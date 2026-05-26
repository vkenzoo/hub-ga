/**
 * Cron diário pra sincronizar insights da Marketing API.
 * Triggered por Vercel cron (vercel.json) com Authorization: Bearer ${CRON_SECRET}.
 *
 * Idempotente: re-sync sobre mesmo período só atualiza rows existentes.
 */
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { syncAllMetaConnections } from "@/lib/meta/sync";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Timeout estendido (Meta API pode demorar com várias contas)
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: Request) {
  // Auth via header Authorization: Bearer ${CRON_SECRET}
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseAdmin();

  try {
    // Sync os últimos 7 dias toda chamada (compromisso entre frescor e custo).
    // Backfill de 30 dias só na 1ª conexão (no flow de connect).
    const result = await syncAllMetaConnections(sb, 7);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[meta-sync cron] failed:", e);
    return NextResponse.json(
      { error: "sync_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
