/*
 * Balanced ("even-handed") chatbot engine.
 *
 * Every bot turn = ONE supporting point + ONE dissenting point
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
    "This is a real back-and-forth conversation, and your goal is to make their information search balanced. Every reply must contain these fields:",
    "(1) stance: where the participant stands NOW, judged from the whole conversation: \"original\" (still holds their starting view), \"shifted\" (now leaning toward the other side) or \"mixed\" (undecided or partly persuaded);",
    "(2) reply: ONE short sentence that responds directly to their last message. If they asked a question, answer it. Otherwise engage with something specific they said (an example, a claim, a worry). Do not agree or disagree, and do not just restate their view. Never start with \"I see\", \"I understand\", \"That's a great point\", \"Interesting\", \"It's understandable\" or \"You raise\";",
    "(3) support: ONE concrete piece of evidence or argument that SUPPORTS the position they currently lean toward and that they have NOT already mentioned;",
    "(4) dissent: ONE concrete piece of evidence or argument from the other side, about as strong and specific as the support;",
    "(5) question: an optional short follow-up question that builds on what they just said, not a generic \"What do you think?\" (may be empty).",
    "Where you can, tie support and dissent to what they just said (their example, their concern) instead of giving free-floating facts.",
    "Follow the participant. If their stance is \"shifted\" or \"mixed\", build on the direction they are moving in: support backs their new leaning, and dissent becomes a brief, gentle point worth keeping in mind from the side they moved away from (at most {soft_words} words). Never rebut or argue against what they just conceded.",
    "Write support and dissent as plain statements with no lead-in or transition word (no \"However\", \"On the other hand\", \"One point in your favor\"); a transition is added for you.",
    "Start support and dissent with a lowercase letter unless the first word is a proper noun or \"I\".",
    "Never reuse evidence from earlier turns. Vary your wording, and don't open every reply the same way. Stay neutral; never say which side is right.",
    "STRICT word budget: reply at most {reply_words}, support at most {point_words}, dissent at most {point_words}, question at most {question_words}; the whole reply must stay under {word_limit} words. Count before answering; replies over the limit are rejected.",
    'Respond ONLY with JSON: {"stance":"","reply":"","support":"","dissent":"","question":""}',
    "",
    'Example (topic: Is Michael Jordan the GOAT? Participant: "Yes, he was the most dominant player ever."):',
    '{"stance":"original","reply":"Dominance is a fair yardstick for a GOAT debate.","support":"he went 6-0 in the Finals and won 6 Finals MVPs.","dissent":"LeBron has more career points and a far longer prime.","question":"Is dominance about peak or about how long it lasts?"}',
    'Later the participant asks: "But didn\'t LeBron lose a lot of Finals?"',
    '{"stance":"original","reply":"He did, he went 4-6 in the Finals.","support":"Jordan never needed a Game 7 in any of his Finals.","dissent":"just reaching 10 Finals is a feat Jordan never matched.","question":"Does losing in the Finals count against him?"}',
    'Later still the participant says: "Okay, LeBron\'s longevity is hard to argue with."',
    '{"stance":"shifted","reply":"Twenty-plus seasons near the top is rare.","support":"he made a record 13 All-NBA First Teams.","dissent":"Jordan\'s Finals record is still unmatched.","question":"Does peak or career matter more to you now?"}'
  ].join("\n");

  var DEFAULT_OPENING_PROMPT =
    'Here is what the participant wrote about why they hold their view: "{p_response}". ' +
    "Start the conversation with your first reply in the required JSON format; " +
    "make the reply react to something specific they wrote.";

  var DEFAULTS = {
    proxy_url: "https://balanced-chat-proxy.bthall3.workers.dev/",
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
    // If a reply is over word_limit: ask for one shorter rewrite, then drop the
    // question and then the direct reply if it is still too long.
    enforce_word_limit: true,
    // Placed before the second point; one is picked at random each turn (never the
    // same one twice in a row). One per line.
    transitions: [
      "However,", "That said,", "On the other hand,", "Then again,", "At the same time,",
      "Still,", "Even so,", "But", "Yet", "On the flip side,", "Conversely,", "Of course,"
    ].join("\n"),
    closing_message: "Thank you for the conversation! We will now move on to the next part of the study.",
    error_message: "Sorry, something went wrong. Please send your message again.",
    opening_fallback: "Thanks for sharing your view. What would you like to discuss about this topic?"
  };

  // Only known placeholders are filled, so JSON braces in the template are left alone.
  function fillTemplate(template, vars) {
    return String(template).replace(/\{(topic|p_response|word_limit|ack_words|reply_words|point_words|soft_words|question_words)\}/g, function (m, key) {
      var v = vars[key];
      return v === undefined || v === null ? "" : String(v).replace(/[\r\n]+/g, " ").trim();
    });
  }

  // Per-part budgets that add up to the limit, leaving room for the transition
  // phrase the page inserts. word_limit 50 -> reply 9, support 14, dissent 14
  // (soft counterpoint after a shift: 7), question 9.
  // ack_words stays 0 so older custom prompts that still use {ack_words} don't break.
  function wordBudgets(cfg) {
    var limit = parseInt(cfg.word_limit, 10) || 50;
    var room = Math.max(limit - transitionAllowance(cfg), 8);
    var reply = Math.floor(room * 0.2);
    var question = Math.floor(room * 0.2);
    var point = Math.floor((room - reply - question) / 2);
    return {
      word_limit: limit,
      ack_words: 0,
      reply_words: reply,
      question_words: question,
      point_words: point,
      soft_words: Math.floor(point / 2)
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
      reply: asText(obj.reply),
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

  function parseTransitions(text) {
    return String(text || "").split(/\n/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  // Random transition, avoiding an immediate repeat.
  function pickTransition(list, previous, rand) {
    if (!list.length) return "";
    var options = list.length > 1 ? list.filter(function (t) { return t !== previous; }) : list;
    return options[Math.floor((rand || Math.random)() * options.length)];
  }

  // Backstop for when the model capitalizes anyway ("However, Many couples..."):
  // lowercase common words only, so proper nouns ("However, LeBron...") stay intact.
  var COMMON_FIRST_WORDS = (
    "a an the this that these those it its there they their he she his her you your we our " +
    "many some most few several more less much each every both all any one another other others " +
    "people couples partners research studies study surveys data evidence experts critics " +
    "having being sharing keeping living not no even when if while without for in on at by with " +
    "financial religious separate shared constant trust privacy relationships"
  ).split(" ");

  function lowerFirst(sentence) {
    var m = /^([A-Za-z']+)/.exec(sentence);
    if (m && COMMON_FIRST_WORDS.indexOf(m[1].toLowerCase()) !== -1 && m[1] !== m[1].toUpperCase()) {
      return sentence.charAt(0).toLowerCase() + sentence.slice(1);
    }
    return sentence;
  }

  function upperFirst(sentence) {
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }

  // "{reply} {first point} {transition} {second point} {question}"
  function renderReply(parts, order, transition) {
    var first = order === "dissent-first" ? parts.dissent : parts.support;
    var second = order === "dissent-first" ? parts.support : parts.dissent;
    second = transition ? transition + " " + lowerFirst(second) : upperFirst(second);
    return [parts.reply ? upperFirst(parts.reply) : "", upperFirst(first), second, parts.question]
      .filter(function (s) { return s; })
      .join(" ");
  }

  function countWords(text) {
    return String(text || "").split(/\s+/).filter(Boolean).length;
  }

  // Words the longest transition phrase adds to a reply.
  function transitionAllowance(cfg) {
    return parseTransitions(cfg.transitions).reduce(function (max, t) {
      return Math.max(max, countWords(t));
    }, 0);
  }

  function partsWords(parts) {
    return countWords(parts.reply) + countWords(parts.support) + countWords(parts.dissent) +
      countWords(parts.question);
  }

  // Last resort for a reply that is still too long: drop the question, then the
  // direct reply. The supporting and dissenting points are never cut.
  function trimToLimit(parts, limit, allowance) {
    var out = {
      stance: parts.stance, reply: parts.reply, support: parts.support, dissent: parts.dissent, question: parts.question
    };
    if (partsWords(out) + allowance > limit) out.question = "";
    if (partsWords(out) + allowance > limit) out.reply = "";
    return out;
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
    var onRequestError = opts.onRequestError || function () {};
    var maxMessages = parseInt(cfg.max_messages, 10);

    var system = buildSystemPrompt(cfg, vars);
    var state = { history: [], turn: 0, busy: false, done: false, stopped: false, records: [], errors: {}, lastTransition: "" };
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

    // Over the limit: ask once for a shorter rewrite (keeping the same points),
    // then trim if it is still too long.
    function enforceLimit(history, prompt, parsed, turn) {
      var limit = parseInt(cfg.word_limit, 10);
      var allowance = transitionAllowance(cfg);
      var words = partsWords(parsed.parts) + allowance;
      if (!cfg.enforce_word_limit || !limit || words <= limit) return parsed;

      var b = wordBudgets(cfg);
      var rewriteHistory = history.concat(
        [{ role: "user", content: prompt }, { role: "assistant", content: parsed.raw }]
      );
      var rewritePrompt =
        "That reply was about " + words + " words; the limit is " + limit + ". Rewrite the SAME reply shorter: " +
        "reply at most " + b.reply_words + " words, support at most " + b.point_words +
        ", dissent at most " + b.point_words + ", question at most " + b.question_words +
        ". Keep one supporting and one dissenting point. Respond ONLY with the JSON.";
      logError(turn, "over word limit (" + words + "), asked for rewrite");

      function trimmed(p) {
        var parts = trimToLimit(p.parts, limit, allowance);
        if (partsWords(parts) + allowance > limit) logError(turn, "still over word limit after trimming");
        else if (parts.question !== p.parts.question) {
          logError(turn, "trimmed to fit word limit");
        }
        return { ok: true, parts: parts, raw: p.raw };
      }

      return callProxy(rewriteHistory, rewritePrompt).then(function (text) {
        var again = parseBalancedReply(text);
        if (!again.ok) return trimmed(parsed);
        return partsWords(again.parts) + allowance <= limit ? again : trimmed(again);
      }, function () {
        return trimmed(parsed);
      });
    }

    function recordTurn(turn, userMessage, parsed) {
      // After a shift, lead with the point for their new leaning; the soft
      // counterpoint always comes second.
      var order = parsed.ok && hasShifted(parsed.parts) ? "support-first" : resolveOrder(cfg.order);
      var transition = parsed.ok ? pickTransition(parseTransitions(cfg.transitions), state.lastTransition) : "";
      if (transition) state.lastTransition = transition;
      var shown = parsed.ok ? renderReply(parsed.parts, order, transition) : parsed.raw.trim();
      var record = {
        turn: turn,
        user: userMessage,
        shown: shown,
        parts: parsed.parts,
        raw: parsed.raw,
        order: parsed.ok ? order : "",
        transition: transition,
        stance: parsed.ok ? parsed.parts.stance : "",
        parse_ok: parsed.ok ? 1 : 0,
        words: countWords(shown),
        over_limit: countWords(shown) > parseInt(cfg.word_limit, 10) ? 1 : 0
      };
      if (turn > 0) store.set("msg_" + turn, userMessage);
      store.set("response_" + turn, shown);
      store.set("support_" + turn, parsed.ok ? parsed.parts.support : "");
      store.set("dissent_" + turn, parsed.ok ? parsed.parts.dissent : "");
      store.set("order_" + turn, record.order);
      store.set("transition_" + turn, transition);
      store.set("stance_" + turn, record.stance);
      store.set("reply_" + turn, parsed.ok ? parsed.parts.reply : "");
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
    resolveOrder: resolveOrder,
    hasShifted: hasShifted,
    parseTransitions: parseTransitions,
    pickTransition: pickTransition,
    renderReply: renderReply,
    countWords: countWords,
    wordBudgets: wordBudgets,
    trimToLimit: trimToLimit,
    createChat: createChat
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BalancedChat;
