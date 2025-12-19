# TypeScript SDK V2 接口（预览版）

简化的 V2 TypeScript Agent SDK 预览，具有基于会话的发送/接收模式，用于多轮对话。

---

<Warning>
V2 接口是一个**不稳定的预览版**。在变得稳定之前，API 可能会根据反馈进行更改。某些功能（如会话分叉）仅在 [V1 SDK](/docs/zh-CN/agent-sdk/typescript) 中可用。
</Warning>

V2 Claude Agent TypeScript SDK 消除了对异步生成器和 yield 协调的需求。这使多轮对话更简单——与其在多个回合中管理生成器状态，每个回合都是一个单独的 `send()`/`receive()` 周期。API 表面简化为三个概念：

- `createSession()` / `resumeSession()`：开始或继续对话
- `session.send()`：发送消息
- `session.receive()`：获取响应

## 安装

V2 接口包含在现有 SDK 包中：

```bash
npm install @anthropic-ai/claude-agent-sdk
```

## 快速开始

### 单次提示

对于不需要维护会话的简单单轮查询，使用 `unstable_v2_prompt()`。此示例发送一个数学问题并记录答案：

```typescript
import { unstable_v2_prompt } from '@anthropic-ai/claude-agent-sdk'

const result = await unstable_v2_prompt('What is 2 + 2?', {
  model: 'claude-sonnet-4-5-20250929'
})
console.log(result.result)
```

<details>
<summary>查看 V1 中的相同操作</summary>

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

const q = query({
  prompt: 'What is 2 + 2?',
  options: { model: 'claude-sonnet-4-5-20250929' }
})

for await (const msg of q) {
  if (msg.type === 'result') {
    console.log(msg.result)
  }
}
```

</details>

### 基本会话

对于超出单个提示的交互，创建一个会话。V2 将发送和接收分为不同的步骤：
- `send()` 分派您的消息
- `receive()` 流式传回响应

这种明确的分离使得在回合之间添加逻辑变得更容易（例如在发送后续内容之前处理响应）。

下面的示例创建一个会话，向 Claude 发送"Hello!"，并打印文本响应。它使用 [`await using`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management)（TypeScript 5.2+）在块退出时自动关闭会话。您也可以手动调用 `session.close()`。

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

await using session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
})

await session.send('Hello!')
for await (const msg of session.receive()) {
  // Filter for assistant messages to get human-readable output
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log(text)
  }
}
```

<details>
<summary>查看 V1 中的相同操作</summary>

在 V1 中，输入和输出都通过单个异步生成器流动。对于基本提示，这看起来类似，但添加多轮逻辑需要重新构造以使用输入生成器。

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

const q = query({
  prompt: 'Hello!',
  options: { model: 'claude-sonnet-4-5-20250929' }
})

for await (const msg of q) {
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log(text)
  }
}
```

</details>

### 多轮对话

会话在多个交换中保持上下文。要继续对话，请在同一会话上再次调用 `send()`。Claude 会记住之前的回合。

此示例询问一个数学问题，然后提出一个引用前一个答案的后续问题：

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

await using session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
})

// Turn 1
await session.send('What is 5 + 3?')
for await (const msg of session.receive()) {
  // Filter for assistant messages to get human-readable output
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log(text)
  }
}

// Turn 2
await session.send('Multiply that by 2')
for await (const msg of session.receive()) {
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log(text)
  }
}
```

<details>
<summary>查看 V1 中的相同操作</summary>

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

// Must create an async iterable to feed messages
async function* createInputStream() {
  yield {
    type: 'user',
    session_id: '',
    message: { role: 'user', content: [{ type: 'text', text: 'What is 5 + 3?' }] },
    parent_tool_use_id: null
  }
  // Must coordinate when to yield next message
  yield {
    type: 'user',
    session_id: '',
    message: { role: 'user', content: [{ type: 'text', text: 'Multiply by 2' }] },
    parent_tool_use_id: null
  }
}

const q = query({
  prompt: createInputStream(),
  options: { model: 'claude-sonnet-4-5-20250929' }
})

for await (const msg of q) {
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log(text)
  }
}
```

</details>

### 会话恢复

如果您有来自之前交互的会话 ID，可以稍后恢复它。这对于长时间运行的工作流或当您需要在应用程序重新启动时保持对话时很有用。

此示例创建一个会话，存储其 ID，关闭它，然后恢复对话：

```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage
} from '@anthropic-ai/claude-agent-sdk'

// Helper to extract text from assistant messages
function getAssistantText(msg: SDKMessage): string | null {
  if (msg.type !== 'assistant') return null
  return msg.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

// Create initial session and have a conversation
const session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
})

await session.send('Remember this number: 42')

// Get the session ID from any received message
let sessionId: string | undefined
for await (const msg of session.receive()) {
  sessionId = msg.session_id
  const text = getAssistantText(msg)
  if (text) console.log('Initial response:', text)
}

console.log('Session ID:', sessionId)
session.close()

// Later: resume the session using the stored ID
await using resumedSession = unstable_v2_resumeSession(sessionId!, {
  model: 'claude-sonnet-4-5-20250929'
})

await resumedSession.send('What number did I ask you to remember?')
for await (const msg of resumedSession.receive()) {
  const text = getAssistantText(msg)
  if (text) console.log('Resumed response:', text)
}
```

<details>
<summary>查看 V1 中的相同操作</summary>

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

// Create initial session
const initialQuery = query({
  prompt: 'Remember this number: 42',
  options: { model: 'claude-sonnet-4-5-20250929' }
})

// Get session ID from any message
let sessionId: string | undefined
for await (const msg of initialQuery) {
  sessionId = msg.session_id
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log('Initial response:', text)
  }
}

console.log('Session ID:', sessionId)

// Later: resume the session
const resumedQuery = query({
  prompt: 'What number did I ask you to remember?',
  options: {
    model: 'claude-sonnet-4-5-20250929',
    resume: sessionId
  }
})

for await (const msg of resumedQuery) {
  if (msg.type === 'assistant') {
    const text = msg.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    console.log('Resumed response:', text)
  }
}
```

</details>

### 清理

会话可以手动关闭或使用 [`await using`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management)（TypeScript 5.2+ 功能用于自动资源清理）自动关闭。如果您使用的是较旧的 TypeScript 版本或遇到兼容性问题，请改用手动清理。

**自动清理（TypeScript 5.2+）：**

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

await using session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
})
// Session closes automatically when the block exits
```

**手动清理：**

```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

const session = unstable_v2_createSession({
  model: 'claude-sonnet-4-5-20250929'
})
// ... use the session ...
session.close()
```

## API 参考

### `unstable_v2_createSession()`

为多轮对话创建新会话。

```typescript
function unstable_v2_createSession(options: {
  model: string;
  // Additional options supported
}): Session
```

### `unstable_v2_resumeSession()`

按 ID 恢复现有会话。

```typescript
function unstable_v2_resumeSession(
  sessionId: string,
  options: {
    model: string;
    // Additional options supported
  }
): Session
```

### `unstable_v2_prompt()`

用于单轮查询的单次便利函数。

```typescript
function unstable_v2_prompt(
  prompt: string,
  options: {
    model: string;
    // Additional options supported
  }
): Promise<Result>
```

### 会话接口

```typescript
interface Session {
  send(message: string): Promise<void>;
  receive(): AsyncGenerator<SDKMessage>;
  close(): void;
}
```

## 功能可用性

并非所有 V1 功能都在 V2 中可用。以下功能需要使用 [V1 SDK](/docs/zh-CN/agent-sdk/typescript)：

- 会话分叉（`forkSession` 选项）
- 某些高级流式输入模式

## 反馈

在 V2 接口变得稳定之前分享您的反馈。通过 [GitHub Issues](https://github.com/anthropics/claude-code/issues) 报告问题和建议。

## 另请参阅

- [TypeScript SDK 参考（V1）](/docs/zh-CN/agent-sdk/typescript) - 完整的 V1 SDK 文档
- [SDK 概述](/docs/zh-CN/agent-sdk/overview) - 常规 SDK 概念
- [GitHub 上的 V2 示例](https://github.com/anthropics/claude-agent-sdk-demos/tree/main/hello-world-v2) - 工作代码示例