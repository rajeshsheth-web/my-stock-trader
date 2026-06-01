import { createMiddleware } from "@tanstack/react-start";
import { createServerClient } from "@/lib/supabase";

export const attachSupabaseAuth = createMiddleware().server(
  async ({ next, request }) => {
    const responseHeaders = new Headers();

    const supabase = createServerClient({
      getAll() {
        return parseCookies(request.headers.get("cookie") ?? "");
      },
      setAll(cookies) {
        cookies.forEach(({ name, value, options }) => {
          responseHeaders.append("Set-Cookie", serializeCookie(name, value, options));
        });
      },
    });

    const { data: { session } } = await supabase.auth.getSession();

    return next({
      context: { supabase, session },
      headers: responseHeaders,
    });
  },
);

function parseCookies(cookieHeader: string) {
  return cookieHeader
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const eq = p.indexOf("=");
      return { name: eq === -1 ? p : p.slice(0, eq).trim(), value: eq === -1 ? "" : p.slice(eq + 1).trim() };
    });
}

function serializeCookie(name: string, value: string, options: Record<string, unknown> = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (options["maxAge"]) s += `; Max-Age=${options["maxAge"]}`;
  if (options["domain"]) s += `; Domain=${options["domain"]}`;
  s += options["path"] ? `; Path=${options["path"]}` : "; Path=/";
  if (options["expires"] instanceof Date) s += `; Expires=${(options["expires"] as Date).toUTCString()}`;
  if (options["httpOnly"]) s += "; HttpOnly";
  if (options["secure"]) s += "; Secure";
  if (options["sameSite"]) s += `; SameSite=${options["sameSite"]}`;
  return s;
}
