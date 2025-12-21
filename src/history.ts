import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

export type HistoryRole = "user" | "assistant";

/**
 * 从 jsonl 解析得到的简化消息结构（用于返回给调用方）。
 */
export interface HistoryMessage {
  role: HistoryRole;
  content: string;
  timestamp?: string;
  uuid?: string;
}

/**
 * 单个 conversationId 的历史记录分页返回结构。
 */
export interface ConversationHistoryResult {
  conversationId: string;
  filePath: string;
  messages: HistoryMessage[];
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * 会话列表条目（用于 conversations 聚合接口）。
 */
export interface ListConversationsItem {
  conversationId: string;
  project: string;
  filePath: string;
  mtimeMs?: number;
  size?: number;
}

/**
 * 判断字符串是否像 UUID。
 *
 * @param input 待检测字符串
 * @returns 若匹配 UUID 样式则返回 true
 */
function isUuidLike(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
}

/**
 * 从 Claude 风格的 content blocks 中提取纯文本。
 *
 * @param blocks 可能是 content block 数组
 * @param param1 选项
 * @returns 拼接后的文本内容（可选包含 thinking）
 */
function extractTextFromContentBlocks(blocks: unknown, { includeThinking }: { includeThinking: boolean }): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const type = (block as { type?: unknown }).type;
    if (type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) parts.push(text);
      continue;
    }
    if (includeThinking && type === "thinking") {
      const thinking = (block as { thinking?: unknown }).thinking;
      if (typeof thinking === "string" && thinking.trim()) parts.push(thinking);
      continue;
    }
  }
  return parts.join("\n").trim();
}

/**
 * 尝试把单条 jsonl 事件转换为简化后的历史消息结构。
 *
 * @param event 已解析的 JSON 事件对象
 * @param param1 选项
 * @returns 若为 user/assistant 消息事件则返回 HistoryMessage，否则返回 null
 */
function extractMessageFromEvent(
  event: unknown,
  { includeThinking }: { includeThinking: boolean }
): HistoryMessage | null {
  if (!event || typeof event !== "object") return null;
  const type = (event as { type?: unknown }).type;
  if (type !== "user" && type !== "assistant") return null;

  const timestamp = (event as { timestamp?: unknown }).timestamp;
  const uuid = (event as { uuid?: unknown }).uuid;

  if (type === "user") {
    const msg = (event as { message?: unknown }).message;
    if (!msg || typeof msg !== "object") return null;
    const contentBlocks = (msg as { content?: unknown }).content;
    const content = extractTextFromContentBlocks(contentBlocks, { includeThinking });
    if (!content) return null;
    return {
      role: "user",
      content,
      ...(typeof timestamp === "string" ? { timestamp } : {}),
      ...(typeof uuid === "string" ? { uuid } : {}),
    };
  }

  const msg = (event as { message?: unknown }).message;
  if (!msg || typeof msg !== "object") return null;
  const role = (msg as { role?: unknown }).role;
  if (role !== "assistant") return null;
  const contentBlocks = (msg as { content?: unknown }).content;
  const content = extractTextFromContentBlocks(contentBlocks, { includeThinking });
  if (!content) return null;
  return {
    role: "assistant",
    content,
    ...(typeof timestamp === "string" ? { timestamp } : {}),
    ...(typeof uuid === "string" ? { uuid } : {}),
  };
}

/**
 * 判断路径是否存在且为普通文件。
 *
 * @param path 绝对文件路径
 * @returns 存在且为文件则返回 true
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * 获取本项目写入的“补充历史文件”（用于保存 assistant 的可展示文本）。
 *
 * 注意：该文件不属于 Claude Code 原始会话文件，避免影响 resume 行为。
 *
 * @param claudeDataDir Claude 数据根目录
 * @param conversationId 会话 ID（UUID）
 * @returns 补充历史文件绝对路径
 */
function getSyntheticHistoryFilePath(claudeDataDir: string, conversationId: string): string {
  const root = resolve(claudeDataDir);
  return join(root, "agent-sdk", "history", `${conversationId}.jsonl`);
}

/**
 * 从任意 jsonl 文件中解析出简化消息列表。
 *
 * @param filePath jsonl 文件路径
 * @param param1 选项
 * @returns 历史消息数组（按文件出现顺序）
 */
async function readMessagesFromJsonlFile(
  filePath: string,
  { includeThinking }: { includeThinking: boolean }
): Promise<HistoryMessage[]> {
  const out: HistoryMessage[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const msg = extractMessageFromEvent(parsed, { includeThinking });
    if (msg) out.push(msg);
  }
  return out;
}

/**
 * 通过扫描所有 project 目录来定位某个会话的 jsonl 文件路径。
 *
 * @param param0 根目录与 conversationId
 * @returns 找到则返回文件路径与 project 名；找不到返回 null
 */
export async function resolveConversationFilePath({
  claudeDataDir,
  conversationId,
}: {
  claudeDataDir: string;
  conversationId: string;
}): Promise<{ filePath: string; project: string } | null> {
  if (!conversationId || typeof conversationId !== "string") return null;
  if (!isUuidLike(conversationId)) return null;
  const root = resolve(claudeDataDir);
  const projectsRoot = join(root, "projects");

  const filename = `${conversationId}.jsonl`;
  let dirs: string[] = [];
  try {
    dirs = await readdir(projectsRoot);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const candidate = join(projectsRoot, dir, filename);
    if (await fileExists(candidate)) return { filePath: candidate, project: dir };
  }
  return null;
}

/**
 * 从会话 jsonl 文件读取历史消息，并按 offset/limit 返回分页结果。
 *
 * 分页基于“消息索引”（仅统计 user/assistant 消息），而不是原始 jsonl 行号。
 *
 * @param param0 输入参数
 * @returns 解析后的会话历史分页结果；找不到返回 null
 */
export async function readConversationHistory({
  claudeDataDir,
  conversationId,
  includeThinking = false,
  offset = 0,
  limit = 200,
}: {
  claudeDataDir: string;
  conversationId: string;
  includeThinking?: boolean;
  offset?: number;
  limit?: number;
}): Promise<ConversationHistoryResult | null> {
  const effectiveOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;

  // 合并 Claude Code 原始会话文件 + 我们的补充历史文件（主要用于 assistant 文本）。
  const syntheticPath = getSyntheticHistoryFilePath(claudeDataDir, conversationId);
  const resolved = await resolveConversationFilePath({ claudeDataDir, conversationId });
  const [primary, synthetic] = await Promise.all([
    resolved ? readMessagesFromJsonlFile(resolved.filePath, { includeThinking }) : [],
    (await fileExists(syntheticPath)) ? readMessagesFromJsonlFile(syntheticPath, { includeThinking }) : [],
  ]);
  if (!resolved && synthetic.length === 0) return null;

  const combined = [...primary, ...synthetic];
  combined.sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : NaN;
    const tb = b.timestamp ? Date.parse(b.timestamp) : NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    if (Number.isFinite(ta)) return -1;
    if (Number.isFinite(tb)) return 1;
    return 0;
  });

  const page = combined.slice(effectiveOffset, effectiveOffset + effectiveLimit);
  const hasMore = effectiveOffset + page.length < combined.length;

  return {
    conversationId,
    filePath: resolved?.filePath ?? syntheticPath,
    messages: page,
    offset: effectiveOffset,
    limit: effectiveLimit,
    hasMore,
    nextOffset: hasMore ? effectiveOffset + page.length : null,
  };
}

/**
 * 列出指定 project 目录下的会话文件，并按 mtime 倒序排序。
 *
 * @param param0 根目录与 project
 * @returns 会话条目列表；project 目录不存在时返回 null
 */
export async function listConversations({
  claudeDataDir,
  project,
  limit = 100,
}: {
  claudeDataDir: string;
  project: string;
  limit?: number;
}): Promise<ListConversationsItem[] | null> {
  const root = resolve(claudeDataDir);
  const projectDir = join(root, "projects", project);

  let names: string[] = [];
  try {
    names = await readdir(projectDir);
  } catch {
    return null;
  }

  const items: ListConversationsItem[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const conversationId = name.slice(0, -".jsonl".length);
    if (!isUuidLike(conversationId)) continue;
    const filePath = join(projectDir, name);
    try {
      const info = await stat(filePath);
      items.push({ conversationId, project, filePath, mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      items.push({ conversationId, project, filePath });
    }
  }

  items.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
  return items.slice(0, Math.max(0, limit));
}

/**
 * 列出 `~/.claude/projects` 下的所有 project 目录名。
 *
 * @param param0 根目录
 * @returns 排序后的 project 名列表；根目录不存在时返回 null
 */
export async function listProjects({
  claudeDataDir,
}: {
  claudeDataDir: string;
}): Promise<string[] | null> {
  const root = resolve(claudeDataDir);
  const projectsRoot = join(root, "projects");
  let entries: string[] = [];
  try {
    entries = await readdir(projectsRoot);
  } catch {
    return null;
  }
  const projects: string[] = [];
  for (const name of entries) {
    try {
      const info = await stat(join(projectsRoot, name));
      if (info.isDirectory()) projects.push(name);
    } catch {
      // skip
    }
  }
  projects.sort();
  return projects;
}

/**
 * 聚合列出所有 projects 下的会话，并按 mtime 倒序排序。
 *
 * @param param0 根目录与 limit
 * @returns 聚合后的会话列表；projects 根目录不存在时返回 null
 */
export async function listAllConversations({
  claudeDataDir,
  limit = 100,
}: {
  claudeDataDir: string;
  limit?: number;
}): Promise<ListConversationsItem[] | null> {
  const projects = await listProjects({ claudeDataDir });
  if (!projects) return null;

  const all: ListConversationsItem[] = [];
  for (const project of projects) {
    const items = await listConversations({ claudeDataDir, project, limit: Math.max(1, limit) });
    if (items) all.push(...items);
  }
  all.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
  return all.slice(0, Math.max(0, limit));
}
