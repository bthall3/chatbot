// Run with: node --test "tests/*.test.*"
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

function setup(replies, cfg = {}, extra = {}) {
  const calls = [];
  const log = {};
  const dom = { history: makeEl(), input: makeEl(), button: makeEl() };
  const fetch = extra.fetch || ((url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const r = replies.shift();
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: r }) });
  });
  const chat = BC.createChat(Object.assign({
    cfg: Object.assign({ delay_ms_per_word: 0, max_messages: 3 }, cfg),
    vars: { topic: "Jordan is the GOAT", p_response: "He was dominant." },
    store: { set: (k, v) => { log[k] = v; } },
    dom,
    fetch
  }, extra));
  const bubbles = () => dom.history.children.map((c) => c.textContent);
  const say = (text) => { dom.input.value = text; return chat.send(); };
  return { chat, calls, log, dom, bubbles, say };
}

const words = (n, w = "word") => Array(n).fill(w).join(" ");
const turn = (message, extra = {}) => JSON.stringify(Object.assign({
  stance: "original", message, support: "for point", dissent: "against point"
}, extra));
const good = (n) => turn("Reply " + n + ", weaving in both sides.", {
  support: "support " + n, dissent: "dissent " + n
});

// ---------- parsing ----------
test("parseBalancedReply accepts clean, fenced and prose-wrapped JSON", () => {
  const clean = BC.parseBalancedReply(good(1));
  assert.equal(clean.ok, true);
  assert.equal(clean.parts.message, "Reply 1, weaving in both sides.");
  assert.equal(clean.parts.support, "support 1");
  assert.equal(BC.parseBalancedReply("```json\n" + good(2) + "\n```").ok, true);
  assert.equal(BC.parseBalancedReply("Sure! " + good(3) + " Hope that helps").ok, true);
});

test("a turn is balanced only with a message plus both woven-in points", () => {
  assert.equal(BC.parseBalancedReply("plain text").ok, false);
  assert.equal(BC.parseBalancedReply("{not json}").ok, false);
  assert.equal(BC.parseBalancedReply(undefined).ok, false);
  assert.equal(BC.parseBalancedReply('{"message":"hi","support":"a","dissent":""}').ok, false);
  assert.equal(BC.parseBalancedReply('{"message":"hi","support":"","dissent":"b"}').ok, false);
  assert.equal(BC.parseBalancedReply('{"message":"","support":"a","dissent":"b"}').ok, false);
});

test("stance is parsed and normalized; it is optional", () => {
  assert.equal(BC.parseBalancedReply(turn("m", { stance: "Shifted" })).parts.stance, "shifted");
  assert.equal(BC.parseBalancedReply(turn("m", { stance: "weird" })).parts.stance, "");
  const noStance = BC.parseBalancedReply('{"message":"m","support":"a","dissent":"b"}');
  assert.equal(noStance.ok, true);
  assert.equal(noStance.parts.stance, "");
  assert.equal(BC.hasShifted({ stance: "mixed" }), true);
  assert.equal(BC.hasShifted({ stance: "original" }), false);
});

// ---------- prompt ----------
test("prompt: conversational, balance woven into every message, follows shifts", () => {
  const sys = BC.buildSystemPrompt(BC.DEFAULTS, { topic: "T", p_response: "line1\nline2" });
  assert.match(sys, /topic "T"/);
  assert.match(sys, /"line1 line2"/);
  assert.match(sys, /conversation partner/);
  assert.match(sys, /In EVERY message, weave in/);
  assert.match(sys, /No lists, no labels/);
  assert.match(sys, /Follow the participant/);
  assert.match(sys, /about 12 words/); // {soft_words} at the 60-word limit
  assert.match(sys, /Never go over 60 words/);
  assert.match(sys, /never agree with, praise or grade/);
  assert.match(sys, /Don.t claim that "research shows"/);
  assert.match(sys, /usually 25-40 words/);
  assert.match(sys, /texting a classmate/);
  assert.match(sys, /Never treat the chat as an assignment/);
  assert.match(sys, /are NOT a shift/);
  assert.match(sys, /"makes sense"/);
  assert.match(sys, /\{"stance":"","message":"","support":"","dissent":""\}/);
  assert.doesNotMatch(sys, /\{(topic|p_response|word_limit|soft_words)\}/);
});

test("older saved prompts with removed placeholders still fill in", () => {
  const out = BC.fillTemplate("{ack_words}/{reply_words}/{point_words}/{question_words}", BC.wordBudgets({ word_limit: 50 }));
  assert.equal(out, "0/10/15/10");
});

test("the example messages in the prompt respect the default word limit", () => {
  const examples = BC.DEFAULT_PROMPT.split("\n").filter((l) => l.startsWith('{"stance"'));
  assert.equal(examples.length, 4);
  for (const ex of examples) {
    const p = BC.parseBalancedReply(ex);
    assert.equal(p.ok, true);
    assert.ok(BC.countWords(p.parts.message) <= BC.DEFAULTS.word_limit, p.parts.message);
  }
});

// ---------- conversation loop ----------
test("opening turn shows the model's message as-is and logs the woven points", async () => {
  const t = setup([good(0)]);
  await t.chat.start();
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].history, []);
  assert.match(t.calls[0].prompt, /He was dominant\./);
  assert.equal(t.calls[0].model, "gpt-5.6-luna");
  assert.equal(t.calls[0].reasoning_effort, "none");
  assert.equal(BC.DEFAULTS.proxy_url, "https://balanced-chat-proxy.bthall3.workers.dev/");
  assert.equal(t.log.response_0, "Reply 0, weaving in both sides.");
  assert.equal(t.bubbles().at(-1), "Reply 0, weaving in both sides.");
  assert.equal(t.log.support_0, "support 0");
  assert.equal(t.log.dissent_0, "dissent 0");
  assert.equal(t.log.stance_0, "original");
  assert.equal(t.log.parse_ok_0, "1");
  assert.equal(t.log.order_0, undefined);
  assert.equal(t.log.transition_0, undefined);
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
  assert.equal(t.calls[1].prompt, "first\n\n" + BC.DEFAULTS.question_hint); // 1 word -> low effort
  assert.equal(t.calls[2].history[1].content, "first"); // the hint never enters history
  assert.deepEqual(t.calls[1].history.map((m) => m.role), ["assistant"]);
  assert.deepEqual(t.calls[2].history.map((m) => m.role), ["assistant", "user", "assistant"]);
  // The model sees its own earlier JSON, so it keeps the format and can avoid repeats.
  assert.match(t.calls[2].history[0].content, /"message":"Reply 0/);
  assert.equal(t.log.msg_1, "first");
  assert.equal(t.log.msg_3, "third");
  assert.equal(t.log.dissent_2, "dissent 2");
  assert.equal(t.log.response_3, undefined);
  assert.equal(t.chat.state.done, true);
  assert.equal(t.dom.input.disabled, true);
  assert.equal(t.bubbles().at(-1), BC.DEFAULTS.closing_message);
});

test("a shifted stance is logged", async () => {
  const t = setup([good(0), turn("Building on your new view, with a gentle note.", { stance: "shifted" })]);
  await t.chat.start();
  await t.say("ok you're right");
  assert.equal(t.log.stance_1, "shifted");
  assert.equal(t.log.response_1, "Building on your new view, with a gentle note.");
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

test("unbalanced or unparseable reply is retried once, then shown raw with parse_ok 0", async () => {
  const missingDissent = JSON.stringify({ stance: "original", message: "only one side", support: "a", dissent: "" });
  const t = setup([good(0), missingDissent, good(1), good(2), "still no", "nope"], { max_messages: 5 });
  await t.chat.start();
  await t.say("a"); // missing dissent, then good
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

test("proxy { error } message is kept and reported via onRequestError", async () => {
  const reported = [];
  const t = setup([], {}, {
    fetch: () => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: "The model `x` does not exist" }) }),
    onRequestError: (n, msg) => reported.push([n, msg])
  });
  await t.chat.start();
  assert.equal(t.log.error_0, "HTTP 502: The model `x` does not exist");
  assert.deepEqual(reported, [[0, "HTTP 502: The model `x` does not exist"]]);
  assert.equal(t.log.response_0, BC.DEFAULTS.opening_fallback);
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

// ---------- word limit ----------
test("over the limit: asks once for a rewrite and uses the shorter message", async () => {
  const t = setup([turn(words(70)), turn(words(40))], { word_limit: 50 });
  await t.chat.start();
  assert.equal(t.calls.length, 2);
  assert.match(t.calls[1].prompt, /70 words; the limit is 50/);
  assert.equal(t.calls[1].history.length, 2); // original prompt + too-long reply
  assert.equal(t.log.words_0, "40");
  assert.match(t.log.error_0, /asked for rewrite/);
  assert.equal(t.chat.state.records[0].over_limit, 0);
});

test("still over after the rewrite: shows the shorter version and flags it", async () => {
  const t = setup([turn(words(70)), turn(words(60))], { word_limit: 50 });
  await t.chat.start();
  assert.equal(t.log.words_0, "60");
  assert.equal(t.chat.state.records[0].over_limit, 1);
  assert.match(t.log.error_0, /still over word limit after rewrite/);
  // a rewrite that comes back longer is ignored
  const t2 = setup([turn(words(60)), turn(words(80))], { word_limit: 50 });
  await t2.chat.start();
  assert.equal(t2.log.words_0, "60");
});

test("enforce_word_limit off: long replies pass through with no extra call", async () => {
  const t = setup([turn(words(70))], { enforce_word_limit: false });
  await t.chat.start();
  assert.equal(t.calls.length, 1);
  assert.equal(t.chat.state.records[0].over_limit, 1);
});

// ---------- question / statement endings ----------
test("endingHint: opening and even turns ask, odd turns don't, low effort always asks", () => {
  const cfg = BC.DEFAULTS;
  const long = "I think it depends a lot on the couple and how they communicate";
  assert.equal(BC.endingHint(cfg, 0, ""), cfg.question_hint);
  assert.equal(BC.endingHint(cfg, 1, long), cfg.statement_hint);
  assert.equal(BC.endingHint(cfg, 2, long), cfg.question_hint);
  assert.equal(BC.endingHint(cfg, 3, long), cfg.statement_hint);
  assert.equal(BC.endingHint(cfg, 3, "idk"), cfg.question_hint);
  assert.equal(BC.endingHint(cfg, 1, "idk, maybe it depends on them"), cfg.question_hint);
  assert.equal(BC.endingHint(Object.assign({}, cfg, { alternate_questions: false }), 0, ""), "");
});

test("isLowEffort: short or noncommittal, but not substantive messages that start with 'no'/'yeah'", () => {
  assert.equal(BC.isLowEffort("probably emergencies mostly"), true);
  assert.equal(BC.isLowEffort("kinda tired, just doing this for psych credit"), false);
  assert.equal(BC.isLowEffort("i guess it could go either way honestly"), true);
  assert.equal(BC.isLowEffort("No, I think couples who live together first learn a lot about each other"), false);
  assert.equal(BC.isLowEffort("Yeah but what about people who move in way too fast and regret it"), false);
});

test("the ending hint is sent with the request but never stored as the participant's words", async () => {
  const long = "I think it depends a lot on the couple and how they communicate";
  const t = setup([good(0), good(1), good(2)], { max_messages: 5 });
  await t.chat.start();
  assert.match(t.calls[0].prompt, /end with one short, easy question/);
  await t.say(long);
  assert.equal(t.calls[1].prompt, long + "\n\n" + BC.DEFAULTS.statement_hint);
  assert.equal(t.log.msg_1, long);
  await t.say("idk");
  assert.equal(t.calls[2].prompt, "idk\n\n" + BC.DEFAULTS.question_hint);
  assert.deepEqual(t.chat.state.history.filter((m) => m.role === "user").map((m) => m.content), [long, "idk"]);
});

test("alternate_questions off: prompts go through unchanged", async () => {
  const t = setup([good(0), good(1)], { alternate_questions: false });
  await t.chat.start();
  await t.say("hello there");
  assert.equal(t.calls[1].prompt, "hello there");
  assert.doesNotMatch(t.calls[0].prompt, /Instruction for this reply/);
});
