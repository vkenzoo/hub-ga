/**
 * Resolver de atribuição UTM → ad/campaign do Meta.
 *
 * 5 níveis de confiança (last-click):
 *   1.00 — utm_id ou utm_term == ad_id  (template canônico utm_term={{ad.id}})
 *   0.90 — utm_content == adset_id AND utm_campaign == campaign_id
 *   0.70 — utm_campaign == campaign_id  (frágil, só campanha)
 *   0.40 — fuzzy: utm_campaign matches campaign_name (ilike)
 *   0.00 — nenhum match → marcado matched=false, method='direct'
 *
 * Idempotente: UPSERT por purchase_id (UNIQUE).
 *
 * Nota: queries usam meta_ad_insights_daily com DISTINCT pra evitar duplicatas
 * (1 row por ad por dia). Limitação: ads que nunca gastaram não estão na tabela.
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
    | "utm_term_ad_id"
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
  // Fuzzy via ILIKE com wildcards. Mais permissivo que exact match.
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
  // Nível 1+2: utm_term ou utm_id == ad_id (template canônico)
  const adCandidate = utm.utm_term?.trim();
  if (adCandidate && /^\d+$/.test(adCandidate)) {
    const found = await findByAdId(hub, adCandidate);
    if (found) {
      return {
        matched: true,
        method: "utm_term_ad_id",
        confidence: 1.0,
        campaign_id: found.campaign_id ?? undefined,
        campaign_name: found.campaign_name ?? undefined,
        adset_id: found.adset_id ?? undefined,
        ad_id: found.ad_id ?? undefined,
      };
    }
  }

  // Nível 3: triple match (utm_content=adset_id AND utm_campaign=campaign_id)
  if (
    utm.utm_content &&
    utm.utm_campaign &&
    /^\d+$/.test(utm.utm_content) &&
    /^\d+$/.test(utm.utm_campaign)
  ) {
    const found = await findByAdsetAndCampaign(hub, utm.utm_content, utm.utm_campaign);
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

  // Nível 4: utm_campaign == campaign_id
  if (utm.utm_campaign && /^\d+$/.test(utm.utm_campaign)) {
    const found = await findByCampaignId(hub, utm.utm_campaign);
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

  // Nível 5: fuzzy por nome — útil se cliente usa {{campaign.name}} no template
  if (utm.utm_campaign && utm.utm_campaign.length > 4) {
    const found = await findByCampaignName(hub, utm.utm_campaign);
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

/**
 * Persiste a atribuição em utm_sales_attribution. Idempotente via UPSERT.
 */
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

/**
 * Marca atribuição como inativa (refund/chargeback).
 * Procura pelo purchase_id (refund é um novo row em purchases, mas precisamos
 * achar o paid original — caller passa o purchase_id do paid).
 */
export async function deactivateAttribution(
  hub: SupabaseClient,
  purchaseId: string,
  reason: "refunded" | "chargeback",
): Promise<void> {
  await hub
    .from("utm_sales_attribution")
    .update({
      is_active: false,
      inactive_reason: reason,
      inactive_at: new Date().toISOString(),
    })
    .eq("purchase_id", purchaseId);
}
