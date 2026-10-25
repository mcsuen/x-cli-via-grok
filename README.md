# x-cli-via-grok

通过 **Grok Bot + grok-bot-cli** 查询、聚合和分析公开 Twitter/X 内容。一个专用 Bot，多个本地研究 session；附带可供 Codex、Claude Code 等支持 Agent Skills 的环境自动发现的 skill。

这个项目不直接调用 X API，也不是通用 Grok 聊天客户端。所有 Bot 和查询操作均经过 [grok-bot-cli](https://github.com/ScriptedAlchemy/grok-bot-cli)。这里的 Grok 指 [Grok Bot 桌面端](https://cursor.com/sand)，不是 grok.com 网页或 xAI API。

## 为什么采用 CLI + skill

| 方案 | 适用性 |
| --- | --- |
| 纯 skill | 简单，但安装、认证、重试、Bot 选择和会话匹配会反复依赖模型临场实现，难以测试。 |
| 只有 CLI | 运行稳定，但无法单靠 CLI 让不同 agent 自动识别 Twitter 意图或做好问题扩写。 |
| **CLI 核心 + 薄 skill** | CLI 固化状态和路由；skill 管触发、扩写、证据判断与呈现。两者共用同一份实现。 |

CLI 的运行代码直接放在 skill 的 `scripts/` 下，仓库 `bin/` 只是入口。因此只复制 skill 目录也能运行，不会依赖一个未复制的外部项目目录。无第三方运行时依赖。

## 安装

前提：Node.js **22.19+**，已安装并登录 Grok Bot 桌面端。缺少桌面端时只提示用户安装，不自动创建账号或接受协议。

```sh
npm install --global github:mcsuen/x-cli-via-grok
x-cli-via-grok install-skill --host both
```

也可仅安装 `--host codex` 或 `--host claude`。安装位置分别是 `$CODEX_HOME/skills`（默认 `~/.codex/skills`）和 `~/.claude/skills`。安装器不会覆盖同名已有 skill；有现存版本时先审阅再替换。必要时重新打开 agent 会话使其发现新 skill。

从本地源码试用：

```sh
node bin/x-cli-via-grok.mjs install-skill --host both
node bin/x-cli-via-grok.mjs doctor --json
```

支持 Agent Skills 的其他环境可直接安装 `skills/x-research-via-grok/` 目录。自动触发取决于宿主的 skill 发现与模型选择；它不是对所有产品的强制路由。Claude **Code** 已提供安装路径；普通 Claude Desktop 不会因为复制该目录自动获得命令执行能力，需宿主另外支持 skills/本地工具。

## 首次准备

```sh
x-cli-via-grok doctor --json
x-cli-via-grok setup --json
```

- `doctor` 默认离线检查，不读钥匙串、不创建 Bot。`doctor --online` 才验证登录。
- 没有 grok-bot-cli 时，`setup` 自动把经过测试的 `grok-bot-cli@0.12.4` 安装到工具私有目录，无需 sudo，不改变全局 PATH。
- 已有 CLI 则复用；版本过旧时用 `setup --install-cli` 安装固定版本的私有副本，不覆盖全局安装。
- 先找已有、用途明确的 X 查询分析 Bot；找不到才创建 **X Research · via Grok CLI**。保存 ID 后持续复用，不触碰主 Bot。
- 验证登录和钥匙串访问前应提醒用户。系统授权、登录、密码和验证码由用户完成，不自动批准。

macOS 某些 Grok Bot 版本没有生成上游 CLI 使用的会话描述文件。如果明确提示 `AUTHORIZATION_REQUIRED`，了解其含义后可运行：

```sh
x-cli-via-grok setup --authorize-app-session --json
```

这个选项同意通过 macOS 钥匙串读取既有 Grok 登录，在内存中解密并传给 CLI；不要求用户复制 token，不读取 refresh token，不保存明文凭据。仅保存非敏感的使用偏好。它不自动批准系统弹窗。详见 [认证与恢复](skills/x-research-via-grok/references/operations.md)。

## 使用

在已安装 skill 的 Codex/Claude Code 中，直接说：

> 查询并总结 Twitter/X 上最近三个月关于 Booking.com 的讨论，区分官方消息与用户投诉，给出原帖链接。

也可以直接运行 CLI。将完整研究目标保存为 UTF-8 文本，例如 `request.txt`：

```sh
x-cli-via-grok plan --prompt-file request.txt --since 2026-07-25 --until 2026-10-25 --timezone Asia/Shanghai --json
x-cli-via-grok query --prompt-file request.txt --session my-research-chat --since 2026-07-25 --until 2026-10-25 --timezone Asia/Shanghai --wait 40 --json
```

`plan` 只预览本地扩写后的可读 prompt，不发送消息。日期包含首尾日，当天只到当前时间；省略日期时默认最近 7 个自然日。上面的日期是示例，实际使用请换成目标日期。

首次调用若返回 `pending`，保存 runId 并读取：

```sh
x-cli-via-grok read RUN_ID --wait 40 --json
x-cli-via-grok sessions --json
```

命令输出稳定 JSON。`complete` 表示收到带完成标识的最终回复，不保证搜索成功或事实正确；需阅读正文、来源和局限。退出码 0 可以是 `pending`；错误退出码为 1。

## Bot 和 session 隔离的实际边界

- **一个账号复用一个专用 Bot**。session 和 run 是本地记录，不在 Bot 列表里新建对象。
- 一个本机账号同时只运行一个研究请求；并发查询返回 `RESEARCH_BUSY`。
- 每个请求完整描述目标；只返回同一 Bot、同一 gateway requestId 下的回复。根线程读取缺少回复时，合并有限尾部消息后仍按相同 requestId 严格筛选。
- 发送回执未知时先查询，不盲目重发。Bot 创建结果不确定时先核对已有 Bot，不反复创建。
- **这是请求与结果隔离，不是 Grok 服务端记忆的物理隔离。** 当前上游没有已验证的记忆重置接口。不同机器也不共享本地锁。严格隔离需求需另行设计。
- 不会删除用户 Bot、聊天或本地历史。不创建后台守护进程、提醒、定时任务，不发帖、私信、点赞或关注。

## 状态和兼容性

默认状态目录是 `$XDG_STATE_HOME/x-cli-via-grok` 或 `~/.local/state/x-cli-via-grok`；Windows 使用 `%LOCALAPPDATA%/x-cli-via-grok`。目录保存配置、请求和结果，不保存访问令牌。

| 变量 | 用途 |
| --- | --- |
| `XG_STATE_DIR` | 自定义本地状态目录，也用于隔离测试。 |
| `XG_GROK_APP_PATH` | 非标准 Grok Bot 安装路径。 |
| `XG_GROK_APP_DATA` | 非标准 Grok Bot 数据目录。 |
| `XG_GROK_CLI` | 明确指定现有 Grok CLI 可执行文件或 `.mjs` 入口。 |
| `XG_GROK_CLIENT_VERSION` | 自定义安装的实际 Grok app 版本；不应填猜测版本。 |

优先使用上游 CLI 支持的原生 app session 或用户已提供的环境认证。macOS 旧格式认证适配单独授权。macOS 检测和旧格式登录是当前实测路径；Windows/Linux 有常见安装路径探测与上游原生认证支持，未做端到端实测，不宣称同等验证。

## 开发与验证

```sh
npm test
npm pack --dry-run
```

测试使用临时目录和模拟 Grok 客户端，检查 Bot 复用、旧请求排除、账号切换、并发、未知投递不重发及独立 skill 安装。真实在线查询需要已登录 Grok Bot，会消耗其正常用量；不放入 CI。

开发细节见 [架构说明](docs/architecture.md)。项目采用 MIT 许可；与 Grok Bot、X、Cursor、OpenAI、Anthropic 没有官方隶属关系。
