import { getServerSupabase } from "@/lib/supabase-server";
import { DemoForm } from "./form";
import { revalidatePath } from "next/cache";

// A minimal CRUD demo. Uses a single table `notes` with columns
// (id uuid default gen_random_uuid(), body text, created_at timestamptz default now()).
//
// Create the table first:
//
//   Supabase Dashboard → SQL Editor → paste:
//   create table if not exists notes (
//     id uuid primary key default gen_random_uuid(),
//     body text not null check (length(body) between 1 and 500),
//     created_at timestamptz not null default now()
//   );
//   alter table notes enable row level security;
//   create policy "anon can read" on notes for select using (true);
//   create policy "anon can insert" on notes for insert with check (true);

async function addNote(formData) {
  "use server";
  const body = (formData.get("body") || "").toString().trim();
  if (!body) return;
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("notes").insert({ body });
  if (error) {
    // In a real app, surface this to the UI. For the demo, rethrow.
    throw new Error(error.message);
  }
  revalidatePath("/demo");
}

export default async function DemoPage() {
  let rows = [];
  let fetchError = null;

  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("notes")
      .select("id, body, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    fetchError = err.message || String(err);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <a href="/" className="text-sm text-blue-500 hover:underline">
        ← back
      </a>
      <h1 className="mt-4 text-3xl font-bold">CRUD demo — notes</h1>
      <p className="mt-2 opacity-70">
        Reads + writes a <code className="rounded bg-gray-500/10 px-1.5 py-0.5">notes</code> table.
        See <code className="rounded bg-gray-500/10 px-1.5 py-0.5">app/demo/page.js</code> for
        the SQL to create it.
      </p>

      <div className="mt-8 rounded-lg border border-gray-500/20 p-6">
        <DemoForm action={addNote} />
      </div>

      {fetchError ? (
        <div className="mt-8 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">
          <p className="font-semibold">Query failed</p>
          <p className="mt-1 opacity-80">{fetchError}</p>
          <p className="mt-2 opacity-60">
            Most likely: the <code>notes</code> table doesn't exist yet. Run the
            SQL from the comment at the top of <code>app/demo/page.js</code>.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {rows.length === 0 ? (
            <p className="opacity-60">No notes yet. Add one above.</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-gray-500/20 p-4"
              >
                <p>{row.body}</p>
                <p className="mt-2 text-xs opacity-50">
                  {new Date(row.created_at).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}
