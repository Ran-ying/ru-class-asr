# RU-Class ASR · v0.1

独立运行的语音识别服务，对外提供带 key 的 OpenAI 兼容 API；主项目通过地址、模型和 key 调用。本项目无需主项目在线，不再主动连接课堂网关。内部调用常驻 whisper.cpp，平台构建留在外部。当前 M1 开发联调，M4 正式验收后期进行。

## 启动

需要 Node.js 22.6+；按 [whisper.cpp 官方说明](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)在本仓库外构建 whisper-server，记录版本/模型及实际 GPU 后端。示例在 macOS：

```sh
cmake -B build -DGGML_METAL=ON
cmake --build build --config Release -j --target whisper-server
sh models/download-ggml-model.sh small
./build/bin/whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-small.bin -l ru
```

在本项目根目录：

```sh
npm ci
cp .env.example .env
# 本地生成至少 24 字符随机 ASR_API_KEY，填入 .env，勿提交
# WHISPER_URL 指向上面的 /inference，WHISPER_MODEL=small
node --env-file=.env --import tsx src/index.ts
```

启动先做真实引擎推理探测，成功后监听 http://127.0.0.1:8090/v1。将该地址、相同的 ASR_API_KEY 和模型 small 配置到主项目。key 不是 Whisper 厂商密钥，而是本独立服务的访问凭证。不向公网暴露内部 whisper-server；跨机器 API 应使用 HTTPS 和受控网络，生产部署需另行授权。

## 兼容接口范围

- Authorization: Bearer <ASR_API_KEY>。
- GET /v1/models：返回可用模型列表。
- POST /v1/audio/transcriptions：multipart file / model，可选 language=ru / response_format=json 或 text；返回 {text} 或纯文本。
- 仅支持最多 30 秒、16 kHz 单声道 PCM16 WAV，请求总大小最多 2 MiB。一次推理，忙时返回 429。非法 key 401，参数 400，引擎错误 502。支持调用方取消，不保存录音。
- 不声称支持完整 OpenAI API、MP3、流式 SSE 或时间戳。实时字幕由调用方分窗重复请求形成。

```sh
npm test
npm run typecheck
npm run build
node --env-file=.env dist/src/index.js
# 对运行中的本地主项目重放授权俄语音频；默认要求至少 5 分钟
GATEWAY_CLIENT_URL=ws://127.0.0.1:3000/ws/client npm run replay -- ru-16k.wav artifacts/replay.json
```

src/api.ts 为兼容 API，inference.ts 为内部 Whisper 适配器，index.ts 为当前入口。旧 worker.ts/session.ts 保留迁移回归用途，正常启动不加载；当前窗口调度在主项目。原始媒体、密钥、模型、个人路径和日志禁止提交。

[当前架构/合约与测试](docs/api-integration-v0.1.md) · [验收](docs/acceptance-v0.1.md) · [后期 M4 流程](docs/hardware-validation.md)。M1 八秒合成俄语通过新 API 真实联调，仍不等于 M4、五分钟自然俄语或实际麦克风验收。
