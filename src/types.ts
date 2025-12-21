import type { Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * 对话消息角色。
 */
export type Role = "user" | "assistant";

/**
 * 简化后的历史消息结构（用于历史读取/展示）。
 */
export interface HistoryMessage {
  role: Role;
  content: string;
}

/**
 * 透传给 Claude Agent SDK 的 options。
 *
 * 注意：服务端会强制 `permissionMode=bypassPermissions` 且跳过交互权限；
 * 即使调用方传入相关字段，也不会生效。
 */
export type RequestOptions = Partial<Options>;

/**
 * `POST /agent-sdk/stream` 的请求体结构。
 */
export interface RequestBody {
  prompt?: string;
  userMessage?: string;
  systemPrompt?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  conversationId?: string;
  options?: RequestOptions;
}

/**
 * settingSources 的允许取值。
 */
export type SettingSource = "user" | "project" | "local";

/**
 * permissionMode 的允许取值。
 */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";

// No beta flag passthrough in this server.
