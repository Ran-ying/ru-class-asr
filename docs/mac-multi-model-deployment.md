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
<你的项目父目录>/whisper.cpp
```

例如你的目录是 `~/Projects/ru-class-asr`，默认会安装到 `~/Projects/whisper.cpp`，两个项目并列，不会放进 `ru-class-asr` 内部。

随后以 `-DGGML_METAL=ON` 构建 `whisper-server`。**如果同级目录已有自己手工安装的 whisper.cpp 仓库及 `models/ggml-small.bin`，直接复用该 checkout 和已有权重**，无需重复克隆或下载。

以前的脚本曾使用 `~/.local/share/ru-class-asr/whisper.cpp`。本次只修改默认位置，**不会自动迁移、删除或覆盖旧目录**。如果你要继续使用那个位置，可在运行前设置 `WHISPER_CPP_DIR="$HOME/.local/share/ru-class-asr/whisper.cpp"`。如果你的旧仓库在其他位置，同样可以用 `WHISPER_CPP_DIR` 指定。

如果同级目录已存在但不是 Git checkout，脚本会报错而非覆盖；如果同级模型文件完整，`download small` 会提示已存在并跳过。自定义模型位置：

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

下载经上游 `models/download-ggml-model.sh`，不是自行构造任意模型链接。已有本地文件不会被覆盖。现在在 `download` 完成和 `run` 启动之前，会核验这三个官方多语言模型的**精确文件字节数和 SHA-256**（官方 ggerganov/whisper.cpp）。`list` 只说明文件存在，**不代表完整性通过**。可明确执行：

```bash
bash scripts/mac-whisper-models.sh verify small
bash scripts/mac-whisper-models.sh verify medium
bash scripts/mac-whisper-models.sh verify large
# 或统一校验：
bash scripts/mac-whisper-models.sh verify all
```

若发现不完整或 SHA 不符，脚本会拒绝运行并保留现有文件供人工处理，不会自动删除它或错误报告“可用”。切勿在未核验前自行改名为有效 GGML 文件。

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

**参数直接写在本地 `config.json` 里**。重新启动 Node 后生效，无需在终端输入环境变量。为了确保同时启动两层服务时模型、端口与解码参数一致，`run` 使用 `config.json` 作为来源；直接运行 API 的旧环境变量覆盖方式仍用于其他部署场景，但不建议在本机模型实验中混用。若旧终端设置过同名 WHISPER_* 覆盖项，`run` 会提示先取消设置，避免静默覆盖文件。

## 4. 通过 config.json 明确启用一个模型

在 `ru-class-asr/config.json` 中只修改已有 `whisper` 区域（不要覆盖本机 API Key 或其它字段）：

```json
"whisper": {
  "url": "http://127.0.0.1:8080/inference",
  "model": "small",
  "temperature": 0,
  "temperatureInc": 0.2,
  "timeoutMs": 30000
}
```

这是配置**片段**，不是单独可用的完整 JSON 文件。参数说明：

- `whisper.model`：`small`、`medium` 或 `large-v3`，决定本次启动的真实权重文件和 Node API 模型 ID；
- `whisper.temperatureInc`：旧版 0；0.2 在 C2 #76 上实际触发了回退，但不能认定最优；
- `whisper.temperature`：初始解码温度，先固定为 0 以保持可比性；
- `whisper.timeoutMs`：Node 等待 Whisper 推理返回的超时毫秒数；medium/large 可调整为 90000/120000 用于离线对照；
- `whisper.url`：组合启动器自动绑定的本机引擎端口；出于引擎安全，组合启动暂只允许 `http://127.0.0.1:PORT/inference`。

配置完后：

```bash
npm ci
npm run build
bash scripts/mac-whisper-models.sh run
```

这会启动 `config.json` 中指定的模型及对应 Node API。以后切换模型时，先使用 Ctrl+C 停止，再编辑 `config.json` 中的 `whisper.model`，然后运行同一条 `run` 命令。不需要 `WHISPER_MODEL=...` 等前缀。

`run small` / `run medium` / `run large` 仍可使用，但只会**验证**实际配置的模型与参数一致；指定模型与文件中的 `whisper.model` 不符时主动拒绝启动，而不会覆盖它。`large` 操作名对应文件里的 `large-v3`。

使用 `run` 时不得在进程环境中另外设置 WHISPER_MODEL / WHISPER_URL / WHISPER_TEMPERATURE / WHISPER_TEMPERATURE_INC / WHISPER_TIMEOUT_MS / RU_CLASS_ASR_CONFIG；这样的启动会提示清理旧覆盖值。直接单独使用 `npm run dev` 的传统环境变量配置兼容性仍保留，但组合启动已不再使用或注入这些变量。

内部 whisper-server 仅绑定本机回环地址；Node API 仍依据 `config.json` 的 `listen.host` 和 `listen.port` 启动。切换之前必须停止旧进程，包装脚本会对 INT/TERM 同时清理它拥有的 Whisper 和 Node 进程。强制 SIGKILL 或断电无法由进程信号处理器捕获。

若只希望运行推理引擎，可使用 `bash scripts/mac-whisper-models.sh engine medium`；然后在另一终端用自己的 `config.json` 启动 Node：`npm run dev`（文件中的模型必须写 `medium`）。

**不要只修改 Node API 模型标签却不重启真实推理引擎。** 模型文件以 whisper-server 的 `-m` 加载路径及 SHA 为准，`GET /v1/models` 只报告 Node 配置中的名称。

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
