# Independent ASR API hardware / browser validation (current v0.1.3)

**Status: M1 DEVELOPMENT SMOKE PASSED; physical-browser end-to-end natural
classroom evidence PENDING; Mac mini M4 FORMAL HARDWARE ACCEPTANCE DEFERRED.**
This document uses the current independent HTTP ASR API, **not** the retired
WebSocket gateway and Worker. Historical M1 synthetic replay details remain
in `m1-development.md`; those measurements do not establish acceptance of
the later browser-direct RU-Class architecture.

## 1. Prepare the actual inference engine

On a test Mac, outside this repository, build whisper.cpp with the
appropriate Metal backend and start its standalone `whisper-server` with
a multilingual Russian-capable model. Record the exact whisper.cpp commit,
model digest, CPU, RAM, macOS, Node and terminal engine logs privately.
Only actual engine logs may confirm Metal (the ASR API deliberately prints
`backend: unverified:check-engine-logs`).

Example upstream engine command, from the whisper.cpp checkout:

```sh
cmake -B build -DGGML_METAL=ON
cmake --build build --config Release -j --target whisper-server
sh models/download-ggml-model.sh small
./build/bin/whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-small.bin -l ru
```

## 2. Start the standalone API

```sh
npm ci
cp config.example.json config.json
# Edit the ignored config.json with a private random API Key >=24 chars.
# Expected: listen.host=127.0.0.1; listen.port=8090;
# whisper.url=http://127.0.0.1:8080/inference; whisper.model=small
npm run dev
```

Startup performs a small real inference probe against the engine before
listening. Do not put the private Key in commands checked into a repository,
log captures or screenshots. The test API's URL for same-device CLI clients
is `http://127.0.0.1:8090/v1`; it is **not** directly usable by a browser
running on a different device.

## 3. Verify API and CORS independently

Use an authorized local secret stored outside Git. Check all combinations
with a real API client:

- `GET /v1/models` without/wrong Bearer -> HTTP 401; correct Bearer ->
  HTTP 200 and configured model ID.
- An authenticated `POST /v1/audio/transcriptions` with a private,
  preconverted **16-kHz mono PCM16 WAV** and `model`, `language=ru`,
  `response_format=json` returns an actual Russian hypothesis, not mock.
- Wrong model -> 400; invalid WAV -> 400; unsupported payload -> appropriate
  error; simultaneous valid inference requests may return 429.
- `OPTIONS /v1/audio/transcriptions` from the actual RU-Class site Origin
  must return the required CORS response without Bearer, while subsequent
  POST still requires Bearer. Exercise unrestricted empty origin list AND
  a nonempty exact-Origin list in separate tests.

A local `curl` request does not test a browser preflight or HTTPS.
For remote browser access, the operator independently provisions an
authenticated, firewalled TLS reverse proxy (or secure tunnel) in front of
the ASR API and restricts access to the internal whisper.cpp port.
Binding `ASR_HOST=0.0.0.0` is allowed directly but does not itself
provide TLS or a firewall.

## 4. Current RU-Class browser-direct end-to-end test

Open the RU-Class static HTTPS site on a physical supported device.
In the browser's speech provider settings, provide the tester's own
ASR `https://...` URL ending in `/v1`, model and private Bearer Key.
The site has **no central login or ASR proxy**; the user's browser must
reach the selected ASR endpoint and the response must satisfy CORS.

Record at least five minutes of natural Russian speech only with required
permission, and privately capture observations:

1. AudioWorklet permission, actual physical microphone input, first live
   captions, subsequent changes and stop-finalization behavior.
2. Audio sample range, ASR request/response times, request frequency, 429
   retry behavior and response when the engine disconnects.
3. Compare the visible transcript and the original private WAV for repeated
   speech, lost phrases and Whisper hallucinations. **Counts are not WER.**
   Browser caption projection happens in `ru-class`; its failures are not
   necessarily the underlying whisper.cpp engine's.
4. Keep the private audio, hypotheses, API Key and domain out of public
   GitHub artifacts; publish only a redacted hardware/configuration/result
   summary and hashes where appropriate.

A different device accessing `localhost` reaches *its own* loopback,
not the test Mac. Remote HTTPS and CORS must be verified from that device.
Do not call a desktop responsive-layout simulation an iPad microphone test.

## 5. Acceptance reporting and outstanding work

Separate these labels in reports:
- `AUTOMATED_TESTS_PASSED` for unit/integration CI;
- `M1_REAL_ENGINE_SYNTHETIC_SMOKE_PASSED` for the measured prior M1 run;
- `BROWSER_DIRECT_REAL_MIC_VERIFIED` only after actual browser evidence;
- `M4_FORMAL_HARDWARE_VALIDATED` only after running this protocol on M4.

The user's deferred **P2 long-duration recording/recovery/full in-page
playback** belongs to the main RU-Class repository and is not part of this
ASR protocol cleanup. Never mark it complete on the strength of ASR tests.
