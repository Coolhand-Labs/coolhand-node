import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import type { AddressInfo } from 'net';
import { Coolhand } from '../src/index';
import { _resetActiveOwner } from '../src/services/RequestMonitoringService';
import { _resetGlobalState } from '../src/global-monitor';

// End-to-end over real sockets: a local "provider" streams SSE frames in separate chunks, the SDK
// monitors it through the real patched fetch/http, and a local "Coolhand backend" records the exact
// bodies POSTed to /api/v2/llm_request_logs. No mocks between the host call and the outgoing payload.
const nodeHttp = require('http');
const nodeHttps = require('https');

const FRAMES = ['data: {"delta":"a"}\n\n', 'data: {"delta":"b"}\n\n', 'data: [DONE]\n\n'];
const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('stream_incomplete end to end (real sockets)', () => {
  const originals = {
    httpRequest: nodeHttp.request, httpGet: nodeHttp.get, httpsRequest: nodeHttps.request, httpsGet: nodeHttps.get,
    fetch: globalThis.fetch
  };
  const sent: Array<{ llm_request_log: { raw_request: Record<string, any> } }> = [];
  let provider: import('http').Server;
  let backend: import('http').Server;
  let base: string;
  let tmpDir: string;
  const openSockets = new Set<import('net').Socket>();

  const rawRequests = () => sent.map((payload) => payload.llm_request_log.raw_request);
  async function waitForRecords(count: number): Promise<void> {
    for (let i = 0; i < 100 && sent.length < count; i++) { await pause(20); }
    // Give a duplicate record time to show up before the caller asserts on the exact count.
    await pause(150);
  }

  beforeAll(async () => {
    backend = nodeHttp.createServer((req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        sent.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        res.setHeader('content-type', 'application/json');
        res.end('{"id":1}');
      });
    });
    provider = nodeHttp.createServer((req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
      const mode = req.url ?? '';
      res.writeHead(200, { 'content-type': 'text/event-stream', ...(mode === '/gzip' && { 'content-encoding': 'gzip' }) });
      void (async () => {
        if (mode === '/gzip') {
          const gz = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
          gz.pipe(res);
          for (let i = 0; i < 300 && !res.destroyed; i++) {
            gz.write(`data: {"i":${i},"t":"${(i * 7919).toString(36)}"}\n\n`);
            gz.flush();
            await pause(2);
          }
          return;
        }
        for (const frame of FRAMES) {
          if (res.destroyed) { return; }
          res.write(frame);
          await pause();
          if (mode === '/drop' && frame === FRAMES[0]) { res.socket?.destroy(); return; }
        }
        if (mode !== '/hold') { res.end(); }
      })();
    });
    for (const server of [provider, backend]) {
      server.on('connection', (socket) => { openSockets.add(socket); socket.on('close', () => openSockets.delete(socket)); });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    }
    const providerPort = (provider.address() as AddressInfo).port;
    base = `http://127.0.0.1:${providerPort}`;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolhand-stream-incomplete-'));
    const patternsFile = path.join(tmpDir, 'patterns.json');
    fs.writeFileSync(patternsFile, JSON.stringify({ patterns: [{ name: 'Local LLM', domains: ['127.0.0.1'], ports: [providerPort], headers: {} }] }));

    _resetGlobalState();
    _resetActiveOwner();
    new Coolhand({
      apiKey: 'test-key',
      silent: true,
      baseUrl: `http://127.0.0.1:${(backend.address() as AddressInfo).port}`,
      patternsFile
    });
  });

  beforeEach(() => { sent.length = 0; });

  afterAll(async () => {
    nodeHttp.request = originals.httpRequest;
    nodeHttp.get = originals.httpGet;
    nodeHttps.request = originals.httpsRequest;
    nodeHttps.get = originals.httpsGet;
    globalThis.fetch = originals.fetch;
    _resetActiveOwner();
    _resetGlobalState();
    for (const socket of openSockets) { socket.destroy(); }
    await Promise.all([provider, backend].map((server) => new Promise((resolve) => server.close(resolve))));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('fetch', () => {
    it('sends a completed stream without the marker, as one record', async () => {
      await (await fetch(`${base}/finish`)).text();
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0]).not.toHaveProperty('stream_incomplete');
      expect(rawRequests()[0].response_body).toBe(FRAMES.join(''));
    });

    it('sends the partial body with stream_incomplete: true when the consumer breaks out of for await', async () => {
      const response = await fetch(`${base}/hold`);
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        expect(chunk.length).toBeGreaterThan(0);
        break;
      }
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(rawRequests()[0].response_body).toBe(FRAMES[0]);
    });

    it('flags a stream abandoned after [DONE] when the server has not closed the connection', async () => {
      const reader = ((await fetch(`${base}/hold`)).body as ReadableStream<Uint8Array>).getReader();
      let seen = '';
      const decoder = new TextDecoder();
      while (!seen.includes('[DONE]')) {
        const { value } = await reader.read();
        seen += decoder.decode(value);
      }
      await reader.cancel();
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(rawRequests()[0].response_body).toBe(FRAMES.join(''));
    });

    it('sends the partial body when an AbortController aborts mid-stream', async () => {
      const controller = new AbortController();
      const response = await fetch(`${base}/hold`, { signal: controller.signal });
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      const pending = reader.read().catch((err: Error) => err);
      controller.abort();
      expect(await pending).toMatchObject({ name: 'AbortError' });
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(String(rawRequests()[0].response_body).startsWith(FRAMES[0])).toBe(true);
    });

    it('sends the partial body when the server drops the connection mid-stream', async () => {
      const response = await fetch(`${base}/drop`);
      await expect(response.text()).rejects.toThrow();
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(rawRequests()[0].response_body).toBe(FRAMES[0]);
    });
  });

  describe('http', () => {
    function get(url: string, onResponse: (res: import('http').IncomingMessage, req: import('http').ClientRequest) => void) {
      const req = nodeHttp.get(url, (res: import('http').IncomingMessage) => onResponse(res, req));
      req.on('error', () => undefined);
      return req;
    }

    it('sends a completed stream without the marker, as one record', async () => {
      get(`${base}/finish`, (res) => res.resume());
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0]).not.toHaveProperty('stream_incomplete');
      expect(rawRequests()[0].response_body).toBe(FRAMES.join(''));
    });

    it('sends the partial body with stream_incomplete: true when the consumer destroys the response mid-stream', async () => {
      get(`${base}/hold`, (res) => { res.once('data', () => res.destroy()); });
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(rawRequests()[0].response_body).toBe(FRAMES[0]);
    });

    it('flags a response destroyed at [DONE] while the server still holds the connection open', async () => {
      get(`${base}/hold`, (res) => {
        let seen = '';
        res.on('data', (chunk: Buffer) => { seen += chunk.toString(); if (seen.includes('[DONE]')) { res.destroy(); } });
      });
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(rawRequests()[0].response_body).toBe(FRAMES.join(''));
    });

    it('sends the partial body when the request is aborted mid-stream', async () => {
      get(`${base}/hold`, (res, req) => { res.once('data', () => req.destroy()); });
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(rawRequests()[0].response_body).toBe(FRAMES[0]);
    });

    it('sends the partial body when the server drops the connection mid-stream', async () => {
      get(`${base}/drop`, (res) => res.resume());
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(rawRequests()[0].response_body).toBe(FRAMES[0]);
    });

    it('decodes the received prefix of a gzip stream the consumer abandons', async () => {
      get(`${base}/gzip`, (res) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 400) { res.destroy(); } });
      });
      await waitForRecords(1);

      expect(rawRequests()).toHaveLength(1);
      expect(rawRequests()[0].stream_incomplete).toBe(true);
      expect(String(rawRequests()[0].response_body)).toMatch(/^data: \{"i":0,"t":"0"\}\n\ndata: \{"i":1,/);
    });
  });
});
