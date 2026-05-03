// lib/supabase-browser.js
// Browser-side Supabase client. Import from client components only.
// Reads public env vars that are bundled at build time.

"use client";

import { createBrowserClient } from "@supabase/ssr";

export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Loud failure in dev — quietly returns null in prod to avoid page crashes.
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "Supabase env missing — copy .env.local.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    return null;
  }
  return createBrowserClient(url, anonKey);
}
