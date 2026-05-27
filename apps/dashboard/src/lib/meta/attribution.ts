/**
 * Cópia do resolver UTM que vive em apps/webhooks/src/lib/handlers/resolve-attribution.ts.
 * Duplicado aqui porque dashboard e webhooks vivem em apps separados (sem package
 * shared). Quando atualizar o resolver, atualize nos 2 lugares.
 *
 * Razão da existência: endpoint de reattribute via UI de admin (session-based,
 * sem precisar de CRON_SECRET).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

interface UtmFields {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

interface AttributionRow {
  campaign_id?: string | null;
  campaign_name?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
}

interface ResolveResult {
  matched: boolean;
  method:
    | "full_utm_match"
    | "utm_ad_id"
    | "triple_utm"
    | "utm_campaign_only"
    | "fuzzy_campaign_name"
    | "direct";
  confidence: number;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  ad_id?: string;
}

function extractId(field: string | null | undefined): string | null {
  if (!field) return null;
  const v = field.trim();
  const lastPipe = v.lastIndexOf("|");
  if (lastPipe >= 0) {
    const after = v.slice(lastPipe + 1).trim();
    if (/^\d+$/.test(after)) return after;
  }
  const firstDoubleColon = v.indexOf("::");
  if (firstDoubleColon > 0) {
    const before = v.slice(0, firstDoubleColon).trim();
    if (/^\d+$/.test(before)) return before;
  }
  const lastDash = v.lastIndexOf("-");
  if (lastDash >= 0) {
    const after = v.slice(lastDash + 1).trim();
    if (/^\d{10,}$/.test(after)) return after;
  }
  if (/^\d+$/.test(v)) return v;
  return null;
}

function extractName(field: string | null | undefined): string | null {
  if (!field) return null;
  const v = field.trim();
  const lastPipe = v.lastIndexOf("|");
  if (lastPipe >= 0 && /^\d+$/.test(v.slice(lastPipe + 1).trim())) {
    return v.slice(0, lastPipe).trim();
  }
  const lastDash = v.lastIndexOf("-");
  if (lastDash >= 0 && /^\d{10,}$/.test(v.slice(lastDash + 1).trim())) {
    return v.slice(0, lastDash).trim();
  }
  return v;
}

async function findByAdId(hub: SupabaseClient, adId: string): Promise<AttributionRow | null> {
  const { data } = await hub
    .from("meta_ad_insights_daily")
    .select("campaign_id, campaign_name, adset_id, ad_id")
    .eq("ad_id", adId)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function findByAdsetAndCampaign(
  hub: SupabaseClient,
  adsetId: string,
  campaignId: string,
): Promise<AttributionRow | null> {
  const { data } = await hub
    .from("meta_ad_insights_daily")
    .select("campaign_id, campaign_name, adset_id")
    .eq("adset_id", adsetId)
    .eq("campaign_id", campaignId)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function findByCampaignId(
  hub: SupabaseClient,
  campaignId: string,
): Promise<AttributionRow | null> {
  const { data } = await hub
    .from("meta_ad_insights_daily")
    .select("campaign_id, campaign_name")
    .eq("campaign_id", campaignId)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function findByCampaignName(
  hub: SupabaseClient,
  name: string,
): Promise<AttributionRow | null> {
  const { data } = await hub
    .from("meta_ad_insights_daily")
    .select("campaign_id, campaign_name")
    .ilike("campaign_name", `%${name}%`)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function resolveSaleAttribution(
  hub: SupabaseClient,
  utm: UtmFields,
): Promise<ResolveResult> {
  const adId = extractId(utm.utm_content);
  const adsetId = extractId(utm.utm_medium);
  const campaignId = extractId(utm.utm_campaign);

  if (adId && adsetId && campaignId) {
    const found = await findByAdId(hub, adId);
    if (
      found &&
      found.adset_id === adsetId &&
      found.campaign_id === campaignId
    ) {
      return {
        matched: true,
        method: "full_utm_match",
        confidence: 1.0,
        campaign_id: found.campaign_id ?? undefined,
        campaign_name: found.campaign_name ?? undefined,
        adset_id: found.adset_id ?? undefined,
        ad_id: found.ad_id ?? undefined,
      };
    }
  }

  if (adId) {
    const found = await findByAdId(hub, adId);
    if (found) {
      return {
        matched: true,
        method: "utm_ad_id",
        confidence: 0.95,
        campaign_id: found.campaign_id ?? undefined,
        campaign_name: found.campaign_name ?? undefined,
        adset_id: found.adset_id ?? undefined,
        ad_id: found.ad_id ?? undefined,
      };
    }
  }

  if (adsetId && campaignId) {
    const found = await findByAdsetAndCampaign(hub, adsetId, campaignId);
    if (found) {
      return {
        matched: true,
        method: "triple_utm",
        confidence: 0.9,
        campaign_id: found.campaign_id ?? undefined,
        campaign_name: found.campaign_name ?? undefined,
        adset_id: found.adset_id ?? undefined,
      };
    }
  }

  if (campaignId) {
    const found = await findByCampaignId(hub, campaignId);
    if (found) {
      return {
        matched: true,
        method: "utm_campaign_only",
        confidence: 0.7,
        campaign_id: found.campaign_id ?? undefined,
        campaign_name: found.campaign_name ?? undefined,
      };
    }
  }

  const campaignName = extractName(utm.utm_campaign);
  if (campaignName && campaignName.length > 4) {
    const found = await findByCampaignName(hub, campaignName);
    if (found) {
      return {
        matched: true,
        method: "fuzzy_campaign_name",
        confidence: 0.4,
        campaign_id: found.campaign_id ?? undefined,
        campaign_name: found.campaign_name ?? undefined,
      };
    }
  }

  return { matched: false, method: "direct", confidence: 0 };
}

export async function persistAttribution(
  hub: SupabaseClient,
  purchaseId: string,
  result: ResolveResult,
): Promise<void> {
  await hub
    .from("utm_sales_attribution")
    .upsert(
      {
        purchase_id: purchaseId,
        matched: result.matched,
        match_method: result.method,
        match_confidence: result.confidence,
        campaign_id: result.campaign_id ?? null,
        campaign_name: result.campaign_name ?? null,
        adset_id: result.adset_id ?? null,
        ad_id: result.ad_id ?? null,
        is_active: true,
        attributed_at: new Date().toISOString(),
      },
      { onConflict: "purchase_id" },
    );
}
