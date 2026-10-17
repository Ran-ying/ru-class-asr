import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const source=resolve('scripts/mac-whisper-models.sh');
function prepared() {
  const root=mkdtempSync(join(tmpdir(),'ru-asr-json-run-'));
  const repo=join(root,'ru-class-asr');
  const bin=join(root,'bin');
  mkdirSync(join(repo,'scripts'),{recursive:true});mkdirSync(bin);
  const script=join(repo,'scripts','mac-whisper-models.sh');
  copyFileSync(source,script);
  for(const [name,content] of [
    ['uname','if [ "$1" = "-s" ];then echo Darwin;else echo arm64;fi'],
    ['xcrun','echo /mock/clang']
  ]){
    writeFileSync(join(bin,name),'#!/bin/sh\n'+content+'\n');chmodSync(join(bin,name),0o755);
  }
  const env:NodeJS.ProcessEnv={...process.env,PATH:bin+':'+process.env.PATH};
  for(const key of ['WHISPER_MODEL','WHISPER_URL','WHISPER_TEMPERATURE',
    'WHISPER_TEMPERATURE_INC','WHISPER_TIMEOUT_MS','RU_CLASS_ASR_CONFIG'])
    delete env[key];
  return {root,repo,script,env,
    write:(model:string,url='http://127.0.0.1:8080/inference')=>
      writeFileSync(join(repo,'config.json'),
        JSON.stringify({apiKey:'a-synthetic-only-long-key',whisper:{model,url,temperatureInc:0.2}}))};
}
test('run MODEL checks config.json model instead of silently overriding the chosen weights',()=>{
  const t=prepared();
  try{
    t.write('medium');
    const r=spawnSync('bash',[t.script,'run','small'],{cwd:t.repo,env:t.env,encoding:'utf8'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/config.json selects medium, but run requested small/);
    assert.doesNotMatch(r.stderr,/Missing engine checkout/);
  }finally{rmSync(t.root,{recursive:true,force:true});}
});
test('run with no model uses configuration and rejects remote inference URLs for local engine',()=>{
  const t=prepared();
  try{
    t.write('small','http://remote.example/inference');
    const r=spawnSync('bash',[t.script,'run'],{cwd:t.repo,env:t.env,encoding:'utf8'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Invalid config.json model\/URL/);
    assert.doesNotMatch(r.stderr,/Missing engine checkout/);
    t.write('small');
    const p=spawnSync('bash',[t.script,'run'],{cwd:t.repo,env:t.env,encoding:'utf8'});
    assert.notEqual(p.status,0);
    assert.match(p.stderr,/Missing engine checkout/);
    assert.doesNotMatch(p.stderr,/Invalid config.json model\/URL/);
  }finally{rmSync(t.root,{recursive:true,force:true});}
});
test('run rejects old hidden environment overrides so the JSON is the source of truth',()=>{
  const t=prepared();
  try{
    t.write('small');
    const r=spawnSync('bash',[t.script,'run'],{cwd:t.repo,
      env:{...t.env,WHISPER_TEMPERATURE_INC:'0'},encoding:'utf8'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Unset WHISPER_TEMPERATURE_INC before run/);
  }finally{rmSync(t.root,{recursive:true,force:true});}
});
