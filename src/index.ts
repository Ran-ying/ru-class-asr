import { WhisperHttp } from './inference.js';
import { createAsrApi } from './api.js';
import { loadConfig } from './config.js';
import { LocalTranslationHttp } from './translate.js';

const config = loadConfig();
const adapter = new WhisperHttp(config.whisperUrl,config.whisperTimeoutMs,{temperature:config.temperature,temperatureInc:config.temperatureInc});
const translation=config.translationEnabled?new LocalTranslationHttp(config.translationUrl,config.translationTimeoutMs):undefined;
const server = createAsrApi(adapter, {apiKey: config.apiKey, model: config.model,allowedOrigins:config.allowedOrigins,translation,translationModel:config.translationModel});
await adapter.infer(Buffer.alloc(16000 * 2));
server.listen(config.port, config.host, () => console.log(JSON.stringify({
  service: 'ru-class-asr', event: 'api.ready', model: config.model,
  backend: 'unverified:check-engine-logs', host: config.host, port: config.port,
  translation:config.translationEnabled?config.translationModel:'disabled'
})));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
