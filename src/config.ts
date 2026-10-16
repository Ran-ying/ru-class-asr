import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Settings = {listen?: {host?: string; port?: number}; whisper?: {url?: string; model?: string}; apiKey?: string; cors?: {allowedOrigins?: string[]}};
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
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.ASR_ALLOW_PUBLIC_BIND !== '1') throw new Error('Non-loopback ASR listener requires ASR_ALLOW_PUBLIC_BIND=1 (TLS and firewall required)');
  const origins=process.env.ASR_CORS_ORIGINS!==undefined
    ? process.env.ASR_CORS_ORIGINS.split(',').map(x=>x.trim()).filter(Boolean)
    : json.cors?.allowedOrigins||[];
  if(!Array.isArray(origins)||origins.some(x=>typeof x!=='string'))throw Error('INVALID_CORS_ORIGINS');
  for(const value of origins){
    let origin:URL;try{origin=new URL(value);}catch{throw Error('INVALID_CORS_ORIGIN');}
    if(origin.origin!==value||(origin.protocol!=='https:' && !(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw Error('INVALID_CORS_ORIGIN');
  }
  return {
    host, port, allowedOrigins:[...new Set(origins)],
    apiKey: stringValue(process.env.ASR_API_KEY ?? json.apiKey, 'apiKey'),
    whisperUrl: stringValue(process.env.WHISPER_URL ?? json.whisper?.url, 'whisper.url', 'http://127.0.0.1:8080/inference'),
    model: stringValue(process.env.WHISPER_MODEL ?? json.whisper?.model, 'whisper.model', 'small')
  };
}
