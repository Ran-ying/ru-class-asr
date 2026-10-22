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
An additional physical M4 experiment then compared `temperatureInc`
0, 0.1, 0.2, 0.3 and 0.4 on 11 fixed windows / 185 local requests,
see `docs/m4-2026-10-17-temperature-inc-sweep.md`. The 0.2 value is
the current *provisional engineering trial* candidate, not an acoustic
accuracy optimum. The 24.5 s blind spot triggers **no** fallback at any
increment; do not pursue 0.15/0.25 on one source before full caption
replay and more independent audio. Do not silently switch the historical
default from 0.

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


## Optional M2M100 Apple Silicon translation (2026-10-18)

New local translation is **disabled by default**. `config.json.translation`
selects only a loopback `http://127.0.0.1:PORT/translate`, enabled flag,
model ID `m2m100-418m-int8`, request timeout and CPU thread limit.
`src/api.ts` must enforce the same Bearer Key / strict CORS used for ASR
on `POST /v1/translate`, keep the input and output bounded, and use
a **separate** translation busy guard so an expensive CPU inference
does not block ASR. Never expose the Python engine to the Internet or
put private classroom text, key values, or audio into logs.

`scripts/mac-local-translate.sh install` downloads the pinned upstream
`facebook/m2m100_418M` snapshot, converts to CTranslate2 CPU INT8 in
an ignored directory and saves a SHA-256 manifest; it must never overwrite
existing weights or auto-download at runtime. `scripts/mac-classroom.sh run`
starts one translator plus the existing Whisper wrapper (which manages
whisper.cpp+Node) and tears down owned children on termination.
No sudo, implicit system launchd service, remote listener, model download
on start, or automatic Whisper model switch. Existing ASR-only workflows
continue unmodified. CI should test Python service and SHA manifest with
fixtures and shell syntax; actual CTranslate2 model compatibility,
Whisper/CPU contention, M4 translation latency and memory are **not**
validated until physical Mac mini trials.


## Optional whisper.cpp Silero VAD (2026-10-21)

`config.json.whisper.vad` (`enabled`, `model: silero-v6.2.0`, `threshold`
0.1–0.9) is **off when absent**. When enabled, `mac-whisper-models.sh run`
verifies `ggml-silero-v6.2.0.bin` (885098 bytes, SHA-256 `2aa269b7…6987`,
identical to whisper.cpp's own test fixture) and passes `--vad --vad-model
--vad-threshold` to whisper-server; `download-vad` / `verify-vad` never
delete or overwrite an existing file. Physical M4 smoke (2026-10-21): pure
silence / low noise changed from subtitle-credit or `[звук …]` hallucinations
to empty text, and synthetic Russian speech text was byte-identical with and
without VAD. This is NOT a classroom accuracy or 44-window replay result;
re-run the private replay before claiming caption equivalence.


## verbose_json segment times for RU-Class v0.6 (2026-10-21)

`response_format=verbose_json` forwards whisper.cpp SEGMENT start/end (window-
relative seconds) through `sanitizeSegments` (ordered, within duration+0.5 s,
<=200, text <=4000). Text must stay byte-identical to `json` (verified on the
M4). Do not forward word/token timings: under VAD they are relative to the
speech-only audio and are sub-word pieces. Adapters without `inferVerbose`
answer 400 so browsers fall back to `json`.

## Silent-window whisper-server crash (2026-10-22, v0.1.5)

With `--vad`, a `verbose_json` request whose whole window is silence made
whisper-server (v1.9.5) segfault: its default language-probability pass runs
on the VAD-trimmed (empty) audio, gets language id -2 and passes the null
`whisper_lang_str_full` result into JSON. Reproduced on the M4 with 8 s of
zeros; `json` and `verbose_json` + `no_language_probabilities=true` both
survive. `WhisperHttp` therefore always sends `no_language_probabilities=true`
for `verbose_json`; never remove it while VAD is supported.
`mac-whisper-models.sh run` now watches the engine as well as the API and
exits when either dies, so a dead engine can no longer hide behind a live API
that answers every request with 502 `transcription_failed`.

## Engine auto-restart (2026-10-22, v0.1.6)

`mac-whisper-models.sh run` restarts a dead whisper-server in place instead of
exiting (start_engine/wait_engine); the Node API keeps running and returns 502
for ~2 s, which RU-Class >= 0.6.2 retries. More than `MAX_ENGINE_RESTARTS`
(default 5) within 10 minutes still fails visibly. The watch loop uses
`sleep & wait` so TERM/INT cleanup is immediate. Verified on the M4 with
`kill -SEGV`: recovery 2 s, crash-loop limit stops both children, TERM leaves
no listeners. The TERM safety test now waits up to 10 s: the wrapper's
`node -e` prechecks exceeded the old 2 s budget on a busy Mac (pre-existing
spurious failure).
