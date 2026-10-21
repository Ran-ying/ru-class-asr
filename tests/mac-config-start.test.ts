import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,rmSync,writeFileSync,chmodSync,readFileSync} from 'node:fs';
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
test('run validates whisper.vad from config.json before touching the engine',()=>{
  const t=prepared();
  try{
    const write=(vad:unknown)=>writeFileSync(join(t.repo,'config.json'),JSON.stringify({apiKey:'a-synthetic-only-long-key',
      whisper:{model:'small',url:'http://127.0.0.1:8080/inference',vad}}));
    write({enabled:true,threshold:2});
    const bad=spawnSync('bash',[t.script,'run'],{cwd:t.repo,env:t.env,encoding:'utf8'});
    assert.notEqual(bad.status,0);
    assert.match(bad.stderr,/whisper.vad.threshold must be between 0.1 and 0.9/);
    assert.doesNotMatch(bad.stderr,/Missing engine checkout/);
    write({enabled:true});
    const ok=spawnSync('bash',[t.script,'run'],{cwd:t.repo,env:t.env,encoding:'utf8'});
    assert.notEqual(ok.status,0);
    assert.match(ok.stderr,/Missing engine checkout/,'valid VAD config proceeds to engine checks');
  }finally{rmSync(t.root,{recursive:true,force:true});}
});
test('verify-vad pins the official Silero file and never deletes a wrong one',()=>{
  const t=prepared();
  try{
    const engine=join(t.root,'whisper.cpp');
    mkdirSync(join(engine,'models'),{recursive:true});
    const r1=spawnSync('bash',[t.script,'verify-vad'],{cwd:t.repo,env:t.env,encoding:'utf8'});
    assert.notEqual(r1.status,0);assert.match(r1.stderr,/Missing VAD model; run download-vad/);
    const file=join(engine,'models','ggml-silero-v6.2.0.bin');
    writeFileSync(file,'not a model');
    // macOS stat/shasum semantics, mocked so the Linux CI runner matches.
    for(const [name,body] of [['stat','echo 11'],['shasum','echo "'+'0'.repeat(64)+'  f"']]){
      writeFileSync(join(t.root,'bin',name),'#!/bin/sh\n'+body+'\n');chmodSync(join(t.root,'bin',name),0o755);
    }
    const r2=spawnSync('bash',[t.script,'verify-vad'],{cwd:t.repo,env:t.env,encoding:'utf8'});
    assert.notEqual(r2.status,0);assert.match(r2.stderr,/Incorrect\/incomplete VAD model/);
    assert.equal(readFileSync(file,'utf8'),'not a model');
  }finally{rmSync(t.root,{recursive:true,force:true});}
});
