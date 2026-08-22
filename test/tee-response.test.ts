import { Readable, PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { createResponseTee } from '../src/utils/tee-response';

function makeRes(): any {
  const res = new Readable({ read() {} }) as any;
  res.statusCode = 200;
  res.statusMessage = 'OK';
  res.headers = { 'content-type': 'application/json' };
  res.rawHeaders = ['Content-Type', 'application/json'];
  res.httpVersion = '1.1';
  res.httpVersionMajor = 1;
  res.httpVersionMinor = 1;
  res.method = undefined;
  res.url = undefined;
  res.socket = { fake: true };
  res.trailers = {};
  res.rawTrailers = [];
  res.complete = false;
  res.aborted = false;
  res.setTimeout = jest.fn().mockReturnThis();
  return res;
}

describe('createResponseTee', () => {
  it('copies IncomingMessage-shaped metadata onto the tee immediately', () => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);

    expect(hostStream.statusCode).toBe(200);
    expect(hostStream.statusMessage).toBe('OK');
    expect(hostStream.headers).toEqual({ 'content-type': 'application/json' });
    expect(hostStream.rawHeaders).toEqual(['Content-Type', 'application/json']);
    expect(hostStream.httpVersion).toBe('1.1');
    expect(hostStream.socket).toBe(res.socket);
  });

  it('shims setTimeout to delegate to the real response and return the tee, not the raw res', () => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);

    expect(typeof hostStream.setTimeout).toBe('function');
    const ret = hostStream.setTimeout?.(5000, jest.fn());
    expect(res.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function));
    // Regression: setTimeout must return the tee, not the real `res` — IncomingMessage#setTimeout
    // returns `this` for chaining (`res.setTimeout(n).on('data', ...)`), and naively binding
    // rather than wrapping would leak the real response back out of that chained call, bypassing
    // the tee entirely.
    expect(ret).toBe(hostStream);
    expect(ret).not.toBe(res);
  });

  it('delivers every chunk to the host stream and does not touch the real res until read', (done) => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);

    let received = '';
    hostStream.on('data', (chunk: Buffer) => { received += chunk.toString(); });
    hostStream.on('end', () => {
      try {
        expect(received).toBe('hello world');
        done();
      } catch (e) {
        done(e);
      }
    });

    res.push('hello ');
    res.push('world');
    res.push(null);
  });

  it('refreshes complete/aborted/rawTrailers once the response has fully arrived', (done) => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);
    hostStream.resume(); // drain so 'end' fires

    hostStream.on('end', () => {
      try {
        expect(hostStream.complete).toBe(true);
        expect(hostStream.aborted).toBe(false);
        expect(hostStream.rawTrailers).toEqual(['X-Trailer', 'value']);
        done();
      } catch (e) {
        done(e);
      }
    });

    res.push('x');
    // Set what Node's http parser sets once the message body has fully arrived — synchronously,
    // before the natural (single) 'end' event fires asynchronously once the tee drains.
    res.complete = true;
    res.rawTrailers = ['X-Trailer', 'value'];
    res.push(null);
  });

  it('forwards \'aborted\' to the tee, including updating the aborted field', (done) => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);

    hostStream.on('aborted', () => {
      try {
        expect(hostStream.aborted).toBe(true);
        done();
      } catch (e) {
        done(e);
      }
    });

    res.emit('aborted');
  });

  it('forwards \'timeout\' to the tee', (done) => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);

    hostStream.on('timeout', () => done());

    res.emit('timeout');
  });

  it('does not crash the process when res errors and the host never attached an error listener', (done) => {
    const res = makeRes();
    createResponseTee(res, PassThrough);

    res.emit('error', new Error('boom'));

    // If this handler fires without the process crashing first, the error was safely swallowed.
    setImmediate(() => done());
  });

  it('still forwards the error to a host that attached its own listener', (done) => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);

    hostStream.on('error', (err: Error) => {
      try {
        expect(err.message).toBe('boom');
        done();
      } catch (e) {
        done(e);
      }
    });

    res.emit('error', new Error('boom'));
  });

  it('destroys the real response when the host destroys its stream mid-flight', (done) => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);

    hostStream.destroy();

    setImmediate(() => {
      try {
        expect(res.destroyed).toBe(true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it('does not throw or emit a spurious error when data arrives after the host destroyed its stream', (done) => {
    const res = makeRes();
    const hostStream = createResponseTee(res, PassThrough);

    hostStream.on('error', (err: Error) => done(err));
    hostStream.destroy();

    expect(() => res.emit('data', Buffer.from('late chunk'))).not.toThrow();

    setImmediate(() => done());
  });

  it('close handler skips destroy() once res is already destroyed, and calls it otherwise', () => {
    // A real Readable (including a real http.IncomingMessage) auto-destroys itself shortly after
    // 'end' regardless of our code, so asserting against a real stream's timing can't actually
    // distinguish "our guard skipped the call" from "Node's own auto-destroy already ran first" —
    // drive the guard directly with a controlled double instead.
    const res = new EventEmitter() as any;
    res.destroyed = false;
    res.destroy = jest.fn();
    res.headers = {};

    const hostStream = createResponseTee(res, PassThrough);

    hostStream.emit('close');
    expect(res.destroy).toHaveBeenCalledTimes(1);

    // Simulate Node's own auto-destroy (or an explicit prior call) having already run —
    // IncomingMessage.prototype._destroy only tears down the socket when the response didn't
    // complete normally, so this is the "safe to skip" case the guard exists for.
    res.destroyed = true;
    hostStream.emit('close');
    expect(res.destroy).toHaveBeenCalledTimes(1);
  });

  it('pauses the real response once the host has started reading but is slow to drain, and resumes on drain', (done) => {
    class TinyPassThrough extends PassThrough {
      constructor() { super({ highWaterMark: 1 }); }
    }

    const res = makeRes();
    const hostStream = createResponseTee(res, TinyPassThrough);

    // Signal "the host is engaged with the stream" without draining yet, so the internal buffer
    // genuinely fills and write() backpressure kicks in. (Not a 'readable' listener — per Node's
    // docs, `resume()` has no effect while one is attached, which would block the drain below.)
    hostStream.pause();

    res.push(Buffer.alloc(64 * 1024, 'a'));

    setImmediate(() => {
      try {
        expect(res.isPaused()).toBe(true);
      } catch (e) {
        return done(e);
      }

      hostStream.resume(); // switch to flowing + drain — should resume `res`
      res.push(null);

      setImmediate(() => {
        try {
          expect(res.isPaused()).toBe(false);
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });

  it('does not deadlock the real response when the host never reads the tee at all', (done) => {
    // Regression test: an early version paused `res` whenever the tee's internal buffer filled,
    // with no way to un-pause it if nobody ever reads the tee (e.g. a host callback that doesn't
    // consume the body, or no callback at all). Since `res` is the interceptor's own single
    // source of truth, that pause would also silently stall the interceptor's own capture below —
    // 'end' must still fire on `res` for a large response even if the tee is completely unread.
    class TinyPassThrough extends PassThrough {
      constructor() { super({ highWaterMark: 1 }); }
    }

    const res = makeRes();
    createResponseTee(res, TinyPassThrough); // tee intentionally never read

    let received = 0;
    res.on('data', (chunk: Buffer) => { received += chunk.length; });
    res.on('end', () => {
      try {
        expect(received).toBe(64 * 1024);
        done();
      } catch (e) {
        done(e);
      }
    });

    res.push(Buffer.alloc(64 * 1024, 'a'));
    res.push(null);
  });

  it('destroys the tee (never pausing res) once an unread tee exceeds the buffered-byte cap', (done) => {
    // Regression test for the #115 fix's own regression: a host callback that does `await` before
    // attaching a listener leaves the tee unread during that gap, so `hostIsReading()` is false and
    // `res` is correctly never paused (see the test above) — but without a hard cap, the tee's
    // internal buffer would then grow completely unbounded during that gap. This asserts the cap
    // kicks in, `res` is still never touched, and `res`'s own direct listeners (standing in for the
    // interceptor's own capture) still receive everything and see a normal 'end'.
    class TinyPassThrough extends PassThrough {
      constructor() { super({ highWaterMark: 1 }); }
    }

    const res = makeRes();
    const hostStream = createResponseTee(res, TinyPassThrough, 100); // tiny cap, tee intentionally never read

    let received = 0;
    let sawPause = false;
    const originalPause = res.pause.bind(res);
    res.pause = (...args: any[]) => { sawPause = true; return originalPause(...args); };

    res.on('data', (chunk: Buffer) => { received += chunk.length; });
    res.on('end', () => {
      try {
        expect(received).toBe(1024);
        expect(sawPause).toBe(false);
        expect(hostStream.destroyed).toBe(true);
        done();
      } catch (e) {
        done(e);
      }
    });

    res.push(Buffer.alloc(1024, 'a')); // far exceeds the 100-byte cap in one chunk
    res.push(null);
  });

  it('does not destroy the tee when a genuinely-reading-but-slow host exceeds the same tiny cap', (done) => {
    class TinyPassThrough extends PassThrough {
      constructor() { super({ highWaterMark: 1 }); }
    }

    const res = makeRes();
    const hostStream = createResponseTee(res, TinyPassThrough, 100);

    let prematurelyDestroyed = false;
    hostStream.on('error', () => { prematurelyDestroyed = true; });

    hostStream.pause(); // engaged but not draining yet — puts it in "reading" state (see hostIsReading)

    let received = '';
    res.push(Buffer.alloc(1024, 'a')); // far exceeds the 100-byte cap, but the host IS reading

    setImmediate(() => {
      try {
        expect(res.isPaused()).toBe(true);
        expect(prematurelyDestroyed).toBe(false);
      } catch (e) {
        return done(e);
      }

      hostStream.on('data', (chunk: Buffer) => { received += chunk.toString(); });
      hostStream.resume();
      res.push(null);

      setImmediate(() => {
        try {
          // A normally-completed stream also ends up `destroyed: true` (Node's autoDestroy
          // fires once both sides finish) — that alone doesn't indicate the cap kicked in.
          // What actually proves the cap was never hit: no error was emitted, and every byte
          // made it through instead of being cut short by an early hostStream.destroy(err).
          expect(prematurelyDestroyed).toBe(false);
          expect(received).toHaveLength(1024);
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });
});
