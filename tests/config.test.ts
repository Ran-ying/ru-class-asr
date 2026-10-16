import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../src/config.js';

test('ASR JSON configuration sets listener and engine while requiring explicit non-loopback opt-in',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-asr-config-'));const file=join(dir,'config.json');
  const keys=['ASR_HOST','ASR_PORT','ASR_API_KEY','WHISPER_URL','WHISPER_MODEL','ASR_ALLOW_PUBLIC_BIND'];
  const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  for(const key of keys)delete process.env[key];
  try{
    await writeFile(file,JSON.stringify({listen:{host:'127.0.0.1',port:8976},apiKey:'a-long-test-only-api-key-for-asr',whisper:{url:'http://127.0.0.1:8080/inference',model:'small'}}));
    const c=loadConfig(file);
    assert.equal(c.port,8976);assert.equal(c.model,'small');assert.equal(c.apiKey,'a-long-test-only-api-key-for-asr');
    process.env.ASR_PORT='9009';assert.equal(loadConfig(file).port,9009);delete process.env.ASR_PORT;
    await writeFile(file,JSON.stringify({listen:{host:'0.0.0.0',port:8090}}));
    assert.throws(()=>loadConfig(file),/ASR_ALLOW_PUBLIC_BIND/);
    process.env.ASR_ALLOW_PUBLIC_BIND='1';assert.equal(loadConfig(file).host,'0.0.0.0');
    await writeFile(file,'{bad');assert.throws(()=>loadConfig(file),/Invalid config/);
  }finally{
    for(const key of keys){if(prev[key]===undefined)delete process.env[key];else process.env[key]=prev[key];}
    await rm(dir,{recursive:true,force:true});
  }
});
