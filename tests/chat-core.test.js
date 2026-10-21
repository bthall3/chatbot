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
  assert.equal(BC.parseBalancedReply('{"support":"y","dissent":""}').ok, false);
  assert.equal(BC.parseBalancedReply(undefined).ok, false);
});

test("renderReply: no labels, transition before the second point", () => {
  const parts = { support: "he won 6 titles.", dissent: "LeBron lasted longer.", question: "Q?" };
  assert.equal(BC.renderReply(parts, "support-first", "However,"),
    "He won 6 titles. However, LeBron lasted longer. Q?");
  assert.equal(BC.renderReply(parts, "dissent-first", "That said,"),
    "LeBron lasted longer. That said, he won 6 titles. Q?");
  assert.equal(BC.renderReply(Object.assign({}, parts, { question: "" }), "support-first", "Still,"),
    "He won 6 titles. Still, LeBron lasted longer.");
});

test("renderReply puts the direct reply first, before either point", () => {
  const parts = { reply: "he did, he went 4-6.", support: "s.", dissent: "d.", question: "Q?" };
  assert.equal(BC.renderReply(parts, "support-first", "But"), "He did, he went 4-6. S. But d. Q?");
  assert.equal(BC.renderReply(parts, "dissent-first", "But"), "He did, he went 4-6. D. But s. Q?");
});

test("reply is parsed but optional, and logged as reply_N", async () => {
  assert.equal(BC.parseBalancedReply('{"reply":" Yes. ","support":"a","dissent":"b"}').parts.reply, "Yes.");
  assert.equal(BC.parseBalancedReply('{"support":"a","dissent":"b"}').ok, true);
  const t = setup([JSON.stringify({ reply: "Fair question.", support: "s.", dissent: "d.", question: "" })]);
  await t.chat.start();
  assert.equal(t.log.reply_0, "Fair question.");
  assert.match(t.log.response_0, /^Fair question\. S\./);
});

test("prompt asks for a direct, specific reply and bans stock openers", () => {
  const sys = BC.buildSystemPrompt(BC.DEFAULTS, { topic: "T", p_response: "R" });
  assert.match(sys, /If they asked a question, answer it/);
  assert.match(sys, /Never start with "I see"/);
  assert.match(sys, /builds on what they just said/);
});

test("renderReply lowercases common words after a transition but keeps proper nouns and acronyms", () => {
  const mk = (dissent) => BC.renderReply({ support: "x.", dissent, question: "" }, "support-first", "Yet");
  assert.equal(mk("Many couples disagree."), "X. Yet many couples disagree.");
  assert.equal(mk("Research shows otherwise."), "X. Yet research shows otherwise.");
  assert.equal(mk("Pew surveys say otherwise."), "X. Yet Pew surveys say otherwise.");
  assert.equal(mk("I would add this."), "X. Yet I would add this.");
  assert.equal(mk("US data differ."), "X. Yet US data differ.");
});

test("pickTransition never repeats the previous phrase", () => {
  const list = BC.parseTransitions("However,\nThat said,\n\n  Still,  ");
  assert.deepEqual(list, ["However,", "That said,", "Still,"]);
  for (let i = 0; i < 50; i++) assert.notEqual(BC.pickTransition(list, "However,"), "However,");
  assert.equal(BC.pickTransition(["Only,"], "Only,"), "Only,");
  assert.equal(BC.pickTransition([], ""), "");
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
  assert.match(sys, /\{"stance":"","reply":"","support":"","dissent":"","question":""\}/);
  assert.doesNotMatch(sys, /acknowledge:/);
  assert.doesNotMatch(sys, /\{topic\}|\{p_response\}|\{word_limit\}/);
});

// ---------- conversation loop ----------
test("opening turn is a balanced reply and is logged as response_0", async () => {
  const t = setup([good(0)]);
  await t.chat.start();
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].history, []);
  assert.match(t.calls[0].prompt, /He was dominant\./);
  assert.equal(t.calls[0].model, "gpt-5.6-luna");
  assert.equal(t.calls[0].reasoning_effort, "none");
  assert.equal(BC.DEFAULTS.proxy_url, "https://balanced-chat-proxy.bthall3.workers.dev/");
  assert.match(t.log.response_0, /^Support 0\. \S.* Dissent 0\. Thoughts\?$/);
  assert.ok(BC.parseTransitions(BC.DEFAULTS.transitions).some((x) => t.log.response_0.includes(x + " ")));
  assert.ok(t.log.transition_0);
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

// ---------- word limit ----------
const words = (n, w = "word") => Array(n).fill(w).join(" ");
const reply = (ack, sup, dis, q) => JSON.stringify({
  acknowledge: words(ack, "ack"), support: words(sup, "sup"), dissent: words(dis, "dis"), question: words(q, "q")
});

test("wordBudgets split the limit across parts, leaving room for the transition", () => {
  const b = BC.wordBudgets(BC.DEFAULTS);
  // longest default transition ("On the other hand,") is 4 words
  assert.deepEqual(b, {
    word_limit: 50, ack_words: 0, reply_words: 9, question_words: 9, point_words: 14, soft_words: 7
  });
  assert.ok(b.reply_words + 2 * b.point_words + b.question_words + 4 <= 50);
  const sys = BC.buildSystemPrompt(BC.DEFAULTS, { topic: "T", p_response: "R" });
  assert.doesNotMatch(sys, /\{(ack|reply|point|soft|question)_words\}/);
  assert.match(sys, /reply at most 9, support at most 14/);
});

test("over-limit reply: asks once for a rewrite and uses the shorter one", async () => {
  const t = setup([reply(10, 25, 25, 10), reply(5, 10, 10, 5)], { word_limit: 50 });
  await t.chat.start();
  assert.equal(t.calls.length, 2);
  assert.match(t.calls[1].prompt, /limit is 50/);
  assert.equal(t.calls[1].history.length, 2); // original prompt + too-long reply
  assert.ok(Number(t.log.words_0) <= 50);
  assert.match(t.log.error_0, /asked for rewrite/);
});

test("still over after rewrite: drops the question, never the points", async () => {
  const t = setup([reply(0, 20, 20, 10), reply(0, 20, 20, 10)], { word_limit: 50 });
  await t.chat.start();
  const r = t.chat.state.records[0];
  assert.equal(r.parts.question, "");
  assert.equal(r.parts.support, words(20, "sup"));
  assert.equal(r.parts.dissent, words(20, "dis"));
  assert.ok(r.words <= 50);
  assert.match(t.log.error_0, /trimmed/);
});

test("still over after dropping the question: drops the direct reply too, never the points", async () => {
  const long = JSON.stringify({
    reply: words(8, "rep"), support: words(20, "sup"), dissent: words(20, "dis"), question: words(10, "q")
  });
  const t = setup([long, long], { word_limit: 50 });
  await t.chat.start();
  const r = t.chat.state.records[0];
  assert.equal(r.parts.question, "");
  assert.equal(r.parts.reply, "");
  assert.equal(r.parts.support, words(20, "sup"));
  assert.equal(r.parts.dissent, words(20, "dis"));
  assert.ok(r.words <= 50);
  // a reply that fits once the question is gone is kept
  const fits = JSON.stringify({
    reply: words(4, "rep"), support: words(20, "sup"), dissent: words(20, "dis"), question: words(10, "q")
  });
  const t2 = setup([fits, fits], { word_limit: 50 });
  await t2.chat.start();
  assert.equal(t2.chat.state.records[0].parts.question, "");
  assert.equal(t2.chat.state.records[0].parts.reply, words(4, "rep"));
});

test("an acknowledgment the model adds anyway is not shown or counted", async () => {
  const t = setup([reply(8, 5, 5, 3)]);
  await t.chat.start();
  assert.doesNotMatch(t.log.response_0, /ack/);
  assert.equal(t.chat.state.records[0].parts.acknowledge, undefined);
});

test("enforce_word_limit off: long replies pass through with no extra call", async () => {
  const t = setup([reply(10, 25, 25, 10)], { enforce_word_limit: false });
  await t.chat.start();
  assert.equal(t.calls.length, 1);
  assert.equal(t.chat.state.records[0].over_limit, 1);
});

test("proxy { error } message is kept and reported via onRequestError", async () => {
  const log = {};
  const reported = [];
  const dom = { history: makeEl(), input: makeEl(), button: makeEl() };
  const chat = BC.createChat({
    cfg: { delay_ms_per_word: 0 },
    vars: { topic: "T", p_response: "R" },
    store: { set: (k, v) => { log[k] = v; } },
    dom,
    fetch: () => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: "The model `x` does not exist" }) }),
    onRequestError: (turn, msg) => reported.push([turn, msg])
  });
  await chat.start();
  assert.equal(log.error_0, "HTTP 502: The model `x` does not exist");
  assert.deepEqual(reported, [[0, "HTTP 502: The model `x` does not exist"]]);
  assert.equal(log.response_0, BC.DEFAULTS.opening_fallback);
});

// ---------- following a participant who shifts ----------
test("stance is parsed and normalized; it is optional", () => {
  assert.equal(BC.parseBalancedReply('{"stance":"Shifted","support":"a","dissent":"b"}').parts.stance, "shifted");
  assert.equal(BC.parseBalancedReply('{"stance":"weird","support":"a","dissent":"b"}').parts.stance, "");
  const noStance = BC.parseBalancedReply('{"support":"a","dissent":"b"}');
  assert.equal(noStance.ok, true);
  assert.equal(noStance.parts.stance, "");
  assert.equal(BC.hasShifted({ stance: "mixed" }), true);
  assert.equal(BC.hasShifted({ stance: "original" }), false);
});

test("prompt tells the bot to follow a shift and fills the soft counterpoint budget", () => {
  const sys = BC.buildSystemPrompt(BC.DEFAULTS, { topic: "T", p_response: "R" });
  assert.match(sys, /Follow the participant/);
  assert.match(sys, /at most 7 words\)/);
  assert.doesNotMatch(sys, /\{soft_words\}/);
  assert.equal(BC.wordBudgets(BC.DEFAULTS).soft_words, 7);
});

test("after a shift, the new-leaning point comes first even when order is dissent-first; stance is logged", async () => {
  const shifted = JSON.stringify({ stance: "shifted", support: "new side point.", dissent: "old side note.", question: "" });
  const original = JSON.stringify({ stance: "original", support: "for you.", dissent: "against you.", question: "" });
  const t = setup([original, shifted], { order: "dissent-first" });
  await t.chat.start();
  await t.say("ok you're right");
  assert.equal(t.log.stance_0, "original");
  assert.equal(t.log.order_0, "dissent-first");
  assert.match(t.log.response_0, /^Against you\./);
  assert.equal(t.log.stance_1, "shifted");
  assert.equal(t.log.order_1, "support-first");
  assert.match(t.log.response_1, /^New side point\. \S.* old side note\.$/);
});

test("trimming keeps the stance", () => {
  const out = BC.trimToLimit({ stance: "shifted", support: "a b c", dissent: "d e f", question: "g h i j" }, 7, 0);
  assert.equal(out.stance, "shifted");
  assert.equal(out.question, "");
});
