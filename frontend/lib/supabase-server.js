// lib/supabase-server.js
// Server-side Supabase client. Use from Server Components, Route Handlers,
// or Server Actions. NEVER import this from client components.
//
// Uses the service-role key when available (bypasses RLS for admin reads),
// otherwise falls back to the anon key.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serverKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serverKey) {
    throw new Error(
      "Supabase env missing — check .env.local. Need NEXT_PUBLIC_SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY (preferred, bypasses RLS) or NEXT_PUBLIC_SUPABASE_ANON_KEY (fallback).",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, serverKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(entries) {
        // In Route Handlers + Server Actions you can setAll; in Server
        // Components Next.js blocks cookie writes — swallow the error.
        try {
          entries.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Read-only context.
        }
      },
    },
  });
}
