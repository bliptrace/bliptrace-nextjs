# @g8scope/nextjs

Next.js framework adapter for [g8scope](https://scope.g8suite.com). A thin layer over the runtime SDK [`@g8scope/js`](https://github.com/bliptrace/bliptrace-js) that wires error capture into Next.js's instrumentation hooks. It is **fire-and-forget** and **never throws into your app** — a slow or unreachable ingest endpoint can never break a request.

The project is resolved **server-side from your ingest key**; it is never sent in the payload.

## Install

```bash
npm install @g8scope/nextjs
```

`next` is an optional peer dependency (>=13) — the adapter does not import Next types, so it works with any modern version.

## Wire it up via `instrumentation.ts`

Next.js 13.4+ runs the `register` export on startup; Next.js 15 calls `onRequestError` for every server-side error. Re-export both from the adapter:

```ts
// instrumentation.ts (project root, or src/)
import { register as registerG8scope, onRequestError as onG8scopeRequestError } from '@g8scope/nextjs';

export function register() {
  registerG8scope({
    key: process.env.BLIPTRACE_INGEST_KEY,
    environment: process.env.NODE_ENV,
    // endpoint defaults to https://ingest.scope.g8suite.com
  });
}

// Next 15 onRequestError signature: (error, request, context)
export const onRequestError = onG8scopeRequestError;
```

That is the whole integration. Every unhandled server error is now captured with request context (method, URL, headers — minus `authorization` and `cookie`).

## Manual capture

Anywhere in server code, after `register()` has run:

```ts
import { captureException } from '@g8scope/nextjs';

try {
  await doRiskyThing();
} catch (err) {
  captureException(err, { context: { user: { id: userId } } });
  throw err; // re-throw if you still want Next to handle it
}
```

## Options

`register(options)` accepts every [`@g8scope/js` `ConfigOptions`](https://github.com/bliptrace/bliptrace-js) field, including:

| Option | Default | Description |
| --- | --- | --- |
| `key` | `null` | Ingest key. The server resolves the project from this. Capture is a no-op without it. |
| `endpoint` | `https://ingest.scope.g8suite.com` | Ingest API base URL. |
| `environment` | `production` | Environment label on the envelope. |
| `release` | `null` | Release / version identifier. |
| `enabled` | `true` | Set `false` to disable capture entirely. |
| `timeout` | `3000` | Send timeout in milliseconds. |
| `ignoreExceptions` | `[]` | Error class names to drop. |
| `scrubKeys` | `[]` | Context keys to redact before sending. |
| `transport` | fetch transport | Inject a custom `Transport` (used in tests). |

`captureException(err, options)` and `onRequestError(err, request, context, options)` accept the same options plus a `context` object that is merged into the envelope, and a `client` override.

## API

- `register(options)` — set up the singleton client. Call from `instrumentation.ts`.
- `onRequestError(error, request, context, options?)` — matches Next 15's hook; builds + ships a request-scoped envelope.
- `captureException(error, options?)` — manual capture via the singleton.
- `buildContext(request)` — build envelope context from a request-like object.
- `getClient()` / `resetClient()` — singleton access (the latter mainly for tests).
- Re-exports `Client`, `Config` from `@g8scope/js`.

## Licence

MIT © Developers Hub Sdn Bhd
