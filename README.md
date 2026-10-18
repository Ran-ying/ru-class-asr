# RU-Class ASR · v0.1.3

独立运行的 Whisper 语音识别 HTTP 服务，提供**OpenAI 兼容 API 的有限子集**。任何获得 API URL、模型和 Key 的服务都可调用它；不要求 RU-Class 主项目在线，也不需要主动连接主项目的旧 Worker。Node.js 应用跨平台，底层 `whisper.cpp` 构建及 GPU 后端按设备决定。此前使用 Mac M1 开发；Mac mini M4 已完成真实 ASR HTTP 与运营者报告的运行时 Metal、多模型/解码增量本地验证（2026-10-17）；真实浏览器长时课堂验收仍未完成。

## 当前维护与验收入口

- [当前独立 HTTP API 架构、监听/CORS 语义与验收状态](docs/current-status.md)
- [真实硬件和浏览器直连验收流程](docs/hardware-validation.md)
- [全新 Mac mini：安装并切换 Whisper small / medium / large-v3](docs/mac-multi-model-deployment.md)
- [DeepSeekHarness：全新 Mac mini 模型部署与 A/B/C/D 实验任务书](docs/deepseekharness-mac-mini-model-validation.md)
- [M4 三模型真实音频对照：解码回退触发、性能与限制](docs/m4-2026-10-17-model-comparison.md)
- [M4 small 温度增量五组实测：185 次请求、0.2 候选与盲点](docs/m4-2026-10-17-temperature-inc-sweep.md)
- [维护者工作规范](AGENTS.md)

历史 Worker/WebSocket 方案已退出当前启动路径。浏览器直连用户自选
ASR 端点不依赖 RU-Class 主站服务器，也不使用全站默认 AI 模型。
目前 M1 合成音频/Metal 联调不等于真实课堂或 M4 正式验收。

## M4 部分实机结果（2026-10-17）

Mac mini M4（16 GB，macOS 26.5.2）已经使用真实 8 秒俄语音频验证本机 ASR 和经 HTTPS/Nginx/WireGuard 的转写请求；连续 **20/20** 次串行公网请求返回 HTTP 200，平均 **852.380 ms**、P95 **906.832 ms**。耗时包含网络及反向代理，不可直接用于计算相对 M1 的芯片加速比例；Metal 启用日志、五分钟真实麦克风和浏览器转写正确性仍未验收。详见 [M4 实测及 M1 对比](docs/m4-2026-10-17-field-report.md)。

## whisper.cpp 推理引擎

首先在本仓库外安装官方 [whisper.cpp](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)。Mac Apple Silicon 示例（在 whisper.cpp 项目根目录执行）：

```sh
cmake -B build -DGGML_METAL=ON
cmake --build build --config Release -j --target whisper-server
sh models/download-ggml-model.sh small
./build/bin/whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-small.bin -l ru
```

**全新 Mac mini 推荐流程：** 安装脚本复用与 `ru-class-asr` 同级的 `whisper.cpp`。以后把模型及解码参数直接写在**本地忽略提交的 `config.json`**：

```json
"whisper": {
  "url": "http://127.0.0.1:8080/inference",
  "model": "small",
  "temperature": 0,
  "temperatureInc": 0.2,
  "timeoutMs": 30000
}
```

这是 `config.json` 的**一个字段片段**，不要用它覆盖完整配置（尤其不要覆盖你的 API Key / 监听等字段）。`temperatureInc: 0.2` 是实测对 C2 #76 有效、上游 whisper.cpp 常用的实验候选，**并非已证明全局最优**。在没有明确修改的情况下示例默认 `temperatureInc: 0` 仍保持旧版基线。

```bash
npm ci && npm run build
bash scripts/mac-whisper-models.sh run
```

现在 `run` **不需要指定模型，也不向 Node 注入 WHISPER_MODEL/WHISPER_URL**；它根据 `config.json` 的 `whisper.model` 自动加载实际模型，并使用文件里的本机 `whisper.url` 端口。仍可 `run small`，但只用于核对配置是否确实选择了 small，若不匹配则报错。切换模型需编辑 `config.json` 的 `whisper.model`（`large-v3` 需写全名）并停止/重启服务。详细步骤见 [三模型部署指南](docs/mac-multi-model-deployment.md)。

对该组合启动器，环境中若还有同名的 WHISPER_* / RU_CLASS_ASR_CONFIG 旧覆盖项将被拒绝，以确保本地文件是唯一生效来源。直接 `npm run dev` 的兼容环境变量支持仍保留给已有自动化部署，但个人 Mac 不需要用它们。

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

真实引擎测试请参阅 [docs/hardware-validation.md](docs/hardware-validation.md)。此前 M1 已完成真实引擎开发联调，M4 已通过 HTTP 部分测试；Metal 后端证明、长时间和实体浏览器麦克风测试仍待完成。


## v0.5 准备：Mac mini 本地俄中机器翻译（可选）

**仓库部署脚本已新增，尚未在你的 Mac mini 下载或启动模型。**
目前 ASR 和原 Web 录音 API 无需更改。新增可选
`POST /v1/translate` 使用**现有 Bearer API Key 与相同 CORS**；
后端把俄语送至仅绑定本机回环地址的 M2M100 INT8 翻译服务。
即使模型不可用，也不会影响 `POST /v1/audio/transcriptions`。
`GET /v1/models` 仍只返回当前 Whisper 模型，避免误导旧客户端。

当前推荐的组合启动：

```sh
# Mac mini: Python 3.11、Node >=22.6、cmake、Xcode CLT 必须已安装
brew install python@3.11 node cmake
npm ci
cp -n config.example.json config.json    # 仅首次创建，不覆盖现有私有配置
# 编辑 config.json：填入随机 apiKey，translation.enabled=true。
bash scripts/mac-classroom.sh install      # 显式下载/转换/校验模型
bash scripts/mac-classroom.sh check
bash scripts/mac-classroom.sh run          # 前台运行，Ctrl+C 停止所有新进程
```

如果已经有本机 `config.json`，**不要复制示例文件覆盖它**；
只需添加如下配置对象：

```json
"translation": {
  "enabled": true,
  "url": "http://127.0.0.1:8091/translate",
  "model": "m2m100-418m-int8",
  "timeoutMs": 10000,
  "threads": 2
}
```

上面是 JSON 内部的一个字段片段，不是独立配置文件。Mac mini 同时启动
Whisper Small + CPU INT8 M2M100，翻译模型权重只加载一次。模型下载和
转换需要数 GB 磁盘空间，并可能临时占用较多内存；转换时建议暂停其他
重量级推理任务。实际内存/延迟和翻译质量**尚需 Mac mini 实机验收**。

完整步骤、独立运行和故障排查参见
[本地翻译与组合启动](docs/mac-local-translation.md)。
`bash scripts/mac-whisper-models.sh run` 依然用于旧 ASR-only 模式。
