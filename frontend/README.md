# Dry Dock 2026 starter — Next.js + Supabase

Your team's app. Provisioned by VanderBot, ready to ship.

## What's in here

- **Next.js 15** — App Router, Server Components, Server Actions
- **Supabase** — Postgres + auth + storage in one managed service
- **Tailwind CSS v4** — utility-first styling (no config bloat)
- **Vercel** — auto-deploys on push to `main`

## Run locally

```bash
# 1. Install deps
npm install

# 2. Wire env vars
cp .env.local.example .env.local
# → edit .env.local; VanderBot already pushed the values. If you cloned
#   manually, grab them from your Supabase dashboard → Project Settings → API.

# 3. Go
npm run dev
```

Open http://localhost:3000 — the stack status card tells you if Supabase is connected.

## What to try first

1. **Visit `/`** — home page with a live Supabase connectivity check.
2. **Visit `/demo`** — CRUD example against a `notes` table. First run will
   show "table doesn't exist yet" — click through the error to see the SQL.
3. **Create the `notes` table** — open Supabase Dashboard → SQL Editor, paste:

   ```sql
   create table if not exists notes (
     id uuid primary key default gen_random_uuid(),
     body text not null check (length(body) between 1 and 500),
     created_at timestamptz not null default now()
   );
   alter table notes enable row level security;
   create policy "anon can read" on notes for select using (true);
   create policy "anon can insert" on notes for insert with check (true);
   ```

4. **Refresh `/demo`** — now you have a working form that writes to Postgres.
5. **Clone the pattern.** Look at `app/demo/page.js` + `app/demo/form.js` +
   `lib/supabase-server.js` — that's the full recipe for any server-side CRUD.

## Deploying

Already set up. Push to `main`:

```bash
git add .
git commit -m "your change"
git push
```

Vercel builds + deploys on every push. Your live URL is in the Vercel dashboard
(or ask VanderBot: "what's my deploy URL?").

## Env vars reference

| Name | Scope | Where used |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | both clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | `getBrowserSupabase()`, anon fallback in `getServerSupabase()` |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | `getServerSupabase()` — bypasses RLS for admin reads |
| `SUPABASE_JWT_SECRET` | **server only** | used for custom JWT signing if you add per-team auth |

Vercel auto-injects from the Vercel project env — VanderBot wrote them there
during provisioning. Never put service-role or JWT secrets in `NEXT_PUBLIC_*`
— those get bundled into the browser.

## Ask VanderBot

Whatever you're stuck on, WhatsApp the bot:

- `"Supabase query returns nothing but the row exists"` — usually RLS
- `"how do I add auth?"` — walks you through Supabase Auth setup
- `"build failing on Vercel"` — check the deployment log, bot helps decode
- `"how do I do X in Next.js?"` — general framework help

## File tour

```
app/
  layout.js         root layout + font + globals.css
  page.js           home page with stack-status card
  demo/
    page.js         CRUD server component
    form.js         client component (Server Action submit)
  globals.css       Tailwind + CSS variables
lib/
  supabase-browser.js    createBrowserClient — client components only
  supabase-server.js     createServerClient  — Server Components / Actions
.env.local.example       template for your env (never commit .env.local)
next.config.mjs          Next.js config (strict mode on)
postcss.config.mjs       Tailwind v4 PostCSS plugin
jsconfig.json            @/ path alias
```

## Troubleshooting

**"Supabase env missing"** — you didn't create `.env.local`, or the values are empty. Copy from the example file.

**"relation \"notes\" does not exist"** — run the SQL from step 3 above.

**Build fails with `Cannot find module`** — run `npm install` again; Node 20+ required.

**Auth redirect loop** — clear cookies, or your Supabase project's auth URLs don't include `localhost:3000` in Site URL settings.

---

Template: [thedatawell/template-nextjs-supabase](https://github.com/thedatawell/template-nextjs-supabase)
