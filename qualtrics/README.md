# Porting the balanced arm into Qualtrics

The test page and Qualtrics run the same engine (`chat-core.js`), so tune the bot on the test page first, then copy the settings here.

## 1. Question
In a new block (for example "Balanced chatbot"), add the same intro text question as the other arms, then a **Text/Graphic** question:

- **HTML view:** paste `qualtrics/question.html`.
- **JavaScript:** delete the default stub, paste **all of `chat-core.js`**, then paste **`qualtrics/adapter.js`** below it.
- In `adapter.js`, copy into `cfg` any settings you changed on the test page (prompt, word limit, and so on). To copy a long prompt, the "Prompt actually sent" box shows the filled-in version; you want the *template* from the System prompt box. Set `prompt_template` to it as a JS string, with line breaks written as `\n`.

The existing custom CSS (`#chat-container`, `.bot-message`, …) already styles it. Optionally add:

```css
.bot-message.typing { font-style: italic; color: #888; }
.bot-message.error { background: #fdecea; }
.user-message.failed { opacity: .55; }
.message { white-space: pre-wrap; }
#chat-input { align-items: flex-end; }
#message-input-1 { resize: none; overflow-y: auto; line-height: 1.4; max-height: calc(6 * 1.4em + 16px); font-family: inherit; }
```

## 2. Survey flow
- In the block randomizer, add a group per arm you're running: **Balanced**, **Congenial** and/or **Uncongenial**. Give each an Embedded Data element with `cond = balanced`, `cond = congenial` or `cond = uncongenial`, followed by a chat block. All three use the same question JavaScript; the adapter reads `cond` and switches the condition, so the prompts stay identical except for the direction rules.
  - Don't set `model`, `temperature`, or `prompt` there. The adapter takes those from `cfg` and the defaults.
- Declare these fields in an Embedded Data element **before** the randomizer, with no value, so `setEmbeddedData` saves them:
  - `msg_1` … `msg_5`, `response_0` … `response_4` (already declared for the other arms)
  - `support_0` … `support_4`, `dissent_0` … `dissent_4`
  - `stance_0` … `stance_4`, `direction_0` … `direction_4` (congenial/uncongenial only), `parse_ok_0` … `parse_ok_4`, `words_0` … `words_4`, `error_0` … `error_4`

  With `max_messages = 5`, the 5th participant message gets no reply by design, so `response_5` stays empty.

- **Belief condition:** randomize `value_cond = high` or `value_cond = low` before the belief questions, and show the matching prompt (display logic on two text-entry questions, or one question with piped text):
  - high: "Think of a belief you hold that is very important to you, one that reflects your core values. Write it as a short statement."
  - low: "Think of a belief you hold that is not very important to you, an opinion you have but don't care much about. Write it as a short statement."

  Then ask "Why do you hold this belief?". Set `topic` to the belief and `p_response` to the reason in an Embedded Data element after those questions (piped `${q://QIDx/ChoiceTextEntryValue}`). `value_cond` is saved by the survey itself; the chat code doesn't need it.

## 3. Check before launch
- **`p_response` and `topic`:** the launched flow set these with a trailing "Custom Value", which is very likely leftover placeholder text that ends up in the prompt. Make sure the new piped values have nothing extra, then preview and check the stored values.
- **Preview test:** run one preview of the balanced arm. Confirm that `response_N`, `support_N`, and `dissent_N` all filled in and that `parse_ok_N` is `1`.

## Differences from the launched arms (note these in the methods)
- The bot writes conversational replies with one supporting and one challenging consideration woven into every message. `support_N` and `dissent_N` are the model's own summaries of those two points.
- Replies are capped at about 60 words instead of 30, because each one has to fit both considerations. A reply that's still long after one rewrite request is shown and flagged, not cut.
- The opening message is itself a balanced, conversational reply, not the generic "warm" opener the other arms use.
- The 5th participant message gets no API call. The launched arms generate `response_5` but never show it.
- While a reply is pending, the input is locked. A failed request asks the participant to resend instead of failing silently.
- The bot stays even-handed throughout. If the participant shifts toward the other side (`stance_N` = `shifted` or `mixed`), it backs their new view and also gives backing for the side they moved away from; `support_N` and `dissent_N` are then relative to the new view.
