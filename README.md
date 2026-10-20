# Balanced Chatbot Lab

This is a test page for a **balanced ("even-handed") chatbot arm** for the AI Interaction study (validating / critical / control). The idea comes from the selective exposure literature on even-handed information search. In every turn, the bot:

1. acknowledges the participant's view without taking sides;
2. gives **one supporting point** the participant didn't mention;
3. gives **one dissenting point** of about equal strength;
4. optionally asks a follow-up question.

The model answers in JSON (`acknowledge`, `support`, `dissent`, `question`). That way the 1:1 balance can be checked on every turn, the parts can be shown in a fixed order, and each part is logged separately for analysis.

## Using the page
Open the GitHub Pages URL; mock mode is described further down.

- **Left:** edit the system prompt and settings, then click **Apply & restart chat**. Your edits are saved in your browser.
- **Middle:** pick a topic or write your own, explain your view, and chat. The page stops after the set number of messages (5 by default).
- **Right:** rate each reply (balanced? good supporting point? good dissenting point?), add notes, and click **Email feedback**. **Download JSON** is a fallback.

Add `?mock=1` to the URL to test the page without calling the API:
- typing `FAIL` simulates a network error;
- typing `BADJSON` simulates a reply in the wrong format.

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
- `response_N`: the reply as shown; `response_0` is the opening reply.
- `support_N`, `dissent_N`: the two points.
- `order_N`: `support-first` or `dissent-first`.
- `transition_N`: the transition phrase placed before the second point.
- `words_N`: word count of the reply as shown.
- `parse_ok_N`: `0` if the model ignored the format and the raw reply was shown.
- `error_N`: network or format problems on that turn.

## Known limitations
- **Third party:** feedback emails pass through Web3Forms. Fine for pilot testing; don't use it with participant data.
- **Public page:** anyone with the URL can use the proxy, which spends API credit.
- **Length confound:** about 50 words per reply here versus 30 in the launched arms.
- **Model shutdown:** `gpt-4.1-nano`, the model used by the launched arms, is scheduled to shut down on Oct 23, 2026, per OpenAI's deprecations page.
- **Accuracy:** the "evidence" comes from a small model and can be wrong or made up. The "good point?" ratings are there to catch this during piloting.
