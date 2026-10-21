import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { InferenceAdapter } from './inference.js';
import type { TranslationAdapter } from './translate.js';
export function createAsrApi(adapter:InferenceAdapter, config:{apiKey:string;model:string;allowedOrigins?:string[];translation?:TranslationAdapter;translationModel?:string}) {
  if(config.apiKey.length<24 || /[\r\n]/.test(config.apiKey))throw new Error('ASR_API_KEY_MIN_24_CHARACTERS');
  let busy=false;
  let translationBusy=false;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    res.setHeader('Vary','Origin');
    const origin=req.headers.origin;
    // An empty allowlist deliberately enables CORS for every browser Origin.
    // A nonempty allowlist keeps strict exact-Origin matching.
    if(origin){
      if(config.allowedOrigins?.length && !config.allowedOrigins.includes(origin)){
        res.writeHead(403).end(JSON.stringify({error:{code:'origin_not_allowed'}}));return;
      }
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age','600');
    }
    // CORS preflight must be handled *before* Bearer authentication; it never
    // sends Authorization and should never initiate inference.
    if(req.method==='OPTIONS'){
      if(!origin){res.writeHead(400).end();return;}
      if(!['/v1/models','/v1/audio/transcriptions',...(config.translation?['/v1/translate']:[])].includes(req.url||'')){res.writeHead(404).end();return;}
      res.writeHead(204).end();return;
    }
    const error=(status:number,code:string)=>{res.writeHead(status).end(JSON.stringify({error:{message:code,type:'invalid_request_error',code}}));};
    const credential=req.headers.authorization||'';const expected=`Bearer ${config.apiKey}`;
    if(Buffer.byteLength(credential)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(credential),Buffer.from(expected))){error(401,'invalid_api_key');return;}
    if(req.method==='GET'&&req.url==='/v1/models'){res.end(JSON.stringify({object:'list',data:[{id:config.model,object:'model',owned_by:'local'}]}));return;}
    if(req.method==='POST'&&req.url==='/v1/translate'&&config.translation){
      if(translationBusy){error(429,'translation_busy');return;}
      translationBusy=true;
      const controller=new AbortController();
      const cancel=()=>{if(!res.writableEnded)controller.abort();};
      res.on('close',cancel);
      let validated=false;
      try{
        const chunks:Buffer[]=[];let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>8192){error(413,'translation_too_large');return;}chunks.push(chunk);}
        if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')){error(415,'json_required');return;}
        const request:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!request||typeof request!=='object'||Array.isArray(request)){error(400,'invalid_translation_request');return;}
        const payload=request as Record<string,unknown>;
        if(typeof payload.text!=='string'||!payload.text.trim()||
           [...payload.text].length>1200||payload.source!=='ru'||payload.target!=='zh'){
          error(400,'invalid_translation_request');return;
        }
        validated=true;
        const translation=await config.translation.translate(payload.text.trim(),controller.signal);
        if(!res.destroyed&&!res.writableEnded)
          res.end(JSON.stringify({translation,source:'ru',target:'zh',model:config.translationModel||'m2m100-418m-int8'}));
      }catch{if(!res.destroyed&&!res.writableEnded)error(validated?502:400,validated?'translation_failed':'invalid_translation_request');}
      finally{translationBusy=false;res.off('close',cancel);}
      return;
    }
    if(req.method!=='POST'||req.url!=='/v1/audio/transcriptions'){error(404,'not_found');return;}
    if(busy){error(429,'inference_busy');return;}
    busy=true;const controller=new AbortController();
    const cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);
    let validating=true;
    try {
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024){error(413,'audio_too_large');return;}chunks.push(chunk);}
      const request=new Request('http://localhost',{method:'POST',headers:{'content-type':req.headers['content-type']||''},body:Buffer.concat(chunks)});
      const form=await request.formData();const file=form.get('file');
      const format=form.get('response_format')||'json';
      if(form.get('model')!==config.model){error(400,'invalid_model');return;}
      if((form.get('language')||'ru')!=='ru'||!['json','text','verbose_json'].includes(String(format))||
         (format==='verbose_json'&&!adapter.inferVerbose)){error(400,'unsupported_language_or_format');return;}
      if(!(file instanceof File)){error(400,'file_required');return;}
      const data=Buffer.from(await file.arrayBuffer());
      // v0.1 supports PCM WAV, 16 kHz mono, up to 30 seconds per request.
      if(data.length<44||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE'){error(400,'invalid_wav');return;}
      let pcm:Buffer|undefined;let validFormat=false;
      for(let offset=12;offset+8<=data.length;){const name=data.toString('ascii',offset,offset+4);const len=data.readUInt32LE(offset+4);const start=offset+8;if(start+len>data.length)throw new Error('invalid_wav');
        if(name==='fmt '&&len>=16)validFormat=data.readUInt16LE(start)===1&&data.readUInt16LE(start+2)===1&&data.readUInt32LE(start+4)===16000&&data.readUInt16LE(start+12)===2&&data.readUInt16LE(start+14)===16;
        if(name==='data')pcm=data.subarray(start,start+len);offset=start+len+(len%2);
      }
      if(!validFormat||!pcm||!pcm.length||pcm.length%2||pcm.length>16000*2*30){error(400,'wav_requires_16khz_mono_pcm16_max_30s');return;}
      validating=false;
      if(format==='verbose_json'){
        // OpenAI-style subset: segment start/end seconds within THIS window.
        const result=await adapter.inferVerbose!(pcm,controller.signal);
        res.end(JSON.stringify({task:'transcribe',language:'ru',duration:result.duration,text:result.text,
          segments:result.segments.map((s,id)=>({id,start:s.start,end:s.end,text:s.text}))}));
        return;
      }
      const text=await adapter.infer(pcm,controller.signal);
      if(format==='text'){res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(text);}else res.end(JSON.stringify({text}));
    }catch{if(!res.writableEnded&&!res.destroyed)error(validating?400:502,validating?'invalid_audio_request':'transcription_failed');}
    finally{busy=false;res.off('close',cancel);}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}
