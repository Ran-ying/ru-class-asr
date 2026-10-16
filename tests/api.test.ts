import test from 'node:test';
import assert from 'node:assert/strict';
import {createAsrApi} from '../src/api.js';
import {wav} from '../src/audio-window.js';

test('OpenAI-compatible API authenticates, validates WAV/model, serializes and cancels inference',async()=>{
  const key='SIMULATED_API_KEY_24_CHARACTERS';let calls=0;let release:(()=>void)|undefined;let cancelled=false;
  const server=createAsrApi({infer:async(_pcm,signal)=>{calls++;if(calls===1)return 'SIMULATED_TEST';await new Promise<void>(r=>{release=r;signal?.addEventListener('abort',()=>{cancelled=true;r();},{once:true});});return 'SIMULATED_TEST';}},{apiKey:key,model:'small'});
  server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as any).port}/v1`;
  const headers={Authorization:`Bearer ${key}`};
  const form=(model='small',data=wav(Buffer.alloc(6400)))=>{const f=new FormData();f.set('model',model);f.set('file',new Blob([new Uint8Array(data)]),'test.wav');return f;};
  try{
    assert.equal((await fetch(base+'/models')).status,401);
    const models=await fetch(base+'/models',{headers}).then(r=>r.json()) as any;assert.equal(models.data[0].id,'small');
    assert.equal((await fetch(base+'/audio/transcriptions',{method:'POST',headers,body:form('wrong')})).status,400);
    assert.equal((await fetch(base+'/audio/transcriptions',{method:'POST',headers,body:form('small',Buffer.from('invalid'))})).status,400);
    assert.equal(calls,0);
    const result=await fetch(base+'/audio/transcriptions',{method:'POST',headers,body:form()}).then(r=>r.json()) as any;
    assert.equal(result.text,'SIMULATED_TEST');
    const controller=new AbortController();
    const pending=fetch(base+'/audio/transcriptions',{method:'POST',headers,body:form(),signal:controller.signal}).catch(()=>undefined);
    for(let n=0;!release&&n<100;n++)await new Promise(r=>setTimeout(r,5));assert.ok(release);
    assert.equal((await fetch(base+'/audio/transcriptions',{method:'POST',headers,body:form()})).status,429);
    controller.abort();await pending;
    for(let n=0;!cancelled&&n<100;n++)await new Promise(r=>setTimeout(r,5));assert.equal(cancelled,true);
  }finally{release?.();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
