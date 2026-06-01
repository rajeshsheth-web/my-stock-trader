import { createMiddleware } from "@tanstack/start";
import { createServerClient } from "@/lib/supabase";

/**
 * attachSupabaseAuth — runs on every SSR request.
 *
 * Reads the Supabase session from cookies and attaches it to the request
 * context so route loaders can call `context.supabase` without re-creating
 * the client.
 */
export const attachSupabaseAuth = createMiddleware().server(
  async ({ next, request }) => {
    const responseHeaders = new Headers();

    const supabase = createServerClient({
      getAll() {
        return parseCookies(request.headers.get("cookie") ?? "");
      },
      setAll(cookies) {
        cookies.forEach(({ name, value, options }) => {
          const serialized = serializeCookie(name, value, options);
          responseHeaders.append("Set-Cookie", serialized);
        });
      },
    });

    const {
      data: { session },
    } = await supabase.auth.getSession();

    return next({
      context: { supabase, session },
      headers: responseHeaders,
    });
  },
);

// ─── minimal cookie helpers (no external dep) ────────────────────────────────

function parseCookies(cookieHeader: string) {
  return cookieHeader
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf("=");
      const name = eqIdx === -1 ? pair : pair.slice(0, eqIdx).trim();
      const value = eqIdx === -1 ? "" : pair.slice(eqIdx + 1).trim();
      return { name, value };
    });
}

function serializeCookie(
  name: string,
  value: string,
  options: Record<string, unknown> = {},
) {
  let str = `${name}=${encodeURIComponent(value)}`;
  if (options["maxAge"]) str += `; Max-Age=${options["maxAge"]}`;
  if (options["domain"]) str += `; Domain=${options["domain"]}`;
  if (options["path"]) str += `; Path=${options["path"]}`;
  else str += "; Path=/";
  if (options["expires"] instanceof Date)
    str += `; Expires=${(options["expires"] as Date).toUTCString()}`;
  if (options["httpOnly"]) str += "; HttpOnly";
  if (options["secure"]) str += "; Secure";
  if (options["sameSite"]) str += `; SameSite=${options["sameSite"]}`;
  return str;
}
