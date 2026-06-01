import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";
import { createServerClient as _createServerClient } from "@supabase/ssr";
import type { CookieMethods } from "@supabase/ssr";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * Browser-side Supabase client.
 * Instantiate once per page load (call at module scope or in a singleton pattern).
 */
export function createBrowserClient() {
  return _createBrowserClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Server-side Supabase client.
 * Pass cookie helpers from the request/response context so that SSR can
 * read and set session cookies.
 */
export function createServerClient(cookieMethods: CookieMethods) {
  return _createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: cookieMethods,
  });
}

/**
 * Singleton browser client — safe to import directly in client components.
 */
export const supabase = createBrowserClient();
