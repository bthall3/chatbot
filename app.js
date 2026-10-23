// Test-page wiring: settings panel, setup form, chat, feedback + email.
(function () {
  "use strict";

  var PAGE = window.PAGE_CONFIG || {};
  var MOCK = /[?&]mock=1\b/.test(location.search);
  var SETTINGS_KEY = "balancedChat.settings.v11"; // v11: directional bots anchored to original view

  var TOPICS = [
    "People in romantic relationships should not have opposite-sex friendships.",
    "In heterosexual romantic relationships, the man should be the breadwinner.",
    "People should be totally comfortable being alone before getting into a relationship.",
    "Watching pornography in a relationship is a form of cheating.",
    "People of different religions should avoid being in romantic relationships.",
    "Couples should keep their finances completely separate.",
    "People in romantic relationships should have each other’s phone passwords.",
    "People in romantic relationships should have each other’s location.",
    "Cohabiting before marriage is essential for a healthy relationship."
  ];
  var OTHER = "__other__";

  var EDITABLE = [
    "condition", "prompt_template", "opening_template", "proxy_url", "model", "reasoning_effort", "temperature", "max_tokens", "word_limit",
    "max_messages", "delay_ms_per_word", "enforce_word_limit", "alternate_questions"
  ];
  var NUMERIC = { temperature: 1, max_tokens: 1, word_limit: 1, max_messages: 1, delay_ms_per_word: 1 };

  var $ = function (id) { return document.getElementById(id); };
  var settingsForm = $("settings-form");

  var session = null; // current conversation + feedback
  var unsent = false;

  // ---------- storage helpers (storage can be blocked; never required) ----------
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function save(obj) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }

  // ---------- settings panel ----------
  function currentSettings() {
    var out = {};
    EDITABLE.forEach(function (key) {
      var el = settingsForm.elements[key];
      out[key] = el.type === "checkbox" ? el.checked : NUMERIC[key] ? Number(el.value) : el.value;
    });
    return out;
  }

  function fillSettings(values) {
    EDITABLE.forEach(function (key) {
      var v = values[key] !== undefined ? values[key] : BalancedChat.DEFAULTS[key];
      var el = settingsForm.elements[key];
      if (el.type === "checkbox") el.checked = !!v;
      else el.value = v;
    });
  }

  function flash(el, text, cls) {
    el.textContent = text;
    el.className = "status" + (cls ? " " + cls : "");
  }

  settingsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    save(currentSettings());
    if (session) {
      startConversation(session.vars);
      flash($("settings-status"), "Applied. Conversation restarted with the new settings.", "ok");
    } else {
      flash($("settings-status"), "Saved. They will be used when you start a conversation.", "ok");
    }
  });

  $("reset-settings").addEventListener("click", function () {
    if (!confirm("Reset the prompt and all settings to the defaults?")) return;
    save({});
    fillSettings({});
    flash($("settings-status"), "Defaults restored. Click Apply to use them.", "");
  });

  // ---------- setup form ----------
  var topicSelect = $("topic-select");
  topicSelect.appendChild(new Option("Choose a topic…", ""));
  TOPICS.forEach(function (t) { topicSelect.appendChild(new Option(t, t)); });
  topicSelect.appendChild(new Option("Other (write your own)", OTHER));
  topicSelect.addEventListener("change", function () {
    $("topic-other").hidden = topicSelect.value !== OTHER;
    $("topic-other").required = topicSelect.value === OTHER;
  });
  $("p-response").addEventListener("input", function () {
    $("char-count").textContent = this.value.length + " / 500";
  });

  $("setup-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var topic = topicSelect.value === OTHER ? $("topic-other").value.trim() : topicSelect.value;
    var pResponse = $("p-response").value.trim();
    if (!topic || !pResponse) return;
    startConversation({ topic: topic, p_response: pResponse });
  });

  $("new-chat").addEventListener("click", function () {
    if (unsent && !confirm("You have feedback that hasn't been emailed. Start over anyway?")) return;
    if (session && session.chat) session.chat.stop();
    session = null;
    unsent = false;
    $("chat-area").hidden = true;
    $("setup-form").hidden = false;
    resetFeedback();
  });

  // ---------- chat ----------
  function resetChatDom() {
    // Replace the input/button so old listeners from a previous chat are dropped.
    var history = $("chat-history-1");
    history.innerHTML = "";
    ["message-input-1", "send-button-1"].forEach(function (id) {
      var old = $(id);
      var fresh = old.cloneNode(true);
      fresh.disabled = false;
      old.parentNode.replaceChild(fresh, old);
    });
    $("message-input-1").value = "";
  }

  // Researcher-facing explanation of a failed request (participants never see this page).
  function explainError(message) {
    if (/Failed to fetch|NetworkError|Load failed|aborted/i.test(message)) {
      return "Couldn't reach the proxy. Check the Proxy URL (Advanced) matches your worker's address, that the worker is deployed, and that this site's address is in its ALLOWED_ORIGINS.";
    }
    if (/OPENAI_API_KEY/.test(message)) return "Add OPENAI_API_KEY as a Secret on the worker (Settings → Variables and Secrets).";
    if (/Model not allowed/.test(message)) return "The worker's ALLOWED_MODELS doesn't include this model. Add it there, or change Model on the left.";
    if (/model/i.test(message) && /exist|not found|invalid|access/i.test(message)) {
      return "OpenAI doesn't recognize this model ID (or your key can't use it). Check the exact name in your OpenAI dashboard, then update Model on the left and ALLOWED_MODELS on the worker.";
    }
    if (/Origin not allowed|HTTP 403/.test(message)) return "The worker rejected this site. Add this page's address to ALLOWED_ORIGINS on the worker.";
    if (/HTTP 401|api key|Incorrect API key/i.test(message)) return "OpenAI rejected the API key. Re-check the OPENAI_API_KEY secret on the worker.";
    return "";
  }

  function showRequestError(turn, message) {
    var box = $("chat-error");
    box.textContent = "";
    var strong = document.createElement("strong");
    strong.textContent = (turn === 0 ? "Opening reply failed" : "Reply " + turn + " failed") + ": ";
    var code = document.createElement("code");
    code.textContent = message;
    box.appendChild(strong);
    box.appendChild(code);
    var hint = explainError(message);
    if (hint) {
      var p = document.createElement("div");
      p.textContent = hint;
      box.appendChild(p);
    }
    box.hidden = false;
  }

  function startConversation(vars) {
    if (session && session.chat) session.chat.stop();
    resetChatDom();
    resetFeedback();
    var cfg = currentSettings();
    var log = {};
    session = {
      id: new Date().toISOString(),
      vars: vars,
      cfg: cfg,
      log: log,
      records: {},
      chat: null
    };
    unsent = false;

    $("chat-error").hidden = true;
    $("setup-form").hidden = true;
    $("chat-area").hidden = false;
    $("topic-shown").textContent = vars.topic + "  (" + cfg.condition + " bot)";

    var chat = BalancedChat.createChat({
      cfg: cfg,
      vars: vars,
      store: { set: function (k, v) { log[k] = v; } },
      dom: { history: $("chat-history-1"), input: $("message-input-1"), button: $("send-button-1") },
      fetch: MOCK ? mockFetch : undefined,
      onBotReply: addTranscript,
      onDone: function () {
        var last = log["msg_" + cfg.max_messages];
        if (last) addTranscriptEntry("You", last, "final message (no reply by design)");
        unsent = true;
        flash($("email-status"), "Conversation finished. Add your overall notes, then click Email feedback.", "");
      },
      onRequestError: showRequestError
    });
    session.chat = chat;
    session.system = chat.system;
    $("sent-prompt").textContent = chat.system;
    chat.start();
  }

  // ---------- feedback ----------
  function resetFeedback() {
    $("turn-feedback").innerHTML = "";
    $("feedback-empty").hidden = false;
    $("overall-notes").value = "";
    flash($("email-status"), "", "");
  }

  function addTranscriptEntry(who, text, meta) {
    $("feedback-empty").hidden = true;
    var li = document.createElement("li");
    li.className = who === "You" ? "tx-you" : "tx-bot";
    var label = document.createElement("strong");
    label.textContent = who + ": ";
    li.appendChild(label);
    li.appendChild(document.createTextNode(text));
    if (meta) {
      var m = document.createElement("div");
      m.className = "tx-meta";
      m.textContent = meta;
      li.appendChild(m);
    }
    var listEl = $("turn-feedback");
    listEl.appendChild(li);
    listEl.scrollTop = listEl.scrollHeight; // keep the newest entry in view
  }

  function addTranscript(record) {
    session.records[record.turn] = record;
    if (record.user) addTranscriptEntry("You", record.user);
    var meta = record.words + " words" + (record.over_limit ? " (over limit)" : "") +
      (record.stance === "shifted" ? " \u00B7 participant shifted" : record.stance === "mixed" ? " \u00B7 participant mixed" : "") +
      (record.parse_ok ? "" : " \u00B7 not in the balanced format");
    addTranscriptEntry("Bot", record.shown, meta);
  }

  function buildReport() {
    var turns = Object.keys(session.records).map(Number).sort(function (a, b) { return a - b; });
    return {
      tester: $("tester-name").value.trim(),
      submitted_at: new Date().toISOString(),
      conversation_started: session.id,
      condition: session.cfg.condition,
      topic: session.vars.topic,
      p_response: session.vars.p_response,
      settings: session.cfg,
      system_prompt_sent: session.system,
      turns: turns.map(function (t) {
        var r = session.records[t];
        return {
          turn: t,
          participant: r.user,
          bot_shown: r.shown,
          support: r.parts ? r.parts.support : "",
          dissent: r.parts ? r.parts.dissent : "",
          stance: r.stance,
          parse_ok: r.parse_ok,
          words: r.words,
          over_limit: r.over_limit
        };
      }),
      final_message: session.log["msg_" + session.cfg.max_messages] || "",
      errors: Object.keys(session.log).filter(function (k) { return k.indexOf("error_") === 0; })
        .map(function (k) { return k + ": " + session.log[k]; }),
      overall_notes: $("overall-notes").value.trim(),
      mock: MOCK,
      user_agent: navigator.userAgent
    };
  }

  function reportText(rep) {
    var lines = [
      "Tester: " + (rep.tester || "(not given)"),
      "Bot condition: " + rep.condition,
      "Submitted: " + rep.submitted_at + (rep.mock ? "  [MOCK MODE]" : ""),
      "Topic: " + rep.topic,
      "Participant explanation: " + rep.p_response,
      "",
      "OVERALL NOTES:",
      rep.overall_notes || "(none)",
      "",
      "TRANSCRIPT"
    ];
    rep.turns.forEach(function (t) {
      lines.push("", "--- " + (t.turn === 0 ? "Opening reply" : "Turn " + t.turn) + " ---");
      if (t.participant) lines.push("Participant: " + t.participant);
      lines.push("Bot (" + t.words + " words, " + (t.parse_ok ? "stance: " + (t.stance || "?") : "NOT balanced format") + "): " + t.bot_shown);
      if (t.parse_ok) lines.push("  woven in -> for: " + t.support + " | against: " + t.dissent);
    });
    if (rep.final_message) lines.push("", "Participant (final, no reply by design): " + rep.final_message);
    if (rep.errors.length) lines.push("", "ERRORS:", rep.errors.join("\n"));
    lines.push(
      "",
      "SETTINGS:",
      Object.keys(rep.settings).filter(function (k) { return k.indexOf("_template") === -1; })
        .map(function (k) { return k + ": " + rep.settings[k]; }).join("\n"),
      "",
      "SYSTEM PROMPT SENT:",
      rep.system_prompt_sent
    );
    return lines.join("\n");
  }

  $("overall-notes").addEventListener("input", function () { if (session) unsent = true; });

  $("download-json").addEventListener("click", function () {
    if (!session) return flash($("email-status"), "Start a conversation first.", "err");
    var rep = buildReport();
    var blob = new Blob([JSON.stringify(rep, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "balanced-chat-feedback-" + rep.submitted_at.replace(/[:.]/g, "-") + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  $("email-feedback").addEventListener("click", function () {
    var status = $("email-status");
    if (!session || !Object.keys(session.records).length) return flash(status, "Start a conversation first.", "err");
    var rep = buildReport();
    var text = reportText(rep);
    window.__lastReport = { json: rep, text: text };

    if (MOCK) {
      console.log(text);
      unsent = false;
      return flash(status, "Mock mode: email not sent (report printed to the console).", "ok");
    }
    var key = PAGE.web3forms_access_key;
    if (!key || key === "PASTE_KEY_HERE") {
      return flash(status, "Email isn't set up yet (no Web3Forms key in config.js). Use Download JSON instead.", "err");
    }

    var btn = $("email-feedback");
    btn.disabled = true;
    flash(status, "Sending…", "");
    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: key,
        subject: (PAGE.email_subject || "Chatbot feedback") + " [" + rep.condition + "]" + (rep.tester ? " from " + rep.tester : ""),
        from_name: rep.tester || "Balanced Chatbot Lab",
        message: text
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.success) throw new Error((data && data.message) || "send failed");
        unsent = false;
        flash(status, "✓ Feedback emailed. Thank you!", "ok");
      })
      .catch(function (err) {
        flash(status, "Couldn't send (" + err.message + "). Please use Download JSON and email the file.", "err");
      })
      .then(function () { btn.disabled = false; });
  });

  window.addEventListener("beforeunload", function (e) {
    if (unsent) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ---------- mock proxy (?mock=1) ----------
  // Type FAIL in a message to simulate a network error, BADJSON for an unparseable reply,
  // "you're right" for a participant who has shifted to the other side.
  var mockCount = 0;
  function mockFetch(url, init) {
    var body = JSON.parse(init.body);
    window.__lastRequest = body;
    mockCount++;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (/FAIL/.test(body.prompt)) return reject(new Error("Simulated network error"));
        var cond = session ? session.cfg.condition : "balanced";
        var forPt = cond === "uncongenial" ? "" : "mock supporting point #" + mockCount;
        var againstPt = cond === "congenial" ? "" : "mock challenging point #" + mockCount;
        var text = /BADJSON/.test(body.prompt)
          ? "Sorry, here is plain text instead of JSON."
          : JSON.stringify({
              stance: /you'?re right/i.test(body.prompt) ? "shifted" : "original",
              message: (/\?\s*(\n|$)/.test(body.prompt)
                ? "Good question, here's a mock answer to it. "
                : "That's a mock reaction to what you just said. ") +
                [forPt && forPt + " fits your view", againstPt && againstPt + " pulls the other way"]
                  .filter(Boolean).join(", though ") + ".",
              support: forPt,
              dissent: againstPt
            });
        resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ text: text }); } });
      }, 250);
    });
  }

  // ---------- init ----------
  fillSettings(loadSaved());
  $("mock-badge").hidden = !MOCK;
})();
