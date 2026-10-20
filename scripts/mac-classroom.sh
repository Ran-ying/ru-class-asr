#!/usr/bin/env bash
# Explicit Mac mini coordinator: local INT8 translator + existing Whisper
# wrapper (which owns whisper.cpp and the authenticated Node ASR API).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
die(){ echo "[ERROR] $*" >&2; exit 1; }
usage(){
  cat <<'HELP'
bash scripts/mac-classroom.sh install
bash scripts/mac-classroom.sh check
bash scripts/mac-classroom.sh run
install: build existing whisper.cpp/Node and install converted M2M100 INT8.
         Reuses existing Whisper checkout/weights, no service enabled.
check:   verify installed Whisper and converted translation model.
run:     foreground Whisper + CPU translation + Node API from config.json;
         Ctrl+C stops all children started by this wrapper.
Existing mac-whisper-models.sh run remains unchanged for ASR-only mode.
Must explicitly set translation.enabled=true in ignored config.json.
HELP
}
settings(){
  [[ -f "$REPO/config.json" ]] || die "Create config.json first, including a private apiKey."
  command -v node >/dev/null 2>&1 || die "Missing Node.js."
  # This compound launcher uses one authoritative ignored JSON config.
  # The older standalone API still accepts its environment overrides.
  local variable
  for variable in ASR_HOST ASR_PORT ASR_API_KEY ASR_CORS_ORIGINS \
    WHISPER_MODEL WHISPER_URL WHISPER_TEMPERATURE \
    WHISPER_TEMPERATURE_INC WHISPER_TIMEOUT_MS RU_CLASS_ASR_CONFIG;do
    if printenv "$variable" >/dev/null 2>&1;then
      die "Unset $variable for combined run/install; configure config.json instead."
    fi
  done
  local selected
  selected="$(node -e '
    const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(c.translation?.enabled!==true||c.translation?.model!=="m2m100-418m-int8")
      throw Error("Set translation.enabled=true, model=m2m100-418m-int8.");
    const url=new URL(c.translation.url);
    if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||
       url.pathname!=="/translate"||url.username||url.password||url.search||url.hash)
      throw Error("translation.url must use local HTTP /translate");
    const tport=Number(url.port);
    const aport=c.listen?.port??8090;
    const whisperUrl=new URL(c.whisper?.url);
    if(whisperUrl.protocol!=="http:"||whisperUrl.hostname!=="127.0.0.1"||
       whisperUrl.pathname!=="/inference"||whisperUrl.username||
       whisperUrl.password||whisperUrl.search||whisperUrl.hash)
      throw Error("whisper.url must be http://127.0.0.1:PORT/inference");
    const wport=Number(whisperUrl.port);
    if(!Number.isInteger(tport)||tport<1024||tport>65535||
       !Number.isInteger(aport)||aport<1024||aport>65535||
       !Number.isInteger(wport)||wport<1024||wport>65535||
       new Set([tport,aport,wport]).size!==3)
      throw Error("Invalid or conflicting translation, API or Whisper ports");
    if(typeof c.apiKey!=="string"||c.apiKey.length<24)throw Error("Valid private apiKey required");
    if(!["small","medium","large-v3"].includes(c.whisper?.model))
      throw Error("Whisper model must be small, medium or large-v3");
    process.stdout.write([c.whisper.model,tport,aport,wport].join(" "));
  ' "$REPO/config.json")" || die "Check config.json model, Key and ports."
  read -r WHISPER_MODEL TRANSLATION_PORT API_PORT WHISPER_PORT <<< "$selected"
}
free_port(){
  if command -v lsof >/dev/null 2>&1;then
    [[ -z "$(lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true)" ]] ||
      die "Port $1 already in use. Inspect: lsof -nP -iTCP:$1 -sTCP:LISTEN. Stop the existing service from its owning launcher and retry; no process was interrupted."
  fi
}
check(){
  settings
  bash "$REPO/scripts/mac-whisper-models.sh" verify "$WHISPER_MODEL"
  bash "$REPO/scripts/mac-local-translate.sh" verify
  [[ -f "$REPO/dist/src/index.js" ]] || die "Run npm ci and npm run build."
  echo "[PASS] Two model files and Node build ready (not a performance test)."
}
install(){
  settings
  bash "$REPO/scripts/mac-whisper-models.sh" bootstrap
  bash "$REPO/scripts/mac-whisper-models.sh" download "$WHISPER_MODEL"
  (cd "$REPO" && npm ci && npm run build)
  bash "$REPO/scripts/mac-local-translate.sh" install
  check
  echo "[PASS] All components installed, not started. No autostart added."
}
run(){
  check
  # Inspect ALL three configured ports BEFORE loading the translator model.
  # An existing Whisper instance must be stopped by its owning launcher,
  # not killed automatically; otherwise this wrapper would load M2M100,
  # fail at the old ASR script's preflight, and tear down the new process.
  free_port "$WHISPER_PORT"
  free_port "$API_PORT"
  free_port "$TRANSLATION_PORT"
  local translate_pid="" asr_pid="" count ready=no
  cleanup(){
    trap - EXIT INT TERM
    # The old Whisper wrapper owns its own two children and reaps them on TERM.
    for child in "$asr_pid" "$translate_pid";do
      if [[ -n "$child" ]];then kill -TERM "$child" 2>/dev/null || true;fi
    done
    for child in "$asr_pid" "$translate_pid";do
      if [[ -n "$child" ]];then wait "$child" 2>/dev/null || true;fi
    done
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  bash "$REPO/scripts/mac-local-translate.sh" serve &
  translate_pid="$!"
  echo "[INFO] Waiting for local M2M100 health (up to 120 seconds)."
  for ((count=0;count<120;count++));do
    kill -0 "$translate_pid" 2>/dev/null || die "Translator exited during model load."
    if curl --noproxy '*' --silent --fail --max-time 1 \
      "http://127.0.0.1:$TRANSLATION_PORT/health" >/dev/null;then ready=yes;break;fi
    sleep 1
  done
  [[ "$ready" == yes ]] || die "Translator did not become ready."
  echo "[PASS] M2M100 loaded. Starting existing Whisper+Node wrapper."
  bash "$REPO/scripts/mac-whisper-models.sh" run &
  asr_pid="$!"
  # macOS ships Bash 3.2, so do not use wait -n. Poll to detect either
  # process exiting and then reap the other. Ctrl+C triggers both cleanups.
  while kill -0 "$translate_pid" 2>/dev/null && kill -0 "$asr_pid" 2>/dev/null;do
    sleep 2
  done
  die "One child exited; stopping remaining components."
}
case "${1:-help}" in
  -h|--help|help) usage;;
  install) install;;
  check) check;;
  run) run;;
  *) die "Unsupported command; use --help.";;
esac
