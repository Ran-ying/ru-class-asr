import os from 'node:os';
import WebSocket from 'ws';
import { decodeAudio, event, parseEvent } from './protocol.js';
import { type InferenceAdapter } from './inference.js';
import { Session } from './session.js';
type Options = {url:string; token:string; model:string; backend:string; windowSeconds?:number; stepSeconds?:number; minSeconds?:number};
export function connectWorker(adapter: InferenceAdapter, options: Options) {
  const url = new URL(options.url);
  if (!['ws:','wss:'].includes(url.protocol) || url.username || url.password || url.search) throw new Error('INVALID_GATEWAY_URL');
  if (url.protocol === 'ws:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('REMOTE_GATEWAY_REQUIRES_WSS');
  if (options.token.length < 24) throw new Error('WORKER_TOKEN_TOO_SHORT');
  const ws = new WebSocket(url, {maxPayload:40000, perMessageDeflate:false});
  let active: {id:string; session:Session} | undefined;
  const send = (type:string,id='',payload={}) => { if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event(type,id,payload))); };
  ws.on('open', () => send('auth','',{token:options.token}));
  ws.on('message', async (data,binary) => {
    try {
      if (binary) {
        const {header,pcm} = decodeAudio(Buffer.from(data as Buffer));
        if(!active || header.session_id !== active.id) throw new Error('UNKNOWN_SESSION');
        active.session.push(header,pcm); return;
      }
      const m = parseEvent(data.toString());
      if(m.type === 'auth.ok') {
        const status = {model:options.model, os:`${os.platform()}/${os.arch()}`, backend:`unverified:${options.backend}`, ready:true};
        send('worker.ready','',status); console.log(JSON.stringify({event:'worker.ready',...status}));
      } else if(m.type === 'session.start') {
        if(active) throw new Error('SESSION_BUSY');
        const id = m.session_id;
        active = {id,session:new Session(adapter, result => send('asr.partial',id,result), () => { send('session.error',id,{code:'INFERENCE_FAILED'}); if(active?.id === id) active=undefined; },options.windowSeconds,options.stepSeconds,options.minSeconds)};
      } else if(m.type === 'session.stop') {
        if(!active || active.id !== m.session_id) throw new Error('UNKNOWN_SESSION');
        const finishing = active; await finishing.session.stop();
        if(active === finishing) { send('session.stopped',finishing.id); active = undefined; }
      } else if(m.type === 'session.cancel') { if(active?.id === m.session_id) { active.session.cancel(); active = undefined; } }
      else if(m.type === 'session.error') { console.error(JSON.stringify({event:'gateway.error',code:m.payload.code})); ws.close(1008,'Gateway rejected message'); }
      else throw new Error('UNKNOWN_EVENT');
    } catch {
      if(active) { send('session.error',active.id,{code:'WORKER_PROTOCOL_ERROR'}); active.session.cancel(); active = undefined; }
      else ws.close(1008,'Protocol error');
    }
  });
  ws.on('error', () => console.error(JSON.stringify({event:'worker.connection_error'})));
  ws.on('close', code => { active?.session.cancel(); active=undefined; console.log(JSON.stringify({event:'worker.disconnected',code})); });
  return ws;
}
