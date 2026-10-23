# Chatbot Lab

This is a test page for the study's information-exposure chatbots, from the selective exposure literature on congenial, uncongenial and even-handed information search. The **Bot condition** setting picks one of three bots:

| Condition | In every message |
|---|---|
| **balanced** | one consideration for the participant's current view **and** one against it |
| **congenial** | one consideration **for** their *original* view (the one they wrote before the chat) |
| **uncongenial** | one consideration **against** their *original* view |

All three use **the same prompt**. Only the condition rules (`{condition_rules}`) and the worked examples (`{examples}`) differ; a unit test checks that everything else is identical. The directional bots stay anchored to the participant's **original** view for the whole chat, as in selective exposure designs. Congenial keeps backing it even if they start to doubt it, and uncongenial keeps challenging it. They may briefly acknowledge what the participant said (e.g. "that can help, but…") as long as each message clearly lands on their side. The balanced bot instead follows the participant's *current* leaning (see below). Congenial and uncongenial give one consideration per message versus two for balanced, so amount of information is confounded with direction.

The rest of this README describes the balanced bot; the same style, length, neutrality and question rules apply to all three.

The bot is a **conversation partner first**. It replies to what the participant actually said, answers their questions and picks up their examples. **Every message** also weaves in, naturally and without lists or labels:

- **one consideration that supports** the participant's view, which they didn't mention;
- **one consideration that challenges** it, of about equal strength.

**Style:** casual and concise, usually 25–40 words in 2–3 short sentences (60 at most). It doesn't agree with, praise or grade the participant, and it avoids vague "research shows" claims.

**Questions:** the code, not the model, decides how each reply ends. The opening and every other reply end with a short question; the rest end on a statement. A very short or noncommittal message ("idk", "maybe") always gets an easy question. This is the **Alternate questions** setting.

**Bored or distracted participants:** for short, noncommittal or off-topic replies, the bot stays brief (under about 25 words), still includes both considerations, and steers back with an easy question. It never treats the chat as an assignment or comments on their effort, and "idk"-type replies don't count as a change of view.

**Following the participant:** "support" and "dissent" are relative to where the participant stands *now*, not just their opening view. If they start agreeing with the other side, the bot follows. Its main point builds on their new leaning, and the counterpoint becomes a brief, gentle "worth keeping in mind" from the side they moved away from (about half as long), never a rebuttal. While they hold their original view, both points are equally strong.

The model writes the whole message itself, and the page shows it as-is. It answers in JSON (`stance`, `message`, `support`, `dissent`). `message` is what the participant reads. `support` and `dissent` are the model's short summaries of the two considerations it wove in; they're logged, never shown. A turn only counts as valid if it has the considerations its condition calls for (both for balanced, only a supporting one for congenial, only a challenging one for uncongenial). An unreadable reply is retried once; a readable one that points the wrong way gets one targeted repair request naming the part to drop or add.

## Using the page
Open the GitHub Pages URL; mock mode is described further down.

- **Left:** edit the system prompt and settings, then click **Apply & restart chat**. Your edits are saved in your browser.
- **Middle:** pick a topic or write your own, explain your view, and chat. The page stops after the set number of messages (5 by default).
- **Right:** the transcript builds up as you chat. Add your overall notes at the bottom and click **Email feedback**, which sends the transcript, notes and settings. **Download JSON** is a fallback.

Add `?mock=1` to the URL to test the page without calling the API:
- typing `FAIL` simulates a network error;
- typing `BADJSON` simulates a reply in the wrong format;
- typing `you're right` simulates a participant who has shifted.

## One-time setup
1. **Email:**
   - Go to <https://web3forms.com>, enter the email address that should receive feedback, and copy the access key.
   - Paste the key into `config.js` (`web3forms_access_key`).
   - The key is meant to be public; it can only send to your inbox.
2. **GitHub Pages:**
   - Go to repo **Settings → Pages → Build and deployment → Deploy from a branch**.
   - Choose the branch that holds these files (`main` after merging), folder `/ (root)`.
   - The page will be at `https://bthall3.github.io/chatbot/`.
3. **Proxy:** deploy `proxy/worker.js` as a new Cloudflare Worker named `balanced-chat-proxy` (steps in [`proxy/README.md`](proxy/README.md)).
   - The page defaults to `gpt-5.6-luna` with reasoning set to `none`. The old proxy can't run this model, because it sends `max_tokens` and `temperature`, which reasoning models reject.
   - If the first reply never appears, open the browser console (F12). The error message says what's wrong: origin, model, or API key.

## Files
| File | Purpose |
|---|---|
| `chat-core.js` | Chat engine: prompt, proxy calls, JSON parsing, rendering, logging. No dependencies; pasted verbatim into Qualtrics. |
| `index.html`, `styles.css`, `app.js` | Test page (settings panel, chat, feedback, email). |
| `config.js` | Web3Forms key and email subject. |
| `proxy/` | Cloudflare Worker that forwards chats to OpenAI (supports reasoning models), plus deploy steps. |
| `qualtrics/` | How to add this as a 4th arm in the survey (`README.md`, `question.html`, `adapter.js`). |
| `tests/` | Unit tests: `node --test "tests/*.test.*"` |

## Logged fields (same names in Qualtrics)
- `msg_N`: participant message.
- `response_N`: the bot's message as shown; `response_0` is the opening message.
- `support_N`, `dissent_N`: the model's summary of the consideration it wove in for the participant's current leaning, and the one from the other side. After a shift, the dissent is the gentle counterpoint.
- `stance_N`: the model's read of the participant: `original`, `shifted` or `mixed`.
- `words_N`: word count of the reply as shown.
- `parse_ok_N`: `0` if the reply was unreadable (raw text shown) or pointed the wrong way for the condition after one retry (the model's message is shown; `support_N`/`dissent_N` show what it reported).
- `error_N`: network or format problems on that turn.

## Known limitations
- **Third party:** feedback emails pass through Web3Forms. Fine for pilot testing; don't use it with participant data.
- **Public page:** anyone with the URL can use the proxy, which spends API credit.
- **Length confound:** about 60 words per reply here versus 30 in the launched arms.
- **Model shutdown:** `gpt-4.1-nano`, the model used by the launched arms, is scheduled to shut down on Oct 23, 2026, per OpenAI's deprecations page.
- **Shift detection:** the model judges `stance` itself. Check `stance_N` against the transcripts during piloting. After a shift, the two sides are no longer equally weighted, so balance varies by participant; account for this in analysis.
- **Self-reported balance:** the page can't see inside free prose, so `support_N` and `dissent_N` are the model's own account of what it wove in. Spot-check them against `response_N` during piloting.
- **Word limit:** a long message gets one rewrite request. If it's still over, it's shown and flagged, because free prose can't be cut safely.
- **Accuracy:** the "evidence" comes from a small model and can be wrong or made up. Use the overall notes to flag weak or inaccurate points during piloting.
