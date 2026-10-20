// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const BC = require("../chat-core.js");

// ---------- minimal DOM stand-in ----------
function el() {
  return {
    children: [],
    classes: new Set(),
    textContent: "",
    value: "",
    disabled: false,
    listeners: {},
    classList: {
      add(...c) { c.forEach((x) => this._el.classes.add(x)); },
      _el: null
    },
    appendChild(c) { c.parentNode = this; this.children.push(c); },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    focus() {},
    scrollTop: 0,
    scrollHeight: 0
  };
}
function makeEl() {
  const e = el();
  e.classList._el = e;
  return e;
}
global.document = { createElement: makeEl };

function setup(replies, cfg = {}) {
  const calls = [];
  const log = {};
  const dom = { history: makeEl(), input: makeEl(), button: makeEl() };
  const fetch = (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const r = replies.shift();
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: r }) });
  };
  const chat = BC.createChat({
    cfg: Object.assign({ delay_ms_per_word: 0, max_messages: 3 }, cfg),
    vars: { topic: "Jordan is the GOAT", p_response: "He was dominant." },
    store: { set: (k, v) => { log[k] = v; } },
    dom,
    fetch
  });
  const bubbles = () => dom.history.children.map((c) => c.textContent);
  const say = (text) => { dom.input.value = text; return chat.send(); };
  return { chat, calls, log, dom, bubbles, say };
}

const good = (n) => JSON.stringify({
  acknowledge: "I see your point.",
  support: "Support " + n + ".",
  dissent: "Dissent " + n + ".",
  question: "Thoughts?"
});

// ---------- pure helpers ----------
test("parseBalancedReply accepts clean, fenced and prose-wrapped JSON", () => {
  const clean = BC.parseBalancedReply(good(1));
  assert.equal(clean.ok, true);
  assert.equal(clean.parts.support, "Support 1.");
  assert.equal(BC.parseBalancedReply("```json\n" + good(2) + "\n```").ok, true);
  assert.equal(BC.parseBalancedReply("Sure! " + good(3) + " Hope that helps").ok, true);
});

test("parseBalancedReply rejects non-JSON and replies missing support or dissent", () => {
  assert.equal(BC.parseBalancedReply("plain text").ok, false);
  assert.equal(BC.parseBalancedReply("{not json}").ok, false);
  assert.equal(BC.parseBalancedReply('{"acknowledge":"x","support":"y","dissent":""}').ok, false);
  assert.equal(BC.parseBalancedReply(undefined).ok, false);
});

test("renderReply puts points in the requested order with labels", () => {
  const parts = { acknowledge: "Ack.", support: "S.", dissent: "D.", question: "Q?" };
  assert.equal(BC.renderReply(parts, "support-first"),
    "Ack. One point in your favor: S. On the other hand: D. Q?");
  assert.equal(BC.renderReply(parts, "dissent-first"),
    "Ack. One point against your view: D. On the other hand: S. Q?");
  assert.equal(BC.renderReply(Object.assign({}, parts, { question: "" }), "support-first"),
    "Ack. One point in your favor: S. On the other hand: D.");
});

test("resolveOrder: fixed orders pass through, random uses the rng", () => {
  assert.equal(BC.resolveOrder("dissent-first"), "dissent-first");
  assert.equal(BC.resolveOrder("anything"), "support-first");
  assert.equal(BC.resolveOrder("random", () => 0.1), "support-first");
  assert.equal(BC.resolveOrder("random", () => 0.9), "dissent-first");
});

test("buildSystemPrompt fills placeholders but leaves JSON braces alone", () => {
  const sys = BC.buildSystemPrompt(BC.DEFAULTS, { topic: "T", p_response: "line1\nline2" });
  assert.match(sys, /topic "T"/);
  assert.match(sys, /"line1 line2"/);
  assert.match(sys, /under 50 words/);
  assert.match(sys, /\{"acknowledge":"","support":"","dissent":"","question":""\}/);
  assert.doesNotMatch(sys, /\{topic\}|\{p_response\}|\{word_limit\}/);
});

// ---------- conversation loop ----------
test("opening turn is a balanced reply and is logged as response_0", async () => {
  const t = setup([good(0)]);
  await t.chat.start();
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].history, []);
  assert.match(t.calls[0].prompt, /He was dominant\./);
  assert.equal(t.calls[0].model, "gpt-4.1-nano");
  assert.match(t.log.response_0, /One point in your favor: Support 0\./);
  assert.equal(t.log.support_0, "Support 0.");
  assert.equal(t.log.parse_ok_0, "1");
  assert.equal(t.dom.input.disabled, false);
});

test("full conversation: keys match the launched arms, history isn't duplicated, last message gets no API call", async () => {
  const t = setup([good(0), good(1), good(2)]);
  await t.chat.start();
  await t.say("first");
  await t.say("second");
  await t.say("third"); // max_messages = 3 -> closing, no call
  assert.equal(t.calls.length, 3);
  // Current message is sent only as `prompt`, not also at the end of `history`.
  assert.equal(t.calls[1].prompt, "first");
  assert.deepEqual(t.calls[1].history.map((m) => m.role), ["assistant"]);
  assert.deepEqual(t.calls[2].history.map((m) => m.role), ["assistant", "user", "assistant"]);
  assert.equal(t.log.msg_1, "first");
  assert.equal(t.log.msg_3, "third");
  assert.equal(t.log.dissent_2, "Dissent 2.");
  assert.equal(t.log.response_3, undefined);
  assert.equal(t.chat.state.done, true);
  assert.equal(t.dom.input.disabled, true);
  assert.equal(t.bubbles().at(-1), BC.DEFAULTS.closing_message);
});

test("network error: message doesn't count, input is restored and unlocked", async () => {
  const t = setup([good(0), new Error("boom"), good(1)]);
  await t.chat.start();
  await t.say("hello");
  assert.equal(t.chat.state.turn, 0);
  assert.equal(t.dom.input.value, "hello");
  assert.equal(t.dom.input.disabled, false);
  assert.equal(t.log.msg_1, undefined);
  assert.match(t.log.error_1, /boom/);
  assert.equal(t.bubbles().at(-1), BC.DEFAULTS.error_message);
  await t.chat.send(); // resend the restored text
  assert.equal(t.log.msg_1, "hello");
  assert.equal(t.chat.state.turn, 1);
});

test("unparseable reply is retried once, then shown raw with parse_ok 0", async () => {
  const t = setup([good(0), "no json", good(1), good(2), "still no", "nope"], { max_messages: 5 });
  await t.chat.start();
  await t.say("a"); // bad then good
  assert.equal(t.log.parse_ok_1, "1");
  assert.match(t.log.error_1, /retried/);
  await t.say("b"); // good
  await t.say("c"); // bad twice
  assert.equal(t.log.parse_ok_3, "0");
  assert.equal(t.log.response_3, "nope");
  assert.equal(t.calls.length, 6);
});

test("opening failure falls back to a neutral message and chat stays usable", async () => {
  const t = setup([new Error("down"), good(1)]);
  await t.chat.start();
  assert.equal(t.log.response_0, BC.DEFAULTS.opening_fallback);
  assert.match(t.log.error_0, /down/);
  await t.say("hi");
  assert.equal(t.log.msg_1, "hi");
});

test("sends are ignored while a reply is pending", async () => {
  const t = setup([good(0), good(1)]);
  await t.chat.start();
  const p = t.say("one");
  await t.say("two"); // busy -> ignored
  await p;
  assert.equal(t.calls.length, 2);
  assert.equal(t.log.msg_1, "one");
});

test("stop() discards a reply that arrives afterwards", async () => {
  const t = setup([good(0)]);
  const p = t.chat.start();
  t.chat.stop();
  await p;
  assert.deepEqual(t.bubbles(), ["typing…"]);
});
