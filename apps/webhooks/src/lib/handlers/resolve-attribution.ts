/**
 * Resolver de atribuição UTM → ad/campaign do Meta.
 *
 * Suporta 2 formatos de UTM:
 *   A. ID puro:    utm_content=120211000123      → extractId retorna "120211000123"
 *   B. name|id:    utm_content=Anuncio X|12021100123  → extractId retorna "12021100123"
 *
 * Template recomendado no Meta Ads (Parâmetros de URL):
 *   utm_source=FB
 *   utm_campaign={{campaign.name}}|{{campaign.id}}
 *   utm_medium={{adset.name}}|{{adset.id}}
 *   utm_content={{ad.name}}|{{ad.id}}
 *   utm_term={{placement}}   ← placement (feed/reels/stories) — não usado pra match
 *
 * 5 níveis de confiança (last-click):
 *   1.00 — utm_content(id) + utm_medium(id) + utm_campaign(id) batem em (ad_id, adset_id, campaign_id)
 *   0.95 — só utm_content(id) bate em ad_id
 *   0.90 — utm_medium(id) + utm_campaign(id) batem em (adset_id, campaign_id)
 *   0.70 — utm_campaign(id) bate em campaign_id
 *   0.40 — fuzzy: utm_campaign(name) ilike campaign_name
 *   0.00 — nenhum match → matched=false, method='direct'
 *
 * Idempotente: UPSERT por purchase_id (UNIQUE).
 *
 * Limitação: queries em meta_ad_insights_daily — ads sem spend ainda não estão lá.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Extrai o ID numérico de um campo UTM no formato "name|id" ou só "id".
 * Retorna null se não conseguir extrair número.
 *
 * Exemplos:
 *   "Anuncio X|120211000123"  → "120211000123"
 *   "120211000123"            → "120211000123"
 *   "Anuncio X"               → null
 *   undefined                 → null
 */
function extractId(field: string | null | undefined): string | null {
  if (!field) return null;
  const v = field.trim();
  // Pega tudo após o último | (caso name contenha pipes — improvável mas seguro)
  const lastPipe = v.lastIndexOf("|");
  const candidate = lastPipe >= 0 ? v.slice(lastPipe + 1).trim() : v;
  return /^\d+$/.test(candidate) ? candidate : null;
}

/**
 * Extrai o nome de um campo UTM no formato "name|id".
 * Se for só "id" puro (sem pipe), retorna o valor inteiro.
 */
function extractName(field: string | null | undefined): string | null {
  if (!field) return null;
  const v = field.trim();
  const lastPipe = v.lastIndexOf("|");
  return lastPipe >= 0 ? v.slice(0, lastPipe).trim() : v;
}

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
    | "full_utm_match"          // ad + adset + campaign IDs todos batem (1.00)
    | "utm_ad_id"                // utm_content tem ad_id que bate (0.95)
    | "triple_utm"               // adset + campaign batem (0.90)
    | "utm_campaign_only"        // só campaign (0.70)
    | "fuzzy_campaign_name"      // ilike campaign_name (0.40)
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
  // Parse: aceita "name|id" ou só "id" puro
  const adId = extractId(utm.utm_content);
  const adsetId = extractId(utm.utm_medium);
  const campaignId = extractId(utm.utm_campaign);

  // Nível 1: full match — todos os 3 IDs presentes e batem (confiança máxima)
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

  // Nível 2: só ad_id bate (template tem só utm_content com id, ou hierarquia
  // mudou no Meta — ad foi movido pra outro adset/campaign).
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

  // Nível 3: adset + campaign (ad pode ter sido pausado/deletado depois da venda)
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

  // Nível 4: só campaign
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

  // Nível 5: fuzzy por nome (extrai do "name|id")
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
