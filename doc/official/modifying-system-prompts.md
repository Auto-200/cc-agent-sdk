# 修改系统提示词

学习如何通过三种方法修改系统提示词来自定义Claude的行为 - 输出样式、带append的systemPrompt和自定义系统提示词。

---

系统提示词定义了Claude的行为、能力和响应风格。Claude Agent SDK提供了三种自定义系统提示词的方法：使用输出样式（持久的、基于文件的配置）、附加到Claude Code的提示词，或使用完全自定义的提示词。

## 理解系统提示词

系统提示词是塑造Claude在整个对话过程中行为的初始指令集。

<Note>
**默认行为：** Agent SDK默认使用**空系统提示词**以获得最大灵活性。要使用Claude Code的系统提示词（工具指令、代码指南等），请在TypeScript中指定`systemPrompt: { preset: "claude_code" }`或在Python中指定`system_prompt="claude_code"`。
</Note>

Claude Code的系统提示词包括：

- 工具使用指令和可用工具
- 代码风格和格式指南
- 响应语调和详细程度设置
- 安全和安全指令
- 关于当前工作目录和环境的上下文

## 修改方法

### 方法1：CLAUDE.md文件（项目级指令）

CLAUDE.md文件提供项目特定的上下文和指令，当Agent SDK在目录中运行时会自动读取。它们作为项目的持久"记忆"。

#### CLAUDE.md如何与SDK配合工作

**位置和发现：**

- **项目级：** 工作目录中的`CLAUDE.md`或`.claude/CLAUDE.md`
- **用户级：** `~/.claude/CLAUDE.md`用于所有项目的全局指令

**重要：** SDK只有在您明确配置`settingSources`（TypeScript）或`setting_sources`（Python）时才会读取CLAUDE.md文件：

- 包含`'project'`以加载项目级CLAUDE.md
- 包含`'user'`以加载用户级CLAUDE.md（`~/.claude/CLAUDE.md`）

`claude_code`系统提示词预设不会自动加载CLAUDE.md - 您还必须指定设置源。

**内容格式：**
CLAUDE.md文件使用纯markdown，可以包含：

- 编码指南和标准
- 项目特定上下文
- 常用命令或工作流程
- API约定
- 测试要求

#### CLAUDE.md示例

```markdown
# 项目指南

## 代码风格

- 使用TypeScript严格模式
- 在React中优先使用函数组件
- 始终为公共API包含JSDoc注释

## 测试

- 提交前运行`npm test`
- 保持>80%的代码覆盖率
- 使用jest进行单元测试，playwright进行E2E测试

## 命令

- 构建：`npm run build`
- 开发服务器：`npm run dev`
- 类型检查：`npm run typecheck`
```

#### 在SDK中使用CLAUDE.md

<CodeGroup>

```typescript TypeScript
import { query } from "@anthropic-ai/claude-agent-sdk";

// 重要：您必须指定settingSources来加载CLAUDE.md
// 仅claude_code预设不会加载CLAUDE.md文件
const messages = [];

for await (const message of query({
  prompt: "为用户配置文件添加一个新的React组件",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code", // 使用Claude Code的系统提示词
    },
    settingSources: ["project"], // 从项目加载CLAUDE.md所必需
  },
})) {
  messages.push(message);
}

// 现在Claude可以访问您来自CLAUDE.md的项目指南
```

```python Python
from claude_agent_sdk import query, ClaudeAgentOptions

# 重要：您必须指定setting_sources来加载CLAUDE.md
# 仅claude_code预设不会加载CLAUDE.md文件
messages = []

async for message in query(
    prompt="为用户配置文件添加一个新的React组件",
    options=ClaudeAgentOptions(
        system_prompt={
            "type": "preset",
            "preset": "claude_code"  # 使用Claude Code的系统提示词
        },
        setting_sources=["project"]  # 从项目加载CLAUDE.md所必需
    )
):
    messages.append(message)

# 现在Claude可以访问您来自CLAUDE.md的项目指南
```

</CodeGroup>

#### 何时使用CLAUDE.md

**最适合：**

- **团队共享上下文** - 每个人都应该遵循的指南
- **项目约定** - 编码标准、文件结构、命名模式
- **常用命令** - 特定于您项目的构建、测试、部署命令
- **长期记忆** - 应该在所有会话中持续存在的上下文
- **版本控制指令** - 提交到git以便团队保持同步

**关键特征：**

- ✅ 在项目的所有会话中持续存在
- ✅ 通过git与团队共享
- ✅ 自动发现（无需代码更改）
- ⚠️ 需要通过`settingSources`加载设置

### 方法2：输出样式（持久配置）

输出样式是修改Claude系统提示词的保存配置。它们存储为markdown文件，可以在会话和项目之间重复使用。

#### 创建输出样式

<CodeGroup>

```typescript TypeScript
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

async function createOutputStyle(
  name: string,
  description: string,
  prompt: string
) {
  // 用户级：~/.claude/output-styles
  // 项目级：.claude/output-styles
  const outputStylesDir = join(homedir(), ".claude", "output-styles");

  await mkdir(outputStylesDir, { recursive: true });

  const content = `---
name: ${name}
description: ${description}
---

${prompt}`;

  const filePath = join(
    outputStylesDir,
    `${name.toLowerCase().replace(/\s+/g, "-")}.md`
  );
  await writeFile(filePath, content, "utf-8");
}

// 示例：创建代码审查专家
await createOutputStyle(
  "Code Reviewer",
  "彻底的代码审查助手",
  `您是一位专业的代码审查员。

对于每个代码提交：
1. 检查错误和安全问题
2. 评估性能
3. 建议改进
4. 评估代码质量（1-10分）`
);
```

```python Python
from pathlib import Path

async def create_output_style(name: str, description: str, prompt: str):
    # 用户级：~/.claude/output-styles
    # 项目级：.claude/output-styles
    output_styles_dir = Path.home() / '.claude' / 'output-styles'

    output_styles_dir.mkdir(parents=True, exist_ok=True)

    content = f"""---
name: {name}
description: {description}
---

{prompt}"""

    file_name = name.lower().replace(' ', '-') + '.md'
    file_path = output_styles_dir / file_name
    file_path.write_text(content, encoding='utf-8')

# 示例：创建代码审查专家
await create_output_style(
    'Code Reviewer',
    '彻底的代码审查助手',
    """您是一位专业的代码审查员。

对于每个代码提交：
1. 检查错误和安全问题
2. 评估性能
3. 建议改进
4. 评估代码质量（1-10分）"""
)
```

</CodeGroup>

#### 使用输出样式

创建后，通过以下方式激活输出样式：

- **CLI**：`/output-style [style-name]`
- **设置**：`.claude/settings.local.json`
- **创建新的**：`/output-style:new [description]`

**SDK用户注意：** 当您在选项中包含`settingSources: ['user']`或`settingSources: ['project']`（TypeScript）/`setting_sources=["user"]`或`setting_sources=["project"]`（Python）时，输出样式会被加载。

### 方法3：使用带append的`systemPrompt`

您可以使用Claude Code预设和`append`属性来添加您的自定义指令，同时保留所有内置功能。

<CodeGroup>

```typescript TypeScript
import { query } from "@anthropic-ai/claude-agent-sdk";

const messages = [];

for await (const message of query({
  prompt: "帮我写一个计算斐波那契数列的Python函数",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        "在Python代码中始终包含详细的文档字符串和类型提示。",
    },
  },
})) {
  messages.push(message);
  if (message.type === "assistant") {
    console.log(message.message.content);
  }
}
```

```python Python
from claude_agent_sdk import query, ClaudeAgentOptions

messages = []

async for message in query(
    prompt="帮我写一个计算斐波那契数列的Python函数",
    options=ClaudeAgentOptions(
        system_prompt={
            "type": "preset",
            "preset": "claude_code",
            "append": "在Python代码中始终包含详细的文档字符串和类型提示。"
        }
    )
):
    messages.append(message)
    if message.type == 'assistant':
        print(message.message.content)
```

</CodeGroup>

### 方法4：自定义系统提示词

您可以提供自定义字符串作为`systemPrompt`，用您自己的指令完全替换默认设置。

<CodeGroup>

```typescript TypeScript
import { query } from "@anthropic-ai/claude-agent-sdk";

const customPrompt = `您是一位Python编码专家。
遵循以下指南：
- 编写干净、文档完善的代码
- 为所有函数使用类型提示
- 包含全面的文档字符串
- 在适当时优先使用函数式编程模式
- 始终解释您的代码选择`;

const messages = [];

for await (const message of query({
  prompt: "创建一个数据处理管道",
  options: {
    systemPrompt: customPrompt,
  },
})) {
  messages.push(message);
  if (message.type === "assistant") {
    console.log(message.message.content);
  }
}
```

```python Python
from claude_agent_sdk import query, ClaudeAgentOptions

custom_prompt = """您是一位Python编码专家。
遵循以下指南：
- 编写干净、文档完善的代码
- 为所有函数使用类型提示
- 包含全面的文档字符串
- 在适当时优先使用函数式编程模式
- 始终解释您的代码选择"""

messages = []

async for message in query(
    prompt="创建一个数据处理管道",
    options=ClaudeAgentOptions(
        system_prompt=custom_prompt
    )
):
    messages.append(message)
    if message.type == 'assistant':
        print(message.message.content)
```

</CodeGroup>

## 所有四种方法的比较

| 功能                 | CLAUDE.md           | 输出样式      | 带append的`systemPrompt` | 自定义`systemPrompt`     |
| --- | --- | --- | --- | --- |
| **持久性**         | 每个项目文件 | 保存为文件  | 仅会话            | 仅会话           |
| **可重用性**         | 每个项目      | 跨项目 | 代码重复        | 代码重复       |
| **管理**          | 在文件系统上    | CLI + 文件     | 在代码中                 | 在代码中                |
| **默认工具**       | 保留        | 保留       | 保留               | 丢失（除非包含） |
| **内置安全性**     | 维护       | 维护      | 维护              | 必须添加          |
| **环境上下文** | 自动        | 自动       | 自动               | 必须提供       |
| **自定义级别** | 仅添加   | 替换默认 | 仅添加          | 完全控制       |
| **版本控制**     | 与项目一起     | 是             | 与代码一起               | 与代码一起              |
| **范围**               | 项目特定 | 用户或项目 | 代码会话            | 代码会话           |

**注意：** "带append"是指在TypeScript中使用`systemPrompt: { type: "preset", preset: "claude_code", append: "..." }`或在Python中使用`system_prompt={"type": "preset", "preset": "claude_code", "append": "..."}`。

## 用例和最佳实践

### 何时使用CLAUDE.md

**最适合：**

- 项目特定的编码标准和约定
- 记录项目结构和架构
- 列出常用命令（构建、测试、部署）
- 应该进行版本控制的团队共享上下文
- 适用于项目中所有SDK使用的指令

**示例：**

- "所有API端点都应该使用async/await模式"
- "提交前运行`npm run lint:fix`"
- "数据库迁移在`migrations/`目录中"

**重要：** 要加载CLAUDE.md文件，您必须明确设置`settingSources: ['project']`（TypeScript）或`setting_sources=["project"]`（Python）。没有此设置，`claude_code`系统提示词预设不会自动加载CLAUDE.md。

### 何时使用输出样式

**最适合：**

- 跨会话的持久行为更改
- 团队共享配置
- 专门的助手（代码审查员、数据科学家、DevOps）
- 需要版本控制的复杂提示词修改

**示例：**

- 创建专门的SQL优化助手
- 构建专注于安全的代码审查员
- 开发具有特定教学法的教学助手

### 何时使用带append的`systemPrompt`

**最适合：**

- 添加特定的编码标准或偏好
- 自定义输出格式
- 添加领域特定知识
- 修改响应详细程度
- 在不丢失工具指令的情况下增强Claude Code的默认行为

### 何时使用自定义`systemPrompt`

**最适合：**

- 完全控制Claude的行为
- 专门的单会话任务
- 测试新的提示词策略
- 不需要默认工具的情况
- 构建具有独特行为的专门代理

## 组合方法

您可以组合这些方法以获得最大的灵活性：

### 示例：带会话特定添加的输出样式

<CodeGroup>

```typescript TypeScript
import { query } from "@anthropic-ai/claude-agent-sdk";

// 假设"Code Reviewer"输出样式已激活（通过/output-style）
// 添加会话特定的关注领域
const messages = [];

for await (const message of query({
  prompt: "审查这个身份验证模块",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `
        对于此次审查，优先考虑：
        - OAuth 2.0合规性
        - 令牌存储安全性
        - 会话管理
      `,
    },
  },
})) {
  messages.push(message);
}
```

```python Python
from claude_agent_sdk import query, ClaudeAgentOptions

# 假设"Code Reviewer"输出样式已激活（通过/output-style）
# 添加会话特定的关注领域
messages = []

async for message in query(
    prompt="审查这个身份验证模块",
    options=ClaudeAgentOptions(
        system_prompt={
            "type": "preset",
            "preset": "claude_code",
            "append": """
            对于此次审查，优先考虑：
            - OAuth 2.0合规性
            - 令牌存储安全性
            - 会话管理
            """
        }
    )
):
    messages.append(message)
```

</CodeGroup>

## 另请参阅

- [输出样式](https://code.claude.com/docs/output-styles) - 完整的输出样式文档
- [TypeScript SDK指南](/docs/zh-CN/agent-sdk/typescript) - 完整的SDK使用指南
- [TypeScript SDK参考](https://code.claude.com/docs/typescript-sdk-reference) - 完整的API文档
- [配置指南](https://code.claude.com/docs/configuration) - 通用配置选项