import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsrApi} from '../src/api.js';
import {LocalTranslationHttp} from '../src/translate.js';
import {wav} from '../src/audio-window.js';

const key='FAKE_LOCAL_TEST_KEY_MINIMUM_24_CHARS';
async function listening(server:ReturnType<typeof createAsrApi>){
  server.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  return 'http://127.0.0.1:'+(server.address() as {port:number}).port+'/v1';
}
async function close(server:ReturnType<typeof createAsrApi>){
  server.closeAllConnections();
  await new Promise<void>(r=>server.close(()=>r()));
}
const auth={Authorization:'Bearer '+key,'Content-Type':'application/json'};
const body=(text='Привет')=>JSON.stringify({text,source:'ru',target:'zh'});

test('disabled translator leaves old ASR-only API fully unchanged',async()=>{
  const server=createAsrApi({infer:async()=>''},{apiKey:key,model:'small'});
  const base=await listening(server);
  try{
    assert.equal((await fetch(base+'/translate',{method:'OPTIONS',headers:{Origin:'https://example.test'}})).status,404);
    assert.equal((await fetch(base+'/translate',{method:'POST',headers:auth,body:body()})).status,404);
    assert.equal((await fetch(base+'/models',{headers:{Authorization:'Bearer '+key}})).status,200);
  }finally{await close(server);}
});
test('translate requires auth, precise CORS origin and valid bounded RU/zh JSON',async()=>{
  let calls=0;const site='https://class.example.test';
  const server=createAsrApi({infer:async()=>''},{apiKey:key,model:'small',allowedOrigins:[site],
    translation:{translate:async text=>{calls++;return '译文:'+text;}},translationModel:'m2m100-418m-int8'});
  const base=await listening(server);
  try{
    assert.equal((await fetch(base+'/translate',{method:'OPTIONS',headers:{
      Origin:site,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'
    }})).status,204);
    assert.equal((await fetch(base+'/translate',{method:'OPTIONS',headers:{Origin:'https://blocked.test'}})).status,403);
    assert.equal((await fetch(base+'/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:body()})).status,401);
    assert.equal((await fetch(base+'/translate',{method:'POST',headers:auth,body:'not json'})).status,400);
    assert.equal((await fetch(base+'/translate',{method:'POST',headers:auth,body:body('x'.repeat(1201))})).status,400);
    assert.equal((await fetch(base+'/translate',{method:'POST',headers:auth,body:body('x'.repeat(8200))})).status,413);
    assert.equal((await fetch(base+'/translate',{method:'POST',headers:auth,body:JSON.stringify({text:'Hi',source:'en',target:'zh'})})).status,400);
    assert.equal((await fetch(base+'/translate',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'text/plain'},body:body()})).status,415);
    assert.equal(calls,0);
    const good=await fetch(base+'/translate',{method:'POST',headers:{...auth,Origin:site},body:body('Добрый день')});
    assert.equal(good.status,200);
    assert.equal(good.headers.get('access-control-allow-origin'),site);
    assert.deepEqual(await good.json(),{
      translation:'译文:Добрый день',source:'ru',target:'zh',model:'m2m100-418m-int8'
    });
    assert.equal(calls,1);
  }finally{await close(server);}
});
test('translation and whisper use separate single-flight busy guards',async()=>{
  let unlock:()=>void=()=>{},started:()=>void=()=>{};
  const active=new Promise<void>(r=>{started=r;});
  const gate=new Promise<void>(r=>{unlock=r;});
  const server=createAsrApi({infer:async()=> 'РУССКИЙ'},{
    apiKey:key,model:'small',translation:{translate:async()=>{started();await gate;return '中文';}}
  });
  const base=await listening(server);
  try{
    const pending=fetch(base+'/translate',{method:'POST',headers:auth,body:body()});
    await active;
    assert.equal((await fetch(base+'/translate',{method:'POST',headers:auth,body:body('test')})).status,429);
    const form=new FormData();
    form.set('file',new Blob([new Uint8Array(wav(Buffer.alloc(3200)))]),'test.wav');
    form.set('model','small');
    const asr=await fetch(base+'/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form});
    assert.equal(asr.status,200);
    assert.equal((await asr.json() as {text:string}).text,'РУССКИЙ');
    unlock();
    assert.equal((await pending).status,200);
  }finally{unlock();await close(server);}
});
test('translation adapter accepts only loopback HTTP /translate and validates response',async()=>{
  for(const url of ['https://remote.test/translate','http://192.168.0.1:8091/translate',
    'http://localhost:8091/translate','http://127.0.0.1:8091/admin',
    'http://127.0.0.1:8091/translate?url=evil']){
    assert.throws(()=>new LocalTranslationHttp(url),/TRANSLATION_URL_MUST_BE_LOOPBACK/);
  }
  const server=await import('node:http').then(m=>m.createServer(async(_req,res)=>{
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({translation:'本地中文'}));
  }));
  server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const adapter=new LocalTranslationHttp('http://127.0.0.1:'+(server.address() as {port:number}).port+'/translate');
  try{assert.equal(await adapter.translate('Привет'),'本地中文');}
  finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
