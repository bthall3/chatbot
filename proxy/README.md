# balanced-chat-proxy (Cloudflare Worker)

This proxy sits between the test page (and later Qualtrics) and OpenAI, so the API key never reaches the browser. It accepts the same requests and returns the same replies as the proxy the launched study uses:
- request: `POST /` with `{prompt, system, history, model, temperature, max_tokens}` and an optional `reasoning_effort`;
- reply: `{text}`, or `{error}` with an error status.

What it adds over the existing proxy:
- **Works with reasoning models** such as `gpt-5.6-luna`. It sends `reasoning_effort` (default `"none"`, which is fast and still allows `temperature`) and uses `max_completion_tokens` instead of `max_tokens`. If OpenAI rejects a parameter, it retries once without it.
- **CORS allow-list:** only `https://bthall3.github.io`, `https://*.qualtrics.com` and localhost can call it from a browser.
- **Model allow-list**, so someone who finds the URL can't run expensive models on your key.

It's deployed as a **new** worker, so the proxy behind the launched study (`openai-api-proxy`) isn't changed.

## Deploy (Cloudflare dashboard, no install needed)
1. Log in to the Cloudflare account that owns `bthall3.workers.dev` (the one with `qualtrics-intake`).
2. Go to **Workers & Pages → Create → Create Worker**, name it `balanced-chat-proxy`, and click **Deploy**.
3. Click **Edit code**, replace everything with the contents of `worker.js`, and click **Deploy**.
4. Go to **Settings → Variables and Secrets**:
   - add `OPENAI_API_KEY` as a **Secret**;
   - optionally add `ALLOWED_ORIGINS` and `ALLOWED_MODELS` (the defaults are in `worker.js` and `wrangler.toml`).
5. The URL will be `https://balanced-chat-proxy.bthall3.workers.dev/`, which is the test page's default. If yours differs, change **Proxy URL** under *Advanced* on the test page, or `proxy_url` in `chat-core.js`.

Or deploy from the command line: in this folder, run `npx wrangler deploy`, then `npx wrangler secret put OPENAI_API_KEY`.

## Check it
On the test page without `?mock=1`, start a conversation. Alternatively, run:

```bash
curl -s https://balanced-chat-proxy.bthall3.workers.dev/ \
  -H "Origin: https://bthall3.github.io" -H "Content-Type: application/json" \
  -d '{"prompt":"Say hi in 3 words","system":"Be brief.","history":[],"model":"gpt-5.6-luna","temperature":0.5,"max_tokens":50}'
```

`{"text": "..."}` means it works. If `{"error": ...}` names the model, check the exact model ID in your OpenAI dashboard. Sources disagree on whether it's `gpt-5.6-luna` or `gpt-6-luna`; add the right one to `ALLOWED_MODELS` and set it on the page.

Tests: `node --test "tests/*.test.*"` from the repo root.
