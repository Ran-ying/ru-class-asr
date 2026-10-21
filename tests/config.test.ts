import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../src/config.js';

test('ASR JSON and environment configuration allow non-loopback listeners without extra flags',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-asr-config-'));const file=join(dir,'config.json');
  const keys=['ASR_HOST','ASR_PORT','ASR_API_KEY','WHISPER_URL','WHISPER_MODEL','ASR_CORS_ORIGINS'];
  const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  for(const key of keys)delete process.env[key];
  try{
    await writeFile(file,JSON.stringify({listen:{host:'127.0.0.1',port:8976},apiKey:'a-long-test-only-api-key-for-asr',whisper:{url:'http://127.0.0.1:8080/inference',model:'small'}}));
    const c=loadConfig(file);
    assert.equal(c.port,8976);assert.equal(c.model,'small');assert.equal(c.apiKey,'a-long-test-only-api-key-for-asr');
    assert.deepEqual(c.allowedOrigins,[]); // Omitted allowedOrigins defaults to unrestricted CORS.
    await writeFile(file,JSON.stringify({
      listen:{host:'127.0.0.1',port:8976},
      cors:{allowedOrigins:['https://restricted.example']}
    }));
    assert.deepEqual(loadConfig(file).allowedOrigins,['https://restricted.example']);
    process.env.ASR_CORS_ORIGINS='';
    assert.deepEqual(loadConfig(file).allowedOrigins,[]); // Empty env also means unrestricted.
    process.env.ASR_CORS_ORIGINS='https://one.example,https://two.example';
    assert.deepEqual(loadConfig(file).allowedOrigins,['https://one.example','https://two.example']);
    delete process.env.ASR_CORS_ORIGINS;
    process.env.ASR_PORT='9009';assert.equal(loadConfig(file).port,9009);delete process.env.ASR_PORT;
    await writeFile(file,JSON.stringify({listen:{host:'0.0.0.0',port:8090}}));
    assert.equal(loadConfig(file).host,'0.0.0.0');
    await writeFile(file,JSON.stringify({listen:{host:'192.0.2.10',port:8090}}));
    assert.equal(loadConfig(file).host,'192.0.2.10');
    process.env.ASR_HOST='::';assert.equal(loadConfig(file).host,'::');delete process.env.ASR_HOST;
    process.env.ASR_HOST='0.0.0.0';assert.equal(loadConfig(file).host,'0.0.0.0');delete process.env.ASR_HOST;
    await writeFile(file,'{bad');assert.throws(()=>loadConfig(file),/Invalid config/);
  }finally{
    for(const key of keys){if(prev[key]===undefined)delete process.env[key];else process.env[key]=prev[key];}
    await rm(dir,{recursive:true,force:true});
  }
});

test('translation config is opt-in, bounded and loopback only',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-translation-settings-'));
  const path=join(dir,'config.json');
  try{
    await writeFile(path,JSON.stringify({}));
    const base=loadConfig(path);
    assert.equal(base.translationEnabled,false);
    assert.equal(base.translationUrl,'http://127.0.0.1:8091/translate');
    assert.equal(base.translationThreads,2);
    await writeFile(path,JSON.stringify({translation:{enabled:true,threads:3,
      model:'m2m100-418m-int8',timeoutMs:12000,url:'http://127.0.0.1:8091/translate'}}));
    assert.equal(loadConfig(path).translationEnabled,true);
    assert.equal(loadConfig(path).translationThreads,3);
    for(const url of ['https://remote.example/translate','http://localhost:8091/translate',
      'http://127.0.0.1:8091/admin','http://127.0.0.1:8091/translate?bad=1']){
      await writeFile(path,JSON.stringify({translation:{enabled:true,url}}));
      assert.throws(()=>loadConfig(path),/TRANSLATION_URL_MUST_BE_LOOPBACK/);
    }
    await writeFile(path,JSON.stringify({translation:{enabled:true,threads:25}}));
    assert.throws(()=>loadConfig(path),/INVALID_TRANSLATION_THREADS/);
    await writeFile(path,JSON.stringify({translation:{enabled:true,model:'other'}}));
    assert.throws(()=>loadConfig(path),/UNSUPPORTED_TRANSLATION_MODEL/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('whisper.vad is optional, off by default, and strictly validated',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-asr-vad-'));const file=join(dir,'config.json');
  const write=(vad:unknown)=>writeFile(file,JSON.stringify({apiKey:'a-long-test-only-api-key-for-asr',
    whisper:{url:'http://127.0.0.1:8080/inference',model:'small',...(vad===undefined?{}:{vad})}}));
  try{
    await write(undefined);
    assert.deepEqual(loadConfig(file).vad,{enabled:false,model:'silero-v6.2.0',threshold:0.5});
    await write({enabled:true,threshold:0.4});
    assert.deepEqual(loadConfig(file).vad,{enabled:true,model:'silero-v6.2.0',threshold:0.4});
    for(const [bad,code] of [[{enabled:'yes'},/INVALID_WHISPER_VAD_ENABLED/],[{model:'silero-v5.1.2'},/UNSUPPORTED_WHISPER_VAD_MODEL/],
      [{threshold:1.5},/INVALID_WHISPER_VAD_THRESHOLD/],[[],/INVALID_WHISPER_VAD/]] as const){
      await write(bad);
      assert.throws(()=>loadConfig(file),code);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
