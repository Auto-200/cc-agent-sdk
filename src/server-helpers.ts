import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionMode, SettingSource } from "./types";

/**
 * 规范化 Anthropic 兼容 Base URL，去掉常见的 `/v1`、`/v1/messages` 等尾巴。
 *
 * @param url 调用方/环境变量传入的 Base URL
 * @returns 规范化后的 Base URL；当入参为空时返回 `undefined`
 */
export function sanitizeBaseURL(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/v1\/messages\/?$/, "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

/**
 * 解析常见的布尔型 query 参数编码。
 *
 * @param value query 参数字符串（缺失时为 `null`）
 * @returns 能识别则返回 `true`/`false`，否则返回 `undefined`
 */
export function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return undefined;
}

/**
 * 解析数字型 query 参数。
 *
 * @param value query 参数字符串（缺失时为 `null`）
 * @returns 解析出的有限数值；解析失败则返回 `undefined`
 */
export function parseNumberParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 便捷的 JSON 响应封装。
 *
 * @param data 可序列化为 JSON 的数据
 * @param init ResponseInit（可覆盖 status/headers 等）
 * @returns 带 `Content-Type: application/json; charset=utf-8` 的 Response
 */
export function json(data: unknown, init?: ResponseInit): Response {
  // JSON.stringify(undefined) returns undefined, which results in an empty body.
  // For HTTP APIs we prefer a deterministic JSON body.
  const body = JSON.stringify(data === undefined ? null : data);
  return new Response(body, {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init?.headers || {}) },
  });
}

/**
 * 默认的设置来源（settingSources）。
 */
export const DEFAULT_SETTING_SOURCES: SettingSource[] = ["user", "project"];

/**
 * 规范化 `settingSources`，过滤掉非法值，仅保留允许的来源。
 *
 * @param input 来自请求体的不可信输入
 * @returns 规范化后的数组；为空/无效则返回 `undefined`
 */
export function normalizeSettingSources(input: unknown): SettingSource[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const valid = input.filter(
    (value): value is SettingSource =>
      value === "user" || value === "project" || value === "local"
  );
  return valid.length > 0 ? valid : undefined;
}

/**
 * 规范化 `permissionMode`，仅允许预定义的模式值。
 *
 * @param input 来自请求体的不可信输入
 * @returns 合法的 PermissionMode；非法则返回 `undefined`
 */
export function normalizePermissionMode(input: unknown): PermissionMode | undefined {
  if (
    input === "default" ||
    input === "acceptEdits" ||
    input === "bypassPermissions" ||
    input === "plan" ||
    input === "dontAsk"
  ) {
    return input;
  }
  return undefined;
}

// No beta flag passthrough: keep server behavior stable and predictable.

/**
 * 规范化 `mcpServers`，将输入转换为可用的 MCP server 配置映射。
 *
 * @param input 来自请求体的不可信输入
 * @returns 合法的 MCP server 映射；无/非法则返回 `undefined`
 */
export function normalizeMcpServers(input: unknown): Record<string, McpServerConfig> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const entries = Object.entries(input);
  const servers: Record<string, McpServerConfig> = {};
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const { command, args, env } = value as { command?: unknown; args?: unknown; env?: unknown };
    if (typeof command !== "string") continue;
    servers[key] = {
      command,
      ...(Array.isArray(args) ? { args } : {}),
      ...(env && typeof env === "object" && !Array.isArray(env) ? { env: env as Record<string, string> } : {}),
    };
  }
  return Object.keys(servers).length > 0 ? servers : undefined;
}
