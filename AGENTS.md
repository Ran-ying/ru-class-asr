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

## Multi-model Apple Silicon deployment and decoder settings (2026-10-17)

`scripts/mac-whisper-models.sh` and
`docs/mac-multi-model-deployment.md` cover explicit on-demand
installation and serial operation of **multilingual** Whisper
`small`, `medium`, and `large-v3` on a NEW Apple Silicon Mac mini.
The convenient `large` name is an alias for actual `large-v3`
weights. Never install all models as concurrent running servers:
only one whisper.cpp engine should be loaded for each controlled test
on the 16 GiB Mac mini. The macOS helper defaults to the
`whisper.cpp` checkout **beside** `ru-class-asr`, not a hidden
per-user `~/.local/share` checkout. Existing sibling Git checkouts
and their GGML model files are reused; never silently delete or move
an older hidden installation. `WHISPER_CPP_DIR` explicitly overrides
this layout.

A new config `whisper.temperatureInc` defaults to **0** for strict
old small-model behavior; explicit `0.2` enables a test of upstream
fallback. `whisper.timeoutMs` supports slower large-model inference.
The three official multilingual model weights are pinned by exact
byte count and SHA-256 in `mac-whisper-models.sh`; never treat a file
above an arbitrary size as a valid GGML model. `list` is presence
only; `verify MODEL` proves the pinned hash; invalid existing model
files must never be auto-deleted. The `run` wrapper owns both the
Whisper and Node child and must reap both on SIGINT/SIGTERM (SIGKILL
cannot be trapped). Real Metal validation must still come from engine
logs, not the mere build flag.

The user's preferred local startup is **config.json only**: the
Mac deployment helper supports `run` without an argument, derives
the local engine model/port from `whisper.model`/`whisper.url`, and
starts Node without injected WHISPER_MODEL/WHISPER_URL. Positional
`run MODEL` is only a strict assertion of configuration consistency.
It rejects inherited whisper-related environment overrides and
RU_CLASS_ASR_CONFIG to avoid silently superseding the file. Existing
direct `npm run dev` environment override API is backwards compatible
for other deployment contexts; do not make it the Mac workflow.
`temperatureInc: 0.2` was compared only with 0 in the same-small
operator experiment: **optimality across 0.1/0.3/etc. was not tested**.
Do not silently switch the historical default from 0.

Operator-reported M4 model comparison is documented in
`docs/m4-2026-10-17-model-comparison.md`. Small + explicit 0.2
temperature increment showed an actual fallback and suppressed an
extreme lexical loop on C2 #76; another offset remained repetitive
without fallback. Default 0 is preserved pending rollout. The user's
private audio and cached hypotheses must not be committed, and
speech accuracy remains unverified.

The API-reported model ID is a configuration string, **NOT** proof that
the weight was loaded. Verify whisper-server `-m` path, model SHA-256,
engine revision, and live Metal backend logs on the host.

The user delegated physical real-model testing to a separate
DeepSeekHarness on a **fresh Mac mini** using
`docs/deepseekharness-mac-mini-model-validation.md`. No human Russian
listening is required; report acoustic accuracy as unverified.
Never use the previously disabled cloud provider key, and never
print a locally generated ASR API key.

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
