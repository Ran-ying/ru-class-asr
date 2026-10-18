import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Settings = {listen?: {host?: string; port?: number}; whisper?: {url?: string; model?: string; temperature?: number; temperatureInc?: number; timeoutMs?: number}; translation?:{enabled?:boolean;url?:string;model?:string;timeoutMs?:number;threads?:number}; apiKey?: string; cors?: {allowedOrigins?: string[]}};
function stringValue(value: unknown, name: string, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value !== 'string') throw new Error(name + ' must be a string');
  return value;
}
export function loadConfig(path = process.env.RU_CLASS_ASR_CONFIG || 'config.json') {
  let json: Settings = {};
  try {
    const value: unknown = JSON.parse(readFileSync(resolve(path), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    json = value as Settings;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid config file ' + path + ': ' + String(e));
  }
  const host = stringValue(process.env.ASR_HOST ?? json.listen?.host, 'listen.host', '127.0.0.1');
  const port = Number(process.env.ASR_PORT ?? json.listen?.port ?? 8090);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('listen.port must be between 1 and 65535');
  const origins=process.env.ASR_CORS_ORIGINS!==undefined
    ? process.env.ASR_CORS_ORIGINS.split(',').map(x=>x.trim()).filter(Boolean)
    : json.cors?.allowedOrigins||[];
  if(!Array.isArray(origins)||origins.some(x=>typeof x!=='string'))throw Error('INVALID_CORS_ORIGINS');
  for(const value of origins){
    let origin:URL;try{origin=new URL(value);}catch{throw Error('INVALID_CORS_ORIGIN');}
    if(origin.origin!==value||(origin.protocol!=='https:' && !(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw Error('INVALID_CORS_ORIGIN');
  }
  const numberOption=(env: string|undefined, configured: number|undefined, fallback: number, name: string, min: number, max: number, integer=false)=>{
    const value=Number(env ?? configured ?? fallback);
    if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))
      throw Error('INVALID_'+name);
    return value;
  };
  const temperature=numberOption(process.env.WHISPER_TEMPERATURE,
    json.whisper?.temperature,0,'WHISPER_TEMPERATURE',0,1);
  // Preserve the previous default (0 = no fallback) for reproducibility.
  // Use 0.2 explicitly to test upstream's temperature fallback behavior.
  const temperatureInc=numberOption(process.env.WHISPER_TEMPERATURE_INC,
    json.whisper?.temperatureInc,0,'WHISPER_TEMPERATURE_INC',0,1);
  const whisperTimeoutMs=numberOption(process.env.WHISPER_TIMEOUT_MS,
    json.whisper?.timeoutMs,30000,'WHISPER_TIMEOUT_MS',1000,300000,true);
  const translationEnabled=json.translation?.enabled??false;
  if(typeof translationEnabled!=='boolean')throw Error('INVALID_TRANSLATION_ENABLED');
  const translationUrl=stringValue(json.translation?.url,'translation.url','http://127.0.0.1:8091/translate');
  const translationPortUrl=new URL(translationUrl);
  if(translationPortUrl.protocol!=='http:'||translationPortUrl.hostname!=='127.0.0.1'||
     translationPortUrl.pathname!=='/translate'||translationPortUrl.username||
     translationPortUrl.password||translationPortUrl.hash||translationPortUrl.search||
     !Number.isInteger(Number(translationPortUrl.port))||
     Number(translationPortUrl.port)<1024||Number(translationPortUrl.port)>65535)
    throw Error('TRANSLATION_URL_MUST_BE_LOOPBACK');
  const translationTimeoutMs=numberOption(undefined,json.translation?.timeoutMs,10000,'TRANSLATION_TIMEOUT_MS',1000,60000,true);
  const translationThreads=numberOption(undefined,json.translation?.threads,2,'TRANSLATION_THREADS',1,6,true);
  const translationModel=stringValue(json.translation?.model,'translation.model','m2m100-418m-int8');
  if(translationModel!=='m2m100-418m-int8')throw Error('UNSUPPORTED_TRANSLATION_MODEL');
  return {
    host, port, allowedOrigins:[...new Set(origins)],
    translationEnabled,translationUrl,translationTimeoutMs,translationThreads,translationModel,
    temperature,temperatureInc,whisperTimeoutMs,
    apiKey: stringValue(process.env.ASR_API_KEY ?? json.apiKey, 'apiKey'),
    whisperUrl: stringValue(process.env.WHISPER_URL ?? json.whisper?.url, 'whisper.url', 'http://127.0.0.1:8080/inference'),
    model: stringValue(process.env.WHISPER_MODEL ?? json.whisper?.model, 'whisper.model', 'small')
  };
}
