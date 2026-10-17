import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtempSync,mkdirSync,copyFileSync,rmSync,writeFileSync,chmodSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';

const source=resolve('scripts/mac-whisper-models.sh');
const smallSha='1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b';
function executable(path:string,body:string) {
  writeFileSync(path,'#!/bin/sh\n'+body+'\n');
  chmodSync(path,0o755);
}
function layout() {
  const root=mkdtempSync(join(tmpdir(),'asr-mac-safety-'));
  const repo=join(root,'ru-class-asr');
  const engine=join(root,'whisper.cpp');
  const bin=join(root,'fakebin');
  mkdirSync(join(repo,'scripts'),{recursive:true});
  mkdirSync(join(repo,'dist','src'),{recursive:true});
  mkdirSync(join(engine,'.git'),{recursive:true});
  mkdirSync(join(engine,'build','bin'),{recursive:true});
  mkdirSync(join(engine,'models'),{recursive:true});
  mkdirSync(bin);
  const script=join(repo,'scripts','mac-whisper-models.sh');
  copyFileSync(source,script);
  const model=join(engine,'models','ggml-small.bin');
  writeFileSync(model,'DO-NOT-DELETE-THIS-LOCAL-MODEL');
  writeFileSync(join(repo,'config.json'),'{"apiKey":"not-a-real-secret","whisper":{"model":"small","url":"http://127.0.0.1:8080/inference"}}');
  writeFileSync(join(repo,'dist','src','index.js'),'// stub');
  const env:NodeJS.ProcessEnv={...process.env,WHISPER_CPP_DIR:engine,
    PATH:bin+':'+process.env.PATH};
  return {root,repo,engine,bin,script,model,env};
}
test('verifier rejects a large-but-truncated GGML model and leaves original intact',()=>{
  const t=layout();
  try{
    executable(join(t.bin,'stat'),'echo 2720000000');
    executable(join(t.bin,'shasum'),'echo "'+smallSha+'  model"');
    const result=spawnSync('bash',[t.script,'verify','small'],{encoding:'utf8',env:t.env});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Incorrect\/incomplete small model/);
    assert.ok(existsSync(t.model));
  }finally{rmSync(t.root,{recursive:true,force:true});}
});
test('verifier rejects same-size altered GGML weights without deleting them',()=>{
  const t=layout();
  try{
    executable(join(t.bin,'stat'),'echo 487601967');
    executable(join(t.bin,'shasum'),'echo "'+'0'.repeat(64)+'  model"');
    const result=spawnSync('bash',[t.script,'verify','small'],{encoding:'utf8',env:t.env});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/SHA256 mismatch/);
    assert.ok(existsSync(t.model));
  }finally{rmSync(t.root,{recursive:true,force:true});}
});
test('verifier accepts expected size and official hash (pure test stubs, not an actual GGML download)',()=>{
  const t=layout();
  try{
    executable(join(t.bin,'stat'),'echo 487601967');
    executable(join(t.bin,'shasum'),'echo "'+smallSha+'  model"');
    const result=spawnSync('bash',[t.script,'verify','small'],{encoding:'utf8',env:t.env});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/exact byte count and official SHA-256/);
  }finally{rmSync(t.root,{recursive:true,force:true});}
});
test('TERM to wrapper cleans up both owned child processes, without touching other services',async()=>{
  const t=layout();let wrapper:ReturnType<typeof spawn>|undefined;
  let enginePid:number|undefined,apiPid:number|undefined;
  try{
    executable(join(t.bin,'stat'),'echo 487601967');
    executable(join(t.bin,'shasum'),'echo "'+smallSha+'  model"');
    executable(join(t.bin,'uname'),'if [ "$1" = "-s" ]; then echo Darwin; else echo arm64; fi');
    executable(join(t.bin,'xcrun'),'echo /mock/clang');
    executable(join(t.bin,'curl'),'exit 0');
    executable(join(t.bin,'lsof'),'exit 1');
    const pEngine=join(t.root,'engine.pid'),pApi=join(t.root,'api.pid');
    executable(join(t.engine,'build','bin','whisper-server'),
      'echo $$ > "'+pEngine+'"\nexec sleep 120');
    executable(join(t.bin,'node'),
      'if [ "$1" = "-e" ]; then echo "small|8080"; exit 0; fi\necho $ > "'+pApi+'"\nexec sleep 120');
    wrapper=spawn('bash',[t.script,'run','small'],{cwd:t.repo,env:t.env,stdio:'ignore'});
    let started=false;
    for(let i=0;i<100;i++){
      if(existsSync(pEngine)&&existsSync(pApi)){started=true;break;}
      await new Promise(r=>setTimeout(r,20));
    }
    assert.equal(started,true,'Both fake processes should start');
    enginePid=Number(readFileSync(pEngine,'utf8').trim());
    apiPid=Number(readFileSync(pApi,'utf8').trim());
    wrapper.kill('SIGTERM');
    const result=await Promise.race([
      new Promise<number|null>(r=>wrapper!.once('exit',r)),
      new Promise<null>(r=>setTimeout(()=>r(null),4000))
    ]);
    assert.equal(result,143,'TERM signal handled with documented exit code');
    for(const pid of [enginePid,apiPid]){
      let gone=false;
      for(let i=0;i<40;i++){
        try{process.kill(pid!,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){gone=true;break;}}
        await new Promise(r=>setTimeout(r,20));
      }
      assert.equal(gone,true,'Child still running after TERM: '+pid);
    }
  }finally{
    if(wrapper && wrapper.exitCode===null)wrapper.kill('SIGKILL');
    for(const pid of [enginePid,apiPid])if(pid){try{process.kill(pid,'SIGKILL');}catch{}}
    rmSync(t.root,{recursive:true,force:true});
  }
});
