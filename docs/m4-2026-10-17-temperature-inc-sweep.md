## Mac mini M4 follow-up: small temperature increment five-point sweep (2026-10-17)

**Provenance:** DeepSeekHarness operator-reported local real-inference report supplied by the owner. The raw classroom audio, hypotheses, live config, API key and private paths are intentionally **not** included. These statistics are not independently reproduced by CI, and do not constitute a measured speech word-error rate.

### Fixed setup

- Mac mini M4, 10-core CPU, 16 GiB unified memory; macOS 26.5.2; Node 24.7.0.
- ASR code `dc6f06b3bc445be31c7467af977194353a33193d`; whisper.cpp `0c7be696371069e0baa2515ed7aa08d5a5473aa6` (v1.9.5-2).
- Multilingual small GGML SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.
- Fixed `temperature=0`, `timeoutMs=30000`, 16 kHz PCM16 mono WAV, same weight and engine options. **Only** `whisper.temperatureInc` changed in an ephemeral private `config.json` copy. Original live `config.json` SHA was reportedly unchanged; production/default config and web reducer untouched.
- 11 focus/control audio windows × 5 increments = 55 independent model starts with reported live `MTL0 (Apple M4)` backend. 3–5 serial requests per combination, **37 requests per increment, 185/185 HTTP 200**; no normal-path timeout/429/5xx. Fallback counts isolated to one focus window per fresh engine rather than contaminated by warmup.
- A separate operator-only smoke of latest file-driven `run` returned HTTP 200, wrapper TERM exit code 143, both service ports released.

### Main controlled comparison

`C2 #76` is the exact private 8-second source sample range 1,267,200–1,395,200 (79.2–87.2 seconds).

| inc | C2 #76 words / unique / max trigram | C2 #76 fallback count over 5 runs | 24.5 s words / unique / max trigram | 24.5 s fallback | Overall mean | Overall p95 | Total fallback (p/h) |
|---:|---|---:|---|---:|---:|---:|---|
| 0 | 164 / 7 / 53 | 0 | 45 / 6 / 8 | 0 | 0.485 s | 1.325 s | 0 / 0 |
| 0.1 | 11 / 9 / 1 | 5 | 45 / 6 / 8 | 0 | 0.657 s | 1.483 s | 15 / 0 |
| **0.2** | **13 / 12 / 1** | **5** | **45 / 6 / 8** | **0** | **0.667 s** | **1.519 s** | **15 / 0** |
| 0.3 | 7 / 7 / 1 | 5 | 45 / 6 / 8 | 0 | 0.567 s | 1.567 s | 15 / 0 |
| 0.4 | 5 / 5 / 1 | 5 | 45 / 6 / 8 | 0 | 0.558 s | 1.432 s | 15 / 0 |

All 55 incremental focus combinations had consistent identical outputs across 3–5 repeated requests. At any nonzero tested increment, *the same four audio regions triggered fallback*: C2 #76 (5 over repeats), C1 #30 (4), adjacent 79.4 s (3), and S08_16 (3). The increment changed **candidate content**, not the observed trigger count under this experiment.

### Related focus counts (length only, NOT speech truth)

| Window | 0 | 0.1 | 0.2 | 0.3 | 0.4 |
|---|---:|---:|---:|---:|---:|
| C1 #30 (24.0–32.0 s) | 3 | 3 | **22** | 28 | 20 |
| C2 adjacent 79.4 s | 14 | 9 | **14** | 15 | 3 |
| C1 #120 final | 15 | 15 | 15 | 15 | 15 |
| C2 adjacent 79.0 s | 15 | 15 | 15 | 15 | 15 |
| 24.5 s potential repetitive speech / decoding | 45 | 45 | 45 | 45 | 45 |
| S08_16 | 21 | 19 | 19 | 18 | 20 |

Several other 8-second controls (S40_48, S56_64, S64_72, S96_104) were unchanged across all five increments. Observed 0.1 fallback at C1 #30 did **not** change the original three-word hypothesis; fallback **triggering** is not synonymous with **useful** output. At 0.4 the 79.4 s window shrank to three words, a potential missing-content signal, not proven omission. At 24.5 s all increments produced 45 words / 6 unique / 8 repeated trigrams, with **zero fallback**. Its rate is 5.625 words/sec, so RU-Class Draft PR #25's conservative lexical guard (≥40 words *and* ≥8 words/sec *and* other criteria) would **not** quarantine this sample.

### Interpretation and decision

- **`0.2` is the best **provisional engineering trial** on these chosen finite proxies**: removes the extreme historical loop, preserves C1 #30's longer candidate and adjacent 79.4 s candidate, and has realistic local M4 latency. It is **not a demonstrated acoustic/WER optimum**, nor statistically representative of diverse classroom speech.
- 0.1, 0.2, 0.3, 0.4 all eliminated the 164-token extreme loop; none fixed the 24.5 s no-fallback blind spot. Bracketing 0.15 and 0.25 might tune this *same sample*, but adds limited value until more independent audio and a full session/overlap-reducer replay are available. Avoid overfitting.
- The `0.2` mean (0.667 s) and p95 (1.519 s) are measured over mixed *serial* 8-second requests, not 10-minute browser capture; intermittent fallback may exceed a 1-second request interval and require bounded queue/drop and backpressure accounting.
- Keep production default `temperatureInc=0` unchanged until a deliberate opt-in; the local experiment's ability to run from `config.json` is not an instruction to edit the owner's live config.
- **`SPEECH_ACCURACY_UNVERIFIED`**. Hypothesis length, lexical similarity, fallback count and HTTP 200 cannot determine whether the speaker actually said these words.

### Next gate

Prioritize **new-output full-session re-inference and RU-Class caption reducer replay** over sub-0.1 parameter bracketing. Preserve true original sample ranges and cache provenance. The exact original converted C1/C2 window JSON checksums specified by RU-Class Draft PR #25 are `e09920d62fa6d74295aa7729c4648e918b53466d06cb53f54170f82a88f5db08` and `d0bd6abac8f71193b7bf695b90d39b669dbeecc0728a3d346f078d7ca92afc19`; never claim an independently reconstructed sequence is byte-identical without evidence. Evaluate baseline vs `0.2` with authentic **121 C1 + 106 C2** 8-second overlapping windows; compare baseline and candidate `TranscriptBuffer`/Draft PR #25 logic, 45 historical altered same-range cases (if available), 227 first-stop prefixes, tail corrections and known true-speech repetition false positives. No public browser rollout or change to P1 Draft PR #25 until separate acceptance.

**Operator result labels:** `DEPLOYMENT_PASS` (locally reported); `REAL_INFERENCE_PASS` (185/185); `LOOP_RISK_REDUCED` (C2 #76), **24.5 s blind spot unchanged**; `REALTIME_PERFORMANCE_PASS_CONDITIONAL`; `SPEECH_ACCURACY_UNVERIFIED`.
