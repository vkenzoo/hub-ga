/**
 * GET /api/admin/replay-unknown-product?q=<substr>&dry=1
 *
 * Reprocessa webhook_executions com status='unknown_product' cujo raw_body
 * CONTÉM `q` (ex: o gateway_product_id do produto). Útil depois de corrigir o
 * match de produto (ex: apagar rascunhos duplicados do scalo): re-posta os
 * webhooks que caíram em unknown_product → agora casam → criam a compra +
 * provisionam + mandam o e-mail.
 *
 * dry-run por padrão (só conta/lista). Adicione &dry=0 pra reprocessar de verdade.
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

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "no_access" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const dry = url.searchParams.get("dry") !== "0";
  const days = Number(url.searchParams.get("days") ?? "45");
  if (!q) {
    return NextResponse.json(
      { error: "q obrigatório (substring do raw_body, ex: o gateway_product_id)" },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdmin();
  const { data: execs, error } = await sb
    .from("webhook_executions")
    .select("id, gateway, raw_body, raw_headers")
    .eq("status", "unknown_product")
    .in("gateway", ["assiny", "hotmart", "hubla"])
    .ilike("raw_body", `%${q}%`)
    .gte("created_at", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: true })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }
  const list = execs ?? [];

  if (dry) {
    return NextResponse.json({
      ok: true,
      dry: true,
      q,
      days,
      encontrados: list.length,
      aviso: "Nada reprocessado. Adicione &dry=0 pra disparar.",
    });
  }

  const base =
    process.env.WEBHOOKS_BASE_URL ??
    process.env.NEXT_PUBLIC_WEBHOOKS_BASE_URL ??
    "https://hub-ga-webhooks.vercel.app";

  let replayed = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const exec of list) {
    try {
      const target = `${base.replace(/\/$/, "")}/api/webhooks/${exec.gateway}`;
      const headers: Record<string, string> = {};
      const rawHeaders = (exec.raw_headers ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(rawHeaders)) {
        const lk = k.toLowerCase();
        if (lk === "host" || lk === "content-length" || lk === "connection") continue;
        if (lk === "cookie") continue;
        headers[k] = v;
      }
      headers["content-type"] = headers["content-type"] ?? "application/json";
      headers["x-hub-replay-of"] = exec.id as string;

      const res = await fetch(target, {
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
    action: "execution.replay_unknown_product",
    target: "webhook_executions",
    payload: { q, days, total: list.length, replayed, failed },
  });

  revalidatePath("/executions");
  revalidatePath("/sales");

  return NextResponse.json({
    ok: true,
    dry: false,
    q,
    total: list.length,
    replayed,
    failed,
    errors: errors.slice(0, 20),
  });
}
