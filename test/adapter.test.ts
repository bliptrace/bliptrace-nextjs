import { afterEach, describe, expect, it } from 'vitest';
import type { Envelope, Transport } from '@g8scope/js';
import {
  buildContext,
  captureException,
  onRequestError,
  register,
  resetClient,
} from '../src/index.js';

class FakeTransport implements Transport {
  sent: Array<{ endpoint: string; key: string; envelope: Envelope; timeout: number }> = [];
  send(endpoint: string, key: string, envelope: Envelope, timeout: number): void {
    this.sent.push({ endpoint, key, envelope, timeout });
  }
}

afterEach(() => resetClient());

function fakeRequest() {
  return {
    method: 'POST',
    url: 'https://app.example.com/api/orders',
    headers: new Headers({
      authorization: 'Bearer secret-token',
      cookie: 'session=abc123',
      'content-type': 'application/json',
      'x-request-id': 'req-42',
    }),
  };
}

describe('onRequestError', () => {
  it('builds and ships a valid envelope for a thrown Error', () => {
    const t = new FakeTransport();
    register({ key: 'k', endpoint: 'http://api', transport: t });

    onRequestError(new TypeError('boom'), fakeRequest(), { routerKind: 'App Router' });

    expect(t.sent).toHaveLength(1);
    const env = t.sent[0].envelope;
    expect(env.runtime.name).toBe('javascript');
    expect(env.sdk?.name).toBe('g8scope-js');
    expect(env.exception.type).toBe('TypeError');
    expect(env.exception.message).toBe('boom');
    expect(env.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('captures request context stripped of secrets', () => {
    const t = new FakeTransport();
    register({ key: 'k', transport: t });

    onRequestError(new Error('x'), fakeRequest());

    const req = t.sent[0].envelope.context?.request as {
      method: string;
      url: string;
      headers: Record<string, string>;
    };
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://app.example.com/api/orders');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers.cookie).toBeUndefined();
    expect(req.headers['x-request-id']).toBe('req-42');
  });

  it('never throws on a malformed request object', () => {
    const t = new FakeTransport();
    register({ key: 'k', transport: t });

    const nasty = {
      get method(): string {
        throw new Error('exploding getter');
      },
      headers: 12345 as unknown,
    };

    expect(() => onRequestError(new Error('x'), nasty)).not.toThrow();
    expect(t.sent).toHaveLength(1);
  });

  it('does nothing when no client is registered', () => {
    const t = new FakeTransport();
    onRequestError(new Error('x'), fakeRequest());
    expect(t.sent).toHaveLength(0);
  });
});

describe('captureException', () => {
  it('ships an envelope via the singleton', () => {
    const t = new FakeTransport();
    register({ key: 'k', transport: t });

    captureException(new RangeError('manual'), { context: { user: { id: '7' } } });

    expect(t.sent).toHaveLength(1);
    const env = t.sent[0].envelope;
    expect(env.exception.type).toBe('RangeError');
    expect(env.runtime.name).toBe('javascript');
    expect((env.context?.user as { id: string }).id).toBe('7');
  });

  it('wraps a non-Error throwable', () => {
    const t = new FakeTransport();
    register({ key: 'k', transport: t });

    captureException('just a string');

    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].envelope.exception.message).toBe('just a string');
  });

  it('sends nothing when disabled', () => {
    const t = new FakeTransport();
    register({ key: 'k', enabled: false, transport: t });
    captureException(new Error('x'));
    expect(t.sent).toHaveLength(0);
  });

  it('sends nothing without a key', () => {
    const t = new FakeTransport();
    register({ key: null, transport: t });
    captureException(new Error('x'));
    expect(t.sent).toHaveLength(0);
  });

  it('never throws even without registration', () => {
    expect(() => captureException(new Error('x'))).not.toThrow();
  });
});

describe('buildContext', () => {
  it('strips authorization and cookie, keeps method/url', () => {
    const ctx = buildContext(fakeRequest());
    const req = ctx.request as { method: string; url: string; headers: Record<string, string> };
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://app.example.com/api/orders');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers.cookie).toBeUndefined();
    expect(req.headers['content-type']).toBe('application/json');
    expect(ctx.custom).toEqual({});
  });

  it('handles plain-object headers', () => {
    const ctx = buildContext({
      method: 'GET',
      url: '/p',
      headers: { Authorization: 'Bearer x', 'X-Foo': 'bar' },
    });
    const req = ctx.request as { headers: Record<string, string> };
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers['x-foo']).toBe('bar');
  });

  it('falls back to { custom: {} } on undefined / garbage input', () => {
    expect(buildContext(undefined)).toEqual({ custom: {} });
    expect(buildContext(42 as unknown)).toEqual({ custom: {} });
  });
});
