# 🏃 Split — Deployment Guide for `split.arqagents.com`

A focused guide to ship Split on Cloudflare in **~45 minutes**, before Pattaya Marathon registration peaks. You've already done this dance with ARQAgents — Split follows the same pattern with two small additions: **KV storage** for the quota, and **web search** in the Claude tool list.

---

## 🏛 Architecture

```
arqagents.com               (Cloudflare Pages — already live)
   └─ Free Apps card → split.arqagents.com

split.arqagents.com         (NEW — Cloudflare Pages)
   ├─ index.html (the UI)
   └─ /api/coach → routes to Worker

split-coach.workers.dev     (NEW — Cloudflare Worker)
   ├─ Holds ANTHROPIC_API_KEY (Worker Secret)
   ├─ Enforces 3-plans-per-day-per-IP via KV
   └─ Forwards to api.anthropic.com with web_search enabled
```

---

## 📁 What's in this package

```
split-site/
├── index.html              ← Split UI (Pattaya-themed)
├── _headers                ← Security headers
├── _redirects              ← Routes /api/coach to Worker
├── .gitignore
├── README.md               ← Quick start
├── DEPLOY_GUIDE.md         ← This file
└── worker/
    ├── worker.js           ← Secure proxy + quota
    └── wrangler.toml       ← Worker config
```

---

# PART 1 — Deploy the Cloudflare Worker

You already have Wrangler installed from ARQAgents. Let's reuse it.

### Step 1.1 — Create a KV namespace for quota tracking

This is the one new thing. KV is Cloudflare's free key-value storage.

```bash
cd split-site/worker
wrangler kv:namespace create "QUOTA_KV"
```

You'll see output like:
```
🌀 Creating namespace with title "split-coach-QUOTA_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "QUOTA_KV", id = "abc123def456..." }
```

**Copy that `id` value.**

### Step 1.2 — Paste the KV ID into wrangler.toml

Open `worker/wrangler.toml` in VS Code. Find this line:

```toml
id = "REPLACE_WITH_KV_ID_FROM_WRANGLER_KV_CREATE"
```

Replace it with your actual KV ID:

```toml
id = "abc123def456..."
```

Save the file.

### Step 1.3 — Set the API key secret

Use the SAME Anthropic API key you used for ARQAgents (or a separate one if you want to budget Split separately).

```bash
wrangler secret put ANTHROPIC_API_KEY
```

Paste your `sk-ant-...` key when prompted. Press Enter.

### Step 1.4 — Deploy the Worker

```bash
wrangler deploy
```

You'll see:
```
✨ Deployed split-coach
   https://split-coach.YOUR-CF-USERNAME.workers.dev
```

**Copy that URL.** You'll need it in Step 2.

### Step 1.5 — Quick health check

In your browser, visit:
```
https://split-coach.YOUR-CF-USERNAME.workers.dev/health
```

You should see:
```json
{ "status": "ok", "service": "Split AI Coach Worker" }
```

✅ Backend is live.

---

# PART 2 — Update the redirect rule

The `_redirects` file tells Cloudflare Pages to route `/api/coach` to your Worker.

### Step 2.1 — Open `_redirects` in VS Code

It currently says:
```
/api/coach  https://split-coach.YOUR-CF-USERNAME.workers.dev/api/coach  200
```

**Replace `YOUR-CF-USERNAME`** with your actual Cloudflare account subdomain (the same one as for arqagents-chat).

Save.

---

# PART 3 — Deploy the website to Cloudflare Pages

### Step 3.1 — Create a new GitHub repo for Split

Go to https://github.com/new (signed in as ARQAgents):
- **Repository name:** `arqagents-split`
- **Public**
- **Don't add README/gitignore/license** (we have files)
- **Create repository**

### Step 3.2 — Push your code

In VS Code's terminal:

```bash
cd ..    # go back to split-site root (out of worker folder)
git init
git remote add origin https://github.com/ARQAgents/arqagents-split.git
git branch -M main
git add .
git commit -m "Initial Split deploy"
git push -u origin main
```

### Step 3.3 — Connect Cloudflare Pages

1. Go to **https://dash.cloudflare.com**
2. **Workers & Pages** → **Create**
3. Click the **"Get started"** link at the bottom (under "Looking to deploy Pages?")
4. **Connect to Git** → select `arqagents-split` repo
5. **Project name:** `arqagents-split`
6. **Production branch:** `main`
7. **Framework preset:** None
8. **Build command:** *(leave blank)*
9. **Build output directory:** `/`
10. **Save and Deploy**

Wait ~1 minute. You'll get a URL like `https://arqagents-split.pages.dev`.

### Step 3.4 — Connect `split.arqagents.com` subdomain

1. In Cloudflare → your `arqagents-split` Pages project
2. **Custom domains** → **Set up a custom domain**
3. Type: `split.arqagents.com`
4. Click **Continue** → **Activate domain**

Wait ~1 minute for SSL.

---

# PART 4 — Test the live site

### Test 1: Basic page loads
Visit `https://split.arqagents.com` — should show the Split UI with the Pattaya Marathon banner at top.

### Test 2: Pattaya autofill works
Click **"Auto-fill for Pattaya Marathon →"** — form should fill with race details (July 19, 42K, Pattaya).

### Test 3: AI Coach works
1. Adjust pace if you want (try `06:30`)
2. Tick a few weekdays
3. Click **Generate Plan**
4. The plan should appear within ~10-30 seconds (AI is doing web search)
5. Quota should show "2 of 3 plans left today" in the corner

### Test 4: Quota enforcement
Generate 3 plans in a row. The 4th should fail with a "Daily limit reached" message.

---

# PART 5 — Add Split card to ARQAgents.com

Last step! Tell your homepage about the new app.

### Step 5.1 — Edit your ARQAgents `index.html`

Open your ARQAgents repo's `index.html` and find the `FREE_APPS` array. It currently has GradeDesk. Add this entry right after it:

```js
{
  tag:        'Fitness · AI',
  name:       'Split',
  desc:       'AI-powered running training plan generator. Tuned for tropical-heat races like Pattaya Marathon 2026. Get a personalized week-by-week plan with paces, weather and local routes. Free, no signup.',
  icon:       '🏃',
  glowColor:  'rgba(200,255,30,.12)',
  features:   ['AI Coach', 'Web Search', 'Weather-aware', '3/day free'],
  url:        'https://split.arqagents.com/',
  status:     'live',
},
```

### Step 5.2 — Push it

```bash
git add .
git commit -m "Add Split card to Free Apps"
git push
```

Cloudflare Pages auto-redeploys ARQAgents in ~30s.

Visit `https://arqagents.com/#free-apps` — you should see two cards: GradeDesk and Split. 🎉

---

# 🛠 Troubleshooting

| Problem | Fix |
|---|---|
| `QUOTA_KV not bound` warning in Worker logs | Make sure you ran `wrangler kv:namespace create` and pasted the ID in `wrangler.toml`, then `wrangler deploy` |
| `Origin not allowed` (403) | Add your domain to `ALLOWED_ORIGINS` in `worker/worker.js`, redeploy |
| `/api/coach` returns 404 | Check `_redirects` file has the correct Worker URL |
| "Daily limit reached" too quickly | The Worker tracks by IP. If you're testing on the same network, the quota is shared. Test from your phone (mobile data) for a different IP |
| Plan generates but no AI tips | Check Worker logs: `wrangler tail`. Most likely the Anthropic key has run out of credit |
| Page loads but blank | Open browser DevTools (F12) → Console. Look for the error |
| Worker calls fail with CORS | Confirm `split.arqagents.com` is in `ALLOWED_ORIGINS` exactly (no trailing slash) |

---

# 💰 Cost reality check

| Service | Free Tier | Your Usage |
|---|---|---|
| **Cloudflare Pages** | Unlimited bandwidth | Negligible |
| **Cloudflare Workers** | 100k requests/day | ~3 per visitor (quota) |
| **Cloudflare KV** | 100k reads, 1k writes/day | Plenty for quota |
| **Anthropic API** | Pay-per-token | ~$0.05 per plan with web_search (Sonnet 4) |

For a typical day with 30 visitors × 1.5 plans avg = **~45 plans = ~$2.25/day = ~₱130/day** at peak. With the 3/day cap, your absolute MAXIMUM daily cost from one user is bounded.

If you want to drop costs further, swap `claude-sonnet-4-20250514` in the HTML to `claude-haiku-4-5-20251001` — same UX but ~5× cheaper. Quality might dip slightly for the "research" coach notes, but the core training plan is deterministic anyway.

---

# 🚀 Launch checklist for Pattaya Marathon timing

- [ ] Worker deployed and `/health` returns 200
- [ ] KV namespace created and ID in `wrangler.toml`
- [ ] `ANTHROPIC_API_KEY` secret set on Worker
- [ ] `_redirects` has correct Worker URL
- [ ] Pages project deployed and accessible at `arqagents-split.pages.dev`
- [ ] Custom domain `split.arqagents.com` working with HTTPS
- [ ] Pattaya autofill button populates form correctly
- [ ] AI Coach generates a real plan (test end-to-end)
- [ ] Quota counter decrements (test 2-3 plans)
- [ ] Split card visible on `arqagents.com/#free-apps`
- [ ] Back-link from Split footer to arqagents.com works
- [ ] Tested on mobile (most marathon runners check on phone)

---

# 📣 Marketing ideas (since you have time before race day)

Once Split is live, here are some quick wins to drive traffic during the Pattaya registration window:

1. **Post in Filipino running Facebook groups** — "Free AI training plan generator built for Pattaya Marathon, made in PH 🇵🇭"
2. **Tag the Pattaya Marathon official IG/FB** — they often share runner resources
3. **Reddit r/running, r/Philippines** — "Made a free training planner for tropical marathons"
4. **LinkedIn post** — story about building it (links back to ARQAgents)

The combination of **timely (registration just opened)** + **free** + **specific (Pattaya tropical)** is a content-marketing trifecta. 🎯

Go ship it! 🏃‍♂️🇹🇭🚀
