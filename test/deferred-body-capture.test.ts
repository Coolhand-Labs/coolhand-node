import { CappedBuffer } from '../src/utils/capped-buffer';
import { createDeferredBodyCapture } from '../src/utils/deferred-body-capture';

const bufferOf = (text: string) => {
  const buffer = new CappedBuffer(1024);
  buffer.push(Buffer.from(text));
  return buffer;
};

describe('createDeferredBodyCapture', () => {
  it('does no work until scheduled, then runs on setImmediate', async () => {
    const sanitize = jest.fn((b: any) => b);
    const assign = jest.fn();
    const capture = createDeferredBodyCapture(bufferOf('{"a":1}'), sanitize, assign, jest.fn());

    capture.schedule();
    expect(sanitize).not.toHaveBeenCalled();

    await new Promise((r) => setImmediate(r));
    expect(assign).toHaveBeenCalledWith({ a: 1 });
  });

  it('flush runs the capture once, even alongside a scheduled run', async () => {
    const sanitize = jest.fn((b: any) => b);
    const assign = jest.fn();
    const capture = createDeferredBodyCapture(bufferOf('{"a":1}'), sanitize, assign, jest.fn());

    capture.schedule();
    capture.flush();
    capture.flush();
    await new Promise((r) => setImmediate(r));

    expect(sanitize).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('assigns null for an empty body', () => {
    const assign = jest.fn();
    createDeferredBodyCapture(new CappedBuffer(1024), (b: any) => b, assign, jest.fn()).flush();
    expect(assign).toHaveBeenCalledWith(null);
  });

  it('swallows sanitize errors, reports them, and assigns null instead of the raw body', () => {
    const assign = jest.fn();
    const onError = jest.fn();
    const capture = createDeferredBodyCapture(bufferOf('{"secret":"x"}'), () => { throw new Error('boom'); }, assign, onError);

    expect(() => capture.flush()).not.toThrow();
    expect(assign).toHaveBeenCalledWith(null);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });
});
