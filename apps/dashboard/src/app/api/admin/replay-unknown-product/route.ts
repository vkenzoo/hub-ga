/**
 * GET /api/admin/replay-unknown-product?q=<substr>&status=<st>&gateway=<gw>&dry=1&limit=120
 *
 * Reprocessa, EM LOTES, webhook_executions re-postando o raw_body + raw_headers
 * originais pro app de webhooks → agora que a causa foi corrigida (match de
 * produto OU token de auth), eles casam/autenticam → criam a compra + provisionam
 * + e-mail.
 *
 * Filtros:
 *   - status  (default 'unknown_product'): qual falha reprocessar. Allowlist:
 *             unknown_product (match de produto corrigido) | rejected_auth (401 por
 *             token — corrigido o env, o x-hubla-token guardado volta a valer).
 *   - q       substring do raw_body (ex: o gateway_product_id). Opcional se passar
 *             gateway; obrigatório caso contrário (nunca reprocessa tudo sem escopo).
 *   - gateway (opcional) assiny | hotmart | hubla — escopa a um gateway só.
 *
 * Processa no máximo `limit` por chamada (default 120, teto 400) pra caber no
 * timeout da Vercel (evita 504). Marca cada re-post OK como status='replayed'
 * NA HORA — se der timeout no meio, o que já foi reprocessado não repete no
 * próximo lote. Retorna `restantes` pra você saber quando acabou (0 = fim).
 * Reprocessa approved E completed do mesmo sale: o 1º que rodar provisiona, o
 * 2º cai no guard anti-duplicata (recordPurchase) e é pulado — seguro.
 *
 * dry-run por padrão (só conta). &dry=0 dispara. Auth via session de admin.
 * Uso recomendado: no console do navegador (F12), com um loop de fetch em
 * &dry=0&limit=60 até `restantes` chegar a 0 (evita colar link várias vezes).
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

  const ALLOWED_STATUS = ["unknown_product", "rejected_auth"];
  const ALLOWED_GATEWAY = ["assiny", "hotmart", "hubla"];

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "unknown_product").trim();
  const gateway = (url.searchParams.get("gateway") ?? "").trim().toLowerCase();
  const dry = url.searchParams.get("dry") !== "0";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "120"), 400);
  const days = Number(url.searchParams.get("days") ?? "60");

  if (!ALLOWED_STATUS.includes(status)) {
    return NextResponse.json(
      { error: `status inválido. Use um de: ${ALLOWED_STATUS.join(", ")}` },
      { status: 400 },
    );
  }
  if (gateway && !ALLOWED_GATEWAY.includes(gateway)) {
    return NextResponse.json(
      { error: `gateway inválido. Use um de: ${ALLOWED_GATEWAY.join(", ")}` },
      { status: 400 },
    );
  }
  // Exige escopo: ou q ou gateway. Nunca reprocessa a tabela inteira sem filtro.
  if (!q && !gateway) {
    return NextResponse.json(
      { error: "informe q (substring do raw_body, ex: gateway_product_id) e/ou gateway" },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdmin();
  const sinceISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const gateways = gateway ? [gateway] : ALLOWED_GATEWAY;

  // Conta quantos ainda faltam (status alvo casando os filtros). Ao reprocessar
  // com sucesso, marcamos status='replayed', então isso vai caindo até 0.
  const remainingQuery = () => {
    let query = sb
      .from("webhook_executions")
      .select("id", { count: "exact", head: true })
      .eq("status", status)
      .in("gateway", gateways)
      .gte("created_at", sinceISO);
    if (q) query = query.ilike("raw_body", `%${q}%`);
    return query;
  };

  if (dry) {
    const { count } = await remainingQuery();
    return NextResponse.json({
      ok: true,
      dry: true,
      status,
      gateway: gateway || "(todos)",
      q: q || "(sem filtro de raw_body)",
      restantes: count ?? 0,
      aviso: "Nada reprocessado. Adicione &dry=0 pra disparar (em lotes).",
    });
  }

  let execsQuery = sb
    .from("webhook_executions")
    .select("id, gateway, raw_body, raw_headers")
    .eq("status", status)
    .in("gateway", gateways)
    .gte("created_at", sinceISO);
  if (q) execsQuery = execsQuery.ilike("raw_body", `%${q}%`);
  const { data: execs, error } = await execsQuery
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }
  const list = execs ?? [];

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

      const res = await fetch(target, { method: "POST", headers, body: exec.raw_body as string });
      if (res.ok) {
        replayed++;
        // Marca JÁ (item a item) — se der timeout no meio do lote, o que já foi
        // reprocessado fica marcado e o próximo lote não repete.
        await sb.from("webhook_executions").update({ status: "replayed" }).eq("id", exec.id as string);
      } else {
        failed++;
        errors.push({ id: exec.id as string, error: `HTTP ${res.status}` });
      }
    } catch (e) {
      failed++;
      errors.push({ id: exec.id as string, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const { count: restantes } = await remainingQuery();

  await logAudit({
    actor: auth.email,
    action: "execution.replay_unknown_product",
    target: "webhook_executions",
    payload: { status, gateway: gateway || null, q, limit, processados: list.length, replayed, failed, restantes: restantes ?? 0 },
  });

  revalidatePath("/executions");
  revalidatePath("/sales");

  return NextResponse.json({
    ok: true,
    dry: false,
    status,
    gateway: gateway || "(todos)",
    q: q || "(sem filtro de raw_body)",
    processados: list.length,
    replayed,
    failed,
    restantes: restantes ?? 0,
    errors: errors.slice(0, 10),
  });
}
