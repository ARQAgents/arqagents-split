/**
 * ════════════════════════════════════════════════════════════════════════
 *  SPLIT — AI Running Coach Worker (Cloudflare)
 * ════════════════════════════════════════════════════════════════════════
 *
 *  Hosts the secure backend for Split (the training-plan generator).
 *  Lives at: api.arqagents.com/coach   (or split.arqagents.com/api/coach)
 *
 *  RESPONSIBILITIES
 *  1. Hold the Anthropic API key as a secret (browser never sees it)
 *  2. Forward chat requests to Claude with web_search tool enabled
 *  3. Enforce a 3-plan-per-day quota PER IP via Cloudflare KV
 *  4. Return X-Quota-Remaining header so the UI can update
 *
 *  ┌────────────────────┐    ┌─────────────────────┐    ┌──────────────┐
 *  │ split.arqagents.com│───▶│ Cloudflare Worker   │───▶│ Claude API   │
 *  │ (browser)          │◀───│ + KV quota tracker  │◀───│              │
 *  └────────────────────┘    └─────────────────────┘    └──────────────┘
 *
 *  DEPLOY: see DEPLOY_GUIDE.md
 * ════════════════════════════════════════════════════════════════════════
 */

// ─── CONFIG ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://split.arqagents.com",
  "https://arqagents-split.pages.dev",          // backup .pages.dev URL
  "https://arqagents.com",                       // homepage links here
  "https://www.arqagents.com",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://localhost:8080",
];

const DAILY_LIMIT     = 3;     // 3 plans per IP per day
const MAX_TOKENS_CAP  = 1500;  // generous cap for the coach JSON
const MAX_MESSAGES    = 5;     // single-shot prompt → ≤5 messages
const ALLOWED_MODELS  = new Set([
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
]);
const DEFAULT_MODEL   = "claude-sonnet-4-20250514";

// ─── HELPERS ────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Quota-Remaining",
    "Access-Control-Max-Age":       "86400",
    "Vary":                         "Origin",
  };
}

function json(body, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", ...extraHeaders },
  });
}

function todayKey(ip) {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  return `quota:${ymd}:${ip}`;
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const url    = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Health check
    if (url.pathname === "/health" || url.pathname === "/") {
      return json({ status: "ok", service: "Split AI Coach Worker", time: new Date().toISOString() }, 200, origin);
    }

    // Accept both /api/coach and /coach
    if (!["/api/coach", "/coach"].includes(url.pathname)) {
      return json({ error: "Not found. Use POST /api/coach" }, 404, origin);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405, origin);
    }

    // Validate origin (extra security beyond CORS)
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: "Origin not allowed." }, 403, origin);
    }

    // Get API key from Worker secrets
    const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "Server not configured (missing API key)." }, 500, origin);
    }

    // ─── QUOTA CHECK ────────────────────────────────────────────────────
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const qkey = todayKey(ip);

    let usedToday = 0;
    if (env.QUOTA_KV) {
      const v = await env.QUOTA_KV.get(qkey);
      usedToday = v ? parseInt(v, 10) || 0 : 0;
    } else {
      // KV not bound — fall back to allowing but log warning
      console.warn("QUOTA_KV not bound — quota disabled");
    }

    const remaining = Math.max(0, DAILY_LIMIT - usedToday);
    if (env.QUOTA_KV && usedToday >= DAILY_LIMIT) {
      return json(
        { error: "Daily limit reached. You've generated 3 plans today. Try again tomorrow!" },
        429, origin,
        { "X-Quota-Remaining": "0" }
      );
    }

    // ─── PARSE & VALIDATE BODY ──────────────────────────────────────────
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON body." }, 400, origin); }

    const { model, max_tokens, messages, tools } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "A non-empty 'messages' array is required." }, 400, origin);
    }
    if (messages.length > MAX_MESSAGES) {
      return json({ error: `Too many messages (max ${MAX_MESSAGES}).` }, 400, origin);
    }
    for (const m of messages) {
      if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
        return json({ error: "Each message needs role 'user'|'assistant' and string content." }, 400, origin);
      }
    }

    const safeModel  = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
    const safeTokens = Math.min(Number(max_tokens) || 1000, MAX_TOKENS_CAP);

    // Build Anthropic payload — pass through tools if they're web_search
    const payload = {
      model:      safeModel,
      max_tokens: safeTokens,
      messages,
    };
    if (Array.isArray(tools) && tools.length) {
      // Only allow web_search tool, drop anything else
      const safeTools = tools.filter(t => t && t.type && /^web_search/.test(t.type));
      if (safeTools.length) payload.tools = safeTools;
    }

    // ─── CALL CLAUDE API ────────────────────────────────────────────────
    let claudeRes;
    try {
      claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("Upstream error:", err);
      return json({ error: "Failed to reach Anthropic API.", detail: String(err) }, 502, origin);
    }

    // ─── ON SUCCESS, INCREMENT QUOTA ────────────────────────────────────
    let newRemaining = remaining;
    if (claudeRes.ok && env.QUOTA_KV) {
      const newCount = usedToday + 1;
      // KV expires at end of UTC day (~24h max)
      const secondsLeftInDay = Math.max(60, 86400 - Math.floor((Date.now() / 1000) % 86400));
      await env.QUOTA_KV.put(qkey, String(newCount), { expirationTtl: secondsLeftInDay });
      newRemaining = Math.max(0, DAILY_LIMIT - newCount);
    }

    const claudeData = await claudeRes.json();
    return json(claudeData, claudeRes.status, origin, {
      "X-Quota-Remaining": String(newRemaining),
    });
  },
};
