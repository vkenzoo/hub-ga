/**
 * Definição declarativa das colunas da tabela /meta-ads.
 *
 * - `key`: identificador no URL (?cols=key1,key2)
 * - `label`: texto na tabela e no toggle
 * - `default`: aparece se user não personalizou cols
 * - `align`: 'left' | 'right'
 * - `format`: 'money' | 'count' | 'pct' | 'roas'
 * - `compute`: recebe a agg e retorna o número (ou null = "—")
 */
export interface CampaignAgg {
  campaign_id: string;
  campaign_name: string;
  adset_id?: string | null;
  adset_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  ad_account_name: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  initiated_checkouts: number;
  ads_count: number;
  days: number;
  classification: "acquisition" | "monetization" | "other" | null;
  revenue_cents: number;
  sales_count: number;
}

export type ColKey =
  | "spend"
  | "receita"
  | "roas"
  | "vendas"
  | "cpa"
  | "ticket_medio"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm"
  | "lpv"
  | "cost_per_lpv"
  | "ic"
  | "cost_per_ic"
  | "ads_count"
  | "days";

export interface ColumnDef {
  key: ColKey;
  label: string;
  default?: boolean;
  align: "left" | "right";
  format: "money" | "count" | "pct" | "roas";
  /** Tom da célula quando > 0 */
  highlight?: "accent" | "warn" | "danger";
  compute: (c: CampaignAgg) => number | null;
}

export const COLUMNS: ColumnDef[] = [
  {
    key: "spend",
    label: "Spend",
    default: true,
    align: "right",
    format: "money",
    compute: (c) => c.spend_cents,
  },
  {
    key: "receita",
    label: "Receita",
    default: true,
    align: "right",
    format: "money",
    highlight: "accent",
    compute: (c) => (c.revenue_cents > 0 ? c.revenue_cents : null),
  },
  {
    key: "roas",
    label: "ROAS",
    default: true,
    align: "right",
    format: "roas",
    compute: (c) => (c.spend_cents > 0 ? c.revenue_cents / c.spend_cents : null),
  },
  {
    key: "vendas",
    label: "Vendas",
    default: true,
    align: "right",
    format: "count",
    compute: (c) => c.sales_count,
  },
  {
    key: "cpa",
    label: "CPA real",
    default: true,
    align: "right",
    format: "money",
    compute: (c) => (c.sales_count > 0 ? c.spend_cents / c.sales_count : null),
  },
  {
    key: "ticket_medio",
    label: "Ticket médio",
    align: "right",
    format: "money",
    compute: (c) => (c.sales_count > 0 ? c.revenue_cents / c.sales_count : null),
  },
  {
    key: "lpv",
    label: "LPVs",
    default: true,
    align: "right",
    format: "count",
    compute: (c) => c.landing_page_views,
  },
  {
    key: "cost_per_lpv",
    label: "Custo / LPV",
    default: true,
    align: "right",
    format: "money",
    compute: (c) =>
      c.landing_page_views > 0 ? c.spend_cents / c.landing_page_views : null,
  },
  {
    key: "ic",
    label: "ICs",
    default: true,
    align: "right",
    format: "count",
    compute: (c) => c.initiated_checkouts,
  },
  {
    key: "cost_per_ic",
    label: "Custo / IC",
    default: true,
    align: "right",
    format: "money",
    compute: (c) =>
      c.initiated_checkouts > 0
        ? c.spend_cents / c.initiated_checkouts
        : null,
  },
  {
    key: "impressions",
    label: "Impressões",
    align: "right",
    format: "count",
    compute: (c) => c.impressions,
  },
  {
    key: "clicks",
    label: "Cliques",
    align: "right",
    format: "count",
    compute: (c) => c.clicks,
  },
  {
    key: "ctr",
    label: "CTR",
    align: "right",
    format: "pct",
    compute: (c) =>
      c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null,
  },
  {
    key: "cpc",
    label: "CPC",
    align: "right",
    format: "money",
    compute: (c) => (c.clicks > 0 ? c.spend_cents / c.clicks : null),
  },
  {
    key: "cpm",
    label: "CPM",
    align: "right",
    format: "money",
    compute: (c) =>
      c.impressions > 0 ? (c.spend_cents / c.impressions) * 1000 : null,
  },
  {
    key: "ads_count",
    label: "Ads",
    align: "right",
    format: "count",
    compute: (c) => c.ads_count,
  },
  {
    key: "days",
    label: "Dias",
    align: "right",
    format: "count",
    compute: (c) => c.days,
  },
];

export const DEFAULT_COLS: ColKey[] = COLUMNS.filter((c) => c.default).map(
  (c) => c.key,
);

export function parseCols(raw: string | string[] | undefined): ColKey[] {
  if (!raw) return DEFAULT_COLS;
  const arr = Array.isArray(raw) ? raw : raw.split(",");
  const valid = new Set(COLUMNS.map((c) => c.key));
  const parsed = arr.filter((k): k is ColKey => valid.has(k as ColKey));
  return parsed.length > 0 ? parsed : DEFAULT_COLS;
}

export function fmtCell(
  value: number | null,
  format: ColumnDef["format"],
): string {
  if (value == null) return "—";
  switch (format) {
    case "money":
      return (value / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
    case "count":
      return Math.round(value).toLocaleString("pt-BR");
    case "pct":
      return `${value.toFixed(2).replace(".", ",")}%`;
    case "roas":
      return value.toFixed(2).replace(".", ",");
  }
}

export type Level = "campaign" | "adset" | "ad";

export function parseLevel(raw: string | undefined): Level {
  if (raw === "adset" || raw === "ad") return raw;
  return "campaign";
}
