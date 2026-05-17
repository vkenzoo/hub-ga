import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieItem = { name: string; value: string; options?: CookieOptions };

const url = process.env.HUB_SUPABASE_URL!;
const anon = process.env.HUB_SUPABASE_ANON_KEY!;

export async function updateSession(req: NextRequest) {
  // Propaga pathname para Server Components via header
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-pathname", req.nextUrl.pathname);

  let res = NextResponse.next({ request: { headers: reqHeaders } });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(items: CookieItem[]) {
        for (const { name, value } of items) req.cookies.set(name, value);
        res = NextResponse.next({ request: { headers: reqHeaders } });
        for (const { name, value, options } of items) res.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = req.nextUrl.pathname;
  const isAuthPath = pathname.startsWith("/login") || pathname.startsWith("/auth");

  if (!user && !isAuthPath) {
    const redirect = req.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  if (user && pathname === "/login") {
    const redirect = req.nextUrl.clone();
    redirect.pathname = "/";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  return res;
}
