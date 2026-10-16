import { wav } from './audio-window.js';
export interface InferenceAdapter { infer(pcm: Buffer, signal?: AbortSignal): Promise<string>; }
export class WhisperHttp implements InferenceAdapter {
  constructor(readonly url: string, readonly timeoutMs = 30000) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('INVALID_WHISPER_URL');
  }
  async infer(pcm: Buffer, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav(pcm))], {type:'audio/wav'}), 'window.wav');
    form.set('language','ru'); form.set('response_format','json'); form.set('temperature','0'); form.set('temperature_inc','0');
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
