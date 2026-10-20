// Test-page wiring: settings panel, setup form, chat, feedback + email.
(function () {
  "use strict";

  var PAGE = window.PAGE_CONFIG || {};
  var MOCK = /[?&]mock=1\b/.test(location.search);
  var SETTINGS_KEY = "balancedChat.settings.v3"; // v3: per-part word budgets in the prompt

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
    "prompt_template", "opening_template", "proxy_url", "model", "reasoning_effort", "temperature", "max_tokens", "word_limit",
    "max_messages", "delay_ms_per_word", "order", "transitions", "enforce_word_limit"
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
      ratings: {},
      chat: null
    };
    unsent = false;

    $("setup-form").hidden = true;
    $("chat-area").hidden = false;
    $("topic-shown").textContent = vars.topic;

    var chat = BalancedChat.createChat({
      cfg: cfg,
      vars: vars,
      store: { set: function (k, v) { log[k] = v; } },
      dom: { history: $("chat-history-1"), input: $("message-input-1"), button: $("send-button-1") },
      fetch: MOCK ? mockFetch : undefined,
      onBotReply: function (record) { addTurnCard(record); },
      onDone: function () { flash($("email-status"), "Conversation finished. Add any notes, then click Email feedback.", ""); }
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

  function rateRow(turn, key, label) {
    var row = document.createElement("div");
    row.className = "rate";
    var span = document.createElement("span");
    span.textContent = label;
    var btns = document.createElement("div");
    btns.className = "btns";
    [["up", "👍", "good"], ["down", "👎", "bad"]].forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = b[0];
      btn.textContent = b[1];
      btn.setAttribute("aria-label", label + " " + b[2]);
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", function () {
        var r = session.ratings[turn];
        r[key] = r[key] === b[2] ? "" : b[2]; // click again to clear
        Array.prototype.forEach.call(btns.children, function (x) {
          x.setAttribute("aria-pressed", String(r[key] === (x.className === "up" ? "good" : "bad")));
        });
        unsent = true;
      });
      btns.appendChild(btn);
    });
    row.appendChild(span);
    row.appendChild(btns);
    return row;
  }

  function addTurnCard(record) {
    var turn = record.turn;
    session.records[turn] = record;
    session.ratings[turn] = { balanced: "", support: "", dissent: "", note: "" };
    $("feedback-empty").hidden = true;

    var li = document.createElement("li");
    li.className = "turn-card";
    var h = document.createElement("h3");
    h.textContent = (turn === 0 ? "Opening reply" : "Reply " + turn) + " · " + record.words + " words" +
      (record.over_limit ? " (over limit)" : "");
    li.appendChild(h);

    if (record.user) {
      var you = document.createElement("p");
      you.className = "you";
      you.textContent = "You: " + record.user;
      li.appendChild(you);
    }

    if (record.parse_ok) {
      var dl = document.createElement("dl");
      [["Supports you", record.parts.support], ["Challenges you", record.parts.dissent]].forEach(function (p) {
        var dt = document.createElement("dt");
        dt.textContent = p[0];
        var dd = document.createElement("dd");
        dd.textContent = p[1];
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      li.appendChild(dl);
    } else {
      var flag = document.createElement("p");
      flag.className = "flag";
      flag.textContent = "Not in the balanced format (support/dissent missing or reply failed). Shown as raw text.";
      li.appendChild(flag);
    }

    li.appendChild(rateRow(turn, "balanced", "Balanced overall?"));
    if (record.parse_ok) {
      li.appendChild(rateRow(turn, "support", "Supporting point good?"));
      li.appendChild(rateRow(turn, "dissent", "Dissenting point good?"));
    }
    var note = document.createElement("textarea");
    note.rows = 2;
    note.placeholder = "Notes on this reply (optional)";
    note.addEventListener("input", function () {
      session.ratings[turn].note = note.value;
      unsent = true;
    });
    li.appendChild(note);
    var listEl = $("turn-feedback");
    listEl.appendChild(li);
    listEl.scrollTop = listEl.scrollHeight; // keep the newest reply in view
  }

  function buildReport() {
    var turns = Object.keys(session.records).map(Number).sort(function (a, b) { return a - b; });
    return {
      tester: $("tester-name").value.trim(),
      submitted_at: new Date().toISOString(),
      conversation_started: session.id,
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
          order: r.order,
          transition: r.transition,
          parse_ok: r.parse_ok,
          words: r.words,
          over_limit: r.over_limit,
          rating: session.ratings[t]
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
      "Submitted: " + rep.submitted_at + (rep.mock ? "  [MOCK MODE]" : ""),
      "Topic: " + rep.topic,
      "Participant explanation: " + rep.p_response,
      "",
      "OVERALL NOTES:",
      rep.overall_notes || "(none)",
      "",
      "TRANSCRIPT + RATINGS"
    ];
    rep.turns.forEach(function (t) {
      lines.push("", "--- " + (t.turn === 0 ? "Opening reply" : "Turn " + t.turn) + " ---");
      if (t.participant) lines.push("Participant: " + t.participant);
      lines.push("Bot (" + t.words + " words, " + (t.parse_ok ? t.order + ', "' + t.transition + '"' : "NOT balanced format") + "): " + t.bot_shown);
      lines.push(
        "Rating -> balanced: " + (t.rating.balanced || "-") +
        " | support: " + (t.rating.support || "-") +
        " | dissent: " + (t.rating.dissent || "-")
      );
      if (t.rating.note) lines.push("Note: " + t.rating.note);
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
        subject: (PAGE.email_subject || "Balanced chatbot feedback") + (rep.tester ? " from " + rep.tester : ""),
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
  // Type FAIL in a message to simulate a network error, BADJSON for an unparseable reply.
  var mockCount = 0;
  function mockFetch(url, init) {
    var body = JSON.parse(init.body);
    window.__lastRequest = body;
    mockCount++;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (/FAIL/.test(body.prompt)) return reject(new Error("Simulated network error"));
        var text = /BADJSON/.test(body.prompt)
          ? "Sorry, here is plain text instead of JSON."
          : JSON.stringify({
              acknowledge: "I see why that matters to you.",
              support: "a mock supporting point (#" + mockCount + ") you didn't mention.",
              dissent: "a mock dissenting point (#" + mockCount + ") to consider.",
              question: "What do you think?"
            });
        resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ text: text }); } });
      }, 250);
    });
  }

  // ---------- init ----------
  fillSettings(loadSaved());
  $("mock-badge").hidden = !MOCK;
})();
