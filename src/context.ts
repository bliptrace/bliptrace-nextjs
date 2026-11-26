import type { Context } from '@bliptrace/js';

/** Header names stripped from the captured request context (PII / secrets). */
const STRIP_HEADERS = ['authorization', 'cookie', 'set-cookie'];

/**
 * A request-like object. Tolerant of the Web `Request`, Next.js `NextRequest`,
 * and the loose `{ method, url, headers }` shape Next passes to `onRequestError`.
 */
export interface RequestLike {
  method?: string;
  url?: string;
  headers?: HeadersLike;
  [k: string]: unknown;
}

type HeadersLike =
  | Headers
  | Map<string, string>
  | Record<string, string | string[] | undefined>
  | Iterable<[string, string]>
  | undefined;

/**
 * Build the envelope context from a request-like object. Never throws — on any
 * malformed input it falls back to `{ custom: {} }` so capture always proceeds.
 */
export function buildContext(request?: unknown): Context {
  try {
    const req = (request ?? {}) as RequestLike;
    const headers = scrubHeaders(req.headers);

    const out: Record<string, unknown> = { custom: {} };
    const method = typeof req.method === 'string' ? req.method : undefined;
    const url = typeof req.url === 'string' ? req.url : undefined;

    if (method || url || Object.keys(headers).length > 0) {
      out.request = {
        ...(method ? { method } : {}),
        ...(url ? { url } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }

    return out;
  } catch {
    return { custom: {} };
  }
}

/** Normalise any header-like value into a plain object, dropping sensitive keys. */
function scrubHeaders(headers: HeadersLike): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;

  try {
    const entries = headerEntries(headers);
    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey).toLowerCase();
      if (STRIP_HEADERS.includes(key)) continue;
      out[key] = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue);
    }
  } catch {
    return {};
  }

  return out;
}

function headerEntries(headers: HeadersLike): Iterable<[string, unknown]> {
  // Web Headers / Map both expose entries().
  const maybe = headers as { entries?: () => Iterable<[string, string]> };
  if (typeof maybe.entries === 'function') {
    return maybe.entries();
  }
  // Already an iterable of pairs.
  if (typeof (headers as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    return headers as Iterable<[string, unknown]>;
  }
  // Plain object.
  return Object.entries(headers as Record<string, unknown>);
}
