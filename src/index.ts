import { Client, Config, type ConfigOptions, type Context, type Transport } from '@g8scope/js';
import { buildContext } from './context.js';

export { Client, Config } from '@g8scope/js';
export type { ConfigOptions, Context, Transport, Envelope, Frame } from '@g8scope/js';
export { buildContext, type RequestLike } from './context.js';

/** Options accepted by {@link register}. Extends the runtime config with a test seam. */
export interface RegisterOptions extends ConfigOptions {
  /** Inject a custom transport — used by tests (FakeTransport) and advanced setups. */
  transport?: Transport;
}

/** Per-call options. Lets a single call override the singleton client + add context. */
export interface CaptureOptions extends RegisterOptions {
  /** Extra envelope context merged in (e.g. user, tags, custom). */
  context?: Context;
  /** Use this client instead of (and without setting) the singleton. */
  client?: Client;
}

let singleton: Client | null = null;

/**
 * Set up the singleton g8scope client. Call from `instrumentation.ts`:
 *
 *   export function register() {
 *     register({ key: process.env.BLIPTRACE_INGEST_KEY });
 *   }
 *
 * Returns the client (or null if it could not be built). Never throws.
 */
export function register(options: RegisterOptions = {}): Client | null {
  try {
    const { transport, ...config } = options;
    singleton = new Client(new Config(config), transport);
    return singleton;
  } catch {
    return null;
  }
}

/** The configured singleton client, or null if {@link register} has not run. */
export function getClient(): Client | null {
  return singleton;
}

/** Reset the singleton. Intended for tests. */
export function resetClient(): void {
  singleton = null;
}

/**
 * Matches Next.js 15 `instrumentation.ts` `onRequestError(error, request, context)`.
 * Builds a request-scoped envelope and fires it off. Signature is deliberately
 * loose so it works without importing Next types. Never throws.
 */
export function onRequestError(
  error: unknown,
  request?: unknown,
  context?: unknown,
  options: CaptureOptions = {},
): void {
  try {
    const err = toError(error);
    const client = resolveClient(options);
    if (!client) return;

    const ctx: Context = {
      ...buildContext(request),
      ...(isRecord(context) ? { nextjs: context } : {}),
      ...(options.context ?? {}),
    };

    fireAndForget(client.capture(err, ctx));
  } catch {
    // Capturing must never break the host app.
  }
}

/**
 * Manually capture an exception with the configured singleton (or a per-call
 * client/options override). Never throws.
 */
export function captureException(error: unknown, options: CaptureOptions = {}): void {
  try {
    const err = toError(error);
    const client = resolveClient(options);
    if (!client) return;

    const ctx: Context = { custom: {}, ...(options.context ?? {}) };
    fireAndForget(client.capture(err, ctx));
  } catch {
    // Capturing must never break the host app.
  }
}

function resolveClient(options: CaptureOptions): Client | null {
  if (options.client) return options.client;
  if (options.key !== undefined || options.transport || options.endpoint) {
    const { transport, context: _ctx, client: _c, ...config } = options;
    return new Client(new Config(config), transport);
  }
  return singleton;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  const e = new Error(typeof error === 'string' ? error : safeStringify(error));
  e.name = 'NonError';
  return e;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Swallow rejections from the deferred send so nothing bubbles into the app. */
function fireAndForget(result: void | Promise<void>): void {
  if (result && typeof (result as Promise<void>).then === 'function') {
    (result as Promise<void>).then(undefined, () => {});
  }
}
