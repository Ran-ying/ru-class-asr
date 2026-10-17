#!/usr/bin/env bash
# Install and run whisper.cpp's multilingual small / medium / large-v3 on Apple Silicon.
# Operates only on explicit user commands. No sudo, no persistent credentials.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_DIR="$HOME/.local/share/ru-class-asr/whisper.cpp"
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
  bash scripts/mac-whisper-models.sh engine small|medium|large
  bash scripts/mac-whisper-models.sh run small|medium|large
small/medium/large are multilingual; large maps to large-v3.
bootstrap clones/builds whisper.cpp and refuses to auto-update it.
download uses whisper.cpp's official GGML download script; models coexist.
engine starts the whisper-server alone in the foreground (Ctrl+C to stop).
run starts one whisper-server plus RU-Class-ASR. Requires ignored config.json
with private API key, and npm ci + npm run build. Ctrl+C stops the engine.
No public listener, TLS proxy, Homebrew, or service auto-start is configured.
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
model_ready(){
  local path="$ENGINE_DIR/models/ggml-$1.bin" size
  [[ -f "$path" && ! -L "$path" ]] ||
    fail "Missing weight file; run download first."
  size="$(stat -f %z "$path")"
  (( size > 100000000 )) || fail "Model binary seems incomplete."
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
      echo "$id : installed"
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
  platform;validate_port;engine_ready;model_ready "$1"
  need node;need npm
  node -e 'const v=process.versions.node.split(".").map(Number);
    if(v[0]<22 || (v[0]===22&&v[1]<6))process.exit(1)' ||
    fail "Node.js 22.6+ required."
  [[ -f "$REPO/config.json" ]] ||
    fail "Create ignored config.json with an API Key (at least 24 characters)."
  [[ -f "$REPO/dist/src/index.js" ]] ||
    fail "Run npm ci and npm run build before activating a model."
  if command -v lsof >/dev/null 2>&1;then
    [[ -z "$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)" ]] ||
      fail "Port already in use; stop the previous inference engine."
  fi
  local pid="" count
  umask 077
  cleanup(){
    if [[ -n "$pid" ]];then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  "$ENGINE_DIR/build/bin/whisper-server" \
    --host 127.0.0.1 --port "$PORT" \
    -m "$ENGINE_DIR/models/ggml-$1.bin" -l ru &
  pid="$!"
  echo "[INFO] Starting $1. Waiting for local engine (up to 240 seconds)."
  local ready=no
  for ((count=0;count<240;count++));do
    kill -0 "$pid" 2>/dev/null || fail "Engine exited during model load."
    if curl --noproxy '*' --silent --fail --max-time 2 \
      "http://127.0.0.1:$PORT/" -o /dev/null;then ready=yes;break;fi
    sleep 1
  done
  [[ "$ready" == yes ]] || fail "Engine did not become ready."
  echo "[PASS] Model loaded. Starting authenticated RU-Class-ASR: $1"
  (cd "$REPO" &&
    WHISPER_MODEL="$1" \
    WHISPER_URL="http://127.0.0.1:$PORT/inference" \
    node dist/src/index.js)
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
    engine) (($#==1))||fail "engine needs model";engine_foreground "$(model_name "$1")";;
    run) (($#==1))||fail "run needs model";run_both "$(model_name "$1")";;
    *) fail "Unknown command; use --help";;
  esac
}
main "$@"
