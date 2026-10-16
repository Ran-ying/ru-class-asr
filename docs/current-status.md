# RU-Class-ASR current architecture and validation status

Updated 2026-10-17. This document and the current README supersede the
historical WebSocket Worker and gateway wiring in the older v0.1 documents.

## Active independent API

```text
Any OpenAI-compatible client (including a visitor's own RU-Class browser)
  -> HTTPS endpoint /v1 (usually TLS reverse proxy)
  -> independent Node.js RU-Class-ASR service
       GET  /v1/models
       POST /v1/audio/transcriptions
  -> private whisper.cpp whisper-server /inference
       (engine runs as a separate local process)
```

There is **no outbound Worker WebSocket** and no dependency on the RU-Class
Node gateway. The RU-Class website itself is an anonymous static BYOK UI;
each visitor configures the ASR URL, model and private token locally in
their browser and calls the ASR service directly.

## Current runtime contract

- Node.js >=22.6, TypeScript server, external whisper.cpp inference engine.
  Deployment/Metal compilation belongs to that engine, **outside this repo**.
- Default `listen.host=127.0.0.1`, `listen.port=8090`; an operator can
  select *any valid local bind address* with `listen.host` or `ASR_HOST`
  including `0.0.0.0` or `::`. No
  `ASR_ALLOW_PUBLIC_BIND` opt-in variable exists.
- Config via private ignored `config.json`, optional `RU_CLASS_ASR_CONFIG`
  and documented environment overrides. A Bearer API Key >=24 characters
  is **mandatory** for both data endpoints. Never put it in Git.
- `cors.allowedOrigins=[]` or unset means **any browser Origin is allowed
  by CORS**; a non-empty list enforces exact HTTPS Origins (loopback HTTP
  is permitted for local development). `ASR_CORS_ORIGINS` overrides JSON.
  OPTIONS preflight is unauthenticated but GET and POST remain authenticated.
  CORS is not authentication, encryption or rate limiting.
- PCM16 mono 16 kHz WAV, at most 30 seconds, 2 MiB upload cap, one
  in-flight inference (additional requests receive HTTP 429). Output has
  no stream or word-level timestamps.
- Do not expose the internal whisper.cpp HTTP port to the Internet. Binding
  `0.0.0.0` alone does **not** provide HTTPS: configure a firewall and
  trusted TLS reverse proxy / private tunnel if remote browsers connect.

## Local verification

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Testability boundaries:
- API auth, CORS (including preflight and unrestricted mode), JSON config
  and bind-address behavior are covered by automated tests.
- A successful CI check **does not** mean the remote HTTP listener is safely
  firewall-protected or that real browser CORS/TLS works in Safari.
- Historical M1/Metal + 101.16-second synthetic Russian inference passed a
  development smoke. It did **not** validate new v0.2 browser-direct
  top-to-bottom classroom acquisition, five minutes of natural microphone
  Russian or the later Mac mini M4 acceptance.
- Never equate a declared backend label with actual Metal activation:
  verify the external whisper-server startup log separately.

## Real-device acceptance (deferred in part)

See `docs/hardware-validation.md` for **current** manual steps. A tester
should verify on their own hardware and private HTTPS endpoint:
- `GET /v1/models` with correct/incorrect/absent Bearer key;
- `OPTIONS` from the RU-Class site's real Origin and its authenticated
  `POST` from a physical browser, not `curl` alone;
- real microphone ASR, timed response, 429 backpressure, network loss,
  correct final flush and accuracy of the underlying transcript against
  private Russian speech; the user deferred M4 formal admission.
Long recording, full in-page WAV playback and recovery are P2 work in the
**main repository** and are not in scope for this documentation pass.

## Historic references

`src/worker.ts`, `src/session.ts`, `src/protocol.ts`,
`docs/protocol.md`, and previous gateway examples describe an old
Worker-to-server path. They remain only for migration/contract history.
The actual entrypoint is `src/index.ts`, which creates `src/api.ts` and
`src/inference.ts`.
