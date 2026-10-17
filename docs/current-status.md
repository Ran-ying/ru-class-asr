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

## Mac mini M4 same-audio multi-model findings (operator report, 2026-10-17)

The independent [M4 four-group comparison](m4-2026-10-17-model-comparison.md)
supersedes **only** the older assumption that M4 runtime Metal evidence
was missing; the supplied newer engine log summary reports an active MTL0
backend. In one matched 8-second private C2 #76 window, small/0/0
returned 164 tokens / 7 unique / 53 max trigram repeats. The same
small weights with `temperatureInc=0.2` yielded 13 / 12 / 1,
**with an observed temperature fallback**. Medium and large-v3 also
removed this extreme cycle in the supplied focus samples but their
one-request-per-second latency is less favorable; model-level looping
is **not fully eliminated** (small/0.2 still repeated at another
alignment with zero actual fallback count).

This was a local ASR and HTTP validation, not a full new 121/106-window
caption replay, ten-minute real microphone session, remote browser CORS,
or a WER measurement. Keep `SPEECH_ACCURACY_UNVERIFIED`, keep
RU-Class PR #25 default OFF, and do not silently change the default
`temperatureInc=0` for users. Consider an explicit 0.2 trial after
a controlled local rollout.

The macOS deploy helper now verifies the **exact upstream model byte
count and SHA-256** for `small`, `medium` and `large-v3` before
loading, and handles TERM by cleaning up the Node and engine children
it owns. `list` merely reports file presence; `verify MODEL` checks
integrity. Existing files are not deleted on failed validation.

### Configuration-first Mac start

On the Mac mini, edit the private `config.json` `whisper.model`,
`whisper.url`, `whisper.temperatureInc` and `whisper.timeoutMs`
directly, then run `bash scripts/mac-whisper-models.sh run`.
The wrapper reads that file to choose the loaded GGML model and
local inference port, starts Node **without** WHISPER_MODEL/URL
environment injection, and refuses mismatched optional `run MODEL`
arguments or inherited whisper-related overrides. Model changes require
a stop/restart. The standalone `npm run dev` environment override
API remains available for backwards compatibility but is not the
preferred Mac workflow.

The operator's small + 0.2 test only compared increment **0 versus
0.2**, not a full threshold/accuracy sweep. There is no evidence
that 0.2 is optimal across diverse Russian audio, nor a validated
acoustic WER; leave default config at 0 until explicitly changed
by the operator.

## M4 small decoder-increment sweep (operator report, 2026-10-17)

The operator reported [five-point real-audio comparison](m4-2026-10-17-temperature-inc-sweep.md):
11 fixed 8-second windows across `temperatureInc` 0/0.1/0.2/0.3/0.4,
**185/185** local serial authenticated requests succeeded, and 55 separate
model starts reported active M4 Metal. The same small weights were used.
At C2 #76 the old 164/7/53 loop changed at 0.2 to 13/12/1 with actual
fallback, but all five settings produced **the same** 45/6/8 hypothesis at
24.5 seconds without triggering fallback. 0.1 left C1 #30 with three words;
0.4 shortened the adjacent 79.4-second hypothesis to three words; their
semantic correctness remains unknown. Under these controlled engineering
proxies **0.2 is the leading optional local candidate**, not a proven
optimal WER setting and not a new project default.

Do **not** refine to 0.15/0.25 just to optimize this one recording
before checking the full source-window sequence and browser caption
projection. RU-Class P1 Draft PR #25 remains OFF and unmerged;
the private original 121/106-window caches may be absent from the test
Mac and their SHA/source timing must be established before a replay
claim. `SPEECH_ACCURACY_UNVERIFIED`.

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
