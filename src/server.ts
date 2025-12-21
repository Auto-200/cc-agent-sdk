import { query , type Options }  from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_SETTING_SOURCES, json, normalizeMcpServers, normalizeSettingSources, parseBooleanParam, parseNumberParam, sanitizeBaseURL } from "./server-helpers";
import { listAllConversations, listProjects, readConversationHistory } from "./history";
import { RequestBody } from "./types";

const PORT = Number(process.env.AGENT_SDK_PORT || 20001);
// Optional: protect the endpoint with a bearer token
const AGENT_SDK_API_KEY = process.env.AGENT_SDK_API_KEY || "";

const AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
const BASE_URL = sanitizeBaseURL(process.env.ANTHROPIC_BASE_URL);
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "claude-3-5-sonnet-20241022";
const DEFAULT_SYSTEM_PROMPT = (process.env.ANTHROPIC_SYSTEM_PROMPT || "").trim() || undefined;
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || "";
const CLAUDE_DATA_DIR =
  process.env.CLAUDE_DATA_DIR ||
  process.env.AGENT_SDK_CLAUDE_DATA_DIR ||
  (HOME_DIR ? `${HOME_DIR}/.claude` : ".claude");

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const isStream = url.pathname === "/agent-sdk/stream";
  const isHistory = url.pathname === "/agent-sdk/history";
  const isProjects = url.pathname === "/agent-sdk/projects";
  const isConversations = url.pathname === "/agent-sdk/conversations";

  if (!(isStream || isHistory || isProjects || isConversations)) {
    return new Response("Not found", { status: 404 });
  }
  if (isStream && req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!isStream && req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  if (AGENT_SDK_API_KEY) {
    const auth = req.headers.get("authorization") || "";
    const expected = `Bearer ${AGENT_SDK_API_KEY}`;
    if (auth !== expected) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  if (!isStream) {
    if (isProjects) {
      const projects = await listProjects({ claudeDataDir: CLAUDE_DATA_DIR });
      if (!projects) return json({ error: "Claude data dir not found", claudeDataDir: CLAUDE_DATA_DIR }, { status: 404 });
      return json({ claudeDataDir: CLAUDE_DATA_DIR, projects });
    }

    if (isConversations) {
      const limit = parseNumberParam(url.searchParams.get("limit")) ?? 100;
      const items = await listAllConversations({ claudeDataDir: CLAUDE_DATA_DIR, limit });
      if (!items) return json({ error: "Claude data dir not found", claudeDataDir: CLAUDE_DATA_DIR }, { status: 404 });
      return json({ claudeDataDir: CLAUDE_DATA_DIR, conversations: items });
    }

    const conversationId = url.searchParams.get("conversationId") || "";
    const offset = parseNumberParam(url.searchParams.get("offset")) ?? 0;
    const limit = parseNumberParam(url.searchParams.get("limit")) ?? 200;
    const includeThinking = parseBooleanParam(url.searchParams.get("includeThinking")) ?? false;

    const result = await readConversationHistory({
      claudeDataDir: CLAUDE_DATA_DIR,
      conversationId,
      offset,
      limit,
      includeThinking,
    });
    if (!result) {
      return json(
        { error: "Conversation not found", claudeDataDir: CLAUDE_DATA_DIR, conversationId },
        { status: 404 }
      );
    }
    return json({ claudeDataDir: CLAUDE_DATA_DIR, ...result });
  }

  let body: RequestBody = {};
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Bad Request: ${message}`, { status: 400 });
  }

  const {
    prompt: bodyPrompt,
    userMessage,
    systemPrompt,
    model,
    baseURL,
    apiKey: bodyApiKey,
    conversationId,
    options: bodyOptions = {},
  } = body;

  const effectiveAuthToken = bodyApiKey || AUTH_TOKEN;
  const effectiveBaseURL = sanitizeBaseURL(baseURL || BASE_URL);
  const effectiveModel = model || bodyOptions.model || DEFAULT_MODEL;
  const allowedTools =
    Array.isArray(bodyOptions.allowedTools) && bodyOptions.allowedTools.length > 0
      ? bodyOptions.allowedTools
      : ["Skill"];
  const settingSources = normalizeSettingSources(bodyOptions.settingSources) ?? DEFAULT_SETTING_SOURCES;
  const cwd = typeof bodyOptions.cwd === "string" ? bodyOptions.cwd : undefined;
  const permissionMode = "bypassPermissions";
  const includePartialMessages = bodyOptions.includePartialMessages !== false; // default true
  const extraArgs =
    bodyOptions.extraArgs && typeof bodyOptions.extraArgs === "object" && !Array.isArray(bodyOptions.extraArgs)
      ? bodyOptions.extraArgs
      : undefined;
  const mcpServers = normalizeMcpServers(bodyOptions.mcpServers);

  console.log("Request received", {
    hasUserMessage: Boolean(userMessage),
    hasPrompt: typeof bodyPrompt === "string",
    hasApiKey: Boolean(bodyApiKey || AUTH_TOKEN),
    baseURL: effectiveBaseURL,
    model: effectiveModel,
    resume: bodyOptions.resume || conversationId || undefined
  });

  if (!userMessage && typeof bodyPrompt !== "string") {
    return new Response("Missing userMessage (or provide a raw prompt)", { status: 400 });
  }
  if (!effectiveAuthToken) {
    return new Response("Missing ANTHROPIC_AUTH_TOKEN (either in env or request apiKey)", { status: 400 });
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  // The upstream (provider/proxy/model) may take >30s before emitting any stream events.
  const idleTimeoutMs = Number(process.env.AGENT_SDK_IDLE_TIMEOUT_MS || 180_000);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastEventAt = Date.now();
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const idleTimer = setInterval(() => {
        const idleFor = Date.now() - lastEventAt;
        if (idleFor >= idleTimeoutMs) {
          console.warn("Idle timeout waiting for upstream response", { idleTimeoutMs, idleFor });
          send({ type: "error", message: "Stream timed out waiting for upstream response." });
          abortController.abort();
          clearInterval(idleTimer);
          close();
        }
      }, 1_000);
      const cleanup = () => {
        clearInterval(idleTimer);
        req.signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        abortController.abort();
        cleanup();
        close();
      };
      req.signal.addEventListener("abort", onAbort, { once: true });

      const systemPromptOption = bodyOptions.systemPrompt ?? systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
      // We rely on `resume` for conversation history; each request should send only the current user message.
      // If callers want full control, they can pass a raw `prompt` string.
      const prompt = typeof bodyPrompt === "string" ? bodyPrompt : userMessage!;
      const queryOptions: Options = {
        abortController, // 用于在 HTTP 连接断开/超时后中止本次调用
        ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
        executable: "node", // 与测试脚本一致，使用 node 运行 Claude Code
        includePartialMessages, // 是否输出 partial stream events（本代理默认 true）
        // 尽量保持最小配置，让上游行为与本地测试一致
        permissionMode, // 权限模式：本代理固定 bypassPermissions（非交互）
        allowDangerouslySkipPermissions: true, // 强制跳过交互式权限确认，避免卡住
        allowedTools, // 默认只允许 Skill，可通过请求覆盖
        env: {
          ...process.env,
          ANTHROPIC_AUTH_TOKEN: effectiveAuthToken,
          ...(effectiveBaseURL
            ? {
                // Anthropic 兼容 Base URL（去掉 /v1 /v1/messages 尾巴后的结果）
                ANTHROPIC_BASE_URL: effectiveBaseURL,
              }
            : {}),
          // 模型相关 fallback：无论是否自定义 baseURL 都下发
          ANTHROPIC_MODEL: effectiveModel,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: effectiveModel,
          ANTHROPIC_DEFAULT_OPUS_MODEL: effectiveModel,
          ANTHROPIC_DEFAULT_SONNET_MODEL: effectiveModel
        },
        ...(cwd ? { cwd } : {}), // Claude Code 的工作目录（可选）
        ...(extraArgs ? { extraArgs } : {}), // 传给 Claude Code CLI 的额外参数（可选）
        persistSession: true, // 固定持久化会话到 ~/.claude（用于 resume）
        ...(conversationId ? { resume: conversationId } : {}), // 使用 conversationId 续聊（主要入口）
        ...(bodyOptions.resume ? { resume: bodyOptions.resume } : {}), // 兼容：直接传 options.resume
        ...(bodyOptions.resumeSessionAt ? { resumeSessionAt: bodyOptions.resumeSessionAt } : {}), // 从指定 checkpoint 恢复（可选）
        ...(bodyOptions.forkSession !== undefined ? { forkSession: bodyOptions.forkSession } : {}), // 是否在恢复时分叉新会话（可选）
        ...(bodyOptions.tools ? { tools: bodyOptions.tools } : {}), // 工具 preset/配置（可选）
        ...(systemPromptOption !== undefined ? { systemPrompt: systemPromptOption } : {}), // 系统提示词（可选；不传则不下发给 SDK）
        ...(mcpServers ? { mcpServers } : {}), // MCP servers 配置（可选）
      };

      // 打印精简后的 query options，env 仅保留关键字段并打码
      const { env, ...restQueryOptions } = queryOptions;
      const envForLog = env
        ? {
            ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
            ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? "[redacted]" : undefined,
            ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
            ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
            ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
          }
        : undefined;
      console.log("Query options:", { ...restQueryOptions, env: envForLog });
      console.log("Query prompt:", prompt);

      const queryStream = query({
        prompt,
        options: queryOptions,
      });

      (async () => {
        try {
          let seen = 0;
          for await (const msg of queryStream) {
            console.log("Stream event received", msg.type);
            if (seen === 0) {
              console.log("First stream event received");
            }
            seen += 1;
            lastEventAt = Date.now();
            send(msg);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error && err.stack ? err.stack : undefined;
          console.error("Stream error:", stack || message);
          send({ type: "error", message, ...(stack ? { stack } : {}) });
        } finally {
          cleanup();
          console.log("Stream ended");
          close();
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: Number(process.env.AGENT_SDK_HTTP_IDLE_TIMEOUT || 120),
  fetch(req: Request): Promise<Response> | Response {
    return handleRequest(req).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Server error:", message);
      return new Response("Internal error", { status: 500 });
    });
  },
});

console.log(`Agent SDK server listening on http://localhost:${server.port}/agent-sdk/stream`);
