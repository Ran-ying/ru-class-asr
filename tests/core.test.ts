import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AudioWindow,wav } from '../src/audio-window.js';
import { Session } from '../src/session.js';
import { WhisperHttp } from '../src/inference.js';
import { event, type AudioHeader } from '../src/protocol.js';
function header(seq:number,count=3200):AudioHeader {return {...event('audio.frame','test-session-1234'),type:'audio.frame',payload:{seq,start_sample:seq*count,sample_count:count,sample_rate:16000,channels:1,encoding:'pcm_s16le',source_sample_rate:48000,source_start_sample:seq*count*3,source_end_sample:(seq+1)*count*3}};}
test('five minutes of simulated frames stays within an eight-second buffer; duplicates/gaps rejected',()=>{
  const audio=new AudioWindow();for(let i=0;i<1500;i++)audio.push(header(i),Buffer.alloc(6400));
  const s=audio.snapshot();assert.equal(s.end,16000*300);assert.equal(s.start,16000*292);assert.equal(s.pcm.length,16000*8*2);assert.throws(()=>audio.push(header(1501),Buffer.alloc(6400)),/AUDIO_DISCONTINUITY/);
});
test('portable WAV has correct sizes and 16 kHz mono PCM format',()=>{
  const out=wav(Buffer.alloc(6400));assert.equal(out.toString('ascii',0,4),'RIFF');assert.equal(out.readUInt32LE(4),6436);assert.equal(out.readUInt32LE(24),16000);assert.equal(out.readUInt16LE(22),1);assert.equal(out.readUInt32LE(40),6400);
});
test('single inference coalesces pending windows and stop flushes tail',async()=>{
  let inflight=0,max=0;const release:(()=>void)[]=[];const results:any[]=[];
  const adapter={async infer(){inflight++;max=Math.max(max,inflight);await new Promise<void>(r=>release.push(r));inflight--;return 'SIMULATED_TEST';}};
  const session=new Session(adapter,r=>results.push(r),()=>assert.fail('unexpected error'));
  for(let i=0;i<10;i++)session.push(header(i),Buffer.alloc(6400));
  assert.equal(release.length,1);for(let i=10;i<27;i++)session.push(header(i),Buffer.alloc(6400));
  const done=session.stop();release.shift()!();await new Promise(r=>setImmediate(r));assert.equal(release.length,1);release.shift()!();await done;
  assert.equal(max,1);assert.equal(results.length,2);assert.equal(results[0].window_end_sample,32000);assert.equal(results[1].window_end_sample,86400);assert.equal(results[1].final,true);
});
test('short tail flush, empty stop and cancellation suppressing late results',async()=>{
  const results:any[]=[];const s=new Session({infer:async()=> 'SIMULATED_TEST'},r=>results.push(r),()=>{});s.push(header(0),Buffer.alloc(6400));assert.equal(results.length,0);await s.stop();assert.equal(results.length,1);
  const empty=new Session({infer:async()=>assert.fail('empty inference')},()=>{},()=>{});await empty.stop();
  let release:()=>void=()=>{};const cancelled=new Session({infer:async()=>{await new Promise<void>(r=>release=r);return 'LATE';}},()=>assert.fail('late result'),()=>assert.fail('cancel error'));
  for(let i=0;i<10;i++)cancelled.push(header(i),Buffer.alloc(6400));cancelled.cancel();release();await new Promise(r=>setImmediate(r));
});
test('HTTP adapter sends multipart Russian WAV and rejects server/malformed responses',async()=>{
  let mode='ok';let requests=0;const server=http.createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);assert.match(req.headers['content-type']!,/multipart\/form-data/);assert.ok(body.includes(Buffer.from('RIFF')));assert.match(body.toString('latin1'),/name="language"\r\n\r\nru/);requests++;res.setHeader('Content-Type','application/json');if(mode==='http'){res.writeHead(503).end();}else if(mode==='bad')res.end('{}');else res.end(JSON.stringify({text:' Русский тест. '}));});
  server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const adapter=new WhisperHttp(`http://127.0.0.1:${(server.address() as any).port}/inference`);
  try {assert.equal(await adapter.infer(Buffer.alloc(6400)),'Русский тест.');mode='http';await assert.rejects(adapter.infer(Buffer.alloc(6400)),/503/);mode='bad';await assert.rejects(adapter.infer(Buffer.alloc(6400)),/INVALID_WHISPER_RESPONSE/);assert.equal(requests,3);}finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('inference failure ends the session without hanging stop',async()=>{
  let errors=0;const s=new Session({infer:async()=>{throw new Error('SIMULATED_FAILURE');}},()=>assert.fail('result'),()=>errors++);s.push(header(0),Buffer.alloc(6400));await s.stop();assert.equal(errors,1);
});
