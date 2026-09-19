import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client.
 *
 * Only the publishable / anon key belongs here. Secret and service-role keys
 * bypass Row Level Security and must NEVER be exposed to the browser, so this
 * module refuses to build a client when it detects one.
 */

// NEXT_PUBLIC_* variables must be referenced literally so Next.js can inline them.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export type SupabaseConfigState =
  | { configured: true }
  | { configured: false; reason: string };

function looksLikeSecretKey(value: string): boolean {
  if (value.startsWith("sb_secret_")) return true;
  const parts = value.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload?.role === "service_role";
    } catch {
      return false;
    }
  }
  return false;
}

export function getSupabaseConfigState(): SupabaseConfigState {
  if (!url || !key) {
    return {
      configured: false,
      reason:
        "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set.",
    };
  }
  if (!/^https?:\/\//.test(url)) {
    return { configured: false, reason: "NEXT_PUBLIC_SUPABASE_URL is not a valid URL." };
  }
  if (looksLikeSecretKey(key)) {
    return {
      configured: false,
      reason:
        "A secret/service-role key was found in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. It was ignored — use the publishable (anon) key only.",
    };
  }
  return { configured: true };
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!getSupabaseConfigState().configured) return null;
  if (!client) {
    client = createClient(url!, key!, { auth: { persistSession: false } });
  }
  return client;
}
