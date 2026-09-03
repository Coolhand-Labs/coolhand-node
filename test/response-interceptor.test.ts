import { EventEmitter } from 'events';
import { patchResponseEmit } from '../src/utils/response-interceptor';

describe('patchResponseEmit', () => {
  it('routes the first "response" emission through internalCapture before delivering it', () => {
    const req = new EventEmitter() as any;
    const rawRes = { tag: 'raw' };
    const teedRes = { tag: 'teed' };
    const internalCapture = jest.fn().mockReturnValue(teedRes);

    patchResponseEmit(req, internalCapture);

    let received: any;
    req.on('response', (res: any) => { received = res; });
    req.emit('response', rawRes);

    expect(internalCapture).toHaveBeenCalledWith(rawRes);
    expect(received).toBe(teedRes);
  });

  it('delivers the same substituted value to every listener, including ones registered before and after patching', () => {
    const req = new EventEmitter() as any;
    const rawRes = { tag: 'raw' };
    const teedRes = { tag: 'teed' };

    let before: any;
    req.on('response', (res: any) => { before = res; });

    patchResponseEmit(req, () => teedRes);

    let after: any;
    req.on('response', (res: any) => { after = res; });

    req.emit('response', rawRes);

    expect(before).toBe(teedRes);
    expect(after).toBe(teedRes);
  });

  it('only substitutes the first "response" emission — later ones pass through unmodified', () => {
    const req = new EventEmitter() as any;
    const internalCapture = jest.fn().mockReturnValue({ tag: 'teed' });
    patchResponseEmit(req, internalCapture);

    const received: any[] = [];
    req.on('response', (res: any) => { received.push(res); });

    req.emit('response', { tag: 'first' });
    req.emit('response', { tag: 'second' });

    expect(internalCapture).toHaveBeenCalledTimes(1);
    expect(received).toEqual([{ tag: 'teed' }, { tag: 'second' }]);
  });

  it('does not affect other events', () => {
    const req = new EventEmitter() as any;
    patchResponseEmit(req, (res: any) => res);

    const closeHandler = jest.fn();
    req.on('close', closeHandler);
    req.emit('close');

    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  it('falls back to the raw response and calls onPatchFailure when internalCapture throws', () => {
    const req = new EventEmitter() as any;
    const rawRes = { tag: 'raw' };
    const onPatchFailure = jest.fn();

    patchResponseEmit(req, () => { throw new Error('boom'); }, onPatchFailure);

    let received: any;
    req.on('response', (res: any) => { received = res; });
    req.emit('response', rawRes);

    expect(received).toBe(rawRes);
    expect(onPatchFailure).toHaveBeenCalledTimes(1);
  });

  it('calls onPatchFailure when req.emit itself cannot be reassigned', () => {
    const req: any = {
      listenerCount: () => 0,
    };
    Object.defineProperty(req, 'emit', {
      value: () => true,
      writable: false,
      configurable: false,
    });
    const onPatchFailure = jest.fn();

    expect(() => patchResponseEmit(req, (res: any) => res, onPatchFailure)).not.toThrow();
    expect(onPatchFailure).toHaveBeenCalledTimes(1);
  });
});
