import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFunnelMap, classifyPurchase } from "./classify";
import { FUNNEL_POSITIONS, type FunnelPosition } from "./positions";

export const META_TAX_RATE = 0.125; // imposto sobre investimento em mídia

const BRT_OFFSET_MIN = 180; // UTC-3

// ── Helpers de mês em BRT ───────────────────────────────────
/** Range UTC do mês (BRT). month = 1..12. */
export function monthRangeUtc(year: number, month: number): { startIso: string; endIso: string } {
  const startUtc = Date.UTC(year, month - 1, 1, 3, 0, 0); // 00:00 BRT = 03:00 UTC
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const endUtc = Date.UTC(nextY, nextM - 1, 1, 3, 0, 0);
  return { startIso: new Date(startUtc).toISOString(), endIso: new Date(endUtc).toISOString() };
}

/** "YYYY-MM-DD" do primeiro dia do mês e do primeiro dia do mês seguinte (p/ date_start). */
export function monthDateBounds(year: number, month: number): { startDate: string; endDate: string } {
  const mm = String(month).padStart(2, "0");
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const startDate = `${year}-${mm}-01`;
  const endDate = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { startDate, endDate };
}

/** Lista de dias "YYYY-MM-DD" do mês. */
export function daysInMonth(year: number, month: number): string[] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate(); // dia 0 do mês seguinte = último dia
  const mm = String(month).padStart(2, "0");
  const out: string[] = [];
  for (let d = 1; d <= last; d++) out.push(`${year}-${mm}-${String(d).padStart(2, "0")}`);
  return out;
}

/** Converte ISO (UTC) → "YYYY-MM-DD" no fuso BRT. */
export function isoDayBRT(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - BRT_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Mês atual em BRT como {year, month}. */
export function currentMonthBRT(): { year: number; month: number } {
  const local = new Date(Date.now() - BRT_OFFSET_MIN * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1 };
}

// ── Bucket de agregação ─────────────────────────────────────
export interface FunnelBucket {
  spendCents: number;
  impressions: number;
  clicks: number;
  lpv: number;
  ic: number;
  vendas: Record<FunnelPosition, number>;
  receita: Record<FunnelPosition, number>;
  mainBuyers: Set<string>;
}

function zeroByPosition(): Record<FunnelPosition, number> {
  const o = {} as Record<FunnelPosition, number>;
  for (const p of FUNNEL_POSITIONS) o[p] = 0;
  return o;
}

export function emptyBucket(): FunnelBucket {
  return {
    spendCents: 0,
    impressions: 0,
    clicks: 0,
    lpv: 0,
    ic: 0,
    vendas: zeroByPosition(),
    receita: zeroByPosition(),
    mainBuyers: new Set<string>(),
  };
}

// ── Métricas derivadas ──────────────────────────────────────
export interface FunnelMetrics {
  // resumo
  investimento: number;
  faturamentoTotal: number;
  faturamentoMain: number;
  cpaReal: number | null;
  roasMain: number | null;
  roasFunil: number | null;
  ticketMedio: number | null;
  impostoMeta: number;
  lucroBruto: number;
  lucroLiquido: number;
  novosClientes: number;
  // números
  impressoes: number;
  cliques: number;
  cpc: number | null;
  viewPage: number;
  checkout: number;
  custoCheckout: number | null;
  vendasTotais: number;
  // taxas
  ctr: number | null;
  viewPagePorClique: number | null;
  checkoutPorViewPage: number | null;
  vendaPorViewPage: number | null;
  vendaPorCheckout: number | null;
  // por posição
  porPosicao: Record<FunnelPosition, { vendas: number; conversao: number | null; faturamento: number }>;
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function computeMetrics(b: FunnelBucket): FunnelMetrics {
  const investimento = b.spendCents / 100;
  const vendasMain = b.vendas.main;
  const faturamentoMain = b.receita.main;
  let faturamentoTotal = 0;
  let vendasTotais = 0;
  for (const p of FUNNEL_POSITIONS) {
    faturamentoTotal += b.receita[p];
    vendasTotais += b.vendas[p];
  }
  const impostoMeta = investimento * META_TAX_RATE;
  const lucroBruto = faturamentoTotal - investimento;
  const lucroLiquido = lucroBruto - impostoMeta;

  const porPosicao = {} as FunnelMetrics["porPosicao"];
  for (const p of FUNNEL_POSITIONS) {
    porPosicao[p] = {
      vendas: b.vendas[p],
      conversao: div(b.vendas[p], vendasMain),
      faturamento: b.receita[p],
    };
  }

  return {
    investimento,
    faturamentoTotal,
    faturamentoMain,
    cpaReal: div(investimento, vendasMain),
    roasMain: div(faturamentoMain, investimento),
    roasFunil: div(faturamentoTotal, investimento),
    ticketMedio: div(faturamentoTotal, vendasTotais),
    impostoMeta,
    lucroBruto,
    lucroLiquido,
    novosClientes: b.mainBuyers.size,
    impressoes: b.impressions,
    cliques: b.clicks,
    cpc: div(investimento, b.clicks),
    viewPage: b.lpv,
    checkout: b.ic,
    custoCheckout: div(investimento, b.ic),
    vendasTotais,
    ctr: div(b.clicks, b.impressions),
    viewPagePorClique: div(b.lpv, b.clicks),
    checkoutPorViewPage: div(b.ic, b.lpv),
    vendaPorViewPage: div(vendasMain, b.lpv),
    vendaPorCheckout: div(vendasMain, b.ic),
    porPosicao,
  };
}

// ── Agregação do mês ────────────────────────────────────────
export interface MonthAggregate {
  year: number;
  month: number;
  days: string[];
  perDay: Map<string, FunnelBucket>;
  total: FunnelBucket;
}

interface MetaRow {
  date_start: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  initiated_checkouts: number;
}
type ProductRel = { gateway_ids: Record<string, string> | null } | null;
interface PurchaseRow {
  gateway_offer_id: string | null;
  net_amount: number | null;
  amount: number;
  customer_id: string;
  created_at: string;
  products: ProductRel | ProductRel[];
}

const netOf = (p: { net_amount: number | null; amount: number }) =>
  p.net_amount != null ? Number(p.net_amount) : Number(p.amount);

/**
 * Agrega um mês inteiro: métricas de mídia (meta_ad_insights_daily) + vendas
 * classificadas por funnel_mapping. Retorna perDay (com todos os dias zerados)
 * e o total do mês.
 */
export async function aggregateMonth(
  sb: SupabaseClient,
  year: number,
  month: number,
): Promise<MonthAggregate> {
  const { startIso, endIso } = monthRangeUtc(year, month);
  const { startDate, endDate } = monthDateBounds(year, month);
  const days = daysInMonth(year, month);

  const [{ data: metaRaw }, { data: purchRaw }, map] = await Promise.all([
    sb
      .from("meta_ad_insights_daily")
      .select("date_start, spend_cents, impressions, clicks, landing_page_views, initiated_checkouts")
      .eq("classification", "acquisition")
      .gte("date_start", startDate)
      .lt("date_start", endDate)
      .limit(100000),
    sb
      .from("purchases")
      .select("gateway_offer_id, net_amount, amount, customer_id, created_at, products(gateway_ids)")
      .eq("gateway", "assiny")
      .eq("status", "paid")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(100000),
    loadFunnelMap(sb),
  ]);

  const perDay = new Map<string, FunnelBucket>();
  for (const d of days) perDay.set(d, emptyBucket());
  const total = emptyBucket();

  // Mídia por dia
  for (const r of (metaRaw ?? []) as MetaRow[]) {
    const day = r.date_start; // já YYYY-MM-DD (BRT)
    const b = perDay.get(day);
    if (!b) continue;
    b.spendCents += Number(r.spend_cents ?? 0);
    b.impressions += Number(r.impressions ?? 0);
    b.clicks += Number(r.clicks ?? 0);
    b.lpv += Number(r.landing_page_views ?? 0);
    b.ic += Number(r.initiated_checkouts ?? 0);
    total.spendCents += Number(r.spend_cents ?? 0);
    total.impressions += Number(r.impressions ?? 0);
    total.clicks += Number(r.clicks ?? 0);
    total.lpv += Number(r.landing_page_views ?? 0);
    total.ic += Number(r.initiated_checkouts ?? 0);
  }

  // Vendas por dia + posição
  for (const p of (purchRaw ?? []) as unknown as PurchaseRow[]) {
    const prod = Array.isArray(p.products) ? p.products[0] : p.products;
    const gatewayProductId = prod?.gateway_ids?.assiny ?? null;
    const pos = classifyPurchase(
      { gateway_offer_id: p.gateway_offer_id, gateway_product_id: gatewayProductId },
      map,
    );
    if (!pos) continue; // não mapeado → fora do funil
    const day = isoDayBRT(p.created_at);
    const b = perDay.get(day);
    const v = netOf(p);
    if (b) {
      b.vendas[pos] += 1;
      b.receita[pos] += v;
      if (pos === "main" && p.customer_id) b.mainBuyers.add(p.customer_id);
    }
    total.vendas[pos] += 1;
    total.receita[pos] += v;
    if (pos === "main" && p.customer_id) total.mainBuyers.add(p.customer_id);
  }

  return { year, month, days, perDay, total };
}
