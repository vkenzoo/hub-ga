/**
 * POST /api/admin/fix-purchase-timestamps
 *
 * Corrige purchases.created_at usando o created_at REAL do payload original
 * armazenado em webhook_executions.raw_body. Útil quando:
 *  - Replay de vendas inseriu com created_at = NOW() (bug histórico)
 *  - Dedup impede que reprocessamento atualize o timestamp
 *
 * Estratégia: para cada purchase das últimas 48h, busca o webhook_execution
 * com mesmo gateway_event_id, extrai data.transaction.created_at (assiny) ou
 * data.purchase.approved_date (hotmart), e atualiza se diferir > 60min.
 *
 * Idempotente — re-rodar não causa problema.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface PurchaseRow {
  id: string;
  gateway: string;
  gateway_event_id: string;
  created_at: string;
}

interface ExecRow {
  id: string;
  raw_body: string;
  gateway: string;
}

export async function POST() {
  const auth = await requireAdmin();
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "no_access" }, { status: 403 });
  }

  const sb = createSupabaseAdmin();

  // Purchases das últimas 48h (período onde replays recentes podem ter quebrado timestamp)
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: purchases, error: pErr } = await sb
    .from("purchases")
    .select("id, gateway, gateway_event_id, created_at")
    .gte("created_at", since)
    .in("gateway", ["assiny", "hotmart"])
    .limit(2000);

  if (pErr) {
    return NextResponse.json({ error: "purchase_query_failed", detail: pErr.message }, { status: 500 });
  }

  const purchasesByEventId = new Map<string, PurchaseRow>();
  for (const p of (purchases ?? []) as PurchaseRow[]) {
    purchasesByEventId.set(p.gateway_event_id, p);
  }

  let fixed = 0;
  let skippedNoExec = 0;
  let skippedNoTs = 0;
  let skippedAlreadyOk = 0;
  const fixes: Array<{ id: string; from: string; to: string }> = [];

  // Pega webhook_executions com gateway_event_id correspondentes
  const eventIds = [...purchasesByEventId.keys()];
  if (eventIds.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, fixed: 0 });
  }

  // Em lotes de 100 pra não estourar limites da query
  for (let i = 0; i < eventIds.length; i += 100) {
    const batch = eventIds.slice(i, i + 100);
    const { data: execs } = await sb
      .from("webhook_executions")
      .select("id, raw_body, gateway")
      .in("gateway_event_id", batch)
      .eq("status", "completed")
      .limit(500);

    for (const exec of (execs ?? []) as ExecRow[]) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(exec.raw_body);
      } catch {
        continue;
      }

      // Extrai created_at real do payload por gateway
      let realCreatedAt: string | null = null;
      if (exec.gateway === "assiny") {
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        const tx = (data.transaction ?? parsed.transaction ?? {}) as Record<string, unknown>;
        const ca = tx.created_at ?? tx.updated_at;
        if (typeof ca === "string") realCreatedAt = ca;
      } else if (exec.gateway === "hotmart") {
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        const purchase = (data.purchase ?? {}) as Record<string, unknown>;
        const approvedDate = purchase.approved_date ?? purchase.order_date;
        if (typeof approvedDate === "number") {
          realCreatedAt = new Date(approvedDate).toISOString();
        }
      }

      if (!realCreatedAt) {
        skippedNoTs++;
        continue;
      }

      // Acha a purchase associada (pode haver múltiplos execs pro mesmo event id; pegamos via raw_body's tx id)
      let txId: string | null = null;
      if (exec.gateway === "assiny") {
        const data = (parsed.data ?? {}) as Record<string, unknown>;
        const tx = (data.transaction ?? parsed.transaction ?? {}) as Record<string, unknown>;
        if (typeof tx.id === "string") txId = tx.id;
      }
      const evt = typeof parsed.event === "string" ? parsed.event : "";
      const candidateEventId = txId ? `${txId}_${evt}` : null;
      const purchase = candidateEventId
        ? purchasesByEventId.get(candidateEventId)
        : undefined;

      if (!purchase) {
        skippedNoExec++;
        continue;
      }

      // Diff > 60 minutos → corrige (evita fixar drift de segundos)
      const diffMs = Math.abs(new Date(purchase.created_at).getTime() - new Date(realCreatedAt).getTime());
      if (diffMs < 60 * 60 * 1000) {
        skippedAlreadyOk++;
        continue;
      }

      const { error: updErr } = await sb
        .from("purchases")
        .update({ created_at: realCreatedAt })
        .eq("id", purchase.id);

      if (!updErr) {
        fixed++;
        fixes.push({ id: purchase.id, from: purchase.created_at, to: realCreatedAt });
      }
    }
  }

  await logAudit({
    actor: auth.email,
    action: "purchase.fix_timestamps",
    target: "purchases",
    payload: { checked: purchases?.length ?? 0, fixed, skippedNoExec, skippedNoTs, skippedAlreadyOk },
  });

  revalidatePath("/acquisition");
  revalidatePath("/sales");

  return NextResponse.json({
    ok: true,
    checked: purchases?.length ?? 0,
    fixed,
    skippedNoExec,
    skippedNoTs,
    skippedAlreadyOk,
    sampleFixes: fixes.slice(0, 10),
  });
}
