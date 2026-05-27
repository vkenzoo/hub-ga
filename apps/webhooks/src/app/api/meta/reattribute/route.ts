/**
 * POST /api/meta/reattribute
 *
 * Reprocessa atribuição UTM em purchases que:
 *   - Ainda não têm row em utm_sales_attribution
 *   - OU têm matched=false (resolver não casou antes)
 *
 * Útil quando:
 *   - Resolver foi atualizado (parser de formato novo)
 *   - Ad/campanha apareceu em meta_ad_insights_daily depois da venda
 *
 * Auth: header Authorization: Bearer ${CRON_SECRET}
 */
import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { resolveSaleAttribution, persistAttribution } from "@/lib/handlers/resolve-attribution";
import { safeEqual } from "@/lib/hmac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hub = createHubServiceClient();

  // Pega últimas 1000 purchases pagas que NÃO têm atribuição com matched=true
  const { data: purchases, error } = await hub
    .from("purchases")
    .select(
      `id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_at,
       utm_sales_attribution(id, matched)`,
    )
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }

  type AttrRel = { id: string; matched: boolean } | Array<{ id: string; matched: boolean }>;
  type Row = {
    id: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    utm_sales_attribution: AttrRel | null;
  };

  const rows = (purchases ?? []) as Row[];

  let processed = 0;
  let matched = 0;
  let skipped = 0;

  for (const r of rows) {
    // Pula se já tem atribuição com matched=true
    const attr = Array.isArray(r.utm_sales_attribution)
      ? r.utm_sales_attribution[0]
      : r.utm_sales_attribution;
    if (attr?.matched === true) {
      skipped++;
      continue;
    }

    try {
      const result = await resolveSaleAttribution(hub, {
        utm_source: r.utm_source,
        utm_medium: r.utm_medium,
        utm_campaign: r.utm_campaign,
        utm_content: r.utm_content,
        utm_term: r.utm_term,
      });
      await persistAttribution(hub, r.id, result);
      processed++;
      if (result.matched) matched++;
    } catch (e) {
      console.error("[reattribute] failed for purchase", r.id, e);
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    processed,
    matched,
    skipped_already_matched: skipped,
  });
}
