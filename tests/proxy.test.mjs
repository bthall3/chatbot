// Run with: node --test "tests/*.test.*"
import test from "node:test";
import assert from "node:assert/strict";
import { handle, buildPayload, isReasoningModel } from "../proxy/worker.js";

const env = { OPENAI_API_KEY: "sk-test" };

function req(body, origin = "https://bthall3.github.io", method = "POST") {
  return new Request("https://proxy.example/", {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

const base = {
  prompt: "hi",
  system: "sys",
  history: [{ role: "assistant", content: "hello" }, { role: "system", content: "injected" }],
  model: "gpt-5.6-luna",
  temperature: 0.5,
  max_tokens: 200
};

function fakeOpenAI(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const [status, data] = responses.shift();
    return new Response(JSON.stringify(data), { status });
  };
  return { fn, calls };
}

const ok = [200, { choices: [{ message: { content: '{"support":"s"}' } }] }];

test("reasoning models get reasoning_effort none, max_completion_tokens and temperature", () => {
  const p = buildPayload(base);
  assert.equal(p.reasoning_effort, "none");
  assert.equal(p.max_completion_tokens, 200);
  assert.equal(p.max_tokens, undefined);
  assert.equal(p.temperature, 0.5);
  // history: system-role entries from the client are dropped
  assert.deepEqual(p.messages.map((m) => m.role), ["system", "assistant", "user"]);
});

test("temperature is not sent when reasoning is on; older models keep max_tokens", () => {
  assert.equal(buildPayload({ ...base, reasoning_effort: "low" }).temperature, undefined);
  const old = buildPayload({ ...base, model: "gpt-4.1-nano" });
  assert.equal(old.max_tokens, 200);
  assert.equal(old.reasoning_effort, undefined);
  assert.equal(isReasoningModel("o4-mini"), true);
  assert.equal(isReasoningModel("gpt-4o-mini"), false);
});

test("returns { text } for an allowed origin and model, with CORS header", async () => {
  const o = fakeOpenAI([ok]);
  const res = await handle(req(base), env, o.fn);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: '{"support":"s"}' });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://bthall3.github.io");
});

test("Qualtrics subdomains and localhost are allowed by default; others are not", async () => {
  for (const origin of ["https://ua.co1.qualtrics.com", "http://localhost:8765"]) {
    const res = await handle(req(base, origin), env, fakeOpenAI([ok]).fn);
    assert.equal(res.status, 200, origin);
  }
  const bad = await handle(req(base, "https://evil.example"), env, fakeOpenAI([ok]).fn);
  assert.equal(bad.status, 403);
});

test("preflight succeeds for allowed origins", async () => {
  const res = await handle(req(null, "https://bthall3.github.io", "OPTIONS"), env);
  assert.equal(res.status, 204);
  assert.match(res.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
});

test("rejects models outside the allow-list and missing prompts", async () => {
  const r1 = await handle(req({ ...base, model: "gpt-6-sol" }), env, fakeOpenAI([]).fn);
  assert.equal(r1.status, 400);
  const r2 = await handle(req({ ...base, prompt: " " }), env, fakeOpenAI([]).fn);
  assert.equal(r2.status, 400);
});

test("retries once without a parameter OpenAI rejects", async () => {
  const o = fakeOpenAI([
    [400, { error: { message: "Unsupported parameter: 'temperature'", param: "temperature" } }],
    ok
  ]);
  const res = await handle(req(base), env, o.fn);
  assert.equal(res.status, 200);
  assert.equal(o.calls.length, 2);
  assert.equal("temperature" in o.calls[0], true);
  assert.equal("temperature" in o.calls[1], false);
});

test("OpenAI errors come back as { error } with status 502", async () => {
  const o = fakeOpenAI([[500, { error: { message: "server down" } }]]);
  const res = await handle(req(base), env, o.fn);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "server down" });
});
