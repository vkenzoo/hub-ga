/**
 * POST /api/meta/reattribute
 *
 * Reprocessa atribuição UTM em até 1000 purchases pagas que ainda não bateram.
 * Auth via session de admin (não usa CRON_SECRET).
 */
import { NextResponse } from "next/server";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { resolveSaleAttribution, persistAttribution } from "@/lib/meta/attribution";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "meta_ads")) {
    return NextResponse.json({ error: "no_access" }, { status: 403 });
  }

  const hub = createSupabaseAdmin();

  const { data: purchases, error } = await hub
    .from("purchases")
    .select(
      `id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       utm_sales_attribution(id, matched)`,
    )
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json(
      { error: "query_failed", detail: error.message },
      { status: 500 },
    );
  }

  type AttrRel = { id: string; matched: boolean } | Array<{ id: string; matched: boolean }> | null;
  type Row = {
    id: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    utm_sales_attribution: AttrRel;
  };

  const rows = (purchases ?? []) as Row[];

  let processed = 0;
  let matched = 0;
  let skipped = 0;

  for (const r of rows) {
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

  await logAudit({
    actor: auth.email,
    action: "meta.reattribute",
    target: "purchases",
    payload: { total: rows.length, processed, matched, skipped_already_matched: skipped },
  });

  revalidatePath("/meta-ads");

  return NextResponse.json({
    ok: true,
    total: rows.length,
    processed,
    matched,
    skipped_already_matched: skipped,
  });
}
