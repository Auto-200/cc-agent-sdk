# cc-agent-sdk

本仓库是一个轻量的本地 Claude Agent SDK 代理服务（TypeScript + Bun），提供 HTTP POST + SSE 的流式接口，方便其他 Worker/DO 通过统一入口调用 Claude Agent SDK（或 Anthropic 兼容 API）。
官方 SDK 参考文档已收纳到 `doc/official/` 目录（未改动原文）。

## 快速开始

```bash
cd /Users/night/code/Auto-200/cc-agent-sdk
bun install

# 本地开发（监听 ts 源码）
bun run dev

# 构建并运行已编译产物
bun run build
bun run start
```

- 默认监听：`http://127.0.0.1:20001/agent-sdk/stream`（可用环境变量 `AGENT_SDK_PORT` 调整）
- 可选鉴权：设置 `AGENT_SDK_API_KEY` 后，所有请求需带头：`Authorization: Bearer <AGENT_SDK_API_KEY>`

## Docker（GitHub Actions 自动构建）

本仓库包含一个 GitHub Actions workflow：每次 push 到 `main` 或打 tag（如 `v0.1.0`）会自动构建并推送镜像到 GHCR：

- 镜像地址：`ghcr.io/<owner>/<repo>`
- Tags：
  - `latest`：仅默认分支（通常是 `main`）
  - `main`：分支 tag
  - `v*`：发布 tag（如 `v0.1.0`）
  - `sha-<...>`：提交哈希

拉取示例：

```bash
docker pull ghcr.io/<owner>/<repo>:latest
```

## 环境变量

- `AGENT_SDK_PORT`：服务端口，默认 `20001`
- `AGENT_SDK_API_KEY`：用于保护代理入口的 Bearer Token（可选）
- `AGENT_SDK_IDLE_TIMEOUT_MS`：SSE 流空闲超时（默认 `180000`），上游较慢时可调大
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`：默认使用的 Anthropic Key（可被请求体覆盖）
- `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_BASE_URL`：默认的 Anthropic 兼容 Base URL（可被请求体覆盖）
- `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL`：默认模型（缺省为 `claude-3-5-sonnet-20241022`）
- `ANTHROPIC_SYSTEM_PROMPT`：兜底系统提示词（请求未传 `systemPrompt`/`options.systemPrompt` 时使用）

运行时直接读取环境变量（容器/部署注入）。本地如需使用 `.env.local`，请自行在启动命令前导出环境变量。

## 接口

`POST /agent-sdk/stream`  
请求体 JSON（字段可选，除非特别标注）：

- `userMessage`：字符串，用户输入（或用 `prompt` 直接提供完整提示）。默认走 cc 会话模式，不需要手动传 history。
- `systemPrompt`：系统提示词（可选，等价于 `options.systemPrompt`）
- `model`：覆盖默认模型
- `baseURL`：覆盖默认的 Anthropic 兼容 Base URL（自动去掉 `/v1/messages` 尾巴）
- `apiKey`：覆盖默认的 Anthropic Key
- `conversationId`：会话 ID，映射到 cc 的 `resume`，不传则新开会话（持久化在 `.claude`）
- `prompt`：直接传入完整 prompt（优先级最高）
- `options`：透传给 `@anthropic-ai/claude-agent-sdk` 的部分字段
  - `allowedTools`（默认 `["Skill"]`）、`disallowedTools`、`tools`（可传 `["Skill", ...]` 或 `{ type:"preset", preset:"claude_code" }`）
  - `systemPrompt`（字符串或 `{ type:"preset", preset:"claude_code", append?: string }`）
  - `settingSources`（默认 `["user","project"]`）、`cwd`、`permissionMode`、`includePartialMessages`（默认 true）
  - `env`：附加环境变量、`extraArgs`
  - 会话/历史：`persistSession`（默认 true）、`resume`、`resumeSessionAt`、`forkSession`
  - 其他：`mcpServers`、`betas` 等

响应：`text/event-stream`，逐条推送 Claude Agent SDK 的原始事件（如 `stream_event`/`content_block_delta`/`assistant`/`result`/`error`）。

返回值格式详见：`doc/response-format.md`

示例 `curl`：

```bash
curl -N http://127.0.0.1:20001/agent-sdk/stream \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "帮我写一个待办应用的需求列表",
    "systemPrompt": "简洁输出要点",
    "model": "claude-3-5-sonnet-20241022",
    "conversationId": "your-session-id-if-any"
  }'
```

更多示例：

1) 指定模型 + 自定义 API 地址 + 透传密钥
```bash
curl -N http://127.0.0.1:20001/agent-sdk/stream \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "用 100 字概括一篇新闻",
    "model": "glm-4.6",
    "baseURL": "https://api.gbro.site",
    "apiKey": "sk-xxx"
  }'
```

2) 自定义系统提示词 + 工具控制
```bash
curl -N http://127.0.0.1:20001/agent-sdk/stream \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "检查当前目录并总结文件",
    "systemPrompt": "你是审计助手，先列出文件再总结。",
    "options": {
      "allowedTools": ["Skill"],
      "disallowedTools": ["KillBash"],
      "tools": { "type": "preset", "preset": "claude_code" }
    }
  }'
```

3) 会话续聊（带 conversationId）+ 追加设置源
```bash
curl -N http://127.0.0.1:20001/agent-sdk/stream \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "继续上一轮的结论，给出行动项",
    "conversationId": "session-uuid-from-previous-run",
    "options": {
      "settingSources": ["user", "project", "local"],
      "includePartialMessages": true
    }
  }'
```

4) MCP 服务器与环境透传
```bash
curl -N http://127.0.0.1:20001/agent-sdk/stream \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "用内部工具拉取配置并解读",
    "options": {
      "mcpServers": {
        "config-reader": { "command": "node", "args": ["./mcp/config-reader.js"] }
      },
      "env": { "TENANT_ID": "foo" }
    }
  }'
```

## 在主项目中的用法（参考）

在 DO 内配置：

- 环境变量：`AGENT_SDK_ENDPOINT=http://127.0.0.1:20001/agent-sdk/stream`
- 可选：`AGENT_SDK_API_KEY` 用于签发请求时的 Authorization
- DO 侧会先尝试代理；若代理不可用或未配置，会直接调用 Anthropic 兼容 API。

## 依赖

- Bun 1.3+（运行时）
- 包：`@anthropic-ai/claude-agent-sdk`

## 环境变量示例

参考 `.env.example`（复制为 `.env.local` 或 `.dev.vars` 使用）：

```bash
AGENT_SDK_PORT=20001
AGENT_SDK_API_KEY=replace-with-a-strong-token

# 默认 Anthropic 兼容配置（可选，调用方可在请求体覆盖）
ANTHROPIC_BASE_URL=https://api.gbro.site
ANTHROPIC_AUTH_TOKEN=replace-with-your-key
ANTHROPIC_API_KEY=replace-with-your-key

# 默认模型（可选）
ANTHROPIC_DEFAULT_OPUS_MODEL=glm-4.6
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-4.6
ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-4.5-air
ANTHROPIC_MODEL=glm-4.6
ANTHROPIC_SMALL_FAST_MODEL=glm-4.6
ANTHROPIC_SYSTEM_PROMPT=You are a capable assistant agent. Be concise, accurate, and action-focused.
```
