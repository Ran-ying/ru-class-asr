# RU-Class-ASR — Mac mini M4 本地俄中翻译部署与运行

**目标：** 在现有 M4 / 16 GB Mac mini 的 `whisper.cpp` (Whisper Small + Metal)
之外，新增 M2M100-418M + CTranslate2 INT8 **CPU** 翻译。
翻译服务在回环 `127.0.0.1` 上运行；**唯一对浏览器暴露的入口仍是现有 Node API**
（原 API Key、CORS、HTTPS 反代）。本操作仅属于部署脚本交付，
模型尚未在 Mac mini 上安装与实测。

参考：
- [Meta 官方模型与 MIT license](https://huggingface.co/facebook/m2m100_418M)
- [CTranslate2 官方 M2M100 转换、tokenizer 与 target prefix 示例](https://github.com/OpenNMT/CTranslate2/blob/master/docs/guides/transformers.md#m2m-100)
- [原 Whisper 启动器](mac-multi-model-deployment.md)

## 架构

```text
MacBook browser -> HTTPS + Bearer -> Node ru-class-asr :8090
                                      | POST /v1/audio/transcriptions
                                      +--> whisper.cpp :8080 /inference (Metal)
                                      | POST /v1/translate
                                      +--> Python M2M100 :8091 /translate (CPU INT8)
```

Node 继续保持 `GET /v1/models` 的**唯一 Whisper 模型**。
翻译接口独立限流：同时至多处理一条翻译，忙时 429；音频 ASR
有自己的单任务锁。公共接口最多接收 8192 字节 JSON，俄语文本
最多 1200 字符，必须 `source=ru`、`target=zh`。
Node 到 Python 模型服务**严格限制 loopback**，不允许配置公网 URL，
不能把 8091 直接写成 Nginx 反代位置。新模块默认关闭，旧环境无变化。

## 前置准备

```bash
xcode-select --install   # 如果已经有 Command Line Tools 则无需再次安装
brew install python@3.11 cmake node
python3.11 --version
node --version            # >= 22.6
```

本仓库与现有 whisper.cpp 同级安装最方便。所有 Python 虚拟环境、
CT2 权重和缓存文件在本机被 Git 忽略；新部署没有 sudo、
launchd、开机自启、隐藏目录迁移或自动公开端口。

## 配置

如果尚无 `config.json`：

```bash
cp config.example.json config.json
chmod 600 config.json
```

如果已有，请**保留原文件和原 API Key**，只把 `translation` 字段
添加进去或将已存在的 `enabled` 改为 `true`：

```json
"translation": {
  "enabled": true,
  "url": "http://127.0.0.1:8091/translate",
  "model": "m2m100-418m-int8",
  "timeoutMs": 10000,
  "threads": 2
}
```

这是 config.json 内的一个字段，不是完整 JSON。默认 `threads=2`，
首次测试可以分别试 2 和 4；不要假定线程越多越快。
`whisper.model` 建议保留原来正在使用的 `small` 和
`whisper.url=http://127.0.0.1:8080/inference`。
原 API 的监听地址 `listen.host`、`listen.port`、
`cors.allowedOrigins` 和 `apiKey` 不需改变。
不可将私钥或 `config.json` 内容发布到 GitHub。

## 安装（只在明确执行时下载）

```bash
cd ru-class-asr
bash scripts/mac-classroom.sh install
```

组合安装会依序：
1. 验证配置，并使用原 `mac-whisper-models.sh bootstrap` 复用或建立
   同级 whisper.cpp checkout；没有自动更新现有 Git checkout；
   保留原有权重，使用旧脚本的官方 SHA/字节数验证选定 Whisper 模型。
2. 执行 `npm ci && npm run build`。
3. 建立本仓库忽略的 `.venv-translate`，安装 CTranslate2、
   Transformers 4.x、SentencePiece、PyTorch（**只在离线模型转换阶段使用**）
   等依赖。首次安装下载约 2 GB 上游权重及额外转换文件，
   加上缓存和中间文件可能需要**数 GB 的额外磁盘空间**。
4. 从 Meta 官方 HF 模型 `facebook/m2m100_418M` 获取固定提交
   `791dc1c6d300846c9a747d4bd11fcc7f369b750e` 的
   `model.safetensors` 及 tokenizer 文件，并转换到
   `models/m2m100-418m-int8`；先写入临时目录、
   记录转换产物 SHA-256 再整体转正。存在的模型不会被覆盖；
   完整性错误会拒绝使用，并保留原文件供检查。

转换本身可能暂时占用大量内存。建议**先停止正在运行的 Whisper 推理**
再执行第一次模型安装；安装脚本不会主动终止用户进程。

如果 Whisper 与 Node 已部署好，只想安装翻译：

```bash
bash scripts/mac-local-translate.sh check
bash scripts/mac-local-translate.sh install
bash scripts/mac-local-translate.sh verify
```

## 运行及停止

```bash
bash scripts/mac-classroom.sh check
bash scripts/mac-classroom.sh run
```

前台组合启动先加载 M2M100，健康检查通过后，
再调用原 `scripts/mac-whisper-models.sh run`。
按 **Control+C** 会给三个新建进程发终止信号并等待退出。
仅在明确运行本命令时才执行，不开机自启。SIGKILL 与硬断电
无法捕获；如发生，请查看监听端口再恢复运行。

旧 ASR-only 模式**仍然可用**：

```bash
bash scripts/mac-whisper-models.sh run
```

单独开发翻译服务：

```bash
bash scripts/mac-local-translate.sh serve
```

## 本机 API 验收

在另一个终端，通过**本机私有方式**获取现有 API Key，
不要输出到屏幕、录屏或提交 Git。

```bash
# 先检查本地引擎已加载（只允许从 Mac mini loopback 访问）
curl --noproxy '*' -fsS http://127.0.0.1:8091/health

# 通过受认证的现有 Node API 调用翻译
curl --noproxy '*' -fsS http://127.0.0.1:8090/v1/translate \
  -H "Authorization: Bearer $ASR_TEST_KEY" \
  -H "Content-Type: application/json" \
  --data-binary '{"text":"Это проверка локального перевода.","source":"ru","target":"zh"}'
```

预期成功 JSON 具有 `translation/source/target/model`，
`GET /v1/models` 仍仅报告 Whisper Small。
缺失或错误 Key 必须是 401，错误语言、空文本、
无效 JSON 返回 400；两个并发翻译中的第二个可能返回 429。
`POST /v1/audio/transcriptions` 需像升级之前一样正常运行。
MacBook Safari 上的 HTTPS/CORS 验收需要以实际网页来源单独验证。

## 并行性能与安全验收

建议用同一段自有俄语课堂文本和 8 秒私有录音，在只启动
Whisper、只启动 M2M100、两个都启动的情况下，记录各 30–100 次
的冷启动、P50、P95、内存压力和错误率。最终录音不得提交仓库；
记录技术指标而不是原始课堂内容。当前 500 ms 翻译 P50 只是目标，
**不是**现有 M4 设备测试结果。CPU 运行 M2M100 可能对 Whisper 的
CPU 解码/音频预处理产生影响，即使 Whisper 的矩阵计算主要在 Metal。
优先让 Whisper 保持响应，若性能变差尝试降低翻译 `threads`。
翻译不应影响上方由 DeepSeek 校正和保存的正式历史，
下方浏览器实时中文字幕接入属于 RU-Class 主仓库后续 v0.5 工作。

## 故障处理

- `missing_or_unsafe_model_directory` / `invalid_model_file`：
  下载不完整或权重被改动；不会自动删除或覆盖，先检查本机转换产物。
- `model not installed`：先运行显式 `install`。
- 翻译 429：本地单任务推理繁忙，浏览器 Latest-Wins
  应只保留最新快照，不能无限排队。
- 翻译 502：查看模型推理进程是否存活、私有服务是否准备就绪，
  切忌把翻译失败误判成 Whisper 失败。
- `Port already in use`：停止此前运行的实例，不能让新包装器覆盖
  正在服务的旧实例。


### 排错：`ct2-transformers-converter` 找不到（2026-10-20）

旧安装脚本曾使用不带目录的可执行文件名；运行
`.venv-translate/bin/python scripts/install_m2m100.py` 时并不自动修改
shell 的 `PATH`，因此已安装的 CTranslate2 仍可能报
`[Errno 2] No such file or directory: 'ct2-transformers-converter'`。
现已改为通过**当前虚拟环境 Python 解释器所在目录**寻找转换器；
不会错误使用另一套 Python 环境的模型转换工具。修复后只需
`git pull --ff-only origin main` 再运行 `bash scripts/mac-classroom.sh install`，
已有 Whisper 权重、Node 构建和 Hugging Face 缓存可复用，无需删除
`.venv-translate` 或模型缓存。若修复后仍提示缺少转换器，
可以只检查 `ls -l .venv-translate/bin/ct2-transformers-converter`；
不要未经确认就清空 Python 虚拟环境或模型目录。


### 排错：Meta tensor 上的 torch.equal 报错（2026-10-20）

如果已经解决转换器路径问题，转换过程中却出现
`NotImplementedError: aten::equal ... Meta tensors`，这不是缺少
Whisper 模型，也不是 Node/CMake 错误。原安装器允许
`ctranslate2>=4.5,<5` 和 `transformers>=4.45,<5` 任意更新；
实机记录中解析到了 CTranslate2 **4.8.3** + Transformers **4.57.6**
（PyTorch **2.14.1**），它们在 M2M100 的权重转换/别名检测路径
上遇到了无法实际比较的 Meta tensors。官方 CTranslate2 早期版本
使用 `torch_dtype` 加载，而后期更改为 `dtype`；搭配新版
Transformers 的 Meta 初始化流程容易产生不兼容。

现在转换专用环境固定为
`ctranslate2==4.5.0` + `transformers==4.45.2`，
使用 macOS arm64/Python 3.11 可安装的版本组合。这是针对
**兼容性故障提出的转换组合**，尚未在用户 M4 上完成实测转换，
不是性能或正确率已验收的声明。安装器在下载前检查实际已安装
版本，防止静默出现另一组组合；转换模型目录记录两者版本。
`torch` 保留原安装环境中符合 2.x 要求的版本，暂时不强制
重新下载巨大的 PyTorch 权重。只会调整被 Git 忽略的
`.venv-translate`，不会删除 Whisper 权重、Hugging Face 缓存、
用户的 API Key 或课堂历史。

```bash
git pull --ff-only origin main
bash scripts/mac-classroom.sh install
bash scripts/mac-classroom.sh check
```

上游模型与 CT2 引擎实际启动仍须单独验收。如果又报 Meta tensor，
请保留完整新 traceback 与 `.venv-translate/bin/python -m pip show
ctranslate2 transformers torch` 版本信息；不要自行修改 CT2 的
`_alias_variables` 或删除完整性校验。
