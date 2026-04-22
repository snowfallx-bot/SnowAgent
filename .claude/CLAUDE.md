你是一个资深系统工程师 / Node.js 工程师 / Windows CLI 自动化工程师。请帮我实现一个可运行的项目，目标是在 Windows 11 环境下，对多个只能通过命令行调用的 AI CLI 做统一编排与适配。

========================
一、项目目标
========================

我要做一个“本地多 Agent CLI 编排器”，它不依赖这些模型提供 REST API，而是通过 Windows 本地命令行调用它们。

第一阶段只需要重点适配 3 类 CLI：

1. Codex CLI
2. Copilot CLI
3. Opencode CLI

这些 CLI 的具体安装方式、命令名、参数形式、输出格式可能不同，甚至用户机器上可能没有安装其中一部分。
所以实现时不要硬编码假设，不要武断认为某个命令一定存在，必须把“发现、探测、适配、降级”做好。

目标是做出一个可扩展的本地编排器，后续我还能继续接入其他 CLI。

========================
二、运行环境与硬约束
========================

运行环境：
- Windows 11
- PowerShell 5.x 和 PowerShell 7.x 都要尽量兼容
- 优先使用 Node.js + TypeScript 实现
- 进程调用需要兼容 Windows shell 行为
- 不依赖 Linux/bash 特性
- 不依赖 WSL
- 不要求 Docker

代码要求：
- 使用 TypeScript
- 项目结构清晰
- 要有基础单元测试
- 要有 README
- 要有可运行的 demo
- 不要只给伪代码，要给出完整项目代码
- 代码必须能在 Windows 上正常工作
- 对路径、编码、换行、shell quoting 做好处理
- 不要把超长 prompt 直接拼在命令行参数里，优先用 stdin 或临时文件

========================
三、核心设计目标
========================

请实现一个“统一 Agent 适配层 + 编排器”的架构。

要求包含以下核心能力：

1. 统一抽象不同 CLI
   - 每个 CLI 都实现相同接口
   - 上层不关心底层命令名、参数、输入方式、输出方式

2. 支持 CLI 可执行文件探测
   - 启动时自动检测 codex / copilot / qwen 是否可用
   - 支持从 PATH 查找
   - 支持手动配置可执行路径
   - 支持探测 --help / -h / version 等
   - 如果探测失败，要记录原因，不要直接崩

3. 支持多种输入方式
   - 优先 stdin
   - 其次临时 prompt 文件
   - 最后才是命令行参数
   - 每个适配器要声明自己支持哪些输入方式

4. 支持统一的执行结果模型
   - success / fail
   - stdout
   - stderr
   - exitCode
   - durationMs
   - timedOut
   - parsed structured result（如果能解析）
   - raw transcript（如有）

5. 支持超时、取消、重试
   - 每个 agent 调用都能设置 timeout
   - 超时后 kill 进程
   - 至少支持 1 次重试
   - 重试策略可配置

6. 支持工作目录隔离
   - 每次运行任务时指定 cwd
   - agent 只能在指定 repo/workspace 下执行
   - 可以创建临时目录保存 prompt / output / logs

7. 支持基础编排
   - 提供一个 router/planner 机制
   - 允许“便宜 agent 做任务分类，高级 agent 真正执行”
   - 先不用做复杂 AI 决策，可以先做规则路由
   - 例如：
     - summarize -> copilot/qwen
     - review -> codex/coproilot
     - fix -> codex 优先，失败后降级到 qwen 或 copilot
   - 路由规则写成配置，不要写死在代码里

8. 支持结构化输出优先
   - 编排器给 agent 的 prompt 中应要求其优先输出 JSON
   - 如果不能保证 JSON，则至少设计“可解析分隔块”
   - 例如：
     ===RESULT_JSON===
     {...}
     ===END_RESULT_JSON===
   - 实现通用 parser

========================
四、我需要的项目功能
========================

请实现以下模块，并给出完整代码：

A. Agent 接口定义
- 定义统一接口，例如：
  - detect()
  - run()
  - buildCommand()
  - parseOutput()

B. 三个适配器
- CodexAdapter
- CopilotAdapter
- QwenAdapter

要求：
- 不要假设它们的命令一定分别叫 codex、copilot、qwen
- 允许配置多个候选命令名
- 先探测，再决定如何调用
- 不确定具体参数时，优先通过 help/version 探测
- 如果某个 CLI 无法可靠探测参数格式，请设计“用户可覆盖配置”的机制

C. 进程执行器
- 统一封装 child_process.spawn
- 处理：
  - stdout/stderr 采集
  - timeout
  - exitCode
  - PowerShell / Windows quoting 问题
  - stdin 写入
  - 大输出缓冲
- 不要使用 exec 直接拼整串命令，优先 spawn/execFile 风格

D. 配置系统
- 支持 yaml 或 json 配置
- 配置项包括：
  - agent 是否启用
  - 候选命令名
  - 可执行路径
  - 默认参数
  - 输入模式（stdin/file/args）
  - 超时时间
  - 重试次数
  - 任务路由规则

E. Router / Orchestrator
- 接收一个标准任务结构
- 根据 task type 选择 agent
- 支持 fallback
- 记录每一步执行日志
- 返回统一结果

F. PromptBuilder
- 根据 task type 生成统一 prompt
- 至少支持：
  - summarize
  - review
  - fix
- prompt 中要求模型输出结构化结果

G. Output Parser
- 先尝试提取 RESULT_JSON 块
- 再尝试提取 Markdown code block 中的 JSON
- 最后保留 raw text

H. CLI Demo
- 提供一个本地命令行入口
- 示例：
  - agent-orchestrator run --task summarize --agent auto --cwd .
  - agent-orchestrator run --task review --agent codex --input-file issue.txt
- 可以从文件读取 prompt
- 可以指定 repo/workspace
- 能打印最终结果

========================
五、数据结构要求
========================

请设计清晰的 TypeScript 类型。

至少包括：

1. Task
- id
- type: "summarize" | "review" | "fix" | "plan"
- title
- prompt
- cwd
- metadata
- preferredAgent
- fallbackAgents
- timeoutMs

2. AgentCapability
- supportsStdin
- supportsPromptFile
- supportsArgs
- supportsJsonMode（如果有）
- supportsCwd
- supportsNonInteractive

3. AgentDetectionResult
- available
- executable
- versionText
- helpText
- detectedInputModes
- notes
- error

4. AgentRunInput
- task
- cwd
- prompt
- promptFilePath?
- timeoutMs
- env
- extraArgs

5. AgentRunResult
- agentName
- success
- exitCode
- stdout
- stderr
- durationMs
- timedOut
- parsed
- rawOutput
- logs

========================
六、实现细节要求
========================

请特别注意以下问题，并在代码中认真处理：

1. Windows 兼容性
- 路径用 path 模块
- 临时文件用 os.tmpdir()
- 考虑 PowerShell 5/7 差异
- 避免 bash-only 写法
- 避免 shell:true 除非必要

2. CLI 探测策略
- 每个 agent 至少设计：
  - candidate command names
  - version probes
  - help probes
- 例如一个 agent 可以尝试：
  - command --version
  - command version
  - command -h
  - command --help
- 探测时要容忍非零退出码
- 探测结果要写入日志

3. 输入注入策略
- 如果 prompt 很长，不要直接作为命令行参数
- 优先：
  - stdin
  - temp file
  - args
- 由 adapter 决定具体构建方式

4. 输出解析策略
- agent 输出可能不是纯 JSON
- 实现 robust parser
- 支持提取 patch / summary / next_action / confidence 等字段
- 如果无法解析，也不能报废，要保留 raw text

5. 日志与审计
- 每次 agent 调用都记录：
  - 实际命令
  - 参数（脱敏后）
  - cwd
  - duration
  - exitCode
  - timeout
  - parser 结果
- 日志同时打印到控制台并保存到文件

6. 错误处理
- 某个 agent 不可用时，不能导致整个程序崩溃
- fallback agent 继续尝试
- 所有错误都应结构化

7. 可扩展性
- 后续我可能加入 claude、aider、gemini 等
- 所以不要把三种 adapter 写死在 if-else 泥团里
- 使用注册表 / 工厂模式

========================
七、项目目录建议
========================

请按类似下面的目录生成项目：

/src
  /agents
    base.ts
    codex.ts
    copilot.ts
    qwen.ts
    registry.ts
  /core
    orchestrator.ts
    router.ts
    task.ts
    result.ts
    prompt-builder.ts
  /process
    process-runner.ts
    windows-command.ts
  /parsers
    structured-output.ts
  /config
    schema.ts
    load-config.ts
  /utils
    logger.ts
    fs.ts
    temp.ts
    detect.ts
  /cli
    index.ts
/tests
README.md
package.json
tsconfig.json

如果你认为有更合理的结构，可以调整，但必须保持模块边界清晰。

========================
八、实现策略要求
========================

注意：你不知道我机器上安装的 Codex/Copilot/Qwen CLI 的精确参数形式，所以请不要伪造确定性实现。

正确做法是：

1. 先实现一个“通用可配置适配器骨架”
2. 再为 Codex/Copilot/Qwen 提供默认猜测配置
3. 再实现探测机制自动校验
4. 不确定的地方通过配置覆盖解决
5. 在 README 中明确说明：
   - 如何查看本机 CLI 的 help
   - 如何在 config 中修改 command/path/args/inputMode

也就是说：
- 可以提供默认实现
- 但必须承认外部 CLI 参数可能不同
- 代码结构要允许用户快速修正配置

========================
九、演示场景
========================

请至少实现并演示这几个场景：

1. summarize 任务
- 输入一段 issue 文本
- auto 路由到某个可用 agent
- 返回结构化 summary

2. review 任务
- 输入一段 diff 或 PR 描述
- 调用 agent 审查
- 输出 review comments / risk summary

3. fix 任务
- 输入 bug 描述
- 调用 agent 生成修复建议
- 不要求真的改文件，但输出 structured fix plan
- 如果能支持 patch 输出更好

4. fallback 场景
- codex 不可用
- 自动降级到 qwen 或 copilot

========================
十、README 必须包含
========================

README 中请清楚写明：

1. 如何安装依赖
2. 如何构建
3. 如何在 Windows PowerShell 5/7 运行
4. 如何配置 codex/copilot/qwen 的命令名或路径
5. 如何调试探测逻辑
6. 如何新增一个新的 agent adapter
7. 当前已知限制
8. 为什么不能完全硬编码 CLI 参数
9. 示例命令

========================
十一、额外加分项
========================

如果你还能顺手做好这些，会更好：

- 使用 zod 做配置校验
- 使用 commander/yargs 做 CLI
- 使用 pino/winston 做日志
- 测试里 mock child_process
- 增加 dry-run 模式
- 增加 agent list / detect 子命令
- 增加输出保存到 artifacts 目录
- 增加 JSON 输出模式，方便后续 webhook 系统对接

========================
十二、输出要求
========================

请直接输出完整项目代码，不要只讲思路。
输出顺序建议为：
1. package.json
2. tsconfig.json
3. 项目源码
4. 测试代码
5. README

如果内容很多，请分段输出，但每段都必须是完整可复制的代码。
不要省略关键文件。
不要只用“此处略”。

补充要求：
请优先保证“可维护、可扩展、Windows 可运行”，而不是假装知道某个 CLI 的准确参数。
如果某个 CLI 的参数无法从通用经验可靠推断，请明确把它做成配置项，并在 README 中告诉我如何修改。
不要为了看起来完整而编造不存在的参数。