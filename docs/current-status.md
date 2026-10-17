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

## Fresh Apple Silicon multi-model operation (2026-10-17)

New `scripts/mac-whisper-models.sh` defaults to a sibling
`../whisper.cpp` checkout alongside the `ru-class-asr` repository,
reusing any preexisting sibling clone and GGML weights. A prior hidden
`~/.local/share/ru-class-asr/whisper.cpp` checkout is left untouched;
set `WHISPER_CPP_DIR` to opt into a different engine location.
The helper builds upstream whisper.cpp with
Metal requested, downloads GGML multilingual `small`, `medium`,
and `large-v3` weights and starts **one** selected model's
whisper-server plus the independent RU-Class-ASR API as a local
foreground pair. `large` is a user-facing alias for `large-v3`.
No existing service is modified, no default remote listener or
service-autostart is created, and no model is actually installed by
GitHub CI.

New `whisper.temperature` / `whisper.temperatureInc` /
`whisper.timeoutMs` config fields are verified by local tests. The
previous decoder policy (0 / 0 increment, 30-second timeout) is
preserved by default for fair historical comparison. The Mac operator
can explicitly compare small 0/0 with small 0/0.2, then medium and
large-v3 at 0/0.2. This does not prove that fallback was invoked,
that Metal is active or that a larger model improves the actual
spoken-word transcript.

See [Mac multi-model deployment](mac-multi-model-deployment.md)
and [DeepSeekHarness fresh-host test brief](deepseekharness-mac-mini-model-validation.md).
The test owner has opted out of human Russian listening; report
`SPEECH_ACCURACY_UNVERIFIED`. The previous Alibaba key is disabled.

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
  top-to-bottom classroom acquisition or five minutes of natural microphone
  Russian. On 2026-10-17, the operator reported **partial Mac mini M4 ASR HTTP
  smoke success**: 8-second real audio transcribed through loopback and HTTPS
  reverse proxy/WireGuard; 20/20 authenticated serial HTTPS requests passed,
  mean 852.380 ms and p95 906.832 ms. **M4 Metal activation and formal
  browser/classroom acceptance remain unverified.**
  Details: [M4 field report](m4-2026-10-17-field-report.md) and
  [privacy-reduced numerical evidence](m4-2026-10-17-http-benchmark.json).
- Never equate a declared backend label with actual Metal activation:
  verify the external whisper-server startup log separately.

## Real-device acceptance (partially completed)

See `docs/hardware-validation.md` for **current** manual steps. A tester
should verify on their own hardware and private HTTPS endpoint:
- `GET /v1/models` with correct/incorrect/absent Bearer key;
- `OPTIONS` from the RU-Class site's real Origin and its authenticated
  `POST` from a physical browser, not `curl` alone;
- real microphone ASR, timed response, 429 backpressure, network loss,
  correct final flush and accuracy of the underlying transcript against
  private Russian speech; the **M4 HTTP-only smoke is passed, but M4 formal
  admission remains pending**.
Long recording, full in-page WAV playback and recovery are P2 work in the
**main repository** and are not in scope for this documentation pass.

## Historic references

`src/worker.ts`, `src/session.ts`, `src/protocol.ts`,
`docs/protocol.md`, and previous gateway examples describe an old
Worker-to-server path. They remain only for migration/contract history.
The actual entrypoint is `src/index.ts`, which creates `src/api.ts` and
`src/inference.ts`.
