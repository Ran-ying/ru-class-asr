#!/usr/bin/env bash
# Install and run whisper.cpp's multilingual small / medium / large-v3 on Apple Silicon.
# Operates only on explicit user commands. No sudo, no persistent credentials.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_DIR="$(dirname "$REPO")/whisper.cpp"
if [[ -n "$(printenv WHISPER_CPP_DIR 2>/dev/null || true)" ]];then ENGINE_DIR="$WHISPER_CPP_DIR";fi
PORT=8080
if [[ -n "$(printenv WHISPER_CPP_PORT 2>/dev/null || true)" ]];then PORT="$WHISPER_CPP_PORT";fi
usage(){
  cat <<'HELP'
RU-Class-ASR new Mac mini helper:
  bash scripts/mac-whisper-models.sh check
  bash scripts/mac-whisper-models.sh bootstrap
  bash scripts/mac-whisper-models.sh download small|medium|large|all
  bash scripts/mac-whisper-models.sh list
  bash scripts/mac-whisper-models.sh verify small|medium|large|all
  bash scripts/mac-whisper-models.sh engine small|medium|large
  bash scripts/mac-whisper-models.sh run [small|medium|large]
small/medium/large are multilingual; large maps to large-v3.
bootstrap clones/builds whisper.cpp and refuses to auto-update it.
download uses whisper.cpp's official GGML download script; models coexist.
engine starts the whisper-server alone in the foreground (Ctrl+C to stop).
run reads whisper.model and whisper.url FROM ignored config.json, starts the
matching whisper-server and the Node API; optional MODEL must match that file.
No model/URL environment injection. Requires a private API key, npm ci + build.
Ctrl+C stops both services.
No public listener, TLS proxy, Homebrew, or service auto-start is configured.
Default checkout: a sibling directory next to ru-class-asr (../whisper.cpp).
Existing sibling whisper.cpp checkouts and downloaded GGML models are reused.
Missing/truncated/tampered models fail verification without deletion.
The former ~/.local/share/ru-class-asr/whisper.cpp is left untouched.
Optional overrides: WHISPER_CPP_DIR, WHISPER_CPP_PORT (default 8080).
HELP
}
fail(){ printf '[ERROR] %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "Missing prerequisite: $1"; }
platform(){
  [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] ||
    fail "Supported deployment: macOS Apple Silicon only."
  need git;need cmake;need curl;need shasum
  need xcrun
  xcrun --find clang >/dev/null 2>&1 ||
    fail "Install Xcode Command Line Tools first: xcode-select --install"
}
model_name(){
  case "$1" in
    small|medium) echo "$1";;
    large|large-v3) echo large-v3;;
    *) fail "Select small, medium, large (large-v3).";;
  esac
}
engine_ready(){
  [[ -d "$ENGINE_DIR/.git" ]] || fail "Missing engine checkout. Run bootstrap."
  [[ -x "$ENGINE_DIR/build/bin/whisper-server" ]] ||
    fail "Engine is not built. Run bootstrap."
}
model_expected(){
  # Expected bytes and SHA-256 from official ggerganov/whisper.cpp GGML
  # multilingual weights (verified on the public upstream model pages).
  case "$1" in
    small) expected_bytes=487601967; expected_sha=1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b;;
    medium) expected_bytes=1533763059; expected_sha=6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208;;
    large-v3) expected_bytes=3095033483; expected_sha=64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2;;
    *) fail "Unsupported model checksum profile: $1";;
  esac
}
model_ready(){
  local path="$ENGINE_DIR/models/ggml-$1.bin" expected_bytes expected_sha size actual_sha
  [[ -f "$path" && ! -L "$path" ]] ||
    fail "Missing weight file; run download first."
  model_expected "$1"
  size="$(stat -f %z "$path")" || fail "Could not read model size."
  [[ "$size" == "$expected_bytes" ]] ||
    fail "Incorrect/incomplete $1 model: $size bytes, expected $expected_bytes. The existing file was NOT deleted."
  actual_sha="$(shasum -a 256 "$path" | awk '{print $1}')" ||
    fail "Failed to hash $1 model."
  [[ "$actual_sha" == "$expected_sha" ]] ||
    fail "SHA256 mismatch for $1; existing file was NOT overwritten or deleted."
  echo "[PASS] Verified $1: exact byte count and official SHA-256."
}
validate_port(){
  [[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT>=1024 && PORT<=65535 )) ||
    fail "WHISPER_CPP_PORT must be in 1024..65535."
}
bootstrap(){
  platform
  if [[ -e "$ENGINE_DIR" ]];then
    [[ -d "$ENGINE_DIR/.git" ]] ||
      fail "ENGINE_DIR exists but is not a whisper.cpp Git checkout."
    echo "[INFO] Retaining existing checkout; no unapproved update."
  else
    mkdir -p "$(dirname "$ENGINE_DIR")"
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$ENGINE_DIR"
  fi
  cmake -S "$ENGINE_DIR" -B "$ENGINE_DIR/build" -DGGML_METAL=ON
  cmake --build "$ENGINE_DIR/build" --config Release --parallel 4 --target whisper-server
  engine_ready
  echo "[PASS] Built whisper-server; upstream Git revision:"
  git -C "$ENGINE_DIR" rev-parse HEAD
}
download_one(){
  local id
  id="$(model_name "$1")"
  engine_ready
  if [[ -f "$ENGINE_DIR/models/ggml-$id.bin" ]];then
    echo "[INFO] Existing model not overwritten: $id"
  else
    (cd "$ENGINE_DIR" && sh models/download-ggml-model.sh "$id")
  fi
  model_ready "$id"
  echo "[PASS] Multilingual model present: $id"
}
list_models(){
  echo "Engine checkout: $ENGINE_DIR"
  local id
  for id in small medium large-v3;do
    if [[ -f "$ENGINE_DIR/models/ggml-$id.bin" ]];then
      echo "$id : present (integrity not checked; use 'verify $id')"
    else echo "$id : absent";fi
  done
}
engine_foreground(){
  platform;validate_port;engine_ready;model_ready "$1"
  exec "$ENGINE_DIR/build/bin/whisper-server" \
    --host 127.0.0.1 --port "$PORT" \
    -m "$ENGINE_DIR/models/ggml-$1.bin" -l ru
}
run_both(){
  platform
  need node;need npm
  [[ -f "$REPO/config.json" ]] ||
    fail "Create ignored config.json with an API Key and whisper.model/whisper.url."
  # This path is file-driven: do not let inherited environment overrides
  # silently change the model, endpoint or decode policy.
  local variable
  for variable in WHISPER_MODEL WHISPER_URL WHISPER_TEMPERATURE WHISPER_TEMPERATURE_INC WHISPER_TIMEOUT_MS RU_CLASS_ASR_CONFIG;do
    if printenv "$variable" >/dev/null 2>&1;then
      fail "Unset $variable before run; put settings in config.json."
    fi
  done
  local configured configured_model configured_port requested_model
  configured="$(node -e '
    const fs=require("node:fs");
    const config=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const model=config.whisper?.model;
    const endpoint=config.whisper?.url;
    if(!["small","medium","large-v3"].includes(model))
      throw Error("config.json whisper.model must be small, medium or large-v3");
    if(typeof endpoint!=="string")
      throw Error("config.json whisper.url must be a local engine URL");
    const url=new URL(endpoint);
    if(url.protocol!=="http:" || url.hostname!=="127.0.0.1" ||
       url.pathname!=="/inference" || url.username || url.password ||
       url.search || url.hash)
      throw Error("config.json whisper.url must be http://127.0.0.1:PORT/inference");
    const port=Number(url.port||"80");
    if(!Number.isInteger(port)||port<1024||port>65535)
      throw Error("Invalid local whisper-server port");
    process.stdout.write(model+"|"+port);
  ' "$REPO/config.json")" || fail "Invalid config.json model/URL."
  IFS='|' read -r configured_model configured_port <<< "$configured"
  [[ -n "$configured_model" && -n "$configured_port" ]] ||
    fail "Incomplete config.json model/port."
  if [[ -n "${1:-}" ]];then
    requested_model="$(model_name "$1")"
    [[ "$configured_model" == "$requested_model" ]] ||
      fail "config.json selects $configured_model, but run requested $requested_model. Edit config.json first."
  fi
  PORT="$configured_port"
  validate_port
  engine_ready
  model_ready "$configured_model"
  node -e 'const v=process.versions.node.split(".").map(Number);
    if(v[0]<22 || (v[0]===22&&v[1]<6))process.exit(1)' ||
    fail "Node.js 22.6+ required."
  [[ -f "$REPO/dist/src/index.js" ]] ||
    fail "Run npm ci and npm run build before activating a model."
  if command -v lsof >/dev/null 2>&1;then
    [[ -z "$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)" ]] ||
      fail "Port already in use; stop the previous inference engine."
  fi
  local engine_pid="" api_pid="" count
  umask 077
  cleanup(){
    # Both children are started directly by this shell. A SIGTERM sent to
    # the wrapper must not leave either the Node API or engine behind.
    trap - EXIT INT TERM
    local child
    for child in "$api_pid" "$engine_pid";do
      if [[ -n "$child" ]];then kill "$child" 2>/dev/null || true;fi
    done
    for child in "$api_pid" "$engine_pid";do
      if [[ -n "$child" ]];then wait "$child" 2>/dev/null || true;fi
    done
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  "$ENGINE_DIR/build/bin/whisper-server" \
    --host 127.0.0.1 --port "$PORT" \
    -m "$ENGINE_DIR/models/ggml-$configured_model.bin" -l ru &
  engine_pid="$!"
  echo "[INFO] Starting $configured_model from config.json. Waiting for local engine (up to 240 seconds)."
  local ready=no
  for ((count=0;count<240;count++));do
    kill -0 "$engine_pid" 2>/dev/null || fail "Engine exited during model load."
    if curl --noproxy '*' --silent --fail --max-time 2 \
      "http://127.0.0.1:$PORT/" -o /dev/null;then ready=yes;break;fi
    sleep 1
  done
  [[ "$ready" == yes ]] || fail "Engine did not become ready."
  echo "[PASS] Model loaded. Starting RU-Class-ASR using config.json: $configured_model"
  (
    cd "$REPO"
    exec node dist/src/index.js
  ) &
  api_pid="$!"
  wait "$api_pid"
}
main(){
  local action=help id
  if (($#));then action="$1";shift;fi
  case "$action" in
    help|--help|-h) usage;;
    check) (($#==0))||fail "Unexpected arguments.";platform;need node;need npm;echo "[PASS] Dependencies available.";;
    bootstrap) (($#==0))||fail "Unexpected arguments.";bootstrap;;
    download)
      (($#==1))||fail "download needs a model or all"
      platform
      if [[ "$1" == all ]];then
        for id in small medium large-v3;do download_one "$id";done
      else download_one "$1";fi;;
    list) (($#==0))||fail "Unexpected arguments.";list_models;;
    verify)
      (($#==1))||fail "verify needs a model or all"
      need shasum
      if [[ "$1" == all ]];then
        for id in small medium large-v3;do model_ready "$id";done
      else model_ready "$(model_name "$1")";fi;;
    engine) (($#==1))||fail "engine needs model";engine_foreground "$(model_name "$1")";;
    run) (($#<=1))||fail "run accepts at most one model";run_both "${1:-}";;
    *) fail "Unknown command; use --help";;
  esac
}
main "$@"
