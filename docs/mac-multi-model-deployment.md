# Mac mini M4 从零部署 Whisper small / medium / large-v3

**范围：** 独立 `ru-class-asr` + 上游 `whisper.cpp` 的多语言俄语识别；本仓库不是上游模型仓库。本指南面向**全新 Mac mini Apple Silicon**，不假定存在已安装的 Node、Git、CMake、Xcode 工具、模型或 API Key。

**不执行远程主机写入、不复用旧密钥、不自动向公网开放任何端口。** 启动命令只有本机明确执行时才会下载、启动或切换。当前仓库不会自动服务化安装，也不修改既有 Mac 的服务。请不要将任何私有课堂录音、密钥、域名或绝对用户路径提交 GitHub。

## 三个模型的对应关系

| 用户操作名 | 上游 whisper.cpp GGML 文件 | 典型磁盘占用 | 语言 |
| --- | --- | --- | --- |
| `small` | `models/ggml-small.bin` | 约 466 MB | 多语言，含俄语 |
| `medium` | `models/ggml-medium.bin` | 约 1.5 GB | 多语言，含俄语 |
| `large` | `models/ggml-large-v3.bin` | 约 3.1 GB | 多语言，含俄语 |

采用 **large-v3** 而不是早期 large-v1/v2；脚本中的 `large` 是一个清楚的操作别名。实际加载的是 `large-v3`，API 返回模型 ID 也为 `large-v3`。三套权重可以同时留在磁盘，但 16 GB 统一内存的 Mac mini **一次只运行一个引擎**，不要同时启动三个服务占用资源。下载需预留数 GB 存储和上游模型下载网络。

参考：
- [whisper.cpp 官方部署](https://github.com/ggml-org/whisper.cpp)
- [官方 GGML 模型](https://huggingface.co/ggerganov/whisper.cpp)
- [官方 whisper-server API 与解码参数](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)

## 0. 全新 macOS 基础依赖

先在用户账户内执行：

```bash
xcode-select --install
# 按系统提示完成安装，然后检查（有时系统已内置工具，无需重复安装）
xcrun --find clang
git --version
```

安装 Homebrew（按 [brew.sh](https://brew.sh) 当时的官方方法）及 **CMake**、**Node.js 22.6 或更新的 LTS**，然后验证：

```bash
brew install cmake node
cmake --version
node --version
npm --version
```

这是供全新环境参考的显式步骤。仓库脚本不会自动安装 Homebrew、不需要 `sudo`，遇到依赖缺失只会报错。

```bash
git clone https://github.com/Ran-ying/ru-class-asr.git
cd ru-class-asr
# 在分支阶段：git fetch origin feat/mac-whisper-model-deployment
#             git switch feat/mac-whisper-model-deployment
bash scripts/mac-whisper-models.sh check
```

请记录真实 `git rev-parse HEAD`；不要把错误的仓库路径或历史 M1 数字当作本机版本证据。

## 1. 克隆并编译 whisper.cpp（启用 Metal 构建）

```bash
bash scripts/mac-whisper-models.sh bootstrap
```

此命令会把官方 whisper.cpp 仓库克隆到：

```text
~/.local/share/ru-class-asr/whisper.cpp
```

随后以 `-DGGML_METAL=ON` 构建 `whisper-server`。如该目录已经存在，仅保留原 checkout，不会擅自更新或覆盖。自定义模型位置：

```bash
export WHISPER_CPP_DIR="$HOME/your-chosen-directory/whisper.cpp"
bash scripts/mac-whisper-models.sh bootstrap
```

**构建启用 Metal ≠ 运行时确认使用 Metal**。启动日志必须记录后端实际加载的信息。正式对比应记录 `git -C "$WHISPER_CPP_DIR" rev-parse HEAD`（或默认路径）、设备/系统、启动日志与模型 SHA-256。

## 2. 分别下载 small、medium、large

```bash
bash scripts/mac-whisper-models.sh download small
bash scripts/mac-whisper-models.sh download medium
bash scripts/mac-whisper-models.sh download large
# 或在磁盘充足时：bash scripts/mac-whisper-models.sh download all
bash scripts/mac-whisper-models.sh list
```

下载经上游 `models/download-ggml-model.sh`，不是自行构造任意模型链接。已有本地文件不会被覆盖；脚本仅检查存在性与大致文件大小，**不能证明未被损坏**。请在本机私下记录每个实际文件的 `shasum -a 256`，必要时与上游公开模型哈希对照。

## 3. 安装本项目 API 并生成本机专用 Key

```bash
npm ci
npm test
npm run typecheck
npm run build
cp config.example.json config.json
chmod 600 config.json
```

然后在本机编辑被 Git 忽略的 `config.json`：
- `apiKey` 填入**自己新生成的随机字符串，至少 24 个字符**，例如本机运行 `openssl rand -hex 32` 产生的值，**不要把生成结果发到聊天、终端录屏或 GitHub**。
- `listen.host=127.0.0.1`, `listen.port=8090`。
- `whisper.url=http://127.0.0.1:8080/inference`，`whisper.model=small` 作为默认静态示例。
- `cors.allowedOrigins` 需要面向网页时再按真实 HTTPS 来源填写。空数组默认允许任意 Origin，但仍需要 Bearer 认证；这不是生产环境的推荐暴露方式。
- `whisper.temperature=0`，`whisper.temperatureInc=0` 保留以前的解码基线，`whisper.timeoutMs=30000` 是原请求超时。

这些值也可在**进程启动之前**由 `WHISPER_TEMPERATURE`、`WHISPER_TEMPERATURE_INC`、`WHISPER_TIMEOUT_MS` 覆盖。增量合法范围是 0–1，超时可设为 1000–300000 毫秒。首次验证应保留 0/0 作基线；后续再测试 0/0.2。

## 4. 明确启用一个模型（同时启动引擎 + ASR API）

```bash
# 终端 A：启用 small，直到 Ctrl+C 退出
bash scripts/mac-whisper-models.sh run small

# 另一次实验，在同一终端先停止上一次进程后：
WHISPER_TEMPERATURE_INC=0.2 \
  bash scripts/mac-whisper-models.sh run small

# 在停止后启用 medium（适当增加超时）
WHISPER_TEMPERATURE_INC=0.2 WHISPER_TIMEOUT_MS=90000 \
  bash scripts/mac-whisper-models.sh run medium

# 在停止后启用 large-v3
WHISPER_TEMPERATURE_INC=0.2 WHISPER_TIMEOUT_MS=120000 \
  bash scripts/mac-whisper-models.sh run large
```

`run` 将 `WHISPER_MODEL` 仅注入**本次** ASR 进程，和实际引擎二进制选择保持一致。它不会修改本机的 `config.json`，也不会切换正在运行的录音会话。内部 whisper-server 强制绑定 `127.0.0.1:8080`，API 保持配置中的 `listen.host`（建议本地 `127.0.0.1:8090`）。`run` 不允许引擎端口已经被其他程序占用。按 Ctrl+C 退出后才切换模型。

若只希望运行推理引擎（例如想分两个终端手动部署 API），使用：

```bash
bash scripts/mac-whisper-models.sh engine medium
# 然后新终端执行 WHISPER_MODEL=medium npm run dev
```

**不能只把 API 的 `WHISPER_MODEL` 改成 `medium` 就声称切换了真正的模型**：底层 whisper-server 是另一个进程，必须实际加载 `ggml-medium.bin`。本项目 `GET /v1/models` 只是报告本次 API 配置标签，模型权重仍以本机引擎启动参数和真实文件哈希为准。

## 5. 本机测试 API，且不泄露凭证

在 Mac mini 的另一个终端手动从本地 `config.json` 安全获取自己的 Key（避免贴在命令行历史中），执行：

```bash
# 此处只是示范：请在当前 shell 以自己的安全方式加载私有 Key。
# 不要输出到终端，也不要直接写入任何仓库文件。
curl --noproxy '*' -fsS \
  -H "Authorization: Bearer $ASR_TEST_KEY" \
  http://127.0.0.1:8090/v1/models

curl --noproxy '*' -fsS \
  -H "Authorization: Bearer $ASR_TEST_KEY" \
  -F "file=@/absolute/private/8s-16k-mono.wav;type=audio/wav" \
  -F "model=medium" -F "language=ru" \
  http://127.0.0.1:8090/v1/audio/transcriptions
```

第二条命令的 `model` 必须与本次 `run small/medium/large` 对外标签相同。请求格式只允许 16-kHz、单声道、PCM16 WAV；不能直接上传未经转换的 m4a/mp3。

## 6. 如何验证模型改善了重复循环

比较下列**同一音频、相同输入条件**，每组至少覆盖 C2 #76、C1 #30 和 C1 #120 的**原始私有** 8 秒焦点音频：

| 组 | 真正加载的模型 | Temperature | 增量 | 用途 |
| --- | --- | --- | --- | --- |
| A | small | 0 | 0 | 之前生产配置的原始基线 |
| B | small | 0 | 0.2 | 隔离温度回退的影响 |
| C | medium | 0 | 0.2 | 隔离模型增大的影响 |
| D | large-v3 | 0 | 0.2 | 高模型容量对照 |

每一组统计原始识别窗口字数、不同词占比、重复三词数，以及同一个原始音频返回结果的耗时。C2 #76 是否还产生异常重复，是第一关注指标。之后再将完整重算的 C1/C2 窗口送入 RU-Class 当前字幕算法验证；旧窗口缓存的 227/45 机械回归不能代替**新模型输出的**端到端对比。

**本实验完全不需要人工俄语听辨**，用户已明确拒绝。结果可以评估工程稳定性和独立模型一致性，但不能声称 WER 或实际说出的词已经被核实。原百炼 Key 已禁用，不要使用或尝试恢复。

## 问题排查

- **`temperature_inc` 修改没有生效**：确认本机 API 的私有配置或进程环境值；本仓库 `src/inference.ts` 负责把参数传到上游 `/inference`。
- **测试耗时超过 30 秒**：为 medium/large 在此测试会话设置 `WHISPER_TIMEOUT_MS=90000` 或 `120000`；记录真实 p95，不要无条件在生产提高实时请求排队。
- **模型 ID 只是标签**：先检查 whisper-server 的 `-m` 文件路径与 SHA，再相信 `/v1/models`。
- **地址绑定问题**：推理引擎保持 loopback；远程 Web 浏览器必须经授权 HTTPS/TLS 反代、合理 CORS、Bearer 和防火墙；此脚本不替用户开启公网。
- **大模型慢/内存紧张**：不要并行启动三套权重；先用固定 8 秒音频分别记录启动、推理时间和系统内存，再决定是否将 medium/large 用于持续约每秒一请求的课堂实时路径。

## 当前验收

这些脚本和文档在 GitHub CI 中做的是**模拟/静态**测试。没有仓库工具直接控制用户的新 Mac mini，也没有实际在 Mac mini 上下载或运行这三组权重。物理 Mac mini 安装、真实模型加载、Metal 使用和跨组推理延迟，需要 DeepSeekHarness 在新环境完成，参见 [Mac mini DeepSeekHarness 任务书](deepseekharness-mac-mini-model-validation.md)。
