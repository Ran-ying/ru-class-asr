// The model is *never* exposed directly to a browser or public network.
// The external API enforces the existing Bearer key and Origin policy.
export interface TranslationAdapter {
  translate(text:string,signal?:AbortSignal):Promise<string>;
}
export class LocalTranslationHttp implements TranslationAdapter{
  constructor(readonly url:string,readonly timeoutMs=10000){
    const u=new URL(url);
    if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/translate'||
       u.username||u.password||u.search||u.hash||
       !Number.isInteger(Number(u.port))||Number(u.port)<1024||Number(u.port)>65535)
      throw Error('TRANSLATION_URL_MUST_BE_LOOPBACK');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)
      throw Error('INVALID_TRANSLATION_TIMEOUT');
  }
  async translate(text:string,signal?:AbortSignal){
    const controller=AbortSignal.any([AbortSignal.timeout(this.timeoutMs),...(signal?[signal]:[])]);
    const response=await fetch(this.url,{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text,source:'ru',target:'zh'}),signal:controller,
      redirect:'error'});
    if(!response.ok)throw Error('TRANSLATION_HTTP_'+response.status);
    if(Number(response.headers.get('content-length')||0)>8192)throw Error('TRANSLATION_RESPONSE_TOO_LARGE');
    const raw=await response.text();
    if(raw.length>8192)throw Error('TRANSLATION_RESPONSE_TOO_LARGE');
    const json:unknown=JSON.parse(raw);
    if(!json||typeof json!=='object'||!('translation' in json)||
       typeof json.translation!=='string'||json.translation.length>4000||
       !json.translation.trim())throw Error('INVALID_TRANSLATION_RESPONSE');
    return json.translation.trim();
  }
}
