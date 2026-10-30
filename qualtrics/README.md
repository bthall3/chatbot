# Qualtrics

## Quick start: import the whole study
`build_qsf.py` writes the complete survey from the final materials (*Even_Handed_Chatbot_Materials_Final.docx*) as a Qualtrics import file. It starts from an export of the launched "AI Interaction" survey, which is known to import: it reuses that survey's settings, consent and debriefing, and copies each question type from it.

```
python3 qualtrics/build_qsf.py AI_Interaction_LAUNCH.qsf
```

This writes `qualtrics/Even_Handed_Chatbot.qsf`. QSF files are git-ignored here because they contain the consent form. In Qualtrics: **Create a new project → Survey → From a file → Import a QSF file**.

It contains:

| Block | What's in it |
|---|---|
| Consent | copied from the launched survey |
| Intro | "Today, you will be chatting with an AI chatbot…" |
| *Randomizer* | `value_cond` = `high` or `low` (evenly), which sets the belief prompt |
| Belief | the high- or low-stakes prompt with the attitude statement; next page: "Now, please briefly explain why you hold that belief." (this page also makes `topic_phrase`) |
| Pre-chat attitude | agreement (−50 to +50), then clarity, correctness, importance, knowledge, commitment (0–100 sliders) |
| *Randomizer* | `cond` = `balanced`, `congenial` or `uncongenial` (evenly) |
| Chatbot conversation | chat instructions; next page: the chat (7 participant messages, then auto-advance) |
| Post-chat attitude | the same items, "After chatting with the AI, …" |
| Chatbot ratings | technical difficulties; 5 rating items (1–6 agree); 10 characteristics (1–6 agree), item 7 is the attention check `Select "Somewhat agree"` |
| Intellectual humility | 9 items (1–5), blanks filled with `${e://Field/topic_phrase}` |
| Need for cognition | 18 items (1–5) |
| Demographics | sex, age, ethnicity, political orientation; AI use; AI trust (1–100) |
| Debriefing | copied from the launched survey (it describes that study: update the title and purpose) |

The chat in Qualtrics is the same code as the test page. After changing `chat-core.js`, `adapter.js` or `topic-phrase.js`, rebuild and re-import, or paste the new code into the two questions by hand.

**Before launch:**
- Update the consent and debriefing: they are the launched survey's (title "AI and Interpersonal Relationships", IRB date 2/23/26).
- Set the end of survey. The SONA credit redirect from the launch survey is *not* included, because the experiment ID differs; add the new study's redirect in Survey options.
- Preview each condition. Survey flow → set `value_cond` and `cond` by hand in a test, or preview several times. Check that the chat works and that the intellectual humility items show the topic phrase.
- Check the scale anchors and the forced-response settings (every question is forced-response, as in the launch survey).

The sections below describe the pieces, for building or changing the survey by hand.

## Porting the chat into an existing survey

The test page and Qualtrics run the same engine (`chat-core.js`), so tune the bot on the test page first, then copy the settings here.

### 1. Question
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

### 2. Survey flow
- In the block randomizer, add a group per arm you're running: **Balanced**, **Congenial** and/or **Uncongenial**. Give each an Embedded Data element with `cond = balanced`, `cond = congenial` or `cond = uncongenial`, followed by a chat block. All three use the same question JavaScript; the adapter reads `cond` and switches the condition, so the prompts stay identical except for the direction rules.
  - Don't set `model`, `temperature`, or `prompt` there. The adapter takes those from `cfg` and the defaults.
- Declare these fields in an Embedded Data element **before** the randomizer, with no value, so `setEmbeddedData` saves them:
  - `msg_1` … `msg_7`, `response_0` … `response_6`
  - `support_0` … `support_6`, `dissent_0` … `dissent_6`
  - `stance_0` … `stance_6`, `direction_0` … `direction_6` (congenial/uncongenial only), `parse_ok_0` … `parse_ok_6`, `words_0` … `words_6`, `error_0` … `error_6`

  With `max_messages = 7` (7 participant messages, 7 bot messages counting the opening), the 7th participant message gets no reply by design.

- **Belief condition:** randomize `value_cond = high` or `value_cond = low` before the belief questions, and show the matching prompt (display logic on two text-entry questions, or one question with piped text):
  - high: "Think of a belief you hold that is very important to you, one that reflects your core values. Write it as a short statement."
  - low: "Think of a belief you hold that is not very important to you, an opinion you have but don't care much about. Write it as a short statement."

  Then ask "Why do you hold this belief?". Set `topic` to the belief and `p_response` to the reason in an Embedded Data element after those questions (piped `${q://QIDx/ChoiceTextEntryValue}`). `value_cond` is saved by the survey itself; the chat code doesn't need it.

- **Intellectual humility scale topic:** to fill the blanks of the scale items ("My views about ___ may change…") with the participant's topic, follow the steps in `qualtrics/topic-phrase.js`:
  - put it on the "Why do you hold this belief?" question, or any question on a later page than the belief;
  - in the scale items, use `${e://Field/topic_phrase}` in each blank;
  - declare `topic_phrase` and `topic_phrase_ok` with the other fields.

  A separate model call turns the belief into a short, neutral phrase ("We need more gun control" → "gun control"). If the call fails, the phrase is "this topic" and `topic_phrase_ok` is `0`.

### 3. Check before launch
- **`p_response` and `topic`:** the launched flow set these with a trailing "Custom Value", which is very likely leftover placeholder text that ends up in the prompt. Make sure the new piped values have nothing extra, then preview and check the stored values.
- **Preview test:** run one preview of the balanced arm. Confirm that `response_N`, `support_N`, and `dissent_N` all filled in and that `parse_ok_N` is `1`.

### Differences from the launched arms (note these in the methods)
- The bot writes conversational replies with one supporting and one challenging consideration woven into every message. `support_N` and `dissent_N` are the model's own summaries of those two points.
- Replies are capped at about 60 words instead of 30, because each one has to fit both considerations. A reply that's still long after one rewrite request is shown and flagged, not cut.
- The opening message is itself a balanced, conversational reply, not the generic "warm" opener the other arms use.
- The 7th (last) participant message gets no API call, so a failed request can't strand anyone at the end.
- While a reply is pending, the input is locked. A failed request asks the participant to resend instead of failing silently.
- The bot stays even-handed throughout. If the participant shifts toward the other side (`stance_N` = `shifted` or `mixed`), it backs their new view and also gives backing for the side they moved away from; `support_N` and `dissent_N` are then relative to the new view.
