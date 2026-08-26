/**
 * End-to-end proof of `searchTemplates`/`getTemplate` against a REAL Coolhand server. Nothing here
 * is mocked — every assertion is about a response that actually came off the wire.
 *
 * Run it with `npm run test:live`; it is not part of `npm test`, because it needs a reachable
 * server and a real private API key that CI does not have. It is opt-in rather than conditionally
 * skipped on purpose: if you ask for it, it runs, and a missing prerequisite is a hard failure
 * rather than a green run that quietly proved nothing.
 *
 *   COOLHAND_LIVE_BASE_URL=http://127.0.0.1:3111 \
 *   COOLHAND_LIVE_API_KEY=<your private key> \
 *   npm run test:live
 *
 * The key is read from the environment and never written down here — it is a live credential.
 *
 * Every request is read-only. Nothing in this file creates, updates or deletes a record, so it is
 * safe to point at a shared development database.
 */
import { TemplateService } from '../../src/services/TemplateService';
import { LlmRequestTemplateSummary } from '../../src/types';

const baseUrl = process.env.COOLHAND_LIVE_BASE_URL;
const apiKey = process.env.COOLHAND_LIVE_API_KEY;

if (!baseUrl || !apiKey) {
  throw new Error(
    'Live tests need COOLHAND_LIVE_BASE_URL and COOLHAND_LIVE_API_KEY (a private API key) in the ' +
      'environment. Set both and re-run `npm run test:live`.'
  );
}

// Re-bound after the guard so the rest of the file sees plain `string`, without a cast.
const LIVE_BASE_URL: string = baseUrl;
const LIVE_API_KEY: string = apiKey;

// Every client is created with these two system buckets, and they are hidden from the list unless
// include_system is passed — which is what makes them a real fixture for that flag.
const SYSTEM_TEMPLATE_NAMES = ['Ignored API Calls', 'Unmatched'];

function newService(key: string = LIVE_API_KEY): TemplateService {
  return new TemplateService({ apiKey: key, silent: true, baseUrl: LIVE_BASE_URL });
}

function expectSummaryShape(template: LlmRequestTemplateSummary): void {
  expect(typeof template.id).toBe('string');
  expect(template.id.length).toBeGreaterThan(0);
  expect(typeof template.name).toBe('string');
  expect(typeof template.workload_id).toBe('string');
  expect(typeof template.workload_name).toBe('string');
  expect(typeof template.system_template).toBe('boolean');
  expect(Number.isInteger(template.log_count)).toBe(true);
  expect(typeof template.created_at).toBe('string');
  expect(typeof template.updated_at).toBe('string');
  // Nullable in the API definition, so assert "string or null" rather than a concrete type.
  for (const field of ['status', 'version', 'group', 'deprecated_at'] as const) {
    expect(template[field] === null || typeof template[field] === 'string').toBe(true);
  }
  // Prompt patterns come from `show` only — a list row must not carry them.
  expect(template).not.toHaveProperty('user_prompt_pattern');
  expect(template).not.toHaveProperty('system_prompt_pattern');
}

describe('TemplateService against a live server', () => {
  describe('searchTemplates', () => {
    it('hides the system buckets by default', async () => {
      const { templates, pagination } = await newService().searchTemplates();

      // A client whose only templates are the two system buckets legitimately returns []. This is
      // the include_system default working, not an empty database.
      for (const template of templates) {
        expect(template.system_template).toBe(false);
      }
      expect(pagination.current_page).toBe(1);
      expect(pagination.per_page).toBe(25);
      // total_count counts the whole collection, not this page, so the two only coincide when
      // everything fits on one page.
      if (pagination.total_pages <= 1) {
        expect(pagination.total_count).toBe(templates.length);
      } else {
        expect(pagination.total_count).toBeGreaterThan(templates.length);
      }
    });

    it('returns the system buckets with includeSystem, and reads totals off the response headers', async () => {
      const { templates, pagination } = await newService().searchTemplates({ includeSystem: true });

      const systemTemplates = templates.filter((t) => t.system_template);
      expect(systemTemplates.map((t) => t.name).sort()).toEqual(SYSTEM_TEMPLATE_NAMES);

      // The header total, not the array length — on a page-sized result these coincide, so the
      // real check is that pagination came back populated at all, since this endpoint has no
      // include_total opt-out and must always send the headers.
      expect(pagination.total_count).toBeGreaterThanOrEqual(systemTemplates.length);
      expect(pagination.total_pages).toBeGreaterThanOrEqual(1);
      expect(pagination.has_prev_page).toBe(false);

      for (const template of templates) {
        expectSummaryShape(template);
      }
    });

    it('honours per as a real page size', async () => {
      const { templates, pagination } = await newService().searchTemplates({ includeSystem: true, per: 1 });

      expect(templates).toHaveLength(1);
      expect(pagination.per_page).toBe(1);
      expect(pagination.current_page).toBe(1);
    });

    it('rejects an unrecognized status with 422 rather than an empty list', async () => {
      // Cast past the union: the point is what the *server* does with a bad value, which a
      // TypeScript-only guard would never exercise.
      await expect(newService().searchTemplates({ status: 'nonsense' as never })).rejects.toMatchObject({
        status: 422
      });
    });

    it('rejects an undecodable workload hashid with 422 rather than an empty list', async () => {
      await expect(newService().searchTemplates({ workloadId: 'not-a-hashid' })).rejects.toMatchObject({
        status: 422
      });
    });
  });

  describe('getTemplate', () => {
    it('returns both prompt patterns for a template found via the list', async () => {
      const { templates } = await newService().searchTemplates({ includeSystem: true });
      expect(templates.length).toBeGreaterThan(0);

      const listed = templates[0];
      const detail = await newService().getTemplate(listed.id);

      expect(detail.id).toBe(listed.id);
      expect(detail.name).toBe(listed.name);
      // Present as keys even when null — that is the difference between `show` and a list row.
      expect(detail).toHaveProperty('user_prompt_pattern');
      expect(detail).toHaveProperty('system_prompt_pattern');
      expect(detail.user_prompt_pattern === null || typeof detail.user_prompt_pattern === 'string').toBe(true);
      expect(detail.system_prompt_pattern === null || typeof detail.system_prompt_pattern === 'string').toBe(true);
    });

    it('reaches a system template by id with no opt-in flag, unlike the list', async () => {
      const { templates } = await newService().searchTemplates({ includeSystem: true });
      const systemTemplate = templates.find((t) => t.system_template);
      if (!systemTemplate) {
        throw new Error('Live fixture broken: includeSystem returned no system template.');
      }

      const detail = await newService().getTemplate(systemTemplate.id);

      expect(detail.system_template).toBe(true);
      expect(SYSTEM_TEMPLATE_NAMES).toContain(detail.name);
    });

    it('returns 404, not 403, for an id this client cannot see', async () => {
      await expect(newService().getTemplate('nosuchid00000')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('authentication', () => {
    it('rejects a request with no API key', async () => {
      await expect(newService('').searchTemplates()).rejects.toMatchObject({ status: 401 });
    });

    it('rejects a request with an invalid API key', async () => {
      await expect(newService('ch_priv_definitely_not_a_real_key').searchTemplates()).rejects.toMatchObject({
        status: 401
      });
    });
  });
});
