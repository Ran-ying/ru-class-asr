import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('combined launcher checks Whisper, Node and local translation ports before loading model',()=>{
  const shell=readFileSync('scripts/mac-classroom.sh','utf8');
  assert.match(shell,/whisperUrl=new URL\(c\.whisper\?\.url\)/);
  assert.match(shell,/whisperUrl\.pathname!=="\/inference"/);
  assert.match(shell,/new Set\(\[tport,aport,wport\]\)\.size!==3/);
  assert.match(shell,/read -r WHISPER_MODEL TRANSLATION_PORT API_PORT WHISPER_PORT/);
  const body=shell.slice(shell.indexOf('run(){'),shell.indexOf('case "${1:-help}"'));
  const whisper=body.indexOf('free_port "$WHISPER_PORT"');
  const api=body.indexOf('free_port "$API_PORT"');
  const translator=body.indexOf('free_port "$TRANSLATION_PORT"');
  const engine=body.indexOf('mac-local-translate.sh" serve');
  assert.ok(whisper>=0&&api>whisper&&translator>api&&engine>translator,
    'every port must be checked before any new model load');
  assert.match(shell,/no process was interrupted/);
  assert.doesNotMatch(shell,/\b(killall|pkill)\b/);
});
