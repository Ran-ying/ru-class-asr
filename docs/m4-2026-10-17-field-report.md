# Mac mini M4 field report — independent ASR HTTPS and listener diagnostics

Date: **2026-10-17**. Evidence: terminal commands and results supplied by the
operator during a live Mac mini deployment. This is an **operator-reported field
result**, not a new test executed by a CI worker or by the repository maintainer.
The source audio, recognized Russian text, API token, serial numbers, identifiers,
private host names, and real private IPs are deliberately **not included**.

**Verdict: `M4_LOCAL_ASR_REAL_INFERENCE_PASS` and `M4_HTTPS_SERIAL_20_20_PASS`.**
**Not** `M4_FORMAL_HARDWARE_VALIDATED` or classroom accuracy acceptance.

## Actual setup and evidence

| Item | Reported observation |
| --- | --- |
| Machine | Mac mini, Apple M4, 10 CPU cores (4 performance + 6 efficiency), 16 GB RAM |
| System | macOS 26.5.2; Node.js v24.7.0; FFmpeg 8.1 |
| Model | Whisper multilingual `small`; returned by authenticated `GET /v1/models` |
| Inference service | whisper.cpp HTTP server listening on `127.0.0.1:8080` |
| API | Independent RU-Class-ASR Node process, port 3000 in this deployment |
| External path | HTTPS client → Nginx reverse proxy on a remote server → WireGuard → Mac mini ASR → local whisper.cpp |
| Audio | First 8.0 seconds extracted from a private approximately 121.95-second M4A; FFmpeg 16 kHz, mono PCM16 WAV, about 250 KiB |
| Actual GPU backend | **UNVERIFIED**: the relevant M4 Metal startup log was not provided |
| Engine Git revision and model hash | **UNVERIFIED**; prior `git rev-parse` accidentally ran from the ASR repository |
| Browser test | **NOT RUN**; requests in this report are curl, not real browser CORS/microphone captures |

The operator reported a local ASR `POST /v1/audio/transcriptions` with
HTTP **200**, non-empty Russian hypothesis, and **274.190 ms** total time.
An HTTPS request through the external reverse-proxy/WireGuard route to the same
8-second WAV produced HTTP **200** in **962.042 ms** total (TCP connect
5.397 ms; time to first byte 962.017 ms). These are **two separate requests**
and the time difference is **not** an isolated network overhead measurement.

## 20-request M4 HTTPS benchmark

Twenty **serial** authenticated multipart requests reused the same 8-second
WAV. Client used `curl --noproxy '*' --http1.1`; no overlap/concurrency,
pacing, live microphone or transcript correctness judgment. All 20 requests
returned HTTP **200**. Total request time includes client-side HTTP(S),
reverse-proxy, WireGuard, the ASR API and inference.

| Metric | M4 HTTPS total time |
| --- | ---: |
| Count / HTTP 200 | 20 / 20 |
| Mean | **852.380 ms** |
| P50 | **848.889 ms** |
| P95 (linear interpolation at 0.95×(n−1)) | **906.832 ms** |
| Minimum | **809.430 ms** |
| Maximum | **940.146 ms** |
| 429 / 5xx / timeouts in this run | **0 / 0 / 0** |

Source numbers (seconds) and machine-readable calculations are in
[`m4-2026-10-17-http-benchmark.json`](m4-2026-10-17-http-benchmark.json).
These measurements establish successful real inference through the deployed
HTTPS path for the tested 8-second sample. They do **not** establish sustained
live RU-Class transcription, Metal acceleration, acoustic-to-caption latency
or reliable transcription accuracy.

## Comparison with historical M1/Metal development run

Reference: [`m1-development.md`](m1-development.md) and
[`m1-replay-metrics.json`](m1-replay-metrics.json).

| Metric | M1 old Worker→ASR local HTTP inference | M4 independent API via remote HTTPS |
| --- | ---: | ---: |
| Model | multilingual small | multilingual small |
| Input | 101.16 s **synthetic Russian paced replay**, 101 results | same **private natural-audio 8 s window** repeated 20 times |
| Mean | 763.247 ms | 852.380 ms |
| P50 | 773.780 ms | 848.889 ms |
| P95 | 852.866 ms | 906.832 ms |
| Maximum | 975.362 ms | 940.146 ms |
| Samples | 101 | 20 |
| Network/architecture | legacy loopback gateway/Worker HTTP time | current external HTTPS→Nginx→WireGuard→Node ASR time |
| Actual Metal | M1 startup log independently verified | M4 startup log **not available** |

Numerically, the M4 HTTPS mean exceeds M1 loopback HTTP by **89.13 ms** and
the P95 by **53.97 ms**; these numbers are **not CPU/GPU speed differences**.
The network, measurement start/end, sound material, sample counts, ASR topology,
and model/backend verification differ. Comparing a single M4 local API result
(274.190 ms) to the M1 average is likewise **not a valid speedup claim**.
A same-sample, same-API-path benchmark with actual GPU logs is required for
a controlled M1 versus M4 hardware comparison.

## Why wildcard binding worked for local testing (root cause unconfirmed)

**Initial condition:** the operator configured ASR `listen.host` to the
Mac mini's own WireGuard IPv4 address and port 3000. Inspection showed:

- The WireGuard IPv4 address existed on macOS `utun5` as a `/32`
  point-to-point local address; route lookup to that same address returned
  `interface: utun5`, `LOCAL`.
- `lsof` confirmed Node was in `LISTEN` state on that exact WireGuard
  IP and TCP port.
- Nevertheless, a **same-Mac** TCP connection to its own WireGuard IP timed
  out after about **3 seconds**, before any HTTP request could be processed.
- Independently, a **remote VPS-to-Mac WireGuard** unauthenticated model-list
  request returned the expected HTTP 401 in approximately **38 ms**. The
  reverse proxy pointed to the Mac's WireGuard IP:port, with
  `proxy_read_timeout 3600s`, so basic remote connectivity and the expected
  authorization boundary were observed.

**Later condition:** after changing only the listener's address field to
`0.0.0.0` (and restarting the service), the operator tested
`127.0.0.1:3000`: no-key model list returned **401 in 4.194 ms**, and
authenticated 8-second transcription returned **200 in 274.190 ms**.

`0.0.0.0` is an **IPv4 wildcard bind**, not a routable destination; it
makes Node listen on every local IPv4 interface, including loopback and
WireGuard. This gives macOS clients a normal `127.0.0.1` path, avoiding
the previously failing **same-host connection to its own utun address**.

**Do not overstate causality.** No post-change controlled retry of the
same-host WireGuard-IP TCP route was recorded. The successful external HTTPS
attempt also explicitly changed curl to `--noproxy '*'` and `--http1.1`.
Consequently, the operator's evidence **does not prove** whether the prior
external request failures came from bind address, Mac local packet filtering,
VPN/routing, system proxy, HTTP protocol selection, a transient/restart issue,
or some combination. The 8-second and 20-second earlier external requests
failed or reset before an HTTP response; neither outcome demonstrates an
inference speed problem. Do not report an MTU or firewall root cause as
confirmed without an isolated experiment.

Security: wildcard bind also opens the same listener on additional IPv4
interfaces (e.g., local LAN). The operator must restrict exposure using the
host firewall/network policy and keep the external TLS reverse proxy; the
whisper.cpp internal port must stay local.

## Acceptance boundary and later work

- Verified from operator terminal: M4 hardware identity, ASR loopback
  transcription, HTTPS proxy/WireGuard real transcription and short 20/20
  serial HTTP success.
- Pending: actual whisper.cpp M4 Metal startup evidence and exact source/model
  digests, controlled matched-input hardware comparison, physical RU-Class
  browser HTTPS/CORS + microphone, 5+ minutes natural speech, timed/correct
  live subtitle alignment, genuine repetition/omission/hallucination review,
  stop-tail and WAV integrity, and failure handling in browser.
- Deferred work in the separate `ru-class` repository (P2): long recording,
  in-page playback and interrupted-recording recovery remain out of scope.

The correct status is **`M4_ASR_HTTP_SMOKE_PASSED / M4_FORMAL_ACCEPTANCE_PENDING`**.
