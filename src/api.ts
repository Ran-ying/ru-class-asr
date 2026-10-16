import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { InferenceAdapter } from './inference.js';
export function createAsrApi(adapter:InferenceAdapter, config:{apiKey:string;model:string}) {
  if(config.apiKey.length<24 || /[\r\n]/.test(config.apiKey))throw new Error('ASR_API_KEY_MIN_24_CHARACTERS');
  let busy=false;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    const error=(status:number,code:string)=>{res.writeHead(status).end(JSON.stringify({error:{message:code,type:'invalid_request_error',code}}));};
    const credential=req.headers.authorization||'';const expected=`Bearer ${config.apiKey}`;
    if(Buffer.byteLength(credential)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(credential),Buffer.from(expected))){error(401,'invalid_api_key');return;}
    if(req.method==='GET'&&req.url==='/v1/models'){res.end(JSON.stringify({object:'list',data:[{id:config.model,object:'model',owned_by:'local'}]}));return;}
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
      if((form.get('language')||'ru')!=='ru'||!['json','text'].includes(String(format))){error(400,'unsupported_language_or_format');return;}
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
      const text=await adapter.infer(pcm,controller.signal);
      if(format==='text'){res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(text);}else res.end(JSON.stringify({text}));
    }catch{if(!res.writableEnded&&!res.destroyed)error(validating?400:502,validating?'invalid_audio_request':'transcription_failed');}
    finally{busy=false;res.off('close',cancel);}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return server;
}
