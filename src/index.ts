import { WhisperHttp } from './inference.js';
import { connectWorker } from './worker.js';
function number(name: string, fallback:number, min:number, max:number) {
  const value = Number(process.env[name] ?? fallback);
  if(!Number.isFinite(value) || value < min || value > max) throw new Error(`INVALID_${name}`);
  return value;
}
const windowSeconds = number('WINDOW_SECONDS',8,2,30);
const stepSeconds = number('STEP_SECONDS',1,0.2,windowSeconds);
const minSeconds = number('MIN_SECONDS',2,0.5,windowSeconds);
const backend = process.env.ASR_BACKEND || 'auto';
if(!['auto','cpu'].includes(backend)) throw new Error('v0.1 ASR_BACKEND supports auto or cpu; configure the actual whisper-server accordingly');
const adapter = new WhisperHttp(process.env.WHISPER_URL || 'http://127.0.0.1:8080/inference',number('INFERENCE_TIMEOUT_MS',30000,1000,30000));
// An actual inference probe verifies HTTP, WAV format, model availability and response shape.
await adapter.infer(Buffer.alloc(16000*2));
console.log(JSON.stringify({event:'inference.probe_ok',backend:'unverified',note:'Verify actual backend from whisper-server startup logs'}));
const ws = connectWorker(adapter,{url:process.env.GATEWAY_URL || 'ws://127.0.0.1:3000/ws/worker',token:process.env.WORKER_TOKEN || '',model:process.env.WHISPER_MODEL || 'small',backend,windowSeconds,stepSeconds,minSeconds});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal, () => ws.close(1000,'Shutdown'));
