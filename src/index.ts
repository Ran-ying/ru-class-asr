import { WhisperHttp } from './inference.js';
import { createAsrApi } from './api.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const adapter = new WhisperHttp(config.whisperUrl);
const server = createAsrApi(adapter, {apiKey: config.apiKey, model: config.model,allowedOrigins:config.allowedOrigins});
await adapter.infer(Buffer.alloc(16000 * 2));
server.listen(config.port, config.host, () => console.log(JSON.stringify({
  service: 'ru-class-asr', event: 'api.ready', model: config.model,
  backend: 'unverified:check-engine-logs', host: config.host, port: config.port
})));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
