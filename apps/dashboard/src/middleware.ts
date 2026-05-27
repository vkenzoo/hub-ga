import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  return updateSession(req);
}

export const config = {
  // Exclui `api/cron/*` porque essas rotas autenticam via CRON_SECRET (não via
  // sessão Supabase). Se passar pelo middleware, redireciona pra /login (307).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\..*).*)"],
};
