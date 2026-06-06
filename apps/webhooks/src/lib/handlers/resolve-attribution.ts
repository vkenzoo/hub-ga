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
 * Extrai o ID numérico de um campo UTM. Aceita 4 formatos comuns:
 *
 *   1. "name|id"                → id após o último |       (template canônico)
 *   2. "id::extra::"            → id antes do primeiro ::  (Meta auto-injection)
 *   3. "name-id"                → id após o último -       (template Assiny/Meta)
 *   4. "id" (puro)              → o próprio valor
 *
 * IDs do Meta são tipicamente ≥ 10 dígitos (usamos 10+ pra evitar match
 * acidental em hífens dentro de nomes como "Opção 1-CTA").
 *
 * Exemplos reais:
 *   "Anuncio X|120211000123"                       → "120211000123"
 *   "120250826235040054::PAZXh0...::"              → "120250826235040054"
 *   "[Validação] - Opção 01-120250825915890054"    → "120250825915890054"
 *   "ANÚNCIO 03-120250826235010054"                → "120250826235010054"
 *   "120211000123"                                 → "120211000123"
 *   "Instagram_Feed"                               → null
 */
function extractId(field: string | null | undefined): string | null {
  if (!field) return null;
  const v = field.trim();

  // 1. Pipe (nosso template ideal): "name|id" OU "name|id::fbtoken::"
  // A Meta auto-injeta "::<fbclid>::" no FIM do utm_content, então o trecho
  // após o pipe vira "id::token::". Tiramos o sufixo :: antes de testar.
  const lastPipe = v.lastIndexOf("|");
  if (lastPipe >= 0) {
    let after = v.slice(lastPipe + 1).trim();
    const dc = after.indexOf("::");
    if (dc >= 0) after = after.slice(0, dc).trim();
    if (/^\d+$/.test(after)) return after;
  }

  // 2. Double-colon (Meta às vezes auto-injeta sem pipe): "id::fbtoken::"
  const firstDoubleColon = v.indexOf("::");
  if (firstDoubleColon > 0) {
    const before = v.slice(0, firstDoubleColon).trim();
    if (/^\d+$/.test(before)) return before;
  }

  // 3. Dash (Assiny/Meta de novo): "name-id" (id tem 10+ dígitos pra evitar
  // falso-positivo em nomes tipo "Opção 01-A" ou "CTA-2")
  const lastDash = v.lastIndexOf("-");
  if (lastDash >= 0) {
    const after = v.slice(lastDash + 1).trim();
    if (/^\d{10,}$/.test(after)) return after;
  }

  // 4. Plain id
  if (/^\d+$/.test(v)) return v;

  // 5. Fallback: primeiro run de 10+ dígitos em qualquer lugar. IDs do Meta têm
  // 15-17 dígitos → pega o id em formatos esquisitos sem casar números curtos
  // dentro de nomes (ex: "AD 11", "Opção 01").
  const m = v.match(/\d{10,}/);
  if (m) return m[0];

  return null;
}

/**
 * Extrai o nome de um campo UTM removendo o ID e separador.
 * Se não houver separador, retorna o valor inteiro.
 */
function extractName(field: string | null | undefined): string | null {
  if (!field) return null;
  const v = field.trim();
  // Mesma ordem do extractId pra consistência
  const lastPipe = v.lastIndexOf("|");
  if (lastPipe >= 0) {
    // "name|id" ou "name|id::token::" → nome é tudo antes do pipe (se o que vem
    // depois, sem o sufixo ::, for um id numérico).
    let after = v.slice(lastPipe + 1).trim();
    const dc = after.indexOf("::");
    if (dc >= 0) after = after.slice(0, dc).trim();
    if (/^\d+$/.test(after)) return v.slice(0, lastPipe).trim();
  }
  const firstDoubleColon = v.indexOf("::");
  if (firstDoubleColon > 0 && /^\d+$/.test(v.slice(0, firstDoubleColon).trim())) {
    // No "::" format, o id vem ANTES — então o "nome" seria depois, mas isso
    // não faz sentido. Retornamos só o id parte.
    return v.slice(firstDoubleColon + 2).trim() || null;
  }
  const lastDash = v.lastIndexOf("-");
  if (lastDash >= 0 && /^\d{10,}$/.test(v.slice(lastDash + 1).trim())) {
    return v.slice(0, lastDash).trim();
  }
  return v;
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
