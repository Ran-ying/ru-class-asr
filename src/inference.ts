import { wav } from './audio-window.js';
export interface InferenceAdapter { infer(pcm: Buffer, signal?: AbortSignal): Promise<string>; }
export type WhisperDecoding = {temperature:number;temperatureInc:number};
export class WhisperHttp implements InferenceAdapter {
  constructor(readonly url: string, readonly timeoutMs = 30000,
    readonly decoding:WhisperDecoding={temperature:0,temperatureInc:0}) {
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)
      throw Error('INVALID_WHISPER_TIMEOUT_MS');
    if(!Number.isFinite(decoding.temperature)||decoding.temperature<0||decoding.temperature>1||
       !Number.isFinite(decoding.temperatureInc)||decoding.temperatureInc<0||decoding.temperatureInc>1)
      throw Error('INVALID_WHISPER_DECODING');
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('INVALID_WHISPER_URL');
  }
  async infer(pcm: Buffer, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav(pcm))], {type:'audio/wav'}), 'window.wav');
    form.set('language','ru'); form.set('response_format','json'); form.set('temperature',String(this.decoding.temperature)); form.set('temperature_inc',String(this.decoding.temperatureInc));
    const response = await fetch(this.url, {method:'POST', body:form, signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])])});
    if (!response.ok) throw new Error(`WHISPER_HTTP_${response.status}`);
    if (Number(response.headers.get('content-length') ?? 0) > 1024 * 1024) throw new Error('WHISPER_RESPONSE_TOO_LARGE');
    const raw = await response.text();
    if (raw.length > 1024 * 1024) throw new Error('WHISPER_RESPONSE_TOO_LARGE');
    const body = JSON.parse(raw);
    if (typeof body.text !== 'string' || body.text.length > 20000) throw new Error('INVALID_WHISPER_RESPONSE');
    return body.text.trim();
  }
}
