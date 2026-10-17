# 2026-10-17 Mac mini M4: same-audio Whisper A/B/C/D model comparison

**Evidence class:** User-supplied, DeepSeekHarness operator-reported real Mac mini
experiment; not raw audio independently replayed by CI or this repository maintainer.
All private audio, raw captions, API credentials, private network endpoints and
machine-specific paths remained local. The numerical results below are derived
from the operator's supplied redacted report; do **not** mark speech accuracy
as verified.

## Reproducibility and genuine hardware

- Hardware: Mac mini M4, 10-core CPU, 16 GiB unified RAM; macOS 26.5.2;
  Node 24.7.0, CMake 4.4.4. The sibling whisper.cpp checkout was reused,
  including an existing small multilingual model.
- `ru-class-asr` revision: `411283c13ef8eef89274446590352130b2b0207f`.
  Engine revision: `0c7be696371069e0baa2515ed7aa08d5a5473aa6`.
- The operator reported runtime Metal logs with `whisper_backend_init_gpu:
  using MTL0 backend` and M4 GPU details for each group. This improves on the
  earlier **HTTP-only** field report, where M4 Metal use was still unverified.
- All three model files were reported to match upstream exact byte count
  and SHA-256:

| Model | Exact bytes | SHA-256 |
| --- | ---: | --- |
| multilingual small | 487601967 | `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` |
| multilingual medium | 1533763059 | `6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208` |
| multilingual large-v3 | 3095033483 | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` |

The reported experiment conducted 130/130 successful serial authenticated
local HTTP requests across all four groups, without timeout, 429 or 5xx in
the *normal* experiment. Separately, 429 backpressure, wrong/missing Key,
model-ID validation, and a forced 1000 ms timeout were tested. **This does
not validate long-duration Safari/Chrome capture or external HTTPS/CORS.**

## Matched C2 #76: extreme lexical repetition

Private 16 kHz mono PCM16 input at source samples
`1,267,200–1,395,200`, i.e. 79.2–87.2 seconds of the same underlying
source. This is a model-level experiment, NOT a whole C1/C2 JSON-cache
caption reducer replay.

| Group | Weight / temperature increment | Words | Unique | Max repeated trigram | Fallbacks on focused request | Mean focused request |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| A | small / 0 | 164 | 7 | 53 | 0 | 1.372 s |
| B | same small / 0.2 | 13 | 12 | 1 | 1 | 1.500 s |
| C | medium / 0.2 | 14 | 13 | 1 | 0 | 0.993 s |
| D | large-v3 / 0.2 | 9 | 9 | 1 | 0 | 1.716 s |

Operator reports identical outputs on repeated identical input
(A: 5/5, B–D: 3/3) and documented that the initial small/0 case matched
the historical 164 / 7 / 53 loop metrics exactly. On small/0.2, the
engine's fallback count was **actually 1**; adding a setting in Node alone
was not the claimed outcome. C/D did not trigger fallback on this specific
sample and cannot be described as benefiting from it.

Window-alignment sensitivity: small/0 gave 14, 15, **164**, 14 and 9
words for starts at 78.7, 79.0, **79.2**, 79.4, and 79.7 seconds,
respectively. small/0.2 gave 14, 15, **13**, 14, 15.

## C1 focus cases and remaining blind spot

- At 24.0 seconds (C1 #30) small/0 yielded a 3-word hypothesis;
  small/0.2 and medium/0.2 yielded 22-word candidates; large-v3/0.2
  yielded 19. At 24.2 seconds, small/0 gave 25 words. A longer
  candidate is **not evidence of improved acoustic correctness**.
- At 24.5 seconds, **both small/0 and small/0.2 still produced**
  45 tokens, 6 unique tokens, and 8 maximum repeated trigrams.
  On the small/0.2 decode the operator reported **zero fallback
  invocations**. The fallback thresholds did not catch that case.
  Important: the RU-Class PR #25 candidate classifier requires
  **at least 40 tokens AND at least 8 tokens/second**, among other
  conditions; an 8-second, 45-token output is ~5.625 tokens/second.
  It is **not** correct to describe this as failing a blanket
  `>=64` token threshold or assume this candidate would quarantine it.
- At C1 #120, A/B/C/D gave 15/15/15/14 tokens. A/B output was identical.
  The report found no new model-level extreme loop there.

## Measured local throughput, not speech correctness

20 repeated local 8-second main-window requests per group:

| Weight / inc | Main p95 | All-request p95 | All-request mean | Peak process RSS |
| --- | ---: | ---: | ---: | ---: |
| small / 0 | 0.308 s | 1.378 s | 0.460 s | ~718 MiB |
| small / 0.2 | 0.422 s | 1.483 s | 0.523 s | ~718 MiB |
| medium / 0.2 | 0.988 s | 1.255 s | 1.025 s | ~1.77 GiB |
| large-v3 / 0.2 | 1.697 s | 2.262 s | 1.767 s | ~3.37 GiB |

Process RSS is not a complete measure of GPU/unified-memory pressure.
These are *loopback serial* observations, not a timed 10-minute browser
session, network path comparison, or word error rate.

The operator considered small+0.2 the strongest currently tested
candidate for the existing one-window-per-second serial browser schedule.
Medium has little slack at ~1 second; large-v3 is too slow for that
strict schedule. None should be silently enabled system-wide until
real browser duration/cadence/stop behavior has been checked.

## Follow-ups, admission boundaries

- Existing Node API default of `temperatureInc=0` remains unchanged to
  preserve historical baseline unless **explicitly** configured otherwise.
  The operator's findings motivate testing `0.2` for a controlled rollout,
  not conflating it with a verified WER improvement.
- Keep RU-Class Draft PR #25's quarantine **default OFF**, with new
  model-output replay before any rollout. This report did not have the
  old exact-SHA 121-/106-window JSON caches and therefore did not
  revalidate the candidate caption reducer on newly produced hypotheses.
- Correct a deployment helper weakness observed by the operator: a
  signal sent to the wrapper shell could leave the Node and engine
  children running even though interactive Ctrl+C cleaned them up.
  Record and clean *both* owned child PIDs; neither PID cleanup nor new
  integrity checks should touch independently running services.
- Old helper's `>100 MB` model check would accept partially downloaded
  large-v3; verify exact bytes and upstream SHA-256, without silently
  deleting existing weights.
- `SPEECH_ACCURACY_UNVERIFIED`: user opted out of human Russian
  listening; no reliable acoustic reference is present. Word counts,
  inter-model agreement and successful HTTP responses are not WER.
- `M4_MODEL_COMPARISON_OPERATOR_REPORTED_PASS` is distinct from a
  `BROWSER_DIRECT_REAL_MIC_VERIFIED` or formal hardware/classroom acceptance.

The operator-reported report included private diagnostic text not
reproduced here. No original WAV, per-window full hypothesis, private host,
or API Key is committed.
