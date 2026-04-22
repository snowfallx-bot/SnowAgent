# Agent Orchestrator

本项目是一个面向 Windows 11 的本地多 Agent CLI 编排器。它不依赖外部 REST API，而是通过本机命令行探测并调用不同的 AI CLI，把它们统一到同一套接口、路由和结果模型下。

第一阶段内置了三类适配器骨架：

- `codex`
- `copilot`
- `qwen`（也可通过配置指向 OpenCode/Qwen 风格 CLI）

项目重点不是“假装知道每个 CLI 的准确参数”，而是把这些不确定性做成可探测、可配置、可降级的系统。

当前仓库还带了一组“本机帮助文本校准过的保守默认值”：

- `codex` 默认走 `codex exec`
- `copilot` 默认走 `copilot --prompt`
- `qwen` 默认走位置参数 one-shot 模式

这些默认值是为了让项目在这台机器上更接近“开箱可跑”，不是为了宣称所有用户机器都一样，所以配置覆盖依然是第一优先级。

## 功能概览

- 统一的 `AgentAdapter` 接口：`detect()` / `buildCommand()` / `parseOutput()` / `run()`
- Windows 友好的进程执行器，优先使用 `spawn`，并处理 `.cmd/.bat/.ps1`
- CLI 探测：支持 PATH 查找和手动指定 executable path
- 输入模式优先级：`stdin` -> `file` -> `args`
- 统一结果模型：`stdout` / `stderr` / `exitCode` / `durationMs` / `timedOut` / `parsed`
- 规则路由与 fallback
- 结构化输出解析：支持 JSON / JSON 数组 / JSONL / `===RESULT_JSON===` / Markdown JSON code block，并会继续尝试从事件 envelope 中提取最终结构化内容
- YAML / JSON 配置与 `zod` 校验
- 本地 CLI 入口：`list` / `detect` / `doctor` / `route` / `prompt` / `run`
- 基础单元测试，包含 `child_process.spawn` mock

## 目录结构

```text
src/
  agents/
  cli/
  config/
  core/
  parsers/
  process/
  utils/
tests/
demo/
agent-orchestrator.config.example.yaml
```

## 安装依赖

要求：

- Windows 11
- Node.js 18.18+，建议 Node.js 20+
- PowerShell 5.x 或 PowerShell 7.x

安装：

```powershell
npm install
```

## 构建

```powershell
npm run build
```

构建完成后，CLI 入口在：

- `dist/cli/index.js`

## 在 PowerShell 5 / 7 运行

PowerShell 5.x：

```powershell
node .\dist\cli\index.js list
node .\dist\cli\index.js detect
node .\dist\cli\index.js doctor
node .\dist\cli\index.js route --task fix --cwd . --detect
node .\dist\cli\index.js prompt --task summarize --input-file .\demo\issue.txt --cwd .
node .\dist\cli\index.js run --task summarize --input-file .\demo\issue.txt --cwd .
```

PowerShell 7.x：

```powershell
node ./dist/cli/index.js list
node ./dist/cli/index.js detect
node ./dist/cli/index.js doctor --json
node ./dist/cli/index.js route --task review --cwd . --json
node ./dist/cli/index.js prompt --task summarize --input-file ./demo/issue.txt --cwd . --json
node ./dist/cli/index.js run --task review --input-file ./demo/review.diff.txt --cwd .
```

如果你把包全局链接或安装成 bin，也可以直接运行：

```powershell
agent-orchestrator detect
```

## 快速开始

1. 先复制示例配置。

```powershell
Copy-Item .\agent-orchestrator.config.example.yaml .\agent-orchestrator.config.yaml
```

2. 根据本机实际 CLI 修改：

- `agents.<name>.commandCandidates`
- `agents.<name>.executablePath`
- `agents.<name>.defaultArgs`
- `agents.<name>.run.stdinArgs`
- `agents.<name>.run.promptFileArgs`
- `agents.<name>.run.promptArgArgs`

3. 先做探测：

```powershell
node .\dist\cli\index.js detect --json
```

4. 先用 doctor 看最终执行预设，必要时顺手做 smoke：

```powershell
node .\dist\cli\index.js doctor --json
node .\dist\cli\index.js doctor --agent copilot --smoke --json
node .\dist\cli\index.js doctor --agent qwen --smoke --fail-on-unhealthy
node .\dist\cli\index.js route --task review --agent codex --cwd . --detect --json
node .\dist\cli\index.js prompt --task summarize --input-file .\demo\issue.txt --cwd . --json
```

5. 再跑 demo：

```powershell
node .\dist\cli\index.js run --task summarize --input-file .\demo\issue.txt --cwd . --agent auto
node .\dist\cli\index.js run --task review --input-file .\demo\review.diff.txt --cwd . --agent codex
node .\dist\cli\index.js run --task fix --input-file .\demo\bug.txt --cwd . --agent auto
```

如果你只想验证路由和命令构建，而不真的启动 agent，可以先用：

```powershell
node .\dist\cli\index.js run --task summarize --input-file .\demo\issue.txt --cwd . --dry-run --json
```

## 配置说明

配置支持 JSON 和 YAML。默认会在当前目录查找：

- `agent-orchestrator.config.json`
- `agent-orchestrator.config.yaml`
- `agent-orchestrator.config.yml`

也可以显式指定：

```powershell
node .\dist\cli\index.js detect --config .\my-config.yaml
```

核心配置项：

```yaml
agents:
  codex:
    enabled: true
    commandCandidates: [codex, codex.exe, codex.cmd]
    executablePath:
    defaultArgs: [exec]
    inputModePriority: [stdin, args]
    timeoutMs: 120000
    retries: 1
    detect:
      versionArgs:
        - [--version]
      helpArgs:
        - [exec, --help]
    run:
      stdinArgs:
        - "-"
      promptFileArgs: []
      promptArgArgs:
        - "{prompt}"
      jsonModeArgs:
        - --json
      nonInteractiveArgs:
        - --skip-git-repo-check
        - --full-auto
      cwdArgs:
        - --cd
        - "{cwd}"
```

### 为什么不能硬编码 CLI 参数

因为不同机器上的 CLI 可能存在这些差异：

- 可执行文件名字不同
- 入口是 `.exe`、`.cmd`、`.bat` 或 `.ps1`
- 有的需要子命令，如 `chat` / `ask` / `run`
- 有的支持 `stdin`，有的只支持 `--prompt-file`
- 有的支持结构化输出，但输出的是 JSONL 事件流而不是单个 JSON 对象
- `--version`、`version`、`-h`、`--help` 的行为不一致
- 有的 CLI 输出 JSON，有的只输出普通文本

所以这里的策略是：

- 给出“保守默认值”
- 先探测 executable
- 把参数模板都暴露给配置
- 失败时不要崩，走 fallback

## CLI 命令

### `list`

列出注册的 adapter 和候选命令。

```powershell
node .\dist\cli\index.js list
node .\dist\cli\index.js list --json
```

### `detect`

探测当前配置下每个 agent 是否可用。

```powershell
node .\dist\cli\index.js detect
node .\dist\cli\index.js detect --json
```

调试探测逻辑时，优先查看：

- `commandCandidates`
- `executablePath`
- `detect.versionArgs`
- `detect.helpArgs`
- `artifacts/session-*.log`

如果探测失败，通常先在 PowerShell 里手工验证：

```powershell
codex --help
copilot --version
qwen -h
```

然后把能工作的命令形态回填到配置里。

在这台机器上，已经确认这些入口可探测：

- `codex --version`
- `codex exec --help`
- `copilot --help`
- `qwen --help`

因此示例配置默认优先使用这些已经验证存在的非交互入口。

### `doctor`

输出每个 agent 的：

- 探测结果
- 当前 run 预设
- 可选 smoke-run 结果
- 总体健康状态与汇总计数
- 自动落盘的 doctor 报告路径
- 面向修复的建议动作，例如 auth / config / timeout / smoke

```powershell
node .\dist\cli\index.js doctor
node .\dist\cli\index.js doctor --json
node .\dist\cli\index.js doctor --agent copilot --smoke --json
node .\dist\cli\index.js doctor --agent qwen --smoke --fail-on-unhealthy
```

这个命令适合在真正跑任务前做一次“体检”：

- `detect` 只回答“命令在不在”
- `doctor` 会进一步告诉你“当前配置准备怎么调用它”
- 加 `--smoke` 后，还能直接验证 non-interactive 组合是不是当前机器真能跑
- 加 `--fail-on-unhealthy` 后，可以直接把 `doctor` 当成 CI / 脚本的健康检查入口
- 当 `doctor` 发现问题时，会在终端、JSON 和 `artifacts/doctor/*.json` 里同时给出下一步修复建议

### `route`

预览某个任务会如何排 agent 顺序，而不真正执行任何 CLI。

```powershell
node .\dist\cli\index.js route --task review --cwd .
node .\dist\cli\index.js route --task fix --agent codex --fallback qwen copilot --cwd . --detect --json
```

适合用来排查：

- 为什么当前任务优先走某个 agent
- fallback 顺序是不是符合预期
- 当前路由链路上的 agent 是否已经可探测

### `prompt`

预览最终下发给 agent 的 prompt，而不真正启动 agent。

```powershell
node .\dist\cli\index.js prompt --task summarize --input-file .\demo\issue.txt --cwd .
node .\dist\cli\index.js prompt --task review --input-file .\demo\review.diff.txt --cwd . --json
```

这个命令适合：

- 调试 PromptBuilder 模板
- 先确认结构化输出约束是否符合预期
- 在真正执行前检查 prompt 是否过长、是否包含了正确上下文

### `run`

执行标准任务。

```powershell
node .\dist\cli\index.js run --task summarize --input-file .\demo\issue.txt --cwd .
node .\dist\cli\index.js run --task review --prompt "review this diff" --agent codex --cwd .
node .\dist\cli\index.js run --task fix --input-file .\demo\bug.txt --agent auto --cwd . --dry-run
```

可用参数：

- `--task summarize|review|fix|plan`
- `--agent auto|codex|copilot|qwen`
- `--input-file <path>`
- `--prompt <text>`
- `--fallback <agents...>`
- `--cwd <path>`
- `--timeout-ms <ms>`
- `--json`
- `--dry-run`

带 `--json` 时，CLI 会抑制运行日志的标准输出污染，只保留最终 JSON 结果，方便后续脚本或 webhook 消费。

## 路由与 fallback

默认路由规则在配置中，而不是写死在代码里：

- `summarize -> copilot -> qwen -> codex`
- `review -> codex -> copilot -> qwen`
- `fix -> codex -> qwen -> copilot`
- `plan -> copilot -> qwen -> codex`

如果任务里显式指定 `preferredAgent` 或 CLI 传了 `--agent`，它会优先于默认路由。

如果首个 agent 不可用或执行失败，编排器会继续尝试后续 agent。

## 结构化输出约定

PromptBuilder 会要求 agent 输出：

```text
===RESULT_JSON===
{ ... }
===END_RESULT_JSON===
```

解析优先级：

1. 原始 JSON 对象或 JSON 数组
2. JSONL 事件流
3. `===RESULT_JSON===` 块
4. ```json code block
5. 启发式字段提取，如 `summary: ...`
6. 保留 raw text

这样即使外部 CLI 没能严格输出 JSON，系统也不会直接报废。

## 日志与产物

默认会在 `artifacts/` 下写出：

- `session-*.log`
- `doctor/*.json`
- `previews/*.json`
- `previews/*.txt`
- `<task-id>-<timestamp>/task-prompt.txt`
- `<task-id>-<timestamp>/<agent>-result.json`
- `<task-id>-<timestamp>/orchestration-result.json`

日志里会记录：

- 实际显示命令
- cwd
- timeout
- exitCode
- duration
- 解析结果

## 新增一个 Agent Adapter

新增适配器的步骤：

1. 新建一个类，例如 `src/agents/claude.ts`，继承 `ConfigurableCliAgentAdapter`
2. 在 `src/core/task.ts` 的 `AGENT_NAMES` 里加入新名称
3. 在 `src/config/schema.ts` 的默认配置里加入新 agent
4. 在 `src/agents/registry.ts` 的 `AGENT_FACTORIES` 注册新类
5. 根据新 CLI 的行为调整：
   - `commandCandidates`
   - `detect.versionArgs`
   - `detect.helpArgs`
   - `run.stdinArgs`
   - `run.promptFileArgs`
   - `run.promptArgArgs`

## 已实现的演示场景

1. summarize
   使用 `demo/issue.txt` 演示自动路由和结构化 summary。

2. review
   使用 `demo/review.diff.txt` 演示 review prompt 和结构化评论输出。

3. fix
   使用 `demo/bug.txt` 演示 fix plan / patch 结构化输出要求。

4. fallback
   Orchestrator 单元测试覆盖“第一个 agent 失败，自动降级到下一个 agent”。

## 测试

运行测试：

```powershell
npm test
```

测试覆盖：

- 结构化输出解析
- Router 排序逻辑
- Orchestrator fallback 行为
- `child_process.spawn` mock 下的 `ProcessRunner`

## 当前限制

- 还不能自动推断每个第三方 CLI 的真实 prompt 参数，只能探测 executable 和帮助信息
- 这版虽然对本机 `codex/copilot/qwen` 做了帮助文本校准，但仍不保证你的其他机器使用完全相同的参数组合
- 某些 CLI 若只能通过 shell alias 调用，而不是实际 `.exe/.cmd` 文件，当前 PATH 探测可能识别不到
- 对 `.cmd/.bat` 做了包装，但复杂 quoting 仍建议优先走 `stdin` 或 prompt file
- 结构化输出解析是 robust-first，不是 strict schema enforcement
- 当前 `qwen` adapter 采用“Qwen/OpenCode 风格”配置骨架，而不是某个特定发行版的硬编码实现
- 本机 `qwen` 已探测到 CLI，但实际 non-interactive 运行仍依赖你先完成 auth type 配置

## 开发建议

- 真正接机前，先执行 `detect`
- 若运行失败，先看本机 help 是否和示例配置一致，再决定是改 `defaultArgs` 还是改输入方式
- 尽量避免把超长 prompt 直接塞进命令行参数
- 如果某个 CLI 必须带子命令，放进 `defaultArgs`

## 许可证

按你的项目需要自行补充。
