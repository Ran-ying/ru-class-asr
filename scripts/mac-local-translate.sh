#!/usr/bin/env bash
# Explicit M2M100 INT8 install/verification/foreground serve on Apple Silicon.
# No sudo; no login items; never touch the existing whisper.cpp checkout.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$REPO/models/m2m100-418m-int8"
VENV="$REPO/.venv-translate"
PYTHON_BIN="${RU_CLASS_TRANSLATE_PYTHON:-python3.11}"
die(){ echo "[ERROR] $*" >&2; exit 1; }
usage(){
  cat <<'HELP'
bash scripts/mac-local-translate.sh check
bash scripts/mac-local-translate.sh install
bash scripts/mac-local-translate.sh verify
bash scripts/mac-local-translate.sh serve
check:  prerequisites only, no model downloads.
install: create ignored Python venv, download PINNED facebook/m2m100_418M,
         convert to CPU INT8, verify SHA manifest. Never overwrite a model.
verify:  hash and validate converted files; model does not need to be loaded.
serve:   load model once and serve loopback only; uses ignored config.json
         translation.url and translation.threads. Foreground, Ctrl+C to stop.
Use mac-classroom.sh run for Whisper + translator + Node together.
HELP
}
platform(){
  [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] ||
    die "This launcher supports macOS Apple Silicon only."
  command -v "$PYTHON_BIN" >/dev/null 2>&1 ||
    die "Install Homebrew python@3.11 (or set RU_CLASS_TRANSLATE_PYTHON)."
  "$PYTHON_BIN" -c 'import sys; assert (3,11)<=(sys.version_info.major,sys.version_info.minor)<(3,13)' ||
    die "Python 3.11/3.12 required."
}
config(){
  [[ -f "$REPO/config.json" ]] || die "Create ignored config.json first."
  command -v node >/dev/null 2>&1 || die "Node.js required to read config.json."
  local pair
  pair="$(node -e '
    const fs=require("node:fs");let c;
    try{c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}
    catch{throw Error("invalid_config_json");}
    const t=c.translation;
    if(t?.enabled!==true)throw Error("translation.enabled must be true for serve");
    const u=new URL(t.url);
    const port=Number(u.port);
    if(u.protocol!=="http:"||u.hostname!=="127.0.0.1"||
       u.pathname!=="/translate"||u.username||u.password||u.search||u.hash||
       !Number.isInteger(port)||port<1024||port>65535)
      throw Error("translation.url must be http://127.0.0.1:PORT/translate");
    if(t.model!=="m2m100-418m-int8")throw Error("unsupported translation.model");
    const threads=t.threads??2;
    if(!Number.isInteger(threads)||threads<1||threads>6)throw Error("threads must be 1..6");
    process.stdout.write(port+" "+threads);
  ' "$REPO/config.json")" || die "Invalid translation settings."
  read -r PORT THREADS <<< "$pair"
}
model_verify(){
  [[ -x "$VENV/bin/python" ]] || die "Missing .venv-translate, run install."
  "$VENV/bin/python" "$REPO/scripts/install_m2m100.py" verify --model-dir "$MODEL_DIR"
}
install(){
  platform
  command -v curl >/dev/null 2>&1 || die "Missing curl."
  [[ ! -L "$VENV" ]] || die "Refuse symlinked Python environment."
  if [[ ! -d "$VENV" ]];then "$PYTHON_BIN" -m venv "$VENV";fi
  [[ -x "$VENV/bin/python" ]] || die "Incomplete Python venv."
  # The converter and transformers loader are an API pair. Do not let pip
  # silently upgrade only one half into an incompatible Meta-tensor workflow.
  "$VENV/bin/python" -m pip install --disable-pip-version-check --no-cache-dir \
    -r "$REPO/translate/requirements-converter.txt"
  "$VENV/bin/python" "$REPO/scripts/install_m2m100.py" install --model-dir "$MODEL_DIR"
  model_verify
  echo "[PASS] Local CPU INT8 translation installed; no service was started."
}
serve(){
  platform;config;model_verify
  if command -v lsof >/dev/null 2>&1;then
    [[ -z "$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)" ]] ||
      die "Translation port $PORT already in use."
  fi
  echo "[INFO] Loading M2M100 on CPU with $THREADS threads; port $PORT loopback only."
  export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
  exec "$VENV/bin/python" -B "$REPO/translate/server.py" \
    --model-dir "$MODEL_DIR" --threads "$THREADS" --port "$PORT"
}
case "${1:-help}" in
  -h|--help|help) usage;;
  check) platform;echo "[PASS] macOS/Python prerequisites present.";;
  install) install;;
  verify) model_verify;;
  serve) serve;;
  *) die "Unsupported command; use --help.";;
esac
