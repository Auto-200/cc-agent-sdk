# 会话管理

了解 Claude Agent SDK 如何处理会话和会话恢复

---

# 会话管理

Claude Agent SDK 提供会话管理功能，用于处理对话状态和恢复。会话允许您在多次交互中继续对话，同时保持完整的上下文。

## 会话工作原理

当您开始新查询时，SDK 会自动创建一个会话，并在初始系统消息中返回会话 ID。您可以捕获此 ID 以便稍后恢复会话。

### 获取会话 ID

<CodeGroup>

```typescript TypeScript
import { query } from "@anthropic-ai/claude-agent-sdk"

let sessionId: string | undefined

const response = query({
  prompt: "帮我构建一个 Web 应用程序",
  options: {
    model: "claude-sonnet-4-5"
  }
})

for await (const message of response) {
  // 第一条消息是包含会话 ID 的系统初始化消息
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id
    console.log(`会话已启动，ID: ${sessionId}`)
    // 您可以保存此 ID 以便稍后恢复
  }

  // 处理其他消息...
  console.log(message)
}

// 稍后，您可以使用保存的 sessionId 来恢复
if (sessionId) {
  const resumedResponse = query({
    prompt: "从我们停下的地方继续",
    options: {
      resume: sessionId
    }
  })
}
```

```python Python
from claude_agent_sdk import query, ClaudeAgentOptions

session_id = None

async for message in query(
    prompt="帮我构建一个 Web 应用程序",
    options=ClaudeAgentOptions(
        model="claude-sonnet-4-5"
    )
):
    # 第一条消息是包含会话 ID 的系统初始化消息
    if hasattr(message, 'subtype') and message.subtype == 'init':
        session_id = message.data.get('session_id')
        print(f"会话已启动，ID: {session_id}")
        # 您可以保存此 ID 以便稍后恢复

    # 处理其他消息...
    print(message)

# 稍后，您可以使用保存的 session_id 来恢复
if session_id:
    async for message in query(
        prompt="从我们停下的地方继续",
        options=ClaudeAgentOptions(
            resume=session_id
        )
    ):
        print(message)
```

</CodeGroup>

## 恢复会话

SDK 支持从先前的对话状态恢复会话，实现连续的开发工作流程。使用 `resume` 选项和会话 ID 来继续之前的对话。

<CodeGroup>

```typescript TypeScript
import { query } from "@anthropic-ai/claude-agent-sdk"

// 使用会话 ID 恢复之前的会话
const response = query({
  prompt: "从我们停下的地方继续实现身份验证系统",
  options: {
    resume: "session-xyz", // 来自之前对话的会话 ID
    model: "claude-sonnet-4-5",
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"]
  }
})

// 对话继续，包含之前会话的完整上下文
for await (const message of response) {
  console.log(message)
}
```

```python Python
from claude_agent_sdk import query, ClaudeAgentOptions

# 使用会话 ID 恢复之前的会话
async for message in query(
    prompt="从我们停下的地方继续实现身份验证系统",
    options=ClaudeAgentOptions(
        resume="session-xyz",  # 来自之前对话的会话 ID
        model="claude-sonnet-4-5",
        allowed_tools=["Read", "Edit", "Write", "Glob", "Grep", "Bash"]
    )
):
    print(message)

# 对话继续，包含之前会话的完整上下文
```

</CodeGroup>

当您恢复会话时，SDK 会自动处理加载对话历史和上下文，让 Claude 能够从停下的地方准确继续。

## 分叉会话

恢复会话时，您可以选择继续原始会话或将其分叉到新分支。默认情况下，恢复会继续原始会话。使用 `forkSession` 选项（TypeScript）或 `fork_session` 选项（Python）来创建一个从恢复状态开始的新会话 ID。

### 何时分叉会话

分叉在以下情况下很有用：
- 从同一起点探索不同方法
- 创建多个对话分支而不修改原始对话
- 测试更改而不影响原始会话历史
- 为不同实验维护单独的对话路径

### 分叉与继续

| 行为 | `forkSession: false`（默认） | `forkSession: true` |
|---|---|---|
| **会话 ID** | 与原始相同 | 生成新会话 ID |
| **历史** | 追加到原始会话 | 从恢复点创建新分支 |
| **原始会话** | 被修改 | 保持不变 |
| **使用场景** | 继续线性对话 | 分支探索替代方案 |

### 示例：分叉会话

<CodeGroup>

```typescript TypeScript
import { query } from "@anthropic-ai/claude-agent-sdk"

// 首先，捕获会话 ID
let sessionId: string | undefined

const response = query({
  prompt: "帮我设计一个 REST API",
  options: { model: "claude-sonnet-4-5" }
})

for await (const message of response) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id
    console.log(`原始会话: ${sessionId}`)
  }
}

// 分叉会话以尝试不同方法
const forkedResponse = query({
  prompt: "现在让我们将其重新设计为 GraphQL API",
  options: {
    resume: sessionId,
    forkSession: true,  // 创建新会话 ID
    model: "claude-sonnet-4-5"
  }
})

for await (const message of forkedResponse) {
  if (message.type === 'system' && message.subtype === 'init') {
    console.log(`分叉会话: ${message.session_id}`)
    // 这将是一个不同的会话 ID
  }
}

// 原始会话保持不变，仍可恢复
const originalContinued = query({
  prompt: "为 REST API 添加身份验证",
  options: {
    resume: sessionId,
    forkSession: false,  // 继续原始会话（默认）
    model: "claude-sonnet-4-5"
  }
})
```

```python Python
from claude_agent_sdk import query, ClaudeAgentOptions

# 首先，捕获会话 ID
session_id = None

async for message in query(
    prompt="帮我设计一个 REST API",
    options=ClaudeAgentOptions(model="claude-sonnet-4-5")
):
    if hasattr(message, 'subtype') and message.subtype == 'init':
        session_id = message.data.get('session_id')
        print(f"原始会话: {session_id}")

# 分叉会话以尝试不同方法
async for message in query(
    prompt="现在让我们将其重新设计为 GraphQL API",
    options=ClaudeAgentOptions(
        resume=session_id,
        fork_session=True,  # 创建新会话 ID
        model="claude-sonnet-4-5"
    )
):
    if hasattr(message, 'subtype') and message.subtype == 'init':
        forked_id = message.data.get('session_id')
        print(f"分叉会话: {forked_id}")
        # 这将是一个不同的会话 ID

# 原始会话保持不变，仍可恢复
async for message in query(
    prompt="为 REST API 添加身份验证",
    options=ClaudeAgentOptions(
        resume=session_id,
        fork_session=False,  # 继续原始会话（默认）
        model="claude-sonnet-4-5"
    )
):
    print(message)
```

</CodeGroup>