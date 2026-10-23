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

  // One shared prompt for all bots. Only {condition_rules} and {examples} differ
  // between the balanced, congenial and uncongenial conditions (see CONDITIONS).
  var DEFAULT_PROMPT = [
    'You are chatting with a participant about the topic "{topic}". Why they hold their view: "{p_response}".',
    "Be a friendly, curious conversation partner, not a debate summary. Talk like a person texting a classmate: everyday words, short sentences, no academic phrasing. Respond to what they actually said, answer their questions directly, pick up their examples and words, and vary how you phrase things.",
    "Keep it concise: 2-3 short sentences, usually 25-40 words.",
    "{condition_rules}",
    "Every consideration must bear directly on the statement \"{topic}\" itself, not on side issues the conversation leads to (logistics, tips, how-tos). If the conversation drifts, tie your point back to the statement.",
    "Work your consideration(s) into your sentences the way a person would in conversation. No lists, no labels like \"one point in your favor\", and don't make it sound like a checklist.",
    "Stay neutral about THEM as well as the topic: never agree with, praise or grade what they say. Don't use words like \"exactly\", \"right\", \"fair\", \"true\", \"makes sense\", \"that's valid\", \"good point\", \"strongest\", \"powerful\", \"thoughtful\" or \"meaningful\" about their views or arguments. Respond to the content instead. Never say which side is right.",
    "Don't claim that \"research shows\", \"studies find\" or \"research suggests\" anything unless it is a widely established finding you can name specifically. Otherwise put considerations as reasons, examples, or what some people or couples experience.",
    "If their reply is short, noncommittal or off-topic (\"idk\", \"maybe\", \"i'm tired\", \"doing this for credit\"), keep yours under about 25 words: still include your consideration(s), briefly, then steer back to the topic with an easy question. Never treat the chat as an assignment, never offer to write or summarize an answer for them, and never comment on their effort or mood.",
    "Never repeat a consideration, example or question you've already used in this conversation; check your earlier messages first. Vary your questions: don't keep starting with \"Would you\"; mix in what/how/why questions, either/or choices, or questions about their own experience. Don't start with stock phrases like \"I see\", \"I understand\", \"Great point\", \"That's a great point\" or \"Interesting\". Follow any instruction about whether to end with a question.",
    "Never go over {word_limit} words.",
    'Respond ONLY with JSON: {"stance":"","message":"","support":"","dissent":""}',
    'stance: "original" (still holds their starting view), "shifted" (now leaning toward the other side) or "mixed" (undecided or partly persuaded). Asking a question does not by itself change their stance, and short, noncommittal or off-topic replies ("idk", "maybe", "i guess", "ok") are NOT a shift: keep the previous stance.',
    "message: exactly what the participant will read.",
    "support: a short summary of the consideration you wove in that supports the view your instructions above focus on; dissent: a short summary of one that challenges that view. Leave a field empty if there is none; a brief acknowledgment of what they said doesn't count. (For the researchers; not shown.)",
    "",
    "{examples}"
  ].join("\n");

  var EX_OPEN = 'Example (topic: Michael Jordan is the GOAT. Participant: "Yes, he was the most dominant player ever."):';
  var EX_ASK = 'Later the participant asks: "But didn\'t LeBron lose a lot of Finals?"';
  var EX_IDK = 'Later the participant says: "idk"';
  var EX_STORY = 'Later the participant says: "My dad says nobody was scarier in a big game than Jordan."';
  var EX_SHIFT = 'Later still the participant says: "Okay, LeBron\'s longevity is hard to argue with."';

  // The only parts of the prompt that differ between conditions.
  var CONDITIONS = {
    balanced: {
      rules: [
        "Your quiet goal is to keep their thinking even-handed. In EVERY message, weave in naturally:",
        "- ONE fresh, concrete consideration (a reason, an example, a common experience, an argument) that supports the view they currently lean toward and that they have NOT already mentioned, and",
        "- ONE fresh, concrete consideration that challenges it, about as strong and specific.",
        "Follow the participant. Judge where they stand NOW from the whole conversation. If they have shifted toward the other side or are undecided, build on the direction they are moving in, and make the challenging consideration a brief, gentle thing to keep in mind from the side they moved away from (about {soft_words} words). Never rebut what they just conceded."
      ].join("\n"),
      examples: [
        EX_OPEN,
        '{"stance":"original","message":"A lot of people settle it on dominance. He went 6-0 in the Finals and never needed a Game 7. But LeBron has more career points and stayed elite way longer. Does how long someone\'s great matter to you?","support":"Jordan went 6-0 in the Finals without a Game 7","dissent":"LeBron has more career points and a longer elite run"}',
        EX_ASK,
        '{"stance":"original","message":"He did, 4-6. That\'s why Jordan\'s perfect Finals record gets so much weight. Then again, LeBron made ten Finals to Jordan\'s six, and getting there that often is its own kind of consistency.","support":"Jordan\'s perfect Finals record versus LeBron\'s 4-6","dissent":"LeBron reached ten Finals to Jordan\'s six"}',
        EX_STORY,
        '{"stance":"original","message":"Did he get to watch those games live? Jordan won Finals MVP all six times he made it there, though LeBron made eight straight Finals, a run Jordan never had.","support":"Jordan won Finals MVP in all six of his Finals","dissent":"LeBron made eight straight Finals"}',
        EX_IDK,
        '{"stance":"original","message":"Jordan never lost a Finals, but LeBron stayed elite for 20+ seasons. Peak or longevity, if you had to pick one?","support":"Jordan never lost a Finals","dissent":"LeBron stayed elite for 20+ seasons"}',
        EX_SHIFT,
        '{"stance":"shifted","message":"Twenty-plus seasons near the top is rare, and he has a record 13 All-NBA First Teams. Jordan\'s 6-for-6 Finals run still keeps the debate alive, though. Peak or career, which matters more to you now?","support":"LeBron\'s record 13 All-NBA First Teams","dissent":"Jordan\'s six-for-six Finals record"}'
      ].join("\n"),
      rewrite: "keeping one supporting and one challenging consideration woven in"
    },
    congenial: {
      rules: [
        "Their view is the position in their written explanation above, and it stays your reference point for the WHOLE conversation, even if they start to change their mind.",
        "In EVERY message, weave in naturally ONE fresh, concrete consideration (a reason, an example, a common experience, an argument) that supports that original view and that they have NOT already mentioned. You may briefly acknowledge something they said, but each message must clearly land in support of their original view; never make a reason against it your point. Leave \"dissent\" empty."
      ].join("\n"),
      examples: [
        EX_OPEN,
        '{"stance":"original","message":"A lot of people settle it on dominance. He went 6-0 in the Finals and never needed a Game 7. Does how someone performs on the biggest stage matter most to you?","support":"Jordan went 6-0 in the Finals without a Game 7","dissent":""}',
        EX_ASK,
        '{"stance":"original","message":"He did, 4-6. That\'s a big reason Jordan\'s perfect Finals record carries so much weight when people compare them.","support":"Jordan\'s perfect Finals record versus LeBron\'s 4-6","dissent":""}',
        EX_STORY,
        '{"stance":"original","message":"Did he get to watch those games live? Jordan won Finals MVP all six times he made it there.","support":"Jordan won Finals MVP in all six of his Finals","dissent":""}',
        EX_IDK,
        '{"stance":"original","message":"Jordan won six titles in eight seasons, which is hard to match. Titles or stats, which counts more for you?","support":"Jordan won six titles in eight seasons","dissent":""}',
        EX_SHIFT,
        '{"stance":"shifted","message":"Longevity is a real argument. Still, Jordan went 6-for-6 in the Finals and never needed a Game 7, which a long career alone doesn\'t match. Peak or career, which matters more to you now?","support":"Jordan\'s six-for-six Finals record","dissent":""}'
      ].join("\n"),
      rewrite: "keeping the supporting consideration woven in"
    },
    uncongenial: {
      rules: [
        "Their view is the position in their written explanation above, and it stays your reference point for the WHOLE conversation, even if they start to change their mind.",
        "In EVERY message, weave in naturally ONE fresh, concrete consideration (a reason, an example, a common experience, an argument) that challenges that original view and that they have NOT already mentioned. You may briefly acknowledge something they said, but each message must clearly land against their original view; never make a reason for it your point. Leave \"support\" empty."
      ].join("\n"),
      examples: [
        EX_OPEN,
        '{"stance":"original","message":"A lot of people settle it on dominance. But LeBron has more career points and stayed elite way longer. Does how long someone\'s great matter to you?","support":"","dissent":"LeBron has more career points and a longer elite run"}',
        EX_ASK,
        '{"stance":"original","message":"He did, 4-6. Then again, LeBron made ten Finals to Jordan\'s six, and getting there that often is its own kind of consistency.","support":"","dissent":"LeBron reached ten Finals to Jordan\'s six"}',
        EX_STORY,
        '{"stance":"original","message":"Did he get to watch those games live? LeBron made eight straight Finals, a run Jordan never had.","support":"","dissent":"LeBron made eight straight Finals"}',
        EX_IDK,
        '{"stance":"original","message":"LeBron stayed elite for 20+ seasons, way longer than Jordan. Peak or longevity, if you had to pick one?","support":"","dissent":"LeBron stayed elite for 20+ seasons"}',
        EX_SHIFT,
        '{"stance":"shifted","message":"Twenty-plus seasons near the top is rare, and he also has a record 13 All-NBA First Teams. Peak or career, which matters more to you now?","support":"","dissent":"LeBron\'s record 13 All-NBA First Teams"}'
      ].join("\n"),
      rewrite: "keeping the challenging consideration woven in"
    }
  };

  function conditionOf(cfg) {
    return CONDITIONS[cfg && cfg.condition] ? cfg.condition : "balanced";
  }

  var DEFAULT_OPENING_PROMPT =
    'Here is what the participant wrote about why they hold their view: "{p_response}". ' +
    "Start the conversation by reacting to something specific they wrote, in the required JSON format.";

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
    question_hint: "(Instruction for this reply only: end with one short, easy question.)",
    statement_hint: "(Instruction for this reply only: end on a statement, not a question.)",
    closing_message: "Thank you for the conversation! We will now move on to the next part of the study.",
    error_message: "Sorry, something went wrong. Please send your message again.",
    opening_fallback: "Thanks for sharing your view. What would you like to discuss about this topic?"
  };

  // Only known placeholders are filled, so JSON braces in the template are left alone.
  // ack/reply/point/question_words are kept so older saved prompts still fill in.
  function fillTemplate(template, vars) {
    return String(template).replace(/\{(topic|p_response|word_limit|ack_words|reply_words|point_words|soft_words|question_words)\}/g, function (m, key) {
      var v = vars[key];
      return v === undefined || v === null ? "" : String(v).replace(/[\r\n]+/g, " ").trim();
    });
  }

  // word_limit 50 -> gentle counterpoint after a shift: about 10 words.
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
    return fillTemplate(applyCondition(cfg.prompt_template, cfg), templateVars(cfg, vars));
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
   *   vars     - { topic, p_response }
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
    function callProxy(history, prompt) {
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var t = timer(function () { if (controller) controller.abort(); }, cfg.request_timeout_ms);
      return fetchFn(cfg.proxy_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequest(cfg, system, history, prompt)),
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

    // Calls the model. An unreadable reply is retried once as-is; a readable one
    // that points the wrong way for the condition gets one targeted repair request.
    function getBalancedReply(history, prompt, turn) {
      return callProxy(history, prompt).then(function (text) {
        var parsed = parseBalancedReply(text, condition);
        if (parsed.ok) return enforceLimit(history, prompt, parsed, turn);
        var readable = parsed.parts && parsed.parts.message;
        var retryHistory = readable
          ? history.concat([{ role: "user", content: prompt }, { role: "assistant", content: parsed.raw }])
          : history;
        var retryPrompt = readable ? repairPrompt(parsed.parts) : prompt;
        logError(turn, readable ? "wrong direction for condition, asked for repair" : "unparseable reply, retried");
        return callProxy(retryHistory, retryPrompt).then(function (text2) {
          var parsed2 = parseBalancedReply(text2, condition);
          if (parsed2.ok) return enforceLimit(history, prompt, parsed2, turn);
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
        parse_ok: parsed.ok ? 1 : 0,
        words: countWords(shown),
        over_limit: countWords(shown) > parseInt(cfg.word_limit, 10) ? 1 : 0
      };
      if (turn > 0) store.set("msg_" + turn, userMessage);
      store.set("response_" + turn, shown);
      store.set("support_" + turn, readable ? parsed.parts.support : "");
      store.set("dissent_" + turn, readable ? parsed.parts.dissent : "");
      store.set("stance_" + turn, record.stance);
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

    function showAfterDelay(record) {
      var delay = Math.min(countWords(record.shown) * Number(cfg.delay_ms_per_word || 0), cfg.max_delay_ms);
      return new Promise(function (resolve) {
        timer(function () {
          if (state.stopped) return resolve(null);
          setBusy(false);
          addBubble(record.shown, "bot");
          onBotReply(record);
          resolve(record);
        }, delay);
      });
    }

    // The ending instruction rides along in the request only; history keeps the
    // participant's actual words.
    function withHint(prompt, turn, participantMessage) {
      var hint = endingHint(cfg, turn, participantMessage);
      return hint ? prompt + "\n\n" + hint : prompt;
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

  return {
    DEFAULTS: DEFAULTS,
    DEFAULT_PROMPT: DEFAULT_PROMPT,
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
