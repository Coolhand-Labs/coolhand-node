import { readCappedResponseText, teeResponseForCapture, CAPTURE_IDLE_TIMEOUT_MS } from '../src/utils/capped-fetch-body';

describe('readCappedResponseText', () => {
  it('reads a streamed body up to the cap and reports truncation', async () => {
    const onTruncate = jest.fn();
    const text = await readCappedResponseText(new Response('a'.repeat(100)), 10, onTruncate);

    expect(text).toBe('a'.repeat(10));
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('skips reading a polyfilled body whose Content-Length exceeds the cap (#254)', async () => {
    const onTruncate = jest.fn();
    const text = jest.fn(() => Promise.resolve('c'.repeat(100)));
    const responseLike = { body: {}, headers: new Headers({ 'content-length': '100' }), text } as unknown as Response;

    expect(await readCappedResponseText(responseLike, 10, onTruncate)).toBe('');
    expect(text).not.toHaveBeenCalled();
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('does not flag truncation for a bodyless response (HEAD/204) that carries a large Content-Length (#254)', async () => {
    const onTruncate = jest.fn();
    const responseLike = { body: null, headers: new Headers({ 'content-length': '100' }), text: () => Promise.resolve('') } as unknown as Response;

    expect(await readCappedResponseText(responseLike, 10, onTruncate)).toBe('');
    expect(onTruncate).not.toHaveBeenCalled();
  });

  it('still reads a polyfilled body whose Content-Length is within the cap (#254)', async () => {
    const text = jest.fn(() => Promise.resolve('short'));
    const responseLike = { body: {}, headers: new Headers({ 'content-length': '5' }), text } as unknown as Response;

    expect(await readCappedResponseText(responseLike, 10)).toBe('short');
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('truncates the .text() fallback when the body is not a readable stream (polyfilled fetch)', async () => {
    const onTruncate = jest.fn();
    const responseLike = { body: null, text: () => Promise.resolve('b'.repeat(100)) } as unknown as Response;

    const text = await readCappedResponseText(responseLike, 10, onTruncate);

    expect(text).toBe('b'.repeat(10));
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('leaves a body under the cap untouched in the fallback path', async () => {
    const onTruncate = jest.fn();
    const responseLike = { body: null, text: () => Promise.resolve('short') } as unknown as Response;

    expect(await readCappedResponseText(responseLike, 10, onTruncate)).toBe('short');
    expect(onTruncate).not.toHaveBeenCalled();
  });
});


// A source we can observe: counts pulls and records cancellation. `total` chunks of `chunkSize`
// bytes, or endless when `total` is Infinity (an SSE-style stream).
function makeSource(total: number, chunkSize = 1024) {
  const stats = { pulls: 0, cancelled: false, cancelReason: undefined as unknown };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (stats.pulls >= total) {
          controller.close();
          return;
        }
        stats.pulls++;
        controller.enqueue(new Uint8Array(chunkSize).fill(97));
      },
      cancel(reason) {
        stats.cancelled = true;
        stats.cancelReason = reason;
      }
    },
    { highWaterMark: 0 }
  );
  return { stream, stats };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe('teeResponseForCapture', () => {
  it('passes the body through to the host and resolves the capture with the same text', async () => {
    const response = new Response('{"hello":"world"}', { status: 201, statusText: 'Created', headers: { 'x-a': 'b' } });

    const { response: host, captured } = teeResponseForCapture(response);

    expect(host.status).toBe(201);
    expect(host.statusText).toBe('Created');
    expect(host.headers.get('x-a')).toBe('b');
    expect(await host.json()).toEqual({ hello: 'world' });
    expect(await captured).toBe('{"hello":"world"}');
  });

  it('mirrors url, redirected and type from the original response', () => {
    const response = new Response('x');
    Object.defineProperty(response, 'url', { value: 'https://api.example.com/v1' });
    Object.defineProperty(response, 'redirected', { value: true });

    const { response: host } = teeResponseForCapture(response);

    expect(host).toBeInstanceOf(Response);
    expect(host.url).toBe('https://api.example.com/v1');
    expect(host.redirected).toBe(true);
    expect(host.type).toBe(response.type);
  });

  it('caps what is captured without truncating what the host receives', async () => {
    const onTruncate = jest.fn();
    const { stream } = makeSource(10, 100);

    const { response: host, captured } = teeResponseForCapture(new Response(stream), 250, onTruncate);
    const hostBytes = (await host.arrayBuffer()).byteLength;

    expect(hostBytes).toBe(1000);
    expect(await captured).toHaveLength(250);
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('does not pull from the source until the host reads (bounded retention for a slow host)', async () => {
    const { stream, stats } = makeSource(Infinity);

    const { response: host } = teeResponseForCapture(new Response(stream));
    await tick();
    expect(stats.pulls).toBe(0);

    const reader = (host.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await tick();

    // One chunk read by the host; nothing queued ahead of it.
    expect(stats.pulls).toBe(1);
    await reader.cancel();
  });

  it('cancels the underlying source when the host cancels, and resolves the capture with the partial body', async () => {
    const { stream, stats } = makeSource(Infinity, 10);

    const { response: host, captured } = teeResponseForCapture(new Response(stream));
    const reader = (host.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.read();

    await Promise.race([
      reader.cancel('host done'),
      tick(1000).then(() => { throw new Error('host cancel hung'); })
    ]);

    expect(stats.cancelled).toBe(true);
    expect(stats.cancelReason).toBe('host done');
    expect(await captured).toHaveLength(20);
  });

  it('resolves (does not reject) the capture when the host cancels while a read is pending', async () => {
    // SSE-style: one chunk, then the source idles until the host aborts.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('hello')); }
    });

    const { response: host, captured } = teeResponseForCapture(new Response(stream));
    const reader = (host.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    const pending = reader.read();
    await tick();
    await reader.cancel('abort');

    expect((await pending).done).toBe(true);
    expect(await captured).toBe('hello');
  });

  it('stops an endless stream once the host cancels via response.body.cancel()', async () => {
    const { stream, stats } = makeSource(Infinity);

    const { response: host, captured } = teeResponseForCapture(new Response(stream));
    const reader = (host.body as ReadableStream<Uint8Array>).getReader();
    for (let i = 0; i < 5; i++) { await reader.read(); }
    reader.releaseLock();
    await (host.body as ReadableStream<Uint8Array>).cancel();
    const pullsAtCancel = stats.pulls;
    await tick();

    expect(stats.cancelled).toBe(true);
    expect(stats.pulls).toBe(pullsAtCancel);
    expect(await captured).toHaveLength(5 * 1024);
  });

  it('errors the host stream and rejects the capture when the source errors', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error('socket reset')); }
    });

    const { response: host, captured } = teeResponseForCapture(new Response(stream));
    captured.catch(() => undefined);

    await expect(host.text()).rejects.toThrow('socket reset');
    await expect(captured).rejects.toThrow('socket reset');
  });

  it('falls back to clone() for responses without a readable stream body', async () => {
    const fake = {
      status: 200,
      body: null,
      clone: () => ({ body: null, text: () => Promise.resolve('cloned') })
    } as unknown as Response;

    const { response, captured } = teeResponseForCapture(fake);

    expect(response).toBe(fake);
    expect(await captured).toBe('cloned');
  });

  it('falls back to clone() when the body stream is already locked', async () => {
    const response = new Response('abc');
    (response.body as ReadableStream<Uint8Array>).getReader();
    const cloneSpy = jest.spyOn(response, 'clone').mockReturnValue({ body: null, text: () => Promise.resolve('locked') } as unknown as Response);

    const result = teeResponseForCapture(response);

    expect(cloneSpy).toHaveBeenCalled();
    expect(result.response).toBe(response);
    expect(await result.captured).toBe('locked');
  });

  describe('idle fallback', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('finalizes the capture when the host never reads the body (status-only check)', async () => {
      jest.useFakeTimers();
      const { stream, stats } = makeSource(Infinity);

      const { captured } = teeResponseForCapture(new Response(stream));
      let settled = false;
      captured.then(() => { settled = true; });

      await jest.advanceTimersByTimeAsync(CAPTURE_IDLE_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);

      expect(settled).toBe(true);
      expect(await captured).toBe('');
      expect(stats.pulls).toBe(0);
    });

    it('keeps the host stream usable after the idle finalize, without extending the capture', async () => {
      const { stream } = makeSource(3, 4);

      const { response: host, captured } = teeResponseForCapture(new Response(stream), undefined, undefined, 10);
      const reader = (host.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      await tick(50);
      expect(await captured).toBe('aaaa');

      const rest: number[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { break; }
        rest.push(value.length);
      }
      expect(rest).toEqual([4, 4]);
      expect(await captured).toBe('aaaa');
    });

    it('does not fire while the host is waiting on a slow source read', async () => {
      const source = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await tick(60);
          controller.enqueue(new Uint8Array(2).fill(97));
          controller.close();
        }
      });

      const { response: host, captured } = teeResponseForCapture(new Response(source), undefined, undefined, 20);

      expect(await host.text()).toBe('aa');
      expect(await captured).toBe('aa');
    });
  });
});

describe('teeResponseForCapture beforeExit finalization', () => {
  it('finalizes pending captures when the event loop drains', async () => {
    const { teeResponseForCapture: tee } = await import('../src/utils/capped-fetch-body');
    const { captured } = tee(new Response('partial body'), 1024, undefined, 60_000);
    process.emit('beforeExit', 0);
    await expect(captured).resolves.toBe('');
  });
});
