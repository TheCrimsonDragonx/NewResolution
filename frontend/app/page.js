import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase-server";

export default async function Home() {
  // Smoke test: prove Supabase connectivity on first paint. If env isn't set,
  // this section shows a helpful diagnostic instead of crashing.
  let supabaseStatus = "not_configured";
  let supabaseError = null;
  try {
    if (
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    ) {
      const supabase = await getServerSupabase();
      // A trivial query against a table Supabase always provides.
      // If the team hasn't created tables yet, this still succeeds.
      const { error } = await supabase.auth.getSession();
      if (error) throw error;
      supabaseStatus = "connected";
    }
  } catch (err) {
    supabaseStatus = "error";
    supabaseError = err.message || String(err);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <p className="text-sm uppercase tracking-widest text-blue-500">
          Dry Dock 2026
        </p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">
          Your team app is live.
        </h1>
        <p className="mt-4 text-lg opacity-80">
          Provisioned by VanderBot. Next.js 15 + Supabase + Vercel.
          Start building in <code className="rounded bg-gray-500/10 px-1.5 py-0.5 text-sm">app/page.js</code>.
        </p>
      </header>

      <section className="mb-10 rounded-lg border border-gray-500/20 p-6">
        <h2 className="text-lg font-semibold">Stack status</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="opacity-60">Next.js</dt>
            <dd className="mt-1 font-mono">✓ running (you're looking at it)</dd>
          </div>
          <div>
            <dt className="opacity-60">Supabase</dt>
            <dd className="mt-1 font-mono">
              {supabaseStatus === "connected" && "✓ connected"}
              {supabaseStatus === "not_configured" && "⚠ env vars missing"}
              {supabaseStatus === "error" && `✗ ${supabaseError?.slice(0, 80)}`}
            </dd>
          </div>
        </dl>
        {supabaseStatus !== "connected" && (
          <p className="mt-4 text-sm opacity-70">
            Copy <code className="rounded bg-gray-500/10 px-1 py-0.5">.env.local.example</code>
            {" "}to <code className="rounded bg-gray-500/10 px-1 py-0.5">.env.local</code>
            {" "}and fill in your Supabase credentials. VanderBot pushes these
            automatically when <code className="rounded bg-gray-500/10 px-1 py-0.5">provision_full_stack</code>
            {" "}runs.
          </p>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold">Where to go next</h2>
        <ul className="space-y-3">
          <li className="rounded-lg border border-gray-500/20 p-4">
            <p className="font-medium">
              <Link href="/demo" className="text-blue-500 hover:underline">
                /demo — CRUD example →
              </Link>
            </p>
            <p className="mt-1 text-sm opacity-70">
              Read + write to Supabase. Clone this pattern for your own features.
            </p>
          </li>
          <li className="rounded-lg border border-gray-500/20 p-4">
            <p className="font-medium">
              <a
                href="https://supabase.com/docs/guides/database/tables"
                className="text-blue-500 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Create your first table →
              </a>
            </p>
            <p className="mt-1 text-sm opacity-70">
              Open your Supabase project → Table Editor → New table.
            </p>
          </li>
          <li className="rounded-lg border border-gray-500/20 p-4">
            <p className="font-medium">
              Ask VanderBot on WhatsApp
            </p>
            <p className="mt-1 text-sm opacity-70">
              "how do I add auth?" · "Supabase query isn't returning rows" · anything stuck.
            </p>
          </li>
        </ul>
      </section>

      <footer className="mt-16 border-t border-gray-500/20 pt-6 text-sm opacity-60">
        <p>
          Template: <a href="https://github.com/thedatawell/template-nextjs-supabase" className="underline">thedatawell/template-nextjs-supabase</a>
        </p>
      </footer>
    </main>
  );
}
