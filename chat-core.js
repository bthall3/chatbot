/*
 * Balanced ("even-handed") chatbot engine.
 *
 * The bot is a conversation partner first: the model writes each reply as a
 * natural message, and weaves into it ONE point that supports the participant's
 * current leaning and ONE that challenges it. The model also reports those two
 * points separately (JSON), so every turn's balance can be checked and logged.
 *
 * No imports and no build step: this file can be pasted verbatim at the top of a
 * Qualtrics question's JavaScript (see qualtrics/README.md). It is also loaded by
 * the standalone test page (index.html) and by the Node tests.
 */
var BalancedChat = (function () {
  "use strict";

  // One shared prompt for all bots (the researcher's wording, no examples). Only
  // {condition_rules} differs between the balanced, congenial and uncongenial
  // conditions. Question endings, the side reminder and the "idk" stance rule
  // are handled in code (withHint, recordTurn).
  var DEFAULT_PROMPT = [
    'You\'re chatting with someone who believes "{topic}". Why, in their words: "{p_response}".',
    "Talk like a friendly person texting: casual, 2-3 short sentences (25-40 words, never over {word_limit}). Reply directly to what they just said and keep it about the topic.",
    "Don't open by agreeing with or praising them (\"exactly\", \"totally\", \"great point\").",
    "Don't repeat a point or a question you've already used.",
    "If they're brief or uninterested, keep it short and casual; never treat the chat like an assignment.",
    "{condition_rules}"
  ].join("\n");

  // Always appended after the prompt: the code needs this reply format to show the
  // message and log stance/support/dissent. Not part of the editable prompt.
  var FORMAT_INSTRUCTIONS = [
    'Reply ONLY with JSON: {"stance":"","message":"","support":"","dissent":""}',
    'stance: "original", "shifted" (now leaning the other way) or "mixed". message: what they\'ll read. support / dissent: a few words naming the point you made for / against their view (leave one empty if there\'s none).'
  ].join("\n");

  // The only part of the prompt that differs between conditions.
  var CONDITIONS = {
    balanced: {
      rules: [
        "Be even-handed in the way you discuss the topic. In every message, naturally work in one point for the view they lean toward now and one point against it.",
        "If they move toward the other side, continue to be even-handed: back their new view and also suggest backing for the alternative side."
      ].join("\n"),
      examples: "",
      rewrite: "keeping one point for and one against"
    },
    congenial: {
      rules: "In every message, naturally work in one point that supports their view. You can briefly acknowledge the other side, but every message should land in support of their view.",
      examples: "",
      rewrite: "keeping the point that supports their view"
    },
    uncongenial: {
      rules: "In every message, naturally work in one point that challenges their view. You can briefly acknowledge what they said, but every message should land against their view.",
      examples: "",
      rewrite: "keeping the point that challenges their view"
    }
  };

  function conditionOf(cfg) {
    return CONDITIONS[cfg && cfg.condition] ? cfg.condition : "balanced";
  }

  var DEFAULT_OPENING_PROMPT =
    'Here is what the participant wrote about why they hold their view: "{p_response}". ' +
    "Start the conversation by reacting to it, in the JSON format.";

  var DEFAULTS = {
    proxy_url: "https://balanced-chat-proxy.bthall3.workers.dev/",
    model: "gpt-5.6-luna",
    reasoning_effort: "none", // reasoning models: "none" keeps replies fast and allows temperature
    temperature: 0.5,
    max_tokens: 300,
    word_limit: 60,
    max_messages: 5,
    // "balanced" (for + against their current leaning) | "congenial" (supports their
    // original view) | "uncongenial" (challenges their original view)
    condition: "balanced",
    delay_ms_per_word: 200,
    max_delay_ms: 8000,
    request_timeout_ms: 20000,
    prompt_template: DEFAULT_PROMPT,
    opening_template: DEFAULT_OPENING_PROMPT,
    // If a message is over word_limit, ask the model once for a shorter rewrite;
    // if it is still too long it is shown anyway and flagged (over_limit).
    enforce_word_limit: true,
    // The code decides whether each reply ends with a question (the model, left to
    // itself, either always or never asks one): the opening and even turns ask,
    // odd turns end on a statement, and a low-effort participant message always
    // gets an easy question. The hint goes to the model only, not into history.
    alternate_questions: true,
    question_hint: "(For this reply: end with one short, easy question about the topic in general, not about their own life or routine, and different from any question you've asked so far.)",
    statement_hint: "(For this reply: end on a statement, not a question.)",
    // Directional bots drift toward the middle late in a chat, so every request
    // repeats which side to land on (sent with the request only, like the hints above).
    side_hint_congenial: "(Your point should land in support of their original view: \"{topic}\".)",
    side_hint_uncongenial: "(Your point should land against their original view: \"{topic}\".)",
    // Directional bots only: a second, quick model call grades each message as
    // FOR / AGAINST / NEITHER the original view while it is being shown. If it
    // landed on the wrong side, the next request swaps the side reminder for this
    // correction ({drift} says how the last message came across).
    direction_check: true,
    direction_fix_hint_congenial: "(Your last message came across as {drift}. Make sure this one lands in support of their original view: \"{topic}\".)",
    direction_fix_hint_uncongenial: "(Your last message came across as {drift}. Make sure this one lands against their original view: \"{topic}\".)",
    closing_message: "Thank you for the conversation! We will now move on to the next part of the study.",
    error_message: "Sorry, something went wrong. Please send your message again.",
    opening_fallback: "Thanks for sharing your view. What would you like to discuss about this topic?"
  };

  // Only known placeholders are filled, so JSON braces in the template are left alone.
  // ack/reply/point/question_words are kept so older saved prompts still fill in.
  function fillTemplate(template, vars) {
    return String(template).replace(/\{(topic|p_response|drift|word_limit|ack_words|reply_words|point_words|soft_words|question_words)\}/g, function (m, key) {
      var v = vars[key];
      return v === undefined || v === null ? "" : String(v).replace(/[\r\n]+/g, " ").trim();
    });
  }

  // Legacy placeholders for older custom prompts (e.g. {soft_words}).
  function wordBudgets(cfg) {
    var limit = parseInt(cfg.word_limit, 10) || 50;
    return {
      word_limit: limit,
      soft_words: Math.max(Math.floor(limit * 0.2), 5),
      ack_words: 0,
      reply_words: Math.floor(limit * 0.2),
      point_words: Math.floor(limit * 0.3),
      question_words: Math.floor(limit * 0.2)
    };
  }

  function templateVars(cfg, vars) {
    var b = wordBudgets(cfg);
    b.topic = vars.topic;
    b.p_response = vars.p_response;
    return b;
  }

  // Drop the condition's rules and examples into the shared template, then fill
  // the remaining placeholders (the rules themselves use {soft_words}).
  function applyCondition(template, cfg) {
    var c = CONDITIONS[conditionOf(cfg)];
    return String(template)
      .replace("{condition_rules}", function () { return c.rules; })
      .replace("{examples}", function () { return c.examples; });
  }

  function buildSystemPrompt(cfg, vars) {
    var prompt = fillTemplate(applyCondition(cfg.prompt_template, cfg), templateVars(cfg, vars)).trim();
    return prompt + "\n\n" + FORMAT_INSTRUCTIONS;
  }

  function buildOpeningPrompt(cfg, vars) {
    return fillTemplate(cfg.opening_template, templateVars(cfg, vars));
  }

  // Same body shape the launched Qualtrics arms send to the proxy, plus reasoning_effort.
  function buildRequest(cfg, system, history, prompt) {
    return {
      prompt: prompt,
      system: system,
      history: history,
      model: cfg.model,
      temperature: Number(cfg.temperature),
      max_tokens: parseInt(cfg.max_tokens, 10),
      reasoning_effort: cfg.reasoning_effort
    };
  }

  function asText(v) {
    return typeof v === "string" ? v.trim() : "";
  }

  var STANCES = ["original", "shifted", "mixed"];

  // Has the participant moved toward the other side? Then the bot follows them.
  function hasShifted(parts) {
    return !!parts && (parts.stance === "shifted" || parts.stance === "mixed");
  }

  // Accepts clean JSON, ```json fenced``` JSON, or JSON surrounded by prose.
  // What a valid turn must contain depends on the condition: balanced needs both
  // considerations; congenial needs one supporting, uncongenial one challenging
  // the participant's original view.
  function parseBalancedReply(text, condition) {
    var raw = typeof text === "string" ? text : "";
    var start = raw.indexOf("{");
    var end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return { ok: false, parts: null, raw: raw };
    var obj;
    var body = raw.slice(start, end + 1);
    try {
      obj = JSON.parse(body);
    } catch (e) {
      // The model sometimes closes with a stray comma or quote: ..."dissent":"x","}
      try {
        obj = JSON.parse(body.replace(/,\s*"?\s*\}$/, "}"));
      } catch (e2) {
        return { ok: false, parts: null, raw: raw };
      }
    }
    var stance = asText(obj.stance).toLowerCase();
    var parts = {
      stance: STANCES.indexOf(stance) !== -1 ? stance : "",
      message: asText(obj.message),
      support: asText(obj.support),
      dissent: asText(obj.dissent)
    };
    // A turn counts as balanced only if the model wrote a message and reports
    // both a supporting and a challenging consideration woven into it.
    var cond = CONDITIONS[condition] ? condition : "balanced";
    // Directional bots may briefly acknowledge the other side (it can show up in
    // the other field); what matters is that their own consideration is there.
    var ok = !!parts.message && (
      cond === "congenial" ? !!parts.support :
      cond === "uncongenial" ? !!parts.dissent :
      !!parts.support && !!parts.dissent
    );
    return { ok: ok, parts: parts, raw: raw };
  }

  function countWords(text) {
    return String(text || "").split(/\s+/).filter(Boolean).length;
  }

  // "idk", "maybe", "ok cool", "probably emergencies mostly": a disengaged reply.
  var LOW_EFFORT = /^(idk|i\s*d(on'?t|unno)\s*know|dunno|maybe|i guess|guess so|ok(ay)?|k|sure|yeah?|yea|ya|yep|nah|no|whatever|fine|lol|cool|true|same)\b/i;

  function isLowEffort(message) {
    var m = String(message || "").trim();
    var n = countWords(m);
    return n <= 5 || (n <= 10 && LOW_EFFORT.test(m));
  }

  // Pure filler ("idk", "maybe", "yeah probably", "i guess"): no position taken.
  // Narrower than isLowEffort, so a short concession like "ok you're right" is
  // still read as a possible shift.
  var FILLER = ("idk i dunno dont don't know maybe guess so not sure ok okay k whatever lol cool eh meh " +
    "hmm probably possibly perhaps kinda sorta yeah ya yea yep im i'm tired").split(" ");

  function isNoncommittal(message) {
    var words = String(message || "").toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 6 && words.every(function (w) { return FILLER.indexOf(w) !== -1; });
  }

  // Which ending this reply should have: the opening and even turns ask a
  // question, odd turns end on a statement, and a low-effort reply always gets
  // an easy question so the participant has something simple to answer.
  function endingHint(cfg, turn, participantMessage) {
    if (!cfg.alternate_questions) return "";
    var ask = turn === 0 || turn % 2 === 0 || isLowEffort(participantMessage);
    return ask ? cfg.question_hint : cfg.statement_hint;
  }

  /*
   * opts:
   *   cfg      - settings (missing keys fall back to DEFAULTS)
   *   vars     - { topic, p_response }: the participant's belief and why they hold it
   *   store    - { set(key, value) }  (Qualtrics: setEmbeddedData)
   *   dom      - { history, input, button } elements
   *   fetch    - optional fetch implementation (tests / mock mode)
   *   onBotReply(record) - called after each bot turn is shown
   *   onDone()           - called after the closing message
   *   onRequestError(turn, message) - called when a request fails
   *   setTimeout         - optional timer (tests)
   */
  function createChat(opts) {
    var cfg = {};
    var k;
    for (k in DEFAULTS) cfg[k] = DEFAULTS[k];
    for (k in opts.cfg || {}) if (opts.cfg[k] !== undefined && opts.cfg[k] !== "") cfg[k] = opts.cfg[k];

    var vars = opts.vars || {};
    var store = opts.store || { set: function () {} };
    var dom = opts.dom;
    var fetchFn = opts.fetch || function (url, init) { return fetch(url, init); };
    var timer = opts.setTimeout || setTimeout;
    var onBotReply = opts.onBotReply || function () {};
    var onDone = opts.onDone || function () {};
    var onRequestError = opts.onRequestError || function () {};
    var maxMessages = parseInt(cfg.max_messages, 10);

    var condition = conditionOf(cfg);
    var system = buildSystemPrompt(cfg, vars);
    var state = { history: [], turn: 0, busy: false, done: false, stopped: false, records: [], errors: {} };
    var typingEl = null;

    function addBubble(text, who, extraClass) {
      var el = document.createElement("div");
      el.classList.add("message", who === "user" ? "user-message" : "bot-message");
      if (extraClass) el.classList.add(extraClass);
      el.textContent = text;
      dom.history.appendChild(el);
      dom.history.scrollTop = dom.history.scrollHeight;
      return el;
    }

    function setBusy(busy) {
      state.busy = busy;
      var locked = busy || state.done;
      dom.input.disabled = locked;
      dom.button.disabled = locked;
      if (busy && !typingEl) {
        typingEl = addBubble("typing…", "bot", "typing");
      } else if (!busy && typingEl) {
        typingEl.parentNode.removeChild(typingEl);
        typingEl = null;
      }
      if (!locked) dom.input.focus();
    }

    function logError(turn, message) {
      state.errors[turn] = (state.errors[turn] ? state.errors[turn] + " | " : "") + message;
      store.set("error_" + turn, state.errors[turn]);
    }

    // One proxy call with a timeout. Resolves to the model's text.
    // `over` replaces request fields (system, temperature, max_tokens), e.g. for the direction check.
    function callProxy(history, prompt, over) {
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var t = timer(function () { if (controller) controller.abort(); }, cfg.request_timeout_ms);
      var body = buildRequest(cfg, system, history, prompt);
      for (var key in over || {}) body[key] = over[key];
      return fetchFn(cfg.proxy_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          if (!res.ok) {
            // Surface the proxy's { error } message, e.g. a bad model name or missing key.
            return res.json().catch(function () { return {}; }).then(function (d) {
              throw new Error("HTTP " + res.status + (d && d.error ? ": " + d.error : ""));
            });
          }
          return res.json();
        })
        .then(function (data) {
          clearTimeout(t);
          if (!data || typeof data.text !== "string" || !data.text.trim()) {
            throw new Error("Empty response" + (data && data.error ? ": " + JSON.stringify(data.error) : ""));
          }
          return data.text;
        }, function (err) {
          clearTimeout(t);
          throw err;
        });
    }

    function finalize(history, prompt, parsed, turn) {
      return Promise.resolve(enforceLimit(history, prompt, parsed, turn));
    }

    var WANT = { congenial: "FOR", uncongenial: "AGAINST" };
    var DRIFT = { FOR: "supporting their original view", AGAINST: "against their original view", NEITHER: "neutral or in the middle" };

    // Second model call: does this message land FOR, AGAINST or NEITHER the
    // participant's original view? Resolves to "" if the check itself fails.
    function judgeDirection(message) {
      var judgeSystem =
        'You check one chatbot message from a conversation with someone who believes "' + clean(vars.topic) + '". ' +
        "Taken as a whole, does the message land FOR that belief, AGAINST it, or NEITHER (balanced, neutral or unclear)? " +
        "Answer with one word: FOR, AGAINST or NEITHER.";
      return callProxy([], message, { system: judgeSystem, temperature: 0, max_tokens: 10 })
        .then(function (text) {
          var m = /\b(FOR|AGAINST|NEITHER)\b/i.exec(text);
          return m ? m[1].toUpperCase() : "";
        }, function () { return ""; });
    }

    function clean(v) {
      return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim();
    }

    // Grades the message just shown; the verdict steers the next reply (see withHint).
    // Nothing is rewritten, so the check adds no wait beyond the typing delay.
    function checkDirection(record) {
      if (!WANT[condition] || !cfg.direction_check || !record.parse_ok) return Promise.resolve();
      return judgeDirection(record.shown).then(function (verdict) {
        record.direction = verdict;
        store.set("direction_" + record.turn, verdict);
        if (verdict && verdict !== WANT[condition]) logError(record.turn, "direction check: " + verdict + ", next reply steered back");
      });
    }

    // Calls the model. An unreadable reply is retried once as-is; a readable one
    // that points the wrong way for the condition gets one targeted repair request.
    function getBalancedReply(history, prompt, turn) {
      return callProxy(history, prompt).then(function (text) {
        var parsed = parseBalancedReply(text, condition);
        if (parsed.ok) return finalize(history, prompt, parsed, turn);
        var readable = parsed.parts && parsed.parts.message;
        var retryHistory = readable
          ? history.concat([{ role: "user", content: prompt }, { role: "assistant", content: parsed.raw }])
          : history;
        var retryPrompt = readable ? repairPrompt(parsed.parts) : prompt;
        logError(turn, readable ? "wrong direction for condition, asked for repair" : "unparseable reply, retried");
        return callProxy(retryHistory, retryPrompt).then(function (text2) {
          var parsed2 = parseBalancedReply(text2, condition);
          if (parsed2.ok) return finalize(history, prompt, parsed2, turn);
          return parsed2.parts && parsed2.parts.message ? parsed2 : readable ? parsed : parsed2;
        });
      });
    }

    // Names what's missing from a readable reply so the rewrite can fix just that.
    function repairPrompt(parts) {
      var needed = condition === "congenial" ? "a consideration that supports their original view"
        : condition === "uncongenial" ? "a consideration that challenges their original view"
        : !parts.support ? "a consideration that supports their current leaning" : "a consideration that challenges it";
      var fix = "Your message was missing " + needed + ". Rewrite it with that woven in.";
      return fix + " Keep the same tone and length. Respond ONLY with the JSON.";
    }

    // Over the limit: ask once for a shorter rewrite. Free prose can't be cut
    // safely, so if it is still too long, the shorter version is shown and the
    // turn is flagged.
    function enforceLimit(history, prompt, parsed, turn) {
      var limit = parseInt(cfg.word_limit, 10);
      var words = countWords(parsed.parts.message);
      if (!cfg.enforce_word_limit || !limit || words <= limit) return parsed;

      var rewriteHistory = history.concat(
        [{ role: "user", content: prompt }, { role: "assistant", content: parsed.raw }]
      );
      var rewritePrompt =
        "That message was " + words + " words; the limit is " + limit + ". Rewrite it shorter, keeping it " +
        "conversational and " + CONDITIONS[condition].rewrite + ". " +
        "Respond ONLY with the JSON.";
      logError(turn, "over word limit (" + words + "), asked for rewrite");

      function keep(p) {
        if (countWords(p.parts.message) > limit) logError(turn, "still over word limit after rewrite");
        return p;
      }

      return callProxy(rewriteHistory, rewritePrompt).then(function (text) {
        var again = parseBalancedReply(text, condition);
        if (!again.ok) return keep(parsed);
        return keep(countWords(again.parts.message) < words ? again : parsed);
      }, function () {
        return keep(parsed);
      });
    }

    function recordTurn(turn, userMessage, parsed) {
      // Invalid for the condition but readable: show the model's message (the turn
      // is flagged parse_ok 0), never the raw JSON. Unreadable: show the raw text.
      var readable = parsed.parts && parsed.parts.message;
      var shown = parsed.ok ? parsed.parts.message : readable ? parsed.parts.message : parsed.raw.trim();
      // "idk" / "maybe" is not a change of mind: keep the previous stance even if
      // the model read it as one.
      var prev = null;
      for (var i = state.records.length - 1; i >= 0 && !prev; i--) {
        if (state.records[i].stance) prev = state.records[i].stance;
      }
      var overridden = 0;
      if (readable && turn > 0 && prev && isNoncommittal(userMessage) && parsed.parts.stance !== prev) {
        parsed.parts.stance = prev;
        overridden = 1;
      }
      var record = {
        turn: turn,
        user: userMessage,
        shown: shown,
        parts: parsed.parts,
        raw: parsed.raw,
        stance: readable ? parsed.parts.stance : "",
        stance_overridden: overridden,
        direction: "",
        parse_ok: parsed.ok ? 1 : 0,
        words: countWords(shown),
        over_limit: countWords(shown) > parseInt(cfg.word_limit, 10) ? 1 : 0
      };
      if (turn > 0) store.set("msg_" + turn, userMessage);
      store.set("response_" + turn, shown);
      store.set("support_" + turn, readable ? parsed.parts.support : "");
      store.set("dissent_" + turn, readable ? parsed.parts.dissent : "");
      store.set("stance_" + turn, record.stance);
      if (WANT[condition]) store.set("direction_" + turn, record.direction);
      store.set("parse_ok_" + turn, String(record.parse_ok));
      store.set("words_" + turn, String(record.words));
      state.records.push(record);
      // Keep the JSON in history so the model keeps answering in JSON.
      if (turn > 0) state.history.push({ role: "user", content: userMessage });
      state.history.push({
        role: "assistant",
        content: parsed.ok ? JSON.stringify(parsed.parts) : parsed.raw
      });
      return record;
    }

    // The direction check runs during the typing delay; the bubble waits for both.
    function showAfterDelay(record) {
      var delay = Math.min(countWords(record.shown) * Number(cfg.delay_ms_per_word || 0), cfg.max_delay_ms);
      var checked = checkDirection(record);
      return new Promise(function (resolve) {
        timer(function () { checked.then(go, go); }, delay);
        function go() {
          if (state.stopped) return resolve(null);
          setBusy(false);
          addBubble(record.shown, "bot");
          onBotReply(record);
          resolve(record);
        }
      });
    }

    // The ending instruction rides along in the request only; history keeps the
    // participant's actual words.
    function withHint(prompt, turn, participantMessage) {
      var last = state.records[state.records.length - 1];
      var drifted = last && last.direction && WANT[condition] && last.direction !== WANT[condition];
      var sideKey = (drifted ? "direction_fix_hint_" : "side_hint_") + condition;
      var side = cfg[sideKey] ? fillTemplate(cfg[sideKey], { topic: vars.topic, drift: drifted ? DRIFT[last.direction] : "" }) : "";
      var hints = [side, endingHint(cfg, turn, participantMessage)].filter(function (h) { return h; });
      return hints.length ? prompt + "\n\n" + hints.join(" ") : prompt;
    }

    function start() {
      setBusy(true);
      return getBalancedReply([], withHint(buildOpeningPrompt(cfg, vars), 0, ""), 0)
        .then(function (parsed) {
          return showAfterDelay(recordTurn(0, "", parsed));
        })
        .catch(function (err) {
          if (state.stopped) return null;
          logError(0, String(err && err.message ? err.message : err));
          onRequestError(0, String(err && err.message ? err.message : err));
          var record = recordTurn(0, "", { ok: false, parts: null, raw: cfg.opening_fallback });
          setBusy(false);
          addBubble(record.shown, "bot");
          onBotReply(record);
          return record;
        });
    }

    function finish(message, turn) {
      state.turn = turn;
      store.set("msg_" + turn, message);
      state.done = true;
      setBusy(false);
      addBubble(cfg.closing_message, "bot", "closing");
      onDone();
    }

    // Grow the message box with its content (CSS max-height caps it; then it scrolls).
    function autoGrow() {
      var el = dom.input;
      if (!el.style || el.tagName !== "TEXTAREA") return;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + (el.offsetHeight - el.clientHeight) + "px";
    }

    function send() {
      if (state.busy || state.done) return Promise.resolve(null);
      var message = (dom.input.value || "").trim();
      if (!message) return Promise.resolve(null);
      var turn = state.turn + 1;
      dom.input.value = "";
      autoGrow();
      var userEl = addBubble(message, "user");

      // Last participant message: no API call, so a failed request can't strand anyone.
      if (turn >= maxMessages) {
        finish(message, turn);
        return Promise.resolve(null);
      }

      setBusy(true);
      return getBalancedReply(state.history.slice(), withHint(message, turn, message), turn)
        .then(function (parsed) {
          state.turn = turn;
          return showAfterDelay(recordTurn(turn, message, parsed));
        })
        .catch(function (err) {
          if (state.stopped) return null;
          // Message doesn't count: put it back so the participant can resend.
          logError(turn, String(err && err.message ? err.message : err));
          onRequestError(turn, String(err && err.message ? err.message : err));
          userEl.classList.add("failed");
          setBusy(false);
          addBubble(cfg.error_message, "bot", "error");
          dom.input.value = message;
          autoGrow();
          return null;
        });
    }

    dom.button.addEventListener("click", function (e) {
      e.preventDefault();
      send();
    });
    // Enter sends; Shift+Enter adds a new line.
    dom.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault(); // stop Qualtrics from advancing the page
        send();
      }
    });
    dom.input.addEventListener("input", autoGrow);

    // Ignore any reply still in flight (e.g. the test page restarts the chat).
    function stop() {
      state.stopped = true;
      state.done = true;
    }

    return { start: start, send: send, stop: stop, state: state, cfg: cfg, system: system };
  }

  // ---------- topic phrase for the intellectual-humility scale ----------
  // A separate, one-off model call turns the participant's belief ("We need more
  // gun control") into a neutral topic phrase ("gun control") to pipe into the
  // blanks of the scale items ("My views about ___ may change...").
  var TOPIC_PHRASE_PROMPT =
    "You will get a belief someone wrote. Reply with a short noun phrase (1-6 words) naming what the belief is about, " +
    'so it reads naturally in the blank of "My views about ___ may change with additional evidence." ' +
    "Stay specific: reuse the belief's own key words and keep both things if it compares two, rather than a broader category. " +
    "Keep it neutral: name the issue, not their claim about it, and leave out words like should, more, less, good, bad, better, worse or overrated. " +
    "Use lowercase unless a word is a proper noun. Reply with the phrase only.";
  var TOPIC_PHRASE_FALLBACK = "this topic";

  // Strips quotes, a leading "about" and end punctuation; rejects anything that
  // isn't a short phrase.
  function cleanTopicPhrase(text) {
    var p = String(text || "").split(/\r?\n/)[0].trim()
      .replace(/^["'\u201C\u2018]+|["'\u201D\u2019]+$/g, "")
      .replace(/^about\s+/i, "")
      .replace(/[.!?;:,]+$/, "")
      .trim();
    var n = countWords(p);
    return n >= 1 && n <= 8 ? p : "";
  }

  // Resolves to { phrase, ok }; never rejects. On any failure the phrase is the
  // fallback ("this topic"), which still reads correctly in every item.
  function topicPhrase(belief, cfg, fetchFn) {
    cfg = Object.assign({}, DEFAULTS, cfg || {});
    fetchFn = fetchFn || function (url, init) { return fetch(url, init); };
    var fail = { phrase: TOPIC_PHRASE_FALLBACK, ok: false };
    if (!String(belief || "").trim()) return Promise.resolve(fail);
    var body = buildRequest(Object.assign({}, cfg, { temperature: 0, max_tokens: 20 }), TOPIC_PHRASE_PROMPT, [],
      String(belief).replace(/[\r\n]+/g, " ").trim());
    return fetchFn(cfg.proxy_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (data) {
        var phrase = cleanTopicPhrase(data && data.text);
        return phrase ? { phrase: phrase, ok: true } : fail;
      }, function () { return fail; });
  }

  return {
    DEFAULTS: DEFAULTS,
    TOPIC_PHRASE_PROMPT: TOPIC_PHRASE_PROMPT,
    cleanTopicPhrase: cleanTopicPhrase,
    topicPhrase: topicPhrase,
    DEFAULT_PROMPT: DEFAULT_PROMPT,
    FORMAT_INSTRUCTIONS: FORMAT_INSTRUCTIONS,
    fillTemplate: fillTemplate,
    buildSystemPrompt: buildSystemPrompt,
    buildOpeningPrompt: buildOpeningPrompt,
    buildRequest: buildRequest,
    parseBalancedReply: parseBalancedReply,
    hasShifted: hasShifted,
    CONDITIONS: CONDITIONS,
    applyCondition: applyCondition,
    countWords: countWords,
    isLowEffort: isLowEffort,
    isNoncommittal: isNoncommittal,
    endingHint: endingHint,
    wordBudgets: wordBudgets,
    createChat: createChat
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BalancedChat;
