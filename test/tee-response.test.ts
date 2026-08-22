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

  it('destroys the host stream once it exceeds the byte cap, but still delivers the full response to the interceptor\'s own res listeners', (done) => {
    const res = makeRes();
    const onCapExceeded = jest.fn();
    const hostStream = createResponseTee(res, PassThrough, 10, onCapExceeded);

    // Registered separately from the tee, mimicking the interceptor's own (independently capped)
    // capture listeners on `res` at the call sites — these must be unaffected by the host cap.
    let received = 0;
    res.on('data', (chunk: Buffer) => { received += chunk.length; });
    res.on('end', () => {
      try {
        expect(hostStream.destroyed).toBe(true);
        expect(received).toBe(20);
        expect(onCapExceeded).toHaveBeenCalledTimes(1);
        done();
      } catch (e) {
        done(e);
      }
    });

    res.push(Buffer.alloc(20, 'a'));
    res.push(null);
  });

  it('does not destroy the real res when the host stream is destroyed due to the byte cap', (done) => {
    // Same EventEmitter-double technique as the close-handler test above: a real Readable
    // auto-destroys itself shortly after 'end' regardless of our code, so asserting against a
    // real stream can't distinguish "our guard skipped the call" from Node's own auto-destroy.
    const res = new EventEmitter() as any;
    res.destroyed = false;
    res.destroy = jest.fn();
    res.headers = {};

    const onCapExceeded = jest.fn();
    const hostStream = createResponseTee(res, PassThrough, 10, onCapExceeded);

    hostStream.on('close', () => {
      try {
        expect(res.destroy).not.toHaveBeenCalled();
        expect(onCapExceeded).toHaveBeenCalledTimes(1);
        done();
      } catch (e) {
        done(e);
      }
    });

    res.emit('data', Buffer.alloc(20, 'a'));
  });

  it('does not call onCapExceeded or destroy the host stream when it stays under the byte cap', (done) => {
    const res = makeRes();
    const onCapExceeded = jest.fn();
    const hostStream = createResponseTee(res, PassThrough, 1024, onCapExceeded);
    hostStream.resume(); // drain so 'end' fires

    hostStream.on('end', () => {
      try {
        expect(onCapExceeded).not.toHaveBeenCalled();
        expect(hostStream.destroyed).toBe(false);
        done();
      } catch (e) {
        done(e);
      }
    });

    res.push(Buffer.alloc(20, 'a'));
    res.push(null);
  });
});
