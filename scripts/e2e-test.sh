#!/usr/bin/env bash
set -euo pipefail

# End-to-end test for:
# - session creation (system.init.session_id)
# - resume via conversationId
# - persisted history matches both turns
# - best-effort: print assistant text from SSE
#
# Usage:
#   bash cc-agent-sdk/scripts/e2e-test.sh
# Optional:
#   AGENT_SDK_ENDPOINT=http://127.0.0.1:20001
#   AGENT_SDK_API_KEY=xxx
#   AGENT_SDK_TURN_TIMEOUT_S=120

ENDPOINT="${AGENT_SDK_ENDPOINT:-http://127.0.0.1:${AGENT_SDK_PORT:-20001}}"

AUTH_HEADER=()
if [[ -n "${AGENT_SDK_API_KEY:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${AGENT_SDK_API_KEY}")
fi

TURN_TIMEOUT_S="${AGENT_SDK_TURN_TIMEOUT_S:-120}"
HEAD_LINES="${AGENT_SDK_HEAD_LINES:-1200}"

tmp1="$(mktemp)"
tmp2="$(mktemp)"
history_body="$(mktemp)"
history_headers="$(mktemp)"
cleanup() { rm -f "$tmp1" "$tmp2" "$history_body" "$history_headers"; }
trap cleanup EXIT

TURN1_PROMPT="请记住代号 ALPHA-42，只回复 OK"
TURN2_PROMPT="我刚才让你记住的代号是什么？只回答代号本身。"

echo "E2E resume + history test"
echo "========================"
echo "endpoint: $ENDPOINT"
echo

echo "[1/4] turn1: create session"
if ! timeout "${TURN_TIMEOUT_S}s" bash -lc \
  "curl -sS -N \"$ENDPOINT/agent-sdk/stream\" ${AUTH_HEADER[*]:-} -H 'Content-Type: application/json' -d '{\"userMessage\":\"${TURN1_PROMPT}\"}' | head -n ${HEAD_LINES} > \"$tmp1\""; then
  echo "FAIL: turn1 did not finish within ${TURN_TIMEOUT_S}s"
  head -n 60 "$tmp1" || true
  exit 1
fi

CID="$(grep -o '\"session_id\":\"[^\"]*\"' "$tmp1" | head -n 1 | cut -d'"' -f4 || true)"
if [[ -z "${CID:-}" ]]; then
  echo "FAIL: did not capture session_id from SSE"
  head -n 60 "$tmp1" || true
  exit 1
fi
echo "session_id: $CID"

echo
echo "[2/4] turn2: resume session"
if ! timeout "${TURN_TIMEOUT_S}s" bash -lc \
  "curl -sS -N \"$ENDPOINT/agent-sdk/stream\" ${AUTH_HEADER[*]:-} -H 'Content-Type: application/json' -d '{\"conversationId\":\"${CID}\",\"userMessage\":\"${TURN2_PROMPT}\"}' | head -n ${HEAD_LINES} > \"$tmp2\""; then
  echo "FAIL: turn2 did not finish within ${TURN_TIMEOUT_S}s"
  head -n 60 "$tmp2" || true
  exit 1
fi

echo
echo "[3/4] fetch persisted history"
http_code="$(
  curl -sS -D "$history_headers" -o "$history_body" -w "%{http_code}" \
    "${AUTH_HEADER[@]}" \
    "$ENDPOINT/agent-sdk/history?conversationId=${CID}&limit=50" || true
)"
if [[ "$http_code" != "200" ]]; then
  echo "FAIL: history endpoint returned HTTP $http_code"
  head -n 40 "$history_headers" || true
  head -n 120 "$history_body" || true
  exit 1
fi

node - "$history_body" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
const input = fs.readFileSync(path, "utf8");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(input);
} catch {
  console.error("FAIL: history endpoint did not return JSON");
  console.error(input.slice(0, 400));
  process.exit(1);
}

if (!parsed || !Array.isArray(parsed.messages)) fail("missing messages[] in history response");

const all = parsed.messages.map((m) => `${m.role}:${m.content}`).join("\n");
if (!all.includes("ALPHA-42")) fail("history does not contain expected marker ALPHA-42");
if (!all.includes("请记住代号")) fail("history does not contain turn1 user prompt");
if (!all.includes("代号是什么")) fail("history does not contain turn2 user prompt");

console.log("PASS: history contains both prompts and ALPHA-42");
NODE

echo
echo "[4/4] assistant text (best-effort)"
extract_text() {
  node - "$1" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
const raw = fs.readFileSync(path, "utf8");

function parseSseDataLine(line) {
  const t = line.trim();
  if (!t.startsWith("data:")) return null;
  const payload = t.slice("data:".length).trim();
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

function extractFromMsg(msg) {
  if (!msg || typeof msg !== "object") return "";
  if (msg.type === "assistant" && msg.message && Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((b) => b && b.type === "text")
      .map((b) => String(b.text || ""))
      .join("");
  }
  if (msg.type === "stream_event" && msg.event && msg.event.type === "content_block_delta") {
    const d = msg.event.delta;
    if (d && d.type === "text_delta" && typeof d.text === "string") return d.text;
  }
  if (msg.type === "result" && typeof msg.result === "string") return msg.result;
  return "";
}

let out = "";
for (const line of raw.split(/\r?\n/)) {
  const msg = parseSseDataLine(line);
  if (!msg) continue;
  out += extractFromMsg(msg);
}
out = out.trim();
console.log(out || "(no assistant text extracted from SSE)");
NODE
}

echo "[turn1]"
extract_text "$tmp1"
echo
echo "[turn2]"
extract_text "$tmp2"

echo
echo "PASS: resume + history e2e test finished"
