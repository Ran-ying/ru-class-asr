# RU-Class ASR · v0.1.1 (开发修复分支)

独立运行的 Whisper 语音识别 HTTP 服务，提供**OpenAI 兼容 API 的有限子集**。任何获得 API URL、模型和 Key 的服务都可调用它；不要求 RU-Class 主项目在线，也不需要主动连接主项目的旧 Worker。Node.js 应用跨平台，底层 `whisper.cpp` 构建及 GPU 后端按设备决定。当前先在 Mac M1 开发，M4 后期完成正式验收。

## whisper.cpp 推理引擎

首先在本仓库外安装官方 [whisper.cpp](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)。Mac Apple Silicon 示例（在 whisper.cpp 项目根目录执行）：

```sh
cmake -B build -DGGML_METAL=ON
cmake --build build --config Release -j --target whisper-server
sh models/download-ggml-model.sh small
./build/bin/whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-small.bin -l ru
```

## 启动独立 API 服务

在 `ru-class-asr` 项目根目录：

```sh
npm ci
cp config.example.json config.json
# 编辑 config.json，设置 apiKey、listen.port 和 whisper.url
npm run dev
```

`config.json` 在 `.gitignore` 中，不上传 API Key。示例 `listen.host=127.0.0.1`，`listen.port=8090`，`whisper.url=http://127.0.0.1:8080/inference`，`whisper.model=small`。更换 `listen.port` 即可自由配置监听端口；用 `RU_CLASS_ASR_CONFIG` 可指定私有 JSON 文件位置。环境变量 `ASR_HOST`、`ASR_PORT`、`ASR_API_KEY`、`WHISPER_URL`、`WHISPER_MODEL` 优先覆盖 JSON；原先 `.env` 方式依然适用。API Key 至少 24 字符，建议通过 `openssl rand -hex 32` 生成。

为避免意外以明文暴露 API Key，ASR 默认只允许监听 loopback。确实需要绑定 `0.0.0.0` 时需额外设置 `ASR_ALLOW_PUBLIC_BIND=1`，**同时自行配置 TLS 反代和防火墙**；通常更建议 loopback + TLS Nginx 反代/私有隧道。不要将内部 whisper-server 端口开放到互联网。主项目若在另一台 VPS 上，必须提供主项目服务器可访问的 HTTPS API 地址（或者受保护的隧道），其 `asr.baseUrl` 应包含 `/v1`。

## HTTP API 子集

- `GET /v1/models`：返回唯一配置的模型名。
- `POST /v1/audio/transcriptions`：携带 `Authorization: Bearer <ASR_API_KEY>`，multipart 表单 `file`、`model`，可选 `language=ru` 和 `response_format=json|text`。
- 仅支持 16 kHz 单声道 PCM16 WAV，最长 30 秒，上传限制 2 MiB；一个并行推理，忙时返回 429。无 SSE/流式 token/词级时间戳，实时字幕由主应用调度重叠短音频请求。

## 测试

```sh
npm test
npm run typecheck
npm run build
node dist/src/index.js
```

真实引擎测试请参阅 [docs/hardware-validation.md](docs/hardware-validation.md)。此前 M1 短俄语音频已完成真实联调，M4、长时间和实体浏览器麦克风仍待验证。
