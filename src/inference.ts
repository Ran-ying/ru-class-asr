import { wav } from './audio-window.js';
/** One Whisper segment, in seconds relative to the start of the submitted window. */
export type Segment = {start:number;end:number;text:string};
export type VerboseTranscript = {text:string;duration:number;segments:Segment[]};
export interface InferenceAdapter {
  infer(pcm: Buffer, signal?: AbortSignal): Promise<string>;
  /** Optional: segment-level timestamps (whisper.cpp verbose_json). */
  inferVerbose?(pcm: Buffer, signal?: AbortSignal): Promise<VerboseTranscript>;
}
export type WhisperDecoding = {temperature:number;temperatureInc:number};
export const MAX_SEGMENTS=200;
/**
 * Keep only well-formed, in-window, ordered segment times. whisper.cpp maps VAD
 * segments back to the original audio timeline, so start/end are window time.
 * Word/token timings are deliberately dropped: under VAD they are relative to
 * the speech-only audio and are sub-word pieces (verified on the M4).
 */
export function sanitizeSegments(raw:unknown,duration:number):Segment[]{
  if(!Array.isArray(raw))throw new Error('INVALID_WHISPER_SEGMENTS');
  if(raw.length>MAX_SEGMENTS)throw new Error('WHISPER_TOO_MANY_SEGMENTS');
  const limit=duration+0.5;
  let previous=0;
  return raw.map(item=>{
    const s=item as Record<string,unknown>;
    const start=Number(s?.start),end=Number(s?.end);
    if(typeof s?.text!=='string'||s.text.length>4000||!Number.isFinite(start)||!Number.isFinite(end)||
       start<0||end<start||end>limit||start+0.05<previous)throw new Error('INVALID_WHISPER_SEGMENTS');
    previous=start;
    return {start:Math.round(start*1000)/1000,end:Math.round(end*1000)/1000,text:s.text.trim()};
  });
}
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
  private async request(pcm: Buffer, format:'json'|'verbose_json', signal?: AbortSignal): Promise<Record<string,unknown>> {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav(pcm))], {type:'audio/wav'}), 'window.wav');
    form.set('language','ru'); form.set('response_format',format); form.set('temperature',String(this.decoding.temperature)); form.set('temperature_inc',String(this.decoding.temperatureInc));
    // whisper.cpp's verbose_json otherwise runs language auto-detection on the
    // VAD-trimmed audio; a fully silent window leaves no audio, the detected id
    // is negative and whisper-server segfaults (verified with v1.9.5 on the M4).
    // The language is fixed to ru, so the probabilities are never needed.
    if(format==='verbose_json')form.set('no_language_probabilities','true');
    const response = await fetch(this.url, {method:'POST', body:form, signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])])});
    if (!response.ok) throw new Error(`WHISPER_HTTP_${response.status}`);
    if (Number(response.headers.get('content-length') ?? 0) > 1024 * 1024) throw new Error('WHISPER_RESPONSE_TOO_LARGE');
    const raw = await response.text();
    if (raw.length > 1024 * 1024) throw new Error('WHISPER_RESPONSE_TOO_LARGE');
    const body = JSON.parse(raw);
    if (typeof body.text !== 'string' || body.text.length > 20000) throw new Error('INVALID_WHISPER_RESPONSE');
    return body;
  }
  async infer(pcm: Buffer, signal?: AbortSignal): Promise<string> {
    return String((await this.request(pcm,'json',signal)).text).trim();
  }
  async inferVerbose(pcm: Buffer, signal?: AbortSignal): Promise<VerboseTranscript> {
    const body=await this.request(pcm,'verbose_json',signal);
    const duration=pcm.length/2/16000;
    return {text:String(body.text).trim(),duration,segments:sanitizeSegments(body.segments,duration)};
  }
}
