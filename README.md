# RU-Class ASR · v0.1.3

独立运行的 Whisper 语音识别 HTTP 服务，提供**OpenAI 兼容 API 的有限子集**。任何获得 API URL、模型和 Key 的服务都可调用它；不要求 RU-Class 主项目在线，也不需要主动连接主项目的旧 Worker。Node.js 应用跨平台，底层 `whisper.cpp` 构建及 GPU 后端按设备决定。当前先在 Mac M1 开发，M4 后期完成正式验收。

## 当前维护与验收入口

- [当前独立 HTTP API 架构、监听/CORS 语义与验收状态](docs/current-status.md)
- [真实硬件和浏览器直连验收流程](docs/hardware-validation.md)
- [维护者工作规范](AGENTS.md)

历史 Worker/WebSocket 方案已退出当前启动路径。浏览器直连用户自选
ASR 端点不依赖 RU-Class 主站服务器，也不使用全站默认 AI 模型。
目前 M1 合成音频/Metal 联调不等于真实课堂或 M4 正式验收。

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

`config.json` 在 `.gitignore` 中，不上传 API Key。示例 `listen.host=127.0.0.1`，`listen.port=8090`，`whisper.url=http://127.0.0.1:8080/inference`，`whisper.model=small`。更换 `listen.host` 和 `listen.port` 即可自由配置监听地址与端口；用 `RU_CLASS_ASR_CONFIG` 可指定私有 JSON 文件位置。环境变量 `ASR_HOST`、`ASR_PORT`、`ASR_API_KEY`、`WHISPER_URL`、`WHISPER_MODEL` 优先覆盖 JSON；原先 `.env` 方式依然适用。API Key 至少 24 字符，建议通过 `openssl rand -hex 32` 生成。

ASR 默认监听 `127.0.0.1`，但可以直接将 `listen.host`（或 `ASR_HOST`）配置为 `0.0.0.0`、`::` 或其他本机可绑定地址，无需额外开关。监听非回环地址时，**应自行配置 HTTPS/TLS 反向代理、防火墙和访问控制**，避免明文传输 API Key；通常更建议 loopback + TLS Nginx 反代/私有隧道。不要将内部 whisper-server 端口开放到互联网。RU-Class 网页由用户的浏览器**直接**请求 ASR，不通过主项目 Node.js 转发。跨域浏览器需要 HTTPS API、API Token 和 CORS。

**v0.1.3 CORS 规则：**

- `"cors": {"allowedOrigins": []}`（**默认值**，包括未设置此字段）：**不限制浏览器来源**；任意网站 Origin 均可收到 CORS 响应并完成预检。
- `"cors": {"allowedOrigins": ["https://class.example.com"]}`：**仅允许**列出的精确 Origin；可填写多个地址。示例域名需替换为实际网页来源。
- 环境变量 `ASR_CORS_ORIGINS` 优先于 JSON。设置为空字符串时同样表示不限制；设置为逗号分隔的地址列表时表示启用白名单。
- 无论哪种模式，`GET /v1/models` 和 `POST /v1/audio/transcriptions` **始终要求 Bearer API Key**。没有 `Origin` 的原生/服务端客户端仍保持原行为。

空白名单便于在个人设备上由不同 RU-Class 域名直连使用，但**任何网站只要获得你的 API Key 都能尝试在浏览器中调用你的 ASR**。CORS 不负责身份验证或保护密钥，切勿因为允许全部 Origin 而删除 Bearer 校验；如果将 ASR 暴露在公网，应额外使用 HTTPS、强随机 Key、速率限制和访问控制。

服务为允许的 Origin 处理无需 Bearer 的 `OPTIONS /v1/models` 和 `OPTIONS /v1/audio/transcriptions` 预检，响应 `Access-Control-Allow-Headers: Authorization, Content-Type`，正常 GET/POST 仍校验 Bearer API Key。不要把自建 ASR 的密钥公开写到网页源代码中；CORS 无限制并不等于无认证。

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
