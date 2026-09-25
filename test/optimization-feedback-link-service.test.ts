import { OptimizationFeedbackLinkService } from '../src/services/OptimizationFeedbackLinkService';
import { HttpError } from '../src/services/BaseService';

const originalFetch = (global as any).fetch;

function mockFetch(...responses: Array<{ status: number; body?: unknown }>): jest.Mock {
  const fn = jest.fn();
  responses.forEach((r) => {
    const text = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    fn.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: jest.fn().mockResolvedValue(text),
      headers: new Headers()
    });
  });
  return fn;
}

function newService(): OptimizationFeedbackLinkService {
  return new OptimizationFeedbackLinkService({ apiKey: 'private-key-123', silent: true });
}

const ids = (n: number, prefix = 'f'): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('OptimizationFeedbackLinkService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  describe('linkFeedback', () => {
    it('POSTs feedback_id (and note) and returns the created link', async () => {
      const link = { id: 'lnk1', optimization_id: 'opt1', feedback_id: 'fb1', note: 'why', created_at: '2026-09-25T00:00:00Z' };
      const fetchMock = mockFetch({ status: 201, body: link });
      (global as any).fetch = fetchMock;

      const result = await newService().linkFeedback('opt1', 'fb1', { note: 'why' });

      expect(result).toEqual(link);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://coolhandlabs.com/api/v2/optimizations/opt1/feedback_links');
      expect(init.method).toBe('POST');
      expect(init.headers['X-API-Key']).toBe('private-key-123');
      expect(JSON.parse(init.body)).toEqual({ feedback_id: 'fb1', note: 'why' });
    });

    it('omits note when not given', async () => {
      const fetchMock = mockFetch({ status: 201, body: {} });
      (global as any).fetch = fetchMock;
      await newService().linkFeedback('opt1', 'fb1');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ feedback_id: 'fb1' });
    });

    it('sends an explicit null note', async () => {
      const fetchMock = mockFetch({ status: 201, body: {} });
      (global as any).fetch = fetchMock;
      await newService().linkFeedback('opt1', 'fb1', { note: null });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ feedback_id: 'fb1', note: null });
    });

    it('throws HttpError with status on 422', async () => {
      (global as any).fetch = mockFetch({ status: 422, body: { errors: ['already linked'] } });
      await expect(newService().linkFeedback('opt1', 'fb1')).rejects.toMatchObject({ status: 422 });
    });

    it('rejects blank and dot-segment ids without calling fetch', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
      await expect(newService().linkFeedback('', 'fb1')).rejects.toThrow('optimizationId');
      await expect(newService().linkFeedback('..', 'fb1')).rejects.toThrow('optimizationId');
      await expect(newService().linkFeedback('opt1', ' ')).rejects.toThrow('feedbackId');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('encodes the optimization id as a single path segment', async () => {
      const fetchMock = mockFetch({ status: 201, body: {} });
      (global as any).fetch = fetchMock;
      await newService().linkFeedback('a/b', 'fb1');
      expect(fetchMock.mock.calls[0][0]).toContain('/optimizations/a%2Fb/feedback_links');
    });
  });

  describe('bulkLinkFeedback', () => {
    it('sends feedback_ids in one request for <= 100 ids', async () => {
      const fetchMock = mockFetch({ status: 200, body: { linked: 2, already_linked: 1, errored: 0, not_found: ['x'] } });
      (global as any).fetch = fetchMock;

      const result = await newService().bulkLinkFeedback('opt1', ['a', 'b', 'c'], { note: 'n' });

      expect(result).toEqual({ linked: 2, already_linked: 1, errored: 0, not_found: ['x'] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ feedback_ids: ['a', 'b', 'c'], note: 'n' });
    });

    it('chunks into batches of 100 and merges the results', async () => {
      const fetchMock = mockFetch(
        { status: 200, body: { linked: 90, already_linked: 5, errored: 1, not_found: ['a', 'b', 'c', 'd'] } },
        { status: 200, body: { linked: 100, already_linked: 0, errored: 0, not_found: [] } },
        { status: 200, body: { linked: 1, already_linked: 0, errored: 0, not_found: ['z'] } }
      );
      (global as any).fetch = fetchMock;

      const result = await newService().bulkLinkFeedback('opt1', ids(201));

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const sizes = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).feedback_ids.length);
      expect(sizes).toEqual([100, 100, 1]);
      expect(result).toEqual({ linked: 191, already_linked: 5, errored: 1, not_found: ['a', 'b', 'c', 'd', 'z'] });
    });

    it('rejects an empty list and blank ids without calling fetch', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
      await expect(newService().bulkLinkFeedback('opt1', [])).rejects.toThrow('non-empty array');
      await expect(newService().bulkLinkFeedback('opt1', ['a', ''])).rejects.toThrow('feedback id');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('propagates a later batch failure', async () => {
      (global as any).fetch = mockFetch(
        { status: 200, body: { linked: 100, already_linked: 0, errored: 0, not_found: [] } },
        { status: 401, body: { error: 'unauthorized' } }
      );
      const err = await newService().bulkLinkFeedback('opt1', ids(150)).catch((e) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(401);
    });
  });

  describe('unlinkFeedback', () => {
    it('DELETEs the link and resolves on 204', async () => {
      const fetchMock = mockFetch({ status: 204 });
      (global as any).fetch = fetchMock;
      await expect(newService().unlinkFeedback('opt1', 'lnk1')).resolves.toBeUndefined();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://coolhandlabs.com/api/v2/optimizations/opt1/feedback_links/lnk1');
      expect(init.method).toBe('DELETE');
    });

    it('rejects blank and dot-segment ids without calling fetch', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
      await expect(newService().unlinkFeedback('opt1', '..')).rejects.toThrow('linkId');
      await expect(newService().unlinkFeedback('', 'lnk1')).rejects.toThrow('optimizationId');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws HttpError on 404', async () => {
      (global as any).fetch = mockFetch({ status: 404, body: { error: 'not found' } });
      await expect(newService().unlinkFeedback('opt1', 'nope')).rejects.toMatchObject({ status: 404 });
    });
  });
});
