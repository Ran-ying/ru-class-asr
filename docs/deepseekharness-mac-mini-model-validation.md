# DeepSeekHarness 任务书：全新 Mac mini 上验证 RU-Class-ASR 三个 Whisper 模型

> **2026-10-17 post-validation update:** This task's initial small/medium/large
> operator benchmark is complete and archived in
> [m4-2026-10-17-model-comparison.md](m4-2026-10-17-model-comparison.md).
> Earlier commands further below that prefix `WHISPER_TEMPERATURE_INC=...` are
> **historical experiment commands**. The new recommended Mac workflow edits
> `config.json` (especially `whisper.model`, `whisper.temperatureInc`,
> `whisper.timeoutMs`) and starts with
> `bash scripts/mac-whisper-models.sh run`, without environment overrides.
> Importantly, 0 versus 0.2 was tested; 0.2 is not proven optimal.

**任务性质：Mac mini 真实部署与实测，不是 GitHub CI。**  
**工程验收语言：中文。**  
**人工俄语听辨：已被用户明确取消。**  
**保密要求：任何原始俄语课堂文本、WAV、Bearer Key、私有域名、IP、用户名和系统序列号不得提交 GitHub 或公开聊天。**

## 0. 接手要求：完全没有先前上下文

这是一台**全新环境**。不要推断已存在工作目录、Homebrew、Node、whisper.cpp、模型权重、Metal GPU、WireGuard、反向代理或本机 ASR 配置。以前 Mac mini 的 HTTP 20/20 成功报告不能算此次验证结果。先读取 GitHub：
- 主仓库：https://github.com/Ran-ying/ru-class-asr
- `AGENTS.md`、`docs/current-status.md`、`docs/mac-multi-model-deployment.md`、`src/inference.ts`、`src/config.ts`、`src/api.ts`
- 关联主站：https://github.com/Ran-ying/ru-class 的 `AGENTS.md`、`docs/current-status.md`、`docs/p1-browser-loop-canary.md`（后一个可能只存在于 Draft PR #25）。

先确认使用的是本次部署修复代码提交及分支；验证 `git rev-parse HEAD`，不要把不同仓库的 SHA 当成同一个版本。不要修改两仓库旧版镜像协议文件。

**默认目录布局已更新：** `mac-whisper-models.sh` 将 `whisper.cpp` 放在 `ru-class-asr` 同级的 `../whisper.cpp`。若同级已有完整 Git 仓库/模型文件，复用而不重新克隆/下载。旧版默认目录 `~/.local/share/ru-class-asr/whisper.cpp` 不再自动使用，也绝不删除或迁移；如需复用它，显式设置 `WHISPER_CPP_DIR`。现场检查两处已有模型以免重复下载。

**目标：** 在新的 Mac mini Apple Silicon 上安装 Whisper 多语言 `small`、`medium`、`large-v3`，能够明确启用其中任意一个；验证温度回退参数对 Whisper 重复解码的作用，并比较不同模型的质量代理指标、实际耗时以及 16 GB 统一内存约束。此任务只验证本地 ASR 和 HTTP 层，不涉及 RU-Class P2 录音恢复与页面内播放。

## 1. 环境检查与安装

在机器上确认：
```sh
uname -s; uname -m; sw_vers; sysctl -n hw.memsize
xcode-select -p
git --version; cmake --version; node --version; npm --version
df -h "$HOME"
```
如缺依赖，按 `docs/mac-multi-model-deployment.md` 明确安装。先保留原始环境摘要（只保留不识别个人身份的字段）。不要触碰已有工作服务，若机器实际并非全新则先列出冲突端口和目录。

本地检出：
```sh
git clone https://github.com/Ran-ying/ru-class-asr.git
cd ru-class-asr
bash scripts/mac-whisper-models.sh check
bash scripts/mac-whisper-models.sh bootstrap
bash scripts/mac-whisper-models.sh download small
bash scripts/mac-whisper-models.sh download medium
bash scripts/mac-whisper-models.sh download large
bash scripts/mac-whisper-models.sh list
```

确认所有模型真正下载成功（至少非空/非截断），每个模型只报告**文件大小、SHA-256、上游 whisper.cpp commit**，不上传二进制。确认大模型能在 Mac mini 内存条件下启动；任何 OOM、Metal 初始化失败、磁盘余量不足均要如实记为未通过，不通过猜测“应该支持”替代。

## 2. 启动 API（密钥只存在本机）

```sh
npm ci
npm test
npm run typecheck
npm run build
cp config.example.json config.json
chmod 600 config.json
```
在本机生成**新的**足够长的随机 Bearer Key，填入被 Git 忽略的 `config.json`。不得重用先前泄露并禁用的阿里云百炼 Key；这不是阿里云调用测试。不要输出或泄漏新 Key。默认内部 API 和 whisper-server 都绑定 127.0.0.1；不要自行建立公网服务、DNS、TLS、WireGuard 或后门。

## 3. 精确控制四组实验，不要并行运行模型

逐组用 `scripts/mac-whisper-models.sh run` 启动，并停止前一个进程后启动下一个：

| 组 | 模型 | `WHISPER_TEMPERATURE` | `WHISPER_TEMPERATURE_INC` | `WHISPER_TIMEOUT_MS` |
| --- | --- | --- | --- | --- |
| A | small | 0 | 0 | 30000 |
| B | small | 0 | 0.2 | 30000 |
| C | medium | 0 | 0.2 | 90000 |
| D | large（映射 large-v3） | 0 | 0.2 | 120000 |

示例：
```sh
WHISPER_TEMPERATURE=0 WHISPER_TEMPERATURE_INC=0 \
  WHISPER_TIMEOUT_MS=30000 bash scripts/mac-whisper-models.sh run small

# Stop A, then repeat B:
WHISPER_TEMPERATURE=0 WHISPER_TEMPERATURE_INC=0.2 \
  WHISPER_TIMEOUT_MS=30000 bash scripts/mac-whisper-models.sh run small

# Stop B, then:
WHISPER_TEMPERATURE=0 WHISPER_TEMPERATURE_INC=0.2 \
  WHISPER_TIMEOUT_MS=90000 bash scripts/mac-whisper-models.sh run medium

# Stop C, then:
WHISPER_TEMPERATURE=0 WHISPER_TEMPERATURE_INC=0.2 \
  WHISPER_TIMEOUT_MS=120000 bash scripts/mac-whisper-models.sh run large
```

每组记录：
- 启动的真实 GGML 模型绝对路径（公开报告只保留文件名和 SHA）。
- whisper.cpp Git revision、模型 SHA-256、Metal 初始化日志证据及 GPU 使用情况；若无法证实，写 `METAL_UNVERIFIED`。
- 鉴权后的 `GET /v1/models` 与实际权重匹配；错误 `model` 为 HTTP 400，不传 Key 为 401。
- 本机 8s 俄语音频串行多次运行的总耗时、平均、p95、最大值、成功与超时/429 数。HTTP 200 只是响应成功。
- A 与 B 使用**相同 small 权重哈希**、同一原始 WAV 和其他参数；C/D 仅变模型与必要 timeout，避免把网络延迟混入。
- 测试文本只保存 owner-only 私有位置，公开报告只给归一化词元数、unique ratio、重复三词组最大频次等数值指标。

## 4. 必须使用同一份**真实音频**对比，不可拿 M1/M4 历史数字对比

优先使用用户 Mac 已留存的三段 8s 私有 WAV：C1 #30、C2 #77（注意真实异常属于它前一个 Whisper **#76**）、C1 #120。要**优先定位并裁出 C2 #76 的精确 8 秒音频**，因为极端重复发生在 79.2–87.2s、原样本 1,267,200–1,395,200，单独测试 #77 不能直接验证 #76 的根因。

新机器如无法访问这些原始数据：先报告 `PRIVATE_INPUTS_UNAVAILABLE`，**不得**自行上传 GitHub、私自从不明来源下载课堂内容或声称复现成功。请用户通过自己认可的私有文件传输方式将必要 WAV 传到 Mac mini，或先运行公开许可的合成俄语样本做部署冒烟测试，并明确区分合成与 C1/C2 私有实验。

每组固定相同 16k mono PCM16 WAV，**不要重新录制 8 秒音频充作历史同源样本**。并行请求会产生 429；为公平比较使用串行相同间隔。对于 C2 #76 对比 A/B/C/D 的是否触发词汇循环（至少 40 词、8 词/秒、unique ratio ≤0.25、相同三元词组重复 ≥8 次）。统计重复异常及后续时间窗的文本一致性；不要因为词数减少就宣称准确率改善。

可以在私有目录保留 raw text，但公开 Issue/PR 里只放按模型组合整理的派生数值和不可逆 SHA 指纹。**不要输出所有转写。**

## 5. 完整系统边界检查

部署层需通过：
- 演示在重启/停止之后，从 small 真正切换到 medium 和 large-v3，而不是只修改 API 返回标签。
- 错误/无 Key 返回 401；错误模型标签返回 400；CORS preflight 正确且不弱化 Bearer；16 kHz PCM16 mono WAV 可被处理。
- whisper-server 推理端口只绑定回环；公网测试由后续明确授权，**本任务不要新增远程代理**。
- `run` Ctrl+C 停止后引擎子进程清理；不能留下三台模型同时占用 16 GB RAM。
- 旧 `temperature_inc=0` 对照不应被 silently 替换成 0.2；记录实际启动环境和 `src/inference.ts` 请求参数。
- 在 `small` 上证明旧/新温度回退条件改变的是解码实验变量而不是 WAV、模型权重或请求路径。

若希望测 browser-direct RU-Class，记得它属于额外阶段：当前主站是匿名静态 BYOK，前端直接发 HTTP API（HTTPS/CORS），**不经过历史 WebSocket 网关**。没有专门测试许可时只做 ASR 服务本地端到端。

## 6. 交付与验收报告

在本机 owner-only 私有目录创建结构：
```text
private-validation/
  environment.json
  models-sha256.json
  experiment-a-small-no-fallback.json
  experiment-b-small-fallback.json
  experiment-c-medium-fallback.json
  experiment-d-large-v3-fallback.json
  api-contract-checks.json
  reviewer-summary.md
```

所示名称只是报告结构要求，不强迫使用特定路径。公开报告中列出：
1. Mac 型号/统一内存、系统版本、Node、whisper.cpp commit、RU-Class-ASR commit；实际 Metal 状态。
2. 三模型文件 SHA-256（只有 SHA，不带模型二进制），实测加载成功/失败、启动时间、推理 p50/p95。
3. A/B/C/D 各自 C2 #76 循环指标及 C1 #30/#120 的稳定性代理指标。
4. 是否能在约一秒一个串行请求的课堂调度频率下工作，是否出现排队、超时、429、内存峰值。
5. 旧解码配置/新回退配置孰优，具体支持数字，不凭直觉推断 medium/large 一定更好。
6. 结论分开标记：`DEPLOYMENT_PASS`、`REAL_INFERENCE_PASS`、`LOOP_RISK_REDUCED_OR_UNCHANGED`、`SPEECH_ACCURACY_UNVERIFIED`。

**禁止**在无人工俄语参考条件下宣称真实识别 WER。用户已经决定不进行俄语人工听辨；这不阻碍工程比较，不需要再反复提出“必须找会俄语的人”。

如发现部署脚本、API 参数传递或模型切换的**实际 bug**，可另开最小修复 PR，跑 CI 并提交数值脱敏的重现实验；不要随意改 main 或发布生产部署。不要接入已禁用的百炼 Key；不要启用 P2。
