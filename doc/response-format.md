# SSE 返回值格式（/agent-sdk/stream）

本服务的 `POST /agent-sdk/stream` 返回 `Content-Type: text/event-stream`，每一条 SSE 消息都只包含一个 `data:` 字段，值为一段 JSON（不做二次封装/不改字段名），并以空行结束：

```text
data: { ...JSON... }

data: { ...JSON... }

```

客户端解析规则：

- 按 SSE 协议按行读取；每个事件以空行分隔
- 取每个事件中 `data:` 后面的字符串，作为 JSON 反序列化
- 事件顺序即服务端推送顺序

> 说明：这些对象来自 `@anthropic-ai/claude-agent-sdk` 的流式输出；本服务基本是“透传”。

## 顶层对象（每条 data 的 JSON）

常见顶层字段：

- `type`: 字符串，事件类型（见下方）
- `session_id`: 字符串，会话 ID（用于续聊/定位日志）
- `uuid`: 字符串，本条事件的唯一标识（SDK 生成）
- `parent_tool_use_id`: `string | null`，工具调用关联（如有）

不同 `type` 下会有不同字段。

## 事件类型一览

### 1) `type: "system"`（初始化）

通常请求开始后第一条会出现 `subtype: "init"`，用于描述运行环境与工具集等：

关键字段（可能随 SDK 版本变化）：

- `subtype`: `"init"`
- `cwd`: Claude Code 子进程工作目录
- `tools`: 可用工具列表（如 `Read`/`Write`/`WebSearch` 等）
- `mcp_servers`: MCP 服务器列表（如有）
- `model`: 当前请求使用的模型名（你请求体传入的 `model` 会体现在这里）
- `permissionMode`: 权限模式
- `claude_code_version`: Claude Code 版本
- `output_style`: 输出风格

### 2) `type: "stream_event"`（原始流事件）

这是最频繁的一类，字段形态为：

- `event`: 一个“上游消息流事件对象”

常见 `event.type`：

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

其中 `content_block_delta` 用来增量输出内容：

- `delta.type: "text_delta"` 时，`delta.text` 是增量文本
- `delta.type: "thinking_delta"` 时，`delta.thinking` 是增量思考（是否出现取决于模型/设置）

客户端通常会把多个 `text_delta` 拼起来得到最终回复文本。

### 3) `type: "assistant"`（聚合后的 assistant 消息快照）

在流式过程中可能会出现一个或多个 `assistant` 对象，形态大致为：

- `message`: 一个 message 对象，包含 `content` 数组（`{type:"text", text:"..."}` / `{type:"thinking", thinking:"..."}` 等）

如果你只关心最终展示文本，可以优先用 `stream_event` 的 `text_delta` 做实时拼接；`assistant` 更像是“过程中的快照/同步点”。

### 4) `type: "result"`（结束）

一次请求正常结束通常会收到 `type: "result"`，常见字段：

- `subtype`: `"success"`（也可能有错误 subtype）
- `is_error`: boolean
- `duration_ms` / `duration_api_ms`
- `num_turns`
- `total_cost_usd`
- `usage` / `modelUsage`
- `permission_denials`

收到 `result` 后，流一般会自然结束（连接关闭）。

### 5) `type: "error"`（错误）

当请求解析失败、缺少密钥、上游报错、或代理侧超时等，会发送：

- `type: "error"`
- `message`: 错误信息字符串

示例：当长时间没有任何上游事件时，可能出现：

```json
{"type":"error","message":"Stream timed out waiting for upstream response."}
```

## 典型事件序列（简化）

一条正常请求一般会呈现类似序列（不保证每次完全一致）：

1. `system:init`
2. 多条 `stream_event`（若干 `text_delta` / `thinking_delta`）
3. 若干 `assistant`（可选）
4. `result:success`

## 客户端最简处理建议

- 实时展示：拼接所有 `stream_event` 中 `delta.type==="text_delta"` 的 `delta.text`
- 会话续聊：把 `system:init.session_id` 或 `result.session_id` 保存下来，下次请求作为 `conversationId`
- 错误处理：一旦收到 `type:"error"`，应中断本次 UI 流并提示 `message`

