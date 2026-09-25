/**
 * End-to-end proof of `linkFeedback`/`bulkLinkFeedback`/`unlinkFeedback` against a REAL Coolhand
 * server. Nothing is mocked. Run with `npm run test:live` (see templates.live.ts for why it is
 * opt-in), plus the two ids below. Unlike the other live suites this one WRITES: it creates and
 * then removes links, so point it at a local/dev server, never production.
 *
 *   COOLHAND_LIVE_BASE_URL=http://127.0.0.1:3111 \
 *   COOLHAND_LIVE_API_KEY=<private key> \
 *   COOLHAND_LIVE_OPTIMIZATION_ID=<optimization hashid> \
 *   COOLHAND_LIVE_FEEDBACK_ID=<feedback hashid belonging to the same client> \
 *   npm run test:live
 */
import { OptimizationFeedbackLinkService } from '../../src/services/OptimizationFeedbackLinkService';

const baseUrl = process.env.COOLHAND_LIVE_BASE_URL;
const apiKey = process.env.COOLHAND_LIVE_API_KEY;
const optimizationId = process.env.COOLHAND_LIVE_OPTIMIZATION_ID;
const feedbackId = process.env.COOLHAND_LIVE_FEEDBACK_ID;

if (!baseUrl || !apiKey || !optimizationId || !feedbackId) {
  throw new Error(
    'Live tests need COOLHAND_LIVE_BASE_URL, COOLHAND_LIVE_API_KEY (private), ' +
      'COOLHAND_LIVE_OPTIMIZATION_ID and COOLHAND_LIVE_FEEDBACK_ID in the environment.'
  );
}

const LIVE_BASE_URL: string = baseUrl;
const LIVE_API_KEY: string = apiKey;
const OPTIMIZATION_ID: string = optimizationId;
const FEEDBACK_ID: string = feedbackId;

function newService(key: string = LIVE_API_KEY): OptimizationFeedbackLinkService {
  return new OptimizationFeedbackLinkService({ apiKey: key, silent: true, baseUrl: LIVE_BASE_URL });
}

describe('OptimizationFeedbackLinkService against a live server', () => {
  it('links, reports already_linked in bulk, then unlinks', async () => {
    const service = newService();

    const link = await service.linkFeedback(OPTIMIZATION_ID, FEEDBACK_ID, { note: 'coolhand-node live test' });
    expect(typeof link.id).toBe('string');
    expect(link.optimization_id).toBe(OPTIMIZATION_ID);
    expect(link.feedback_id).toBe(FEEDBACK_ID);
    expect(link.note).toBe('coolhand-node live test');

    await expect(service.linkFeedback(OPTIMIZATION_ID, FEEDBACK_ID)).rejects.toMatchObject({ status: 422 });

    const bulk = await service.bulkLinkFeedback(OPTIMIZATION_ID, [FEEDBACK_ID, 'not-a-real-id']);
    expect(bulk).toEqual({ linked: 0, already_linked: 1, errored: 0, not_found: ['not-a-real-id'] });

    await expect(service.unlinkFeedback(OPTIMIZATION_ID, link.id)).resolves.toBeUndefined();
    await expect(service.unlinkFeedback(OPTIMIZATION_ID, link.id)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a missing key with 401', async () => {
    await expect(newService('invalid-key').bulkLinkFeedback(OPTIMIZATION_ID, [FEEDBACK_ID])).rejects.toMatchObject({
      status: 401
    });
  });
});
