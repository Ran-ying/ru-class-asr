# RU-Class-ASR maintainer contract — current (2026-10-17)

Read `README.md`, `docs/current-status.md` and
`docs/hardware-validation.md` before changes. The historical
`docs/architecture.md`, `docs/protocol.md`, `src/worker.ts` and
`src/session.ts` describe an obsolete outbound Worker WebSocket design;
the **active entrypoint** is `src/index.ts`.

## Current service

- A standalone Node.js OpenAI-compatible HTTP transcription API.
  `src/api.ts` exposes Bearer-authenticated `GET /v1/models` and
  `POST /v1/audio/transcriptions`. `src/inference.ts` calls a
  separately installed `whisper.cpp` inference HTTP endpoint.
- No dependency on RU-Class's old gateway or shared server-side models.
  RU-Class v0.2 browser uses browser-direct BYOK and its own CORS-compliant
  ASR provider; no global RU-Class default service, proxy or browser login.
- Default listener is loopback, but **all valid local bind addresses** may
  be configured directly using `listen.host` or `ASR_HOST`; no special
  `ASR_ALLOW_PUBLIC_BIND` environment flag or ban on `0.0.0.0`.
- Empty/missing `cors.allowedOrigins` permits any Origin, and a populated
  list permits only those exact Origins. CORS preflight occurs without
  Authorization but both data endpoints still require Bearer.
- Preserve the 16kHz PCM16 mono WAV contract (30 seconds/2 MiB per request),
  bounded one-at-a-time inference and HTTP 429 backpressure. No invented
  word timestamps, SSE, or claim of arbitrary audio-format support.

## Change controls and verification

- Never commit credentials, private DNS/hosts, raw classroom recordings,
  model binaries or unredacted device logs. Keep personal config ignored.
- Bind to a public interface only if the *operator* configures it; TLS,
  firewall, and API-key handling are operational duties, not silently
  delivered by a host string. Do not deploy for the user without approval.
- Run `npm test`, `npm run typecheck`, `npm run build` and inspect
  relevant CI results. Verify browser CORS/HTTPS with a physical browser.
- Keep docs in sync with the active API. Historical protocol/Worker content
  should be labeled archival in *separate* current-status/README notes, not
  by editing mirrored protocol files. `src/protocol.ts` and `docs/protocol.md`
  must remain byte-identical to their copies in `ru-class`; CI checks that.
- M1/Metal 101.16-second synthetic development inference was observed;
  five-minute real Russian microphone/classroom and later M4 formal
  acceptance remain unverified. Do not call automated tests a hardware pass.
- User deferred P2 long recording and full in-browser playback/recovery in
  the main RU-Class repository; do not introduce incidental P2 changes here.
