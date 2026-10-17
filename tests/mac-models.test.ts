import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {mkdtempSync,mkdirSync,copyFileSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';

const script=resolve('scripts/mac-whisper-models.sh');
test('Mac deployment helper parses in bash, documents explicit install/run commands',()=>{
  const syntax=spawnSync('bash',['-n',script],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  const help=spawnSync('bash',[script,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0,help.stderr);
  for(const fragment of ['bootstrap','download small|medium|large|all',
    'engine small|medium|large','run small|medium|large','large-v3',
    'verify small|medium|large|all','config.json']){
    assert.match(help.stdout,new RegExp(fragment.replace(/[|.]/g,x=>'\\'+x),'i'));
  }
});
test('Mac helper invalid subcommand does not download or run anything',()=>{
  const invalid=spawnSync('bash',[script,'definitely-invalid'],{encoding:'utf8'});
  assert.notEqual(invalid.status,0);
  assert.match(invalid.stderr,/Unknown command/);
});

test('default engine path is the sibling whisper.cpp, with existing models reused in list',()=>{
  const root=mkdtempSync(join(tmpdir(),'ru-class-asr-sibling-test-'));
  try{
    const scripts=join(root,'ru-class-asr','scripts');
    const models=join(root,'whisper.cpp','models');
    mkdirSync(scripts,{recursive:true});
    mkdirSync(models,{recursive:true});
    const copied=join(scripts,'mac-whisper-models.sh');
    copyFileSync(script,copied);
    writeFileSync(join(models,'ggml-small.bin'),'already-downloaded-model');
    const env={...process.env};
    delete env.WHISPER_CPP_DIR;
    const r=spawnSync('bash',[copied,'list'],{encoding:'utf8',env});
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,new RegExp(root.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')+'/whisper\\.cpp'));
    assert.match(r.stdout,/small : present \(integrity not checked/);
    assert.match(r.stdout,/medium : absent/);
    const custom=join(root,'different-model-home');
    mkdirSync(custom,{recursive:true});
    const alternate=spawnSync('bash',[copied,'list'],{
      encoding:'utf8',env:{...env,WHISPER_CPP_DIR:custom}});
    assert.equal(alternate.status,0,alternate.stderr);
    assert.ok(alternate.stdout.includes('Engine checkout: '+custom));
    assert.match(alternate.stdout,/small : absent/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('bootstrap reuses an existing sibling whisper.cpp without cloning over it',()=>{
  const root=mkdtempSync(join(tmpdir(),'ru-class-asr-bootstrap-test-'));
  try{
    const scripts=join(root,'ru-class-asr','scripts');
    const bin=join(root,'mock-commands');
    const engine=join(root,'whisper.cpp');
    mkdirSync(scripts,{recursive:true});
    mkdirSync(bin,{recursive:true});
    mkdirSync(join(engine,'.git'),{recursive:true});
    mkdirSync(join(engine,'build','bin'),{recursive:true});
    const copied=join(scripts,'mac-whisper-models.sh');
    copyFileSync(script,copied);
    writeFileSync(join(engine,'build','bin','whisper-server'),'#!/bin/sh\nexit 0\n');
    chmodSync(join(engine,'build','bin','whisper-server'),0o755);
    const commands={
      uname:'#!/bin/sh\nif [ "$1" = "-s" ]; then echo Darwin; else echo arm64; fi\n',
      xcrun:'#!/bin/sh\necho /mock/clang\n',
      cmake:'#!/bin/sh\nexit 0\n',
      git:'#!/bin/sh\nif [ "$1" = "clone" ]; then echo BAD_CLONE >&2; exit 71; fi\nif [ "$1" = "-C" ]; then echo mock-whisper-revision; exit 0; fi\nexit 0\n'
    };
    for(const [name,data] of Object.entries(commands)){
      writeFileSync(join(bin,name),data);
      chmodSync(join(bin,name),0o755);
    }
    const env:NodeJS.ProcessEnv={...process.env,PATH:bin+':'+process.env.PATH};
    delete env.WHISPER_CPP_DIR;
    const result=spawnSync('bash',[copied,'bootstrap'],{encoding:'utf8',env});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/Retaining existing checkout/);
    assert.doesNotMatch(result.stderr,/BAD_CLONE/);
    assert.match(result.stdout,/mock-whisper-revision/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
