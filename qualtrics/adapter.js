/*
 * Qualtrics adapter for the balanced chatbot.
 *
 * Question JavaScript = the full contents of chat-core.js, then this file below it.
 * Question HTML       = qualtrics/question.html
 * See qualtrics/README.md for the survey-flow fields to declare.
 */
Qualtrics.SurveyEngine.addOnload(function () {
  this.hideNextButton(); // auto-advance handles page progression
});

Qualtrics.SurveyEngine.addOnReady(function () {
  var q = this;

  function ed(key) {
    return (Qualtrics.SurveyEngine.getEmbeddedData(key) || "").replace(/[\r\n]+/g, " ").trim();
  }

  // Copy any settings you changed on the test page here. Anything left out uses
  // BalancedChat.DEFAULTS (model, prompt_template, word_limit, ...).
  // Set them here, not via embedded data: the launched flow's "GPT-4.1 nano"
  // value is not a valid model ID, and gpt-4.1-nano shuts down Oct 23, 2026.
  // Requires the balanced-chat-proxy worker (proxy/README.md).
  var cfg = {
    max_messages: 7
  };

  // One script for all three arms: the survey flow sets `cond` to balanced,
  // congenial or uncongenial. Anything else falls back to balanced.
  var cond = ed("cond");
  cfg.condition = BalancedChat.CONDITIONS[cond] ? cond : "balanced";

  var chat = BalancedChat.createChat({
    cfg: cfg,
    vars: { topic: ed("topic"), p_response: ed("p_response") },
    store: {
      set: function (key, value) { Qualtrics.SurveyEngine.setEmbeddedData(key, value); }
    },
    dom: {
      history: document.getElementById("chat-history-1"),
      input: document.getElementById("message-input-1"),
      button: document.getElementById("send-button-1")
    },
    onDone: function () {
      setTimeout(function () { q.clickNextButton(); }, 5000);
    }
  });
  chat.start();
});
