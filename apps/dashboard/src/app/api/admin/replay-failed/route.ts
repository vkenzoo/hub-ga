/**
 * POST /api/admin/replay-failed
 *
 * Reprocessa webhook_executions com status='failed' dos últimos 3 dias.
 * Útil quando o insert falhou por erro transitório (ex: coluna que ainda não
 * existia durante uma migration) e a venda não foi gravada.
 *
 * Auth via session de admin.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireAdmin();
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "no_access" }, { status: 403 });
  }

  const sb = createSupabaseAdmin();

  const { data: execs, error } = await sb
    .from("webhook_executions")
    .select("id, gateway, raw_body, raw_headers, raw_event_type")
    .eq("status", "failed")
    .in("gateway", ["assiny", "hotmart"])
    .gte("created_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: true })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }

  const base =
    process.env.WEBHOOKS_BASE_URL ??
    process.env.NEXT_PUBLIC_WEBHOOKS_BASE_URL ??
    "https://hub-ga-webhooks.vercel.app";

  let replayed = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const exec of execs ?? []) {
    try {
      const url = `${base.replace(/\/$/, "")}/api/webhooks/${exec.gateway}`;
      const headers: Record<string, string> = {};
      const rawHeaders = (exec.raw_headers ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(rawHeaders)) {
        const lk = k.toLowerCase();
        if (lk === "host" || lk === "content-length" || lk === "connection") continue;
        if (lk === "authorization" || lk === "cookie") continue;
        headers[k] = v;
      }
      headers["content-type"] = headers["content-type"] ?? "application/json";
      headers["x-hub-replay-of"] = exec.id as string;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: exec.raw_body as string,
      });
      if (res.ok) replayed++;
      else {
        failed++;
        errors.push({ id: exec.id as string, error: `HTTP ${res.status}` });
      }
    } catch (e) {
      failed++;
      errors.push({ id: exec.id as string, error: e instanceof Error ? e.message : String(e) });
    }
  }

  await logAudit({
    actor: auth.email,
    action: "execution.bulk_replay_failed",
    target: "webhook_executions",
    payload: { total: (execs ?? []).length, replayed, failed },
  });

  revalidatePath("/executions");
  revalidatePath("/sales");
  revalidatePath("/acquisition");

  return NextResponse.json({
    ok: true,
    total: (execs ?? []).length,
    replayed,
    failed,
    errors: errors.slice(0, 20),
  });
}
