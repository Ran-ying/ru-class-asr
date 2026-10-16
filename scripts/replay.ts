import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import WebSocket from 'ws';
import { event,encodeAudio,type AudioHeader } from '../src/protocol.js';

const [file,output='artifacts/replay.json',short] = process.argv.slice(2);
if(!file) throw new Error('Usage: npm run replay -- Russian-16k-mono-pcm16.wav [artifacts/replay.json] [--allow-short]');
const token=process.env.CLIENT_TOKEN || '';
if(token.length<24)throw new Error('Set CLIENT_TOKEN locally; never put it in command arguments or committed files');
const url=new URL(process.env.GATEWAY_CLIENT_URL || 'ws://127.0.0.1:3000/ws/client');
if(!['ws:','wss:'].includes(url.protocol) || url.username || url.password || url.search || (url.protocol==='ws:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Use WSS for a remote gateway');
const wav=await readFile(file);
if(wav.toString('ascii',0,4)!=='RIFF' || wav.toString('ascii',8,12)!=='WAVE')throw new Error('Expected RIFF WAV');
let formatOK=false,pcm:Buffer|undefined;
for(let at=12;at+8<=wav.length;){const size=wav.readUInt32LE(at+4),end=at+8+size;if(end>wav.length)throw new Error('Truncated WAV');const type=wav.toString('ascii',at,at+4);if(type==='fmt '){if(size<16)throw new Error('Invalid fmt');formatOK=wav.readUInt16LE(at+8)===1 && wav.readUInt16LE(at+10)===1 && wav.readUInt32LE(at+12)===16000 && wav.readUInt16LE(at+22)===16;}if(type==='data')pcm=wav.subarray(at+8,end);at=end+(size%2);}
if(!formatOK || !pcm || pcm.length%2)throw new Error('Expected 16 kHz, mono, signed PCM16 WAV');
const duration=pcm.length/32000;
if(duration<300 && short!=='--allow-short')throw new Error('Acceptance requires >=300 seconds. --allow-short is only a smoke test.');
const origin=`${url.protocol==='wss:'?'https:':'http:'}//${url.host}`;
const ws=new WebSocket(url,{origin});
const id=crypto.randomUUID();let index=0,seq=0;const anchors:{end:number,at:number}[]=[];
const metrics:{inference_ms:number,audio_end_to_result_ms:number|null,window_span_ms:number}[]=[];
let firstBeforeStop=false,stopSent=false,lastText='',repeat=0,maxRepeat=0,failed:string|undefined;
let readyResolve:()=>void=()=>{},doneResolve:()=>void=()=>{};
const ready=new Promise<void>(r=>readyResolve=r),done=new Promise<void>(r=>doneResolve=r);
const send=(type:string,payload={})=>ws.send(JSON.stringify(event(type,type==='auth'?'':id,payload)));
ws.on('open',()=>send('auth',{token}));
ws.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.type==='auth.ok')send('session.start');else if(m.type==='session.ready')readyResolve();else if(m.type==='asr.partial'){if(!stopSent)firstBeforeStop=true;const p=m.payload;const anchor=anchors.find(a=>a.end>=p.window_end_sample);metrics.push({inference_ms:p.inference_ms,audio_end_to_result_ms:anchor?performance.now()-anchor.at:null,window_span_ms:(p.window_end_sample-p.window_start_sample)/16});repeat=p.text===lastText?repeat+1:1;maxRepeat=Math.max(maxRepeat,repeat);lastText=p.text;}else if(m.type==='session.stopped')doneResolve();else if(m.type==='session.error'){failed=m.payload.code;readyResolve();doneResolve();}});
ws.on('error',()=>{failed='CONNECTION_ERROR';readyResolve();doneResolve();});
ws.on('close',()=>{if(!stopSent){failed ||= 'CONNECTION_CLOSED';readyResolve();doneResolve();}});
const wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function timed(p:Promise<void>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([p,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Replay timed out')),ms);})]);}finally{clearTimeout(timer);}}
function stats(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return sorted.length?{count:sorted.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p50:sorted[Math.floor((sorted.length-1)*.5)],p95:sorted[Math.floor((sorted.length-1)*.95)],max:sorted.at(-1)}:null;}
try {
  await timed(ready,10000);if(failed)throw new Error(failed);const start=performance.now();
  while(index<pcm.length){const chunk=pcm.subarray(index,Math.min(index+6400,pcm.length));const end=(index+chunk.length)/2;await wait(Math.max(0,start+end/16-performance.now()));if(failed || ws.readyState!==WebSocket.OPEN)throw new Error(failed || 'CONNECTION_CLOSED');if(ws.bufferedAmount>512000)throw new Error('NETWORK_BACKPRESSURE');const h={...event('audio.frame',id),type:'audio.frame',payload:{seq:seq++,start_sample:index/2,sample_count:chunk.length/2,sample_rate:16000,channels:1,encoding:'pcm_s16le',source_sample_rate:16000,source_start_sample:index/2,source_end_sample:end}} as AudioHeader;anchors.push({end,at:performance.now()});ws.send(encodeAudio(h,chunk));index+=chunk.length;}
  stopSent=true;send('session.stop');await timed(done,70000);if(failed)throw new Error(failed);
  const report={kind:'REALTIME_REPLAY_REQUIRES_MANUAL_HARDWARE_AND_LANGUAGE_REVIEW',date_utc:new Date().toISOString(),node:process.version,os:`${os.platform()}/${os.arch()}`,cpu:os.cpus()[0]?.model,source_sha256:createHash('sha256').update(wav).digest('hex'),audio_seconds:duration,replayed_seconds:(performance.now()-start)/1000,frames:seq,results:metrics.length,captions_before_stop:firstBeforeStop,configured_model:process.env.WHISPER_MODEL||'small',actual_backend:'UNVERIFIED_CHECK_ENGINE_LOGS',inference_ms:stats(metrics.map(m=>m.inference_ms)),audio_end_to_result_ms:stats(metrics.flatMap(m=>m.audio_end_to_result_ms===null?[]:[m.audio_end_to_result_ms])),window_span_ms:stats(metrics.map(m=>m.window_span_ms)),maximum_consecutive_equal_text_results:maxRepeat,notes:'No transcript, token, host, source filename or audio is stored here. Check Russian accuracy, UI responsiveness, repetition and engine backend manually. This network estimate excludes capture buffering.'};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:output,captions_before_stop:firstBeforeStop,results:metrics.length}));if(!firstBeforeStop)process.exitCode=1;
} finally {ws.close();}
