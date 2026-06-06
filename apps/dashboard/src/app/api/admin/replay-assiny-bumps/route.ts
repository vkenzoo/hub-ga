/**
 * POST /api/admin/replay-assiny-bumps
 *
 * Reprocessa webhook_executions Assiny já `completed` (approved_purchase)
 * pra capturar order_bumps que o handler antigo ignorava.
 *
 * No replay:
 *   - Main purchase: vira 'duplicate' (já existe no purchases) → skip
 *   - Bumps: gateway_event_id `_bump_<id>` é único → cria purchase nova
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

  // Pega últimos 30 dias de webhooks Assiny já processados que tenham bumps
  // (filtro feito client-side porque jsonb_array_length não tá indexado)
  const { data: execs, error } = await sb
    .from("webhook_executions")
    .select("id, raw_body, raw_headers")
    .eq("gateway", "assiny")
    .eq("status", "completed")
    .eq("raw_event_type", "approved_purchase")
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json(
      { error: "query_failed", detail: error.message },
      { status: 500 },
    );
  }

  const base =
    process.env.WEBHOOKS_BASE_URL ??
    process.env.NEXT_PUBLIC_WEBHOOKS_BASE_URL ??
    "https://hub-ga-webhooks.vercel.app";

  let candidates = 0;
  let replayed = 0;
  let skipped_no_bumps = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const exec of execs ?? []) {
    candidates++;
    // Parse body só pra checar se tem bumps (evita replay desnecessário)
    let hasBumps = false;
    try {
      const body = JSON.parse(exec.raw_body as string);
      const bumps = body?.data?.offer?.order_bumps;
      hasBumps = Array.isArray(bumps) && bumps.length > 0;
    } catch {
      // Body inválido — pula
      continue;
    }

    if (!hasBumps) {
      skipped_no_bumps++;
      continue;
    }

    try {
      const url = `${base.replace(/\/$/, "")}/api/webhooks/assiny`;
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
      errors.push({
        id: exec.id as string,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await logAudit({
    actor: auth.email,
    action: "execution.replay_assiny_bumps",
    target: "webhook_executions",
    payload: { candidates, replayed, skipped_no_bumps, failed },
  });

  revalidatePath("/sales");
  revalidatePath("/acquisition");
  revalidatePath("/customers");

  return NextResponse.json({
    ok: true,
    candidates,
    replayed,
    skipped_no_bumps,
    failed,
    errors: errors.slice(0, 20),
  });
}
