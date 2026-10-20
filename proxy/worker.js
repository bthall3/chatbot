/*
 * Chat proxy for the study chatbots (Cloudflare Worker).
 *
 * Same contract as the proxy the launched Qualtrics arms use:
 *   POST /  { prompt, system, history, model, temperature, max_tokens, reasoning_effort? }
 *   ->      { text }            (or { error } with a non-2xx status)
 *
 * Handles newer reasoning models (gpt-5.x / gpt-6 / o-series): sends
 * reasoning_effort (default "none") and max_completion_tokens instead of max_tokens.
 * If OpenAI rejects a parameter, it retries once without it.
 *
 * Settings (Worker → Settings → Variables and Secrets):
 *   OPENAI_API_KEY   secret, required
 *   ALLOWED_ORIGINS  comma list; "*" wildcards allowed, e.g.
 *                    https://bthall3.github.io,https://*.qualtrics.com
 *   ALLOWED_MODELS   comma list, e.g. gpt-5.6-luna
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_ORIGINS = "https://bthall3.github.io,https://*.qualtrics.com,http://localhost:*";
const DEFAULT_MODELS = "gpt-5.6-luna";
const MAX_HISTORY = 40;
const MAX_CHARS = 4000;

function list(value, fallback) {
  return String(value || fallback).split(",").map((s) => s.trim()).filter(Boolean);
}

function originAllowed(origin, patterns) {
  return patterns.some((p) => {
    if (p === "*") return true;
    const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
    return re.test(origin);
  });
}

export function isReasoningModel(model) {
  return /^(gpt-5|gpt-6|o\d)/i.test(model);
}

function clip(s) {
  return String(s == null ? "" : s).slice(0, MAX_CHARS);
}

export function buildPayload(body) {
  const messages = [];
  if (body.system) messages.push({ role: "system", content: clip(body.system) });
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  for (const m of history) {
    if (m && (m.role === "user" || m.role === "assistant")) {
      messages.push({ role: m.role, content: clip(m.content) });
    }
  }
  messages.push({ role: "user", content: clip(body.prompt) });

  const payload = { model: body.model, messages };
  const maxTokens = parseInt(body.max_tokens, 10);
  const temperature = Number(body.temperature);
  if (isReasoningModel(body.model)) {
    const effort = body.reasoning_effort || "none";
    payload.reasoning_effort = effort;
    if (maxTokens > 0) payload.max_completion_tokens = maxTokens;
    // Sampling parameters are only accepted when reasoning is off.
    if (effort === "none" && Number.isFinite(temperature)) payload.temperature = temperature;
  } else {
    if (maxTokens > 0) payload.max_tokens = maxTokens;
    if (Number.isFinite(temperature)) payload.temperature = temperature;
  }
  return payload;
}

async function callOpenAI(payload, apiKey, fetchFn) {
  const res = await fetchFn(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function handle(request, env, fetchFn = fetch) {
  const origin = request.headers.get("Origin") || "";
  const okOrigin = originAllowed(origin, list(env.ALLOWED_ORIGINS, DEFAULT_ORIGINS));
  const cors = {
    "Access-Control-Allow-Origin": okOrigin ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  const reply = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (request.method === "OPTIONS") return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!okOrigin) return reply({ error: "Origin not allowed" }, 403);
  if (!env.OPENAI_API_KEY) return reply({ error: "Proxy is missing OPENAI_API_KEY" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return reply({ error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return reply({ error: "Missing prompt" }, 400);
  }
  if (!list(env.ALLOWED_MODELS, DEFAULT_MODELS).includes(body.model)) {
    return reply({ error: "Model not allowed: " + body.model }, 400);
  }

  const payload = buildPayload(body);
  let { res, data } = await callOpenAI(payload, env.OPENAI_API_KEY, fetchFn);

  // e.g. a model that rejects temperature: drop the named parameter and retry once.
  const param = data && data.error && data.error.param;
  if (res.status === 400 && param && param in payload && param !== "model" && param !== "messages") {
    delete payload[param];
    ({ res, data } = await callOpenAI(payload, env.OPENAI_API_KEY, fetchFn));
  }

  if (!res.ok) {
    const message = (data && data.error && data.error.message) || "OpenAI error " + res.status;
    return reply({ error: message }, 502);
  }
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content || ""
    : "";
  return reply({ text });
}

export default {
  fetch(request, env) {
    return handle(request, env);
  }
};
