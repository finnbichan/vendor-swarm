# Deploying haggle-vendors (Render free + Supabase + real models)

In production, all 8 vendor bots run in **one Render web service** (`bot/host.ts`), each at its own path:

```
https://<service>.onrender.com/            index page
https://<service>.onrender.com/health      status (engine, storage, config version per vendor)
https://<service>.onrender.com/vendors     discovery list for the auctioneer
https://<service>.onrender.com/match       catalogue check across all vendors (swarm key)
https://<service>.onrender.com/v/aurora/card | /quote | /award | /policy | /admin/
```

Locally nothing changes. `npm run swarm` still runs one process per port (4101-4108). `npm run host` runs the production layout on :10000.

## 1. Supabase (config storage + owner logins)

1. Create a project and open **SQL Editor**. Paste and run `supabase/migrations/001_vendor_config.sql`. It creates `vendor_config` and `vendor_config_history`, with RLS on and no policies, so only the service role can read them. It also turns on Realtime for `vendor_config`.
2. Note the **URL**, **anon key** and **service-role key** (Project Settings → API).
3. Create one owner login per vendor:
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run admins -- --all
   ```
   This prints `aurora@haggle.dev  <password>`, and so on. Set `<ID>_ADMIN_PASSWORD` first if you want to choose the passwords yourself.
4. You don't need to seed anything. On first boot each bot copies its repo JSON into its row. Use `npm run config:reset -- --vendor <id>` to reset a vendor to the repo JSON later.

## 2. Model keys

Set a key for every provider you want to use. Each vendor picks a provider and model on its `/admin` page (Rules → Model → **Test model**), or in `vendor.json`:

```json
"llm": { "provider": "openai", "model": "gpt-5-mini" }
```

| Provider id | Key env | Endpoint |
|---|---|---|
| `xai` (default) | `XAI_API_KEY` | https://api.x.ai/v1 |
| `openai` | `OPENAI_API_KEY` | https://api.openai.com/v1 |
| `anthropic` | `ANTHROPIC_API_KEY` | https://api.anthropic.com/v1/ (OpenAI-compatible) |
| `groq` | `GROQ_API_KEY` | https://api.groq.com/openai/v1 |
| `openrouter` | `OPENROUTER_API_KEY` | https://openrouter.ai/api/v1 |
| `together` | `TOGETHER_API_KEY` | https://api.together.xyz/v1 |
| `custom` | `LLM_API_KEY` | `LLM_BASE_URL` (e.g. a vLLM gateway) |

The model has to support **tool calling**. Owners can pick a provider id but never a URL or a key, so a key only ever goes to its own provider.

The model path fails safe. Each call times out after `LLM_TIMEOUT_MS` and is retried once on 429 or 5xx. If the whole turn takes longer than `TURN_BUDGET_MS`, the bot falls back to the scripted negotiator and sends a `fallback` tool event. The model's messages to the buyer are checked for cost or floor figures, and any that contain one are replaced by the vendor's own line.

**Cost:** one auction is roughly 12-25 LLM calls across all bots, which is pennies on most providers. Set a spending limit on each key anyway.

## 3. Render

1. Push this repo to GitHub:
   ```bash
   git add -A && git commit -m "haggle-vendors" && git remote add origin … && git push -u origin main
   ```
2. In Render, go to **New → Blueprint** and pick the repo. `render.yaml` creates one free web service, `haggle-vendors`.
3. Fill in the secrets it asks for:
   - At least one model key (`XAI_API_KEY`).
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   - `CORS_ORIGINS`: your Vercel URL.
   - Optional: `TAVILY_API_KEY` and the Shopify vars.

   `SWARM_API_KEY` and `ADMIN_SESSION_SECRET` are generated for you.
4. Deploy. The service refuses to start if a production secret is missing, and the log names which one.
5. Check `https://<service>.onrender.com/health`. Every vendor should show `engine: "xai:grok-4.7"` and `storage: "supabase"`.

### Staying awake
The free tier sleeps after about 15 minutes idle, and the next request takes 30-60 seconds to wake it.
- **Before a demo:** open `/health` a minute early, or
- **Always on:** set the GitHub repo variable `HAGGLE_VENDORS_URL=https://<service>.onrender.com`. `.github/workflows/keep-warm.yml` then pings it every 10 minutes. One always-on free service fits in Render's 750 free hours a month.

Memory is about 150 MB for all 8 vendors, well within the free tier's 512 MB.

## 4. Test the deployment from your terminal

```bash
export SWARM_API_KEY=<value from Render → Environment>
npm run auction -- "noise cancelling headphones under £260 by Friday" --base https://<service>.onrender.com --real
```

`--real` runs full-speed turns with the real models. Each bot's engine is listed at the start, and any model fallback is flagged with ⚠.

## 5. Point ~/haggle at it (later step)

In the Vercel project:
- `HAGGLE_VENDOR_BASE=https://<service>.onrender.com`. The auctioneer calls `POST /match` with the shopper's intent to learn which vendors will take part, then runs `/quote` rounds against those bots.
- `SWARM_API_KEY=<same value>`, sent as `Authorization: Bearer …` on `/quote` and `/award`.

## Checklist

| | |
|---|---|
| ☐ | Migration run, `npm run admins -- --all` done |
| ☐ | Render env: a model key, 3 Supabase keys, `CORS_ORIGINS` |
| ☐ | `/health` shows real engines and `storage: supabase` |
| ☐ | An owner can log in at `/v/<id>/admin/` and **Test model** works |
| ☐ | `mini-auction --base … --real` completes and awards a code |
| ☐ | Keep-warm variable set (or warm up manually before the demo) |
