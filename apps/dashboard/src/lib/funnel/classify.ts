import type { SupabaseClient } from "@supabase/supabase-js";
import { isFunnelPosition, type FunnelPosition } from "./positions";

/**
 * Mapa de classificação de funil carregado do banco.
 *   byOffer   → gateway_offer_id → posição (mais específico, vence)
 *   byProduct → gateway_product_id → posição (oferta null = produto inteiro)
 */
export interface FunnelMap {
  byOffer: Map<string, FunnelPosition>;
  byProduct: Map<string, FunnelPosition>;
}

interface MappingRow {
  gateway_product_id: string | null;
  gateway_offer_id: string | null;
  funnel_position: string;
  active: boolean;
}

/** Carrega funnel_mapping ativos (gateway assiny) e monta os índices de lookup. */
export async function loadFunnelMap(sb: SupabaseClient): Promise<FunnelMap> {
  const { data } = await sb
    .from("funnel_mapping")
    .select("gateway_product_id, gateway_offer_id, funnel_position, active")
    .eq("active", true)
    .eq("gateway", "assiny")
    .limit(5000);

  const byOffer = new Map<string, FunnelPosition>();
  const byProduct = new Map<string, FunnelPosition>();
  for (const r of (data ?? []) as MappingRow[]) {
    if (!isFunnelPosition(r.funnel_position)) continue;
    if (r.gateway_offer_id) byOffer.set(r.gateway_offer_id, r.funnel_position);
    else if (r.gateway_product_id) byProduct.set(r.gateway_product_id, r.funnel_position);
  }
  return { byOffer, byProduct };
}

/**
 * Classifica uma compra numa posição de funil. Oferta exata vence; senão produto
 * inteiro; senão null (não mapeado — fica fora das seções do funil).
 */
export function classifyPurchase(
  p: { gateway_offer_id: string | null; gateway_product_id: string | null },
  map: FunnelMap,
): FunnelPosition | null {
  if (p.gateway_offer_id) {
    const byOffer = map.byOffer.get(p.gateway_offer_id);
    if (byOffer) return byOffer;
  }
  if (p.gateway_product_id) {
    const byProduct = map.byProduct.get(p.gateway_product_id);
    if (byProduct) return byProduct;
  }
  return null;
}
