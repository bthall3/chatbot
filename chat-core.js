/*
 * Balanced ("even-handed") chatbot engine.
 *
 * Every bot turn = acknowledge + ONE supporting point + ONE dissenting point
 * (+ optional question). The model is asked for JSON so the 1:1 balance can be
 * checked, rendered in a fixed order, and logged piece by piece.
 *
 * No imports and no build step: this file can be pasted verbatim at the top of a
 * Qualtrics question's JavaScript (see qualtrics/README.md). It is also loaded by
 * the standalone test page (index.html) and by the Node tests.
 */
var BalancedChat = (function () {
  "use strict";

  var DEFAULT_PROMPT = [
    'You are discussing the topic "{topic}" with a participant. Their reasoning: "{p_response}".',
    "Your goal is to make their information search balanced. Every reply must contain these fields:",
    "(1) acknowledge: one short sentence showing you understand their point, without agreeing or disagreeing;",
    "(2) support: ONE concrete piece of evidence or argument that SUPPORTS their position and that they have NOT already mentioned;",
    "(3) dissent: ONE concrete piece of evidence or argument that CHALLENGES their position, about as strong and specific as the support;",
    "(4) question: an optional short follow-up question (may be empty).",
    "Never reuse evidence from earlier turns. Stay neutral; never say which side is right.",
    "Keep the whole reply under {word_limit} words.",
    'Respond ONLY with JSON: {"acknowledge":"","support":"","dissent":"","question":""}',
    "",
    'Example (topic: Is Michael Jordan the GOAT? Participant: "Yes, he was the most dominant player ever."):',
    '{"acknowledge":"I see why his dominance stands out.","support":"He went 6-0 in the Finals and won 6 Finals MVPs.","dissent":"LeBron has more career points and a far longer prime.","question":"How much should longevity count?"}'
  ].join("\n");

  var DEFAULT_OPENING_PROMPT =
    'Here is what the participant wrote about why they hold their view: "{p_response}". ' +
    "Start the conversation with your first reply in the required JSON format.";

  var DEFAULTS = {
    proxy_url: "https://balanced-chat-proxy.hallbradent.workers.dev/",
    model: "gpt-5.6-luna",
    reasoning_effort: "none", // reasoning models: "none" keeps replies fast and allows temperature
    temperature: 0.5,
    max_tokens: 200,
    word_limit: 50,
    max_messages: 5,
    delay_ms_per_word: 200,
    max_delay_ms: 8000,
    order: "support-first", // "support-first" | "dissent-first" | "random"
    request_timeout_ms: 20000,
    prompt_template: DEFAULT_PROMPT,
    opening_template: DEFAULT_OPENING_PROMPT,
    label_support_first: "One point in your favor:",
    label_dissent_first: "One point against your view:",
    label_second: "On the other hand:",
    closing_message: "Thank you for the conversation! We will now move on to the next part of the study.",
    error_message: "Sorry, something went wrong. Please send your message again.",
    opening_fallback: "Thanks for sharing your view. What would you like to discuss about this topic?"
  };

  // Only known placeholders are filled, so JSON braces in the template are left alone.
  function fillTemplate(template, vars) {
    return String(template).replace(/\{(topic|p_response|word_limit)\}/g, function (m, key) {
      var v = vars[key];
      return v === undefined || v === null ? "" : String(v).replace(/[\r\n]+/g, " ").trim();
    });
  }

  function buildSystemPrompt(cfg, vars) {
    return fillTemplate(cfg.prompt_template, {
      topic: vars.topic,
      p_response: vars.p_response,
      word_limit: cfg.word_limit
    });
  }

  function buildOpeningPrompt(cfg, vars) {
    return fillTemplate(cfg.opening_template, {
      topic: vars.topic,
      p_response: vars.p_response,
      word_limit: cfg.word_limit
    });
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
    var parts = {
      acknowledge: asText(obj.acknowledge),
      support: asText(obj.support),
      dissent: asText(obj.dissent),
      question: asText(obj.question)
    };
    // The manipulation requires both a supporting and a dissenting point.
    return { ok: !!(parts.support && parts.dissent), parts: parts, raw: raw };
  }

  function resolveOrder(order, rand) {
    if (order === "random") return (rand || Math.random)() < 0.5 ? "support-first" : "dissent-first";
    return order === "dissent-first" ? "dissent-first" : "support-first";
  }

  function renderReply(parts, order, cfg) {
    var c = cfg || DEFAULTS;
    var middle =
      order === "dissent-first"
        ? [c.label_dissent_first, parts.dissent, c.label_second, parts.support]
        : [c.label_support_first, parts.support, c.label_second, parts.dissent];
    return [parts.acknowledge].concat(middle, [parts.question])
      .filter(function (s) { return s; })
      .join(" ");
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
          if (!res.ok) throw new Error("HTTP " + res.status);
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
        if (parsed.ok) return parsed;
        logError(turn, "unparseable reply, retried");
        return callProxy(history, prompt).then(function (text2) {
          var parsed2 = parseBalancedReply(text2);
          return parsed2.ok ? parsed2 : { ok: false, parts: null, raw: text2 };
        });
      });
    }

    function recordTurn(turn, userMessage, parsed) {
      var order = resolveOrder(cfg.order);
      var shown = parsed.ok ? renderReply(parsed.parts, order, cfg) : parsed.raw.trim();
      var record = {
        turn: turn,
        user: userMessage,
        shown: shown,
        parts: parsed.parts,
        raw: parsed.raw,
        order: parsed.ok ? order : "",
        parse_ok: parsed.ok ? 1 : 0,
        words: countWords(shown)
      };
      if (turn > 0) store.set("msg_" + turn, userMessage);
      store.set("response_" + turn, shown);
      store.set("support_" + turn, parsed.ok ? parsed.parts.support : "");
      store.set("dissent_" + turn, parsed.ok ? parsed.parts.dissent : "");
      store.set("order_" + turn, record.order);
      store.set("parse_ok_" + turn, String(record.parse_ok));
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

    function send() {
      if (state.busy || state.done) return Promise.resolve(null);
      var message = (dom.input.value || "").trim();
      if (!message) return Promise.resolve(null);
      var turn = state.turn + 1;
      dom.input.value = "";
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
          userEl.classList.add("failed");
          setBusy(false);
          addBubble(cfg.error_message, "bot", "error");
          dom.input.value = message;
          return null;
        });
    }

    dom.button.addEventListener("click", function (e) {
      e.preventDefault();
      send();
    });
    dom.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault(); // stop Qualtrics from advancing the page
        send();
      }
    });

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
    resolveOrder: resolveOrder,
    renderReply: renderReply,
    countWords: countWords,
    createChat: createChat
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BalancedChat;
