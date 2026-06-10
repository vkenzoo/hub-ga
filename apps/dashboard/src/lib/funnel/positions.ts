/**
 * Posições do funil de vendas (estilo KPI-DH).
 *
 * Uma venda é classificada numa dessas posições via funnel_mapping
 * (por gateway_offer_id, ou produto inteiro). Usado pra montar as seções
 * do grid diário e do comparativo de meses.
 */

export type FunnelPosition =
  | "main"
  | "order_01"
  | "order_02"
  | "order_03"
  | "order_04"
  | "order_05"
  | "upsell_01"
  | "upsell_02"
  | "downsell_01"
  | "downsell_02";

export const FUNNEL_POSITIONS: FunnelPosition[] = [
  "main",
  "order_01",
  "order_02",
  "order_03",
  "order_04",
  "order_05",
  "upsell_01",
  "upsell_02",
  "downsell_01",
  "downsell_02",
];

export const POSITION_LABEL: Record<FunnelPosition, string> = {
  main: "Produto Principal",
  order_01: "Order 01",
  order_02: "Order 02",
  order_03: "Order 03",
  order_04: "Order 04",
  order_05: "Order 05",
  upsell_01: "Upsell 01",
  upsell_02: "Upsell 02",
  downsell_01: "Downsell 01",
  downsell_02: "Downsell 02",
};

/** Label curto pro dropdown de mapeamento (com agrupamento visual). */
export const POSITION_GROUP: Record<FunnelPosition, "principal" | "order" | "upsell" | "downsell"> = {
  main: "principal",
  order_01: "order",
  order_02: "order",
  order_03: "order",
  order_04: "order",
  order_05: "order",
  upsell_01: "upsell",
  upsell_02: "upsell",
  downsell_01: "downsell",
  downsell_02: "downsell",
};

export function isFunnelPosition(v: string): v is FunnelPosition {
  return (FUNNEL_POSITIONS as string[]).includes(v);
}

/** Posições que entram nas seções de "VENDAS ..." do grid, em ordem. */
export const SALES_SECTION_ORDER: FunnelPosition[] = FUNNEL_POSITIONS;
