/*
 * Topic phrase for the intellectual humility scale.
 *
 * Turns the participant's belief ("We need more gun control") into a short,
 * neutral phrase ("gun control") and saves it as embedded data `topic_phrase`,
 * so the scale items can pipe it: "My views about ${e://Field/topic_phrase} ...".
 *
 * Put this on a question that comes on a LATER PAGE than the belief question,
 * ideally the "Why do you hold this belief?" question, so the call (about a
 * second) finishes while they type.
 *
 * Question text: add this hidden span (replace QIDx with the belief question's ID):
 *   <span id="belief-src" style="display:none">${q://QIDx/ChoiceTextEntryValue}</span>
 * Question JavaScript: the full contents of chat-core.js, then this file below it.
 */
Qualtrics.SurveyEngine.addOnload(function () {
  var src = document.getElementById("belief-src");
  var belief = src ? src.textContent : "";
  // Fallback first, so the items still read correctly if the call fails or the
  // participant moves on before it returns.
  Qualtrics.SurveyEngine.setEmbeddedData("topic_phrase", "this topic");
  Qualtrics.SurveyEngine.setEmbeddedData("topic_phrase_ok", "0");
  BalancedChat.topicPhrase(belief).then(function (r) {
    Qualtrics.SurveyEngine.setEmbeddedData("topic_phrase", r.phrase);
    Qualtrics.SurveyEngine.setEmbeddedData("topic_phrase_ok", r.ok ? "1" : "0");
  });
});
