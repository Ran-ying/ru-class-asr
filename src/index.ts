import { WhisperHttp } from './inference.js';
import { createAsrApi } from './api.js';
const adapter=new WhisperHttp(process.env.WHISPER_URL||'http://127.0.0.1:8080/inference');
const server=createAsrApi(adapter,{apiKey:process.env.ASR_API_KEY||'',model:process.env.WHISPER_MODEL||'small'});
await adapter.infer(Buffer.alloc(16000*2));
const host=process.env.ASR_HOST||'127.0.0.1';const port=Number(process.env.ASR_PORT||8090);
server.listen(port,host,()=>console.log(JSON.stringify({service:'ru-class-asr',event:'api.ready',model:process.env.WHISPER_MODEL||'small',backend:'unverified:check-engine-logs',port})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
