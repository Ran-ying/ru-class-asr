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

test('explicit exact-origin CORS supports browser OPTIONS preflight but never exposes unknown origins',async()=>{
  const key='SIMULATED_CORS_KEY_24_CHARACTERS';
  const site='https://ru-class.example.test';
  let calls=0;
  const server=createAsrApi({infer:async()=>{calls++;return 'Привет';}},{apiKey:key,model:'small',allowedOrigins:[site]});
  server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const url='http://127.0.0.1:'+(server.address() as any).port+'/v1';
  try{
    const preflight=await fetch(url+'/audio/transcriptions',{method:'OPTIONS',headers:{
      Origin:site,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'
    }});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),site);
    assert.match(preflight.headers.get('access-control-allow-headers')||'',/Authorization/);
    const unauthorized=await fetch(url+'/models',{headers:{Origin:site}});
    assert.equal(unauthorized.status,401);
    assert.equal(unauthorized.headers.get('access-control-allow-origin'),site);
    const allowed=await fetch(url+'/models',{headers:{Origin:site,Authorization:'Bearer '+key}});
    assert.equal(allowed.status,200);
    assert.equal(allowed.headers.get('access-control-allow-origin'),site);
    const denied=await fetch(url+'/models',{headers:{Origin:'https://other.example.test',Authorization:'Bearer '+key}});
    assert.equal(denied.status,403);
    assert.equal(denied.headers.get('access-control-allow-origin'),null);
    assert.equal(calls,0);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('empty or omitted CORS allowlist permits any browser Origin without disabling API-key authentication',async()=>{
  const key='SIMULATED_OPEN_CORS_KEY_24_CHARACTERS';
  for(const allowedOrigins of [[],undefined]){
    const server=createAsrApi({infer:async()=>{throw new Error('inference must not run');}},{apiKey:key,model:'small',allowedOrigins});
    server.listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+(server.address() as any).port+'/v1';
    try{
      for(const origin of ['https://arbitrary.example','http://localhost:3000','https://another-app.example']){
        const preflight=await fetch(base+'/audio/transcriptions',{method:'OPTIONS',headers:{
          Origin:origin,'Access-Control-Request-Method':'POST',
          'Access-Control-Request-Headers':'authorization,content-type'
        }});
        assert.equal(preflight.status,204);
        assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
        assert.match(preflight.headers.get('access-control-allow-headers')||'',/Authorization/);
        assert.equal(preflight.headers.get('vary'),'Origin');

        const preflightModels=await fetch(base+'/models',{method:'OPTIONS',headers:{
          Origin:origin,'Access-Control-Request-Method':'GET',
          'Access-Control-Request-Headers':'authorization'
        }});
        assert.equal(preflightModels.status,204);
        assert.equal(preflightModels.headers.get('access-control-allow-origin'),origin);

        const missingKey=await fetch(base+'/models',{headers:{Origin:origin}});
        assert.equal(missingKey.status,401);
        assert.equal(missingKey.headers.get('access-control-allow-origin'),origin);

        const wrongKey=await fetch(base+'/models',{headers:{Origin:origin,Authorization:'Bearer wrong'}});
        assert.equal(wrongKey.status,401);

        const models=await fetch(base+'/models',{headers:{Origin:origin,Authorization:'Bearer '+key}});
        assert.equal(models.status,200);
        assert.equal(models.headers.get('access-control-allow-origin'),origin);
        assert.equal((await models.json() as any).data[0].id,'small');
      }
      const noOrigin=await fetch(base+'/models',{headers:{Authorization:'Bearer '+key}});
      assert.equal(noOrigin.status,200); // Server-side clients work as before.
      assert.equal(noOrigin.headers.get('access-control-allow-origin'),null);
    }finally{
      server.closeAllConnections();
      await new Promise<void>(resolve=>server.close(()=>resolve()));
    }
  }
});
