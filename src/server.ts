// Minimal local Claude Agent SDK proxy server, now as a TypeScript module.
// Usage: npm run dev (watch) or npm run start (built output)
// - Listens on AGENT_SDK_PORT (default 20001)
// - Endpoint: POST /agent-sdk/stream
//   Body: { conversationId?, messageId?, userMessage?, history?, systemPrompt?, model?, baseURL?, apiKey?, prompt?, options? }
// - Response: SSE stream (raw Claude Agent SDK events)

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

function sanitizeBaseURL(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/v1\/messages\/?$/, "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

type Role = "user" | "assistant";

interface HistoryMessage {
  role: Role;
  content: string;
}

interface RequestOptions {
  allowedTools?: string[];
  settingSources?: string[];
  cwd?: string;
  permissionMode?: string;
  includePartialMessages?: boolean;
  disallowedTools?: string[];
  allowDangerouslySkipPermissions?: boolean;
  env?: Record<string, string>;
  extraArgs?: Record<string, string | null>;
  persistSession?: boolean;
  resume?: string;
  forkSession?: boolean;
  model?: string;
  tools?: string[] | { type: "preset"; preset: "claude_code" };
  systemPrompt?: string | { type: "preset"; preset: "claude_code"; append?: string };
  mcpServers?: Record<string, McpServerConfig>;
  resumeSessionAt?: string;
  betas?: string[];
}

interface RequestBody {
  prompt?: string;
  userMessage?: string;
  history?: HistoryMessage[];
  systemPrompt?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  conversationId?: string;
  options?: RequestOptions;
}

type SettingSource = "user" | "project" | "local";
type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
type BetaFlag = "context-1m-2025-08-07";

const DEFAULT_SETTING_SOURCES: SettingSource[] = ["user", "project"];
const ALLOWED_BETAS: BetaFlag[] = ["context-1m-2025-08-07"];

function normalizeSettingSources(input: unknown): SettingSource[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const valid = input.filter(
    (value): value is SettingSource =>
      value === "user" || value === "project" || value === "local"
  );
  return valid.length > 0 ? valid : undefined;
}

function normalizePermissionMode(input: unknown): PermissionMode | undefined {
  if (input === "default" || input === "acceptEdits" || input === "bypassPermissions" || input === "plan" || input === "dontAsk") {
    return input;
  }
  return undefined;
}

function normalizeBetas(input: unknown): BetaFlag[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const valid = input.filter((beta): beta is BetaFlag => ALLOWED_BETAS.includes(beta as BetaFlag));
  return valid.length > 0 ? valid : undefined;
}

function normalizeMcpServers(input: unknown): Record<string, McpServerConfig> | undefined {
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

const PORT = Number(process.env.AGENT_SDK_PORT || 20001);
// Optional: protect the endpoint with a bearer token
const AGENT_SDK_API_KEY = process.env.AGENT_SDK_API_KEY || "";

const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const BASE_URL = sanitizeBaseURL(process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_API_BASE_URL);
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "claude-3-5-sonnet-20241022";
const DEFAULT_SYSTEM_PROMPT =
  (process.env.ANTHROPIC_SYSTEM_PROMPT || "").trim() ||
  "You are a capable assistant agent. Be concise, accurate, and action-focused.";
const EXECUTABLE = "bun";

function buildPrompt({
  history = [],
  userMessage,
}: {
  history?: HistoryMessage[];
  userMessage?: string;
}): string {
  const histText = history
    .map((m) => `${m.role === "assistant" ? "助手" : "用户"}: ${m.content}`)
    .join("\n");
  return `${histText ? `${histText}\n` : ""}用户: ${userMessage}`;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== "/agent-sdk/stream") {
    return new Response("Not found", { status: 404 });
  }

  if (AGENT_SDK_API_KEY) {
    const auth = req.headers.get("authorization") || "";
    const expected = `Bearer ${AGENT_SDK_API_KEY}`;
    if (auth !== expected) {
      return new Response("Unauthorized", { status: 401 });
    }
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
    history = [],
    model,
    baseURL,
    apiKey: bodyApiKey,
    conversationId,
    options: bodyOptions = {},
  } = body;

  const effectiveApiKey = bodyApiKey || API_KEY;
  const effectiveBaseURL = sanitizeBaseURL(baseURL || BASE_URL);
  const effectiveModel = model || bodyOptions.model || DEFAULT_MODEL;
  const allowedTools =
    Array.isArray(bodyOptions.allowedTools) && bodyOptions.allowedTools.length > 0
      ? bodyOptions.allowedTools
      : ["Skill"];
  const settingSources = normalizeSettingSources(bodyOptions.settingSources) ?? DEFAULT_SETTING_SOURCES;
  const cwd = typeof bodyOptions.cwd === "string" ? bodyOptions.cwd : undefined;
  const permissionMode = normalizePermissionMode(bodyOptions.permissionMode) ?? "default";
  const includePartialMessages = bodyOptions.includePartialMessages !== false; // default true
  const extraArgs =
    bodyOptions.extraArgs && typeof bodyOptions.extraArgs === "object" && !Array.isArray(bodyOptions.extraArgs)
      ? bodyOptions.extraArgs
      : undefined;
  const betas = normalizeBetas(bodyOptions.betas);
  const mcpServers = normalizeMcpServers(bodyOptions.mcpServers);

  console.log("Request received", {
    hasUserMessage: Boolean(userMessage),
    hasPrompt: typeof bodyPrompt === "string",
    hasApiKey: Boolean(bodyApiKey || API_KEY),
    baseURL: effectiveBaseURL,
    model: effectiveModel,
  });

  if (!userMessage && typeof bodyPrompt !== "string") {
    return new Response("Missing userMessage (or provide a raw prompt)", { status: 400 });
  }
  if (!effectiveApiKey) {
    return new Response("Missing ANTHROPIC_API_KEY (either in env or request apiKey)", { status: 400 });
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
      const prompt =
        typeof bodyPrompt === "string"
          ? bodyPrompt
          : buildPrompt({ history, userMessage });
      const queryStream = query({
        prompt,
        options: {
          abortController,
          model: effectiveModel,
          executable: EXECUTABLE,
          includePartialMessages,
          settingSources,
          allowedTools,
          disallowedTools: bodyOptions.disallowedTools || ["Bash", "BashOutput", "KillBash"],
          permissionMode,
          allowDangerouslySkipPermissions: bodyOptions.allowDangerouslySkipPermissions || false,
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: effectiveApiKey,
            ...(effectiveBaseURL
              ? { ANTHROPIC_BASE_URL: effectiveBaseURL, ANTHROPIC_API_BASE_URL: effectiveBaseURL }
              : {}),
            ...(bodyOptions.env && typeof bodyOptions.env === "object" ? bodyOptions.env : {}),
          },
          ...(cwd ? { cwd } : {}),
          ...(extraArgs ? { extraArgs } : {}),
          persistSession: bodyOptions.persistSession ?? true,
          ...(conversationId ? { resume: conversationId } : {}),
          ...(bodyOptions.resume ? { resume: bodyOptions.resume } : {}),
          ...(bodyOptions.resumeSessionAt ? { resumeSessionAt: bodyOptions.resumeSessionAt } : {}),
          ...(bodyOptions.forkSession !== undefined ? { forkSession: bodyOptions.forkSession } : {}),
          ...(bodyOptions.tools ? { tools: bodyOptions.tools } : {}),
          ...(systemPromptOption !== undefined ? { systemPrompt: systemPromptOption } : {}),
          ...(mcpServers ? { mcpServers } : {}),
          ...(betas ? { betas } : {}),
        },
      });

      (async () => {
        try {
          let seen = 0;
          for await (const msg of queryStream) {
            if (seen === 0) {
              console.log("First stream event received");
            }
            seen += 1;
            lastEventAt = Date.now();
            send(msg);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("Stream error:", message);
          send({ type: "error", message });
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
