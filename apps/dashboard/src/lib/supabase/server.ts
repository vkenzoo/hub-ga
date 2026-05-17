import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieItem = { name: string; value: string; options?: CookieOptions };

const url = process.env.HUB_SUPABASE_URL!;
const anon = process.env.HUB_SUPABASE_ANON_KEY!;
const service = process.env.HUB_SUPABASE_SERVICE_ROLE_KEY!;

export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(items: CookieItem[]) {
        try {
          for (const { name, value, options } of items) cookieStore.set(name, value, options);
        } catch {
          // Componente Server: a mutação acontece via middleware
        }
      },
    },
  });
}

// Usado apenas em route handlers / server actions para operações privilegiadas
export function createSupabaseAdmin() {
  return createPlainClient(url, service, { auth: { persistSession: false } });
}
