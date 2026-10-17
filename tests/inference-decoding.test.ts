import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WhisperHttp} from '../src/inference.js';
import {loadConfig} from '../src/config.js';

test('decoder form parameters: preserve old default and enable explicit temperature fallback',async()=>{
  const originalFetch=globalThis.fetch;
  const captures:{temperature:string|null;increment:string|null;language:string|null;format:string|null}[]=[];
  globalThis.fetch=async (_url,options)=>{
    const form=options?.body as FormData;
    captures.push({temperature:String(form.get('temperature')),
      increment:String(form.get('temperature_inc')),
      language:String(form.get('language')),
      format:String(form.get('response_format'))});
    return new Response(JSON.stringify({text:'Привет'}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const pcm=Buffer.alloc(16000*2);
    assert.equal(await new WhisperHttp('http://127.0.0.1:8080/inference').infer(pcm),'Привет');
    assert.equal(await new WhisperHttp('http://127.0.0.1:8080/inference',
      90000,{temperature:0,temperatureInc:0.2}).infer(pcm),'Привет');
    assert.deepEqual(captures,[{temperature:'0',increment:'0',language:'ru',format:'json'},
      {temperature:'0',increment:'0.2',language:'ru',format:'json'}]);
  }finally{globalThis.fetch=originalFetch;}
});

test('reject unsafe decoder parameters, invalid timeouts or invalid URLs',()=>{
  assert.throws(()=>new WhisperHttp('file:///tmp/engine'),/INVALID_WHISPER_URL/);
  assert.throws(()=>new WhisperHttp('http://localhost:8080',999),/INVALID_WHISPER_TIMEOUT_MS/);
  assert.throws(()=>new WhisperHttp('http://localhost:8080',30000,
    {temperature:-1,temperatureInc:0.2}),/INVALID_WHISPER_DECODING/);
  assert.throws(()=>new WhisperHttp('http://localhost:8080',30000,
    {temperature:0,temperatureInc:NaN}),/INVALID_WHISPER_DECODING/);
});

test('per-model config accepts explicit fallback and long timeout; defaults remain backward-compatible',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-asr-decode-'));
  const path=join(dir,'config.json');
  const keys=['WHISPER_TEMPERATURE','WHISPER_TEMPERATURE_INC','WHISPER_TIMEOUT_MS',
    'WHISPER_MODEL','WHISPER_URL','RU_CLASS_ASR_CONFIG'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    for(const key of keys)delete process.env[key];
    await writeFile(path,JSON.stringify({whisper:{model:'medium'}}));
    const original=loadConfig(path);
    assert.equal(original.model,'medium');
    assert.equal(original.temperature,0);
    assert.equal(original.temperatureInc,0);
    assert.equal(original.whisperTimeoutMs,30000);
    await writeFile(path,JSON.stringify({whisper:{
      model:'large-v3',temperature:0,temperatureInc:0.2,timeoutMs:90000}}));
    const configured=loadConfig(path);
    assert.equal(configured.model,'large-v3');
    assert.equal(configured.temperatureInc,0.2);
    assert.equal(configured.whisperTimeoutMs,90000);
    process.env.WHISPER_MODEL='small';
    process.env.WHISPER_TEMPERATURE_INC='0';
    process.env.WHISPER_TIMEOUT_MS='60000';
    assert.equal(loadConfig(path).model,'small');
    assert.equal(loadConfig(path).temperatureInc,0);
    assert.equal(loadConfig(path).whisperTimeoutMs,60000);
    process.env.WHISPER_TEMPERATURE_INC='Infinity';
    assert.throws(()=>loadConfig(path),/INVALID_WHISPER_TEMPERATURE_INC/);
    process.env.WHISPER_TEMPERATURE_INC='0.2';
    process.env.WHISPER_TIMEOUT_MS='1234.5';
    assert.throws(()=>loadConfig(path),/INVALID_WHISPER_TIMEOUT_MS/);
  }finally{
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];
      else process.env[key]=previous[key];}
    await rm(dir,{recursive:true,force:true});
  }
});
