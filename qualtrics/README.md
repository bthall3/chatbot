# Porting the balanced arm into Qualtrics

The test page and Qualtrics run the same engine (`chat-core.js`), so tune the bot on the test page first, then copy the settings here.

## 1. Question
In a new block (for example "Balanced chatbot"), add the same intro text question as the other arms, then a **Text/Graphic** question:

- **HTML view:** paste `qualtrics/question.html`.
- **JavaScript:** delete the default stub, paste **all of `chat-core.js`**, then paste **`qualtrics/adapter.js`** below it.
- In `adapter.js`, copy into `cfg` any settings you changed on the test page (prompt, word limit, order, transitions, and so on). To copy a long prompt, the "Prompt actually sent" box shows the filled-in version; you want the *template* from the System prompt box. Set `prompt_template` to it as a JS string, with line breaks written as `\n`.

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
- In the block randomizer, add a 4th group, **Balanced**. Give it an Embedded Data element with `cond = balanced`, followed by the new block.
  - Don't set `model`, `temperature`, or `prompt` there. The adapter takes those from `cfg` and the defaults.
- Declare these fields in an Embedded Data element **before** the randomizer, with no value, so `setEmbeddedData` saves them:
  - `msg_1` … `msg_5`, `response_0` … `response_4` (already declared for the other arms)
  - `support_0` … `support_4`, `dissent_0` … `dissent_4`
  - `order_0` … `order_4`, `stance_0` … `stance_4`, `transition_0` … `transition_4`, `parse_ok_0` … `parse_ok_4`, `words_0` … `words_4`, `error_0` … `error_4`

  With `max_messages = 5`, the 5th participant message gets no reply by design, so `response_5` stays empty.

## 3. Check before launch
- **`p_response` and `topic`:** in the launched flow these are set to `${q://QID10/ChoiceTextEntryValue}Custom Value` and `${q://QID8/ChoiceGroup/SelectedChoices}Custom Value`. The trailing "Custom Value" is very likely leftover placeholder text that ends up in the prompt. Remove it, then preview and check the stored values.
- **Preview test:** run one preview of the balanced arm. Confirm that `response_N`, `support_N`, and `dissent_N` all filled in and that `parse_ok_N` is `1`.

## Differences from the launched arms (note these in the methods)
- Replies are capped at about 50 words instead of 30, because each reply has to fit a supporting point and a dissenting point.
- The opening message is a balanced reply, not the generic "warm" opener the other arms use.
- The 5th participant message gets no API call. The launched arms generate `response_5` but never show it.
- While a reply is pending, the input is locked. A failed request asks the participant to resend instead of failing silently.
- The bot follows the participant. While they hold their starting view, the two points are equally strong. If they shift toward the other side (`stance_N` = `shifted` or `mixed`), the main point backs their new leaning and the counterpoint becomes brief and gentle, so balance after a shift varies by participant.
