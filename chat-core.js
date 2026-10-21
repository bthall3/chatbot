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

  var DEFAULT_PROMPT = [
    'You are chatting with a participant about the topic "{topic}". Why they hold their view: "{p_response}".',
    "Be a friendly, curious conversation partner, not a debate summary. Talk like a person: respond to what they actually said, answer their questions directly, pick up their examples and words, and vary how you phrase things.",
    "Your quiet goal is to keep their thinking even-handed. In EVERY message, weave in naturally:",
    "- ONE fresh, concrete consideration (a reason, an example, a common experience, an argument) that supports the view they currently lean toward and that they have NOT already mentioned, and",
    "- ONE fresh, concrete consideration that challenges it, about as strong and specific.",
    "Work them into your sentences the way a person would in conversation. No lists, no labels like \"one point in your favor\", and don't make them sound like a pro/con checklist.",
    "Follow the participant. Judge where they stand NOW from the whole conversation. If they have shifted toward the other side or are undecided, build on the direction they are moving in, and make the challenging consideration a brief, gentle thing to keep in mind from the side they moved away from (about {soft_words} words). Never rebut what they just conceded.",
    "Stay neutral about THEM as well as the topic: never agree with, praise or grade what they say. Don't use words like \"exactly\", \"right\", \"fair\", \"true\", \"good point\", \"strongest\", \"powerful\", \"thoughtful\" or \"meaningful\" about their views or arguments. Respond to the content instead. Never say which side is right.",
    "Don't claim that \"research shows\", \"studies find\" or \"research suggests\" anything unless it is a widely established finding you can name specifically. Otherwise put considerations as reasons, examples, or what some people or couples experience.",
    "Never reuse a consideration from earlier in the conversation. Don't start with stock phrases like \"I see\", \"I understand\", \"Great point\", \"That's a great point\" or \"Interesting\". End with a question in only about half of your messages; otherwise end on a statement they can react to.",
    "Keep the message under {word_limit} words.",
    'Respond ONLY with JSON: {"stance":"","message":"","support":"","dissent":""}',
    'stance: "original" (still holds their starting view), "shifted" (now leaning toward the other side) or "mixed" (undecided or partly persuaded). Asking a question does not by itself change their stance.',
    "message: exactly what the participant will read.",
    "support, dissent: a short summary of the supporting and the challenging consideration you wove into the message (for the researchers; not shown).",
    "",
    'Example (topic: Michael Jordan is the GOAT. Participant: "Yes, he was the most dominant player ever."):',
    '{"stance":"original","message":"Dominance is how a lot of people settle this one. He went 6-0 in the Finals and never needed a Game 7, which is hard to argue with. The flip side is longevity: LeBron has more career points and stayed elite far longer. Does how long someone dominates matter to you?","support":"Jordan went 6-0 in the Finals without a Game 7","dissent":"LeBron has more career points and a longer elite run"}',
    'Later the participant asks: "But didn\'t LeBron lose a lot of Finals?"',
    '{"stance":"original","message":"He did, 4 wins and 6 losses. That\'s part of why people rank Jordan\'s perfect Finals record so highly. Still, you have to be great just to get there, and LeBron reached ten Finals to Jordan\'s six, which takes its own kind of consistency.","support":"Jordan\'s perfect Finals record versus LeBron\'s 4-6","dissent":"LeBron reached ten Finals to Jordan\'s six"}',
    'Later still the participant says: "Okay, LeBron\'s longevity is hard to argue with."',
    '{"stance":"shifted","message":"Twenty-plus seasons near the top really is rare, and he backed it up with a record 13 All-NBA First Team selections. Jordan\'s six-for-six Finals run is still the one thing that keeps the debate going, though. Does peak or career matter more to you now?","support":"LeBron\'s record 13 All-NBA First Teams","dissent":"Jordan\'s six-for-six Finals record"}'
  ].join("\n");

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
    delay_ms_per_word: 200,
    max_delay_ms: 8000,
    request_timeout_ms: 20000,
    prompt_template: DEFAULT_PROMPT,
    opening_template: DEFAULT_OPENING_PROMPT,
    // If a message is over word_limit, ask the model once for a shorter rewrite;
    // if it is still too long it is shown anyway and flagged (over_limit).
    enforce_word_limit: true,
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

  function buildSystemPrompt(cfg, vars) {
    return fillTemplate(cfg.prompt_template, templateVars(cfg, vars));
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
  function parseBalancedReply(text) {
    var raw = typeof text === "string" ? text : "";
    var start = raw.indexOf("{");
    var end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return { ok: false, parts: null, raw: raw };
    var obj;
    try {
      obj = JSON.parse(raw.slice(start, end + 1));
    } catch (e) {
      return { ok: false, parts: null, raw: raw };
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
    return { ok: !!(parts.message && parts.support && parts.dissent), parts: parts, raw: raw };
  }

  function countWords(text) {
    return String(text || "").split(/\s+/).filter(Boolean).length;
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

    // Calls the model; if the reply isn't valid balanced JSON, retries once.
    function getBalancedReply(history, prompt, turn) {
      return callProxy(history, prompt).then(function (text) {
        var parsed = parseBalancedReply(text);
        if (parsed.ok) return enforceLimit(history, prompt, parsed, turn);
        logError(turn, "unparseable reply, retried");
        return callProxy(history, prompt).then(function (text2) {
          var parsed2 = parseBalancedReply(text2);
          return parsed2.ok ? enforceLimit(history, prompt, parsed2, turn) : { ok: false, parts: null, raw: text2 };
        });
      });
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
        "conversational and keeping one supporting and one challenging consideration woven in. " +
        "Respond ONLY with the JSON.";
      logError(turn, "over word limit (" + words + "), asked for rewrite");

      function keep(p) {
        if (countWords(p.parts.message) > limit) logError(turn, "still over word limit after rewrite");
        return p;
      }

      return callProxy(rewriteHistory, rewritePrompt).then(function (text) {
        var again = parseBalancedReply(text);
        if (!again.ok) return keep(parsed);
        return keep(countWords(again.parts.message) < words ? again : parsed);
      }, function () {
        return keep(parsed);
      });
    }

    function recordTurn(turn, userMessage, parsed) {
      var shown = parsed.ok ? parsed.parts.message : parsed.raw.trim();
      var record = {
        turn: turn,
        user: userMessage,
        shown: shown,
        parts: parsed.parts,
        raw: parsed.raw,
        stance: parsed.ok ? parsed.parts.stance : "",
        parse_ok: parsed.ok ? 1 : 0,
        words: countWords(shown),
        over_limit: countWords(shown) > parseInt(cfg.word_limit, 10) ? 1 : 0
      };
      if (turn > 0) store.set("msg_" + turn, userMessage);
      store.set("response_" + turn, shown);
      store.set("support_" + turn, parsed.ok ? parsed.parts.support : "");
      store.set("dissent_" + turn, parsed.ok ? parsed.parts.dissent : "");
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

    function start() {
      setBusy(true);
      return getBalancedReply([], buildOpeningPrompt(cfg, vars), 0)
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
      return getBalancedReply(state.history.slice(), message, turn)
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
    countWords: countWords,
    wordBudgets: wordBudgets,
    createChat: createChat
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BalancedChat;
