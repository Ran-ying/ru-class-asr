# RU-Class ASR · v0.1

跨平台 Node.js/TypeScript Worker，主动连接 RU-Class 网关，把远端浏览器 PCM 组织为重叠 WAV 窗口，通过可替换适配器调用常驻 whisper.cpp HTTP 服务。核心无 Metal/Homebrew/系统路径依赖。当前在 M1 / 8 GB 上开发，small/Metal 的真实联调已通过；Mac mini M4 留待后期正式验收。实际结果见 [验收报告](docs/acceptance-v0.1.md)。其他操作系统尚未由作者验证，欢迎自行部署并反馈。

## macOS 安装与启动

要求 Node.js 22.6+、npm、Git、CMake、C++ 编译工具。whisper.cpp 是外部依赖，不放入本仓库；在独立目录按 [官方说明](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)构建。先选定并记录官方提交 SHA，再进行构建，避免把不明版本视为测试基线。

```sh
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
git rev-parse HEAD
cmake -B build -DGGML_METAL=ON
cmake --build build --config Release -j --target whisper-server
sh models/download-ggml-model.sh small
./build/bin/whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-small.bin -l ru
```

保持该进程运行，模型驻留内存。保留本地启动日志，确认模型是多语言 small 并核对 Metal 实际启用；`auto` 配置名称不证明 GPU 加速。CPU 对照可用同一服务的 `-ng`，并设 Worker `ASR_BACKEND=cpu`。不向公网开放此推理端口。

在本仓库：

```sh
npm ci
cp .env.example .env
# 本地填入网关的 WORKER_TOKEN；远端网关必须填 wss://.../ws/worker
node --env-file=.env --import tsx src/index.ts
```

Worker 启动先进行真实 WAV 推理探测，成功后才向网关注册。日志显示 `inference.probe_ok` 和 `worker.ready`，包含配置模型、操作系统、`unverified:auto` 或 `unverified:cpu`。真实后端仍需结合 whisper-server 日志验收；不会根据 macOS 系统名假称 Metal。断开网关后本次进程结束，检查错误后重启，原课堂不恢复。

`WHISPER_URL` 为可配置推理 URL，`WHISPER_MODEL` 为配置标签，超时默认 30 秒；窗口默认 8 秒、步长 1 秒、最早 2 秒首次推理，均可调整。核心只允许单次推理并行，积压只保留最新窗口。停止会 flush 尾部；结果携带音频采样区间，仅为窗口时间，不提供词级对齐。后续 LocalAgreement 不在本版。

## 结构与验证

`src/worker.ts` 处理出站连接/会话，`audio-window.ts` 管理有限 PCM 缓冲和 WAV，`inference.ts` 定义适配器和真实 HTTP 实现，`session.ts` 调度单次推理/flush/cancel，`protocol.ts` 是与主仓库固定版本的协议副本。

```sh
npm test
npm run typecheck
npm run build
# 构建后：node --env-file=.env dist/src/index.js
```

自动化测试使用明确的模拟适配器/HTTP，不代表俄语识别或 M4 实测。真实 5 分钟实时重放见 [硬件流程](docs/hardware-validation.md)。网关 VPS 安装/启动说明见主仓库 README：独立 Node 进程、HTTPS/WSS 反向代理、单独访问和 Worker 令牌，模型只在 ASR 主机运行。

错误排查：探测失败检查 whisper-server、模型加载、URL 和 HTTP 返回；连接认证失败检查 WORKER_TOKEN；远端只接受 WSS；断线需手动重启，不声称可靠恢复。勿提交密钥、私人地址、模型、录音、原始日志或个人路径。提交 Issue 时附脱敏的版本、CPU/GPU、后端和复现信息。社区反馈不等同于作者亲测。

模块关系见 [architecture](docs/architecture.md)，完整自动化输出见 [test results](docs/test-results-v0.1.txt)。

M1 实测方法、模型版本和延迟数据见 [M1 development](docs/m1-development.md)，M4 后期流程见 [hardware validation](docs/hardware-validation.md)。
