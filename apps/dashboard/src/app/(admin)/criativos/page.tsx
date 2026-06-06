import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { Hideable } from "@/components/hideable";
import { CreativesTable, type CreativeRow } from "./creatives-table";

type Period = "today" | "yesterday" | "7d" | "30d" | "month" | "all" | "custom";
type Classification = "all" | "acquisition" | "monetization" | "other";

const BRT_OFFSET_MIN = 180;

function brtMidnightFromDateString(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 3, 0, 0));
}

function periodStart(p: Period, from?: string): Date | null {
  if (p === "custom") return from ? brtMidnightFromDateString(from) : null;
  if (p === "all") return null;
  const nowLocalMs = Date.now() - BRT_OFFSET_MIN * 60_000;
  const local = new Date(nowLocalMs);
  local.setUTCHours(0, 0, 0, 0);
  if (p === "yesterday") local.setUTCDate(local.getUTCDate() - 1);
  else if (p === "7d") local.setUTCDate(local.getUTCDate() - 6);
  else if (p === "30d") local.setUTCDate(local.getUTCDate() - 29);
  else if (p === "month") local.setUTCDate(1);
  return new Date(local.getTime() + BRT_OFFSET_MIN * 60_000);
}

function periodEnd(p: Period, to?: string): Date | null {
  if (p === "yesterday") {
    const nowLocalMs = Date.now() - BRT_OFFSET_MIN * 60_000;
    const local = new Date(nowLocalMs);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() + BRT_OFFSET_MIN * 60_000);
  }
  if (p !== "custom" || !to) return null;
  const start = brtMidnightFromDateString(to);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60_000);
}

function parsePeriod(raw: string | undefined): Period {
  if (raw === "today" || raw === "yesterday" || raw === "7d" || raw === "30d" || raw === "month" || raw === "all" || raw === "custom") return raw;
  return "30d";
}

function parseClassification(raw: string | undefined): Classification {
  if (raw === "acquisition" || raw === "monetization" || raw === "other") return raw;
  return "all";
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildQuery(p: { period: Period; classification: Classification; from?: string; to?: string }): string {
  const sp = new URLSearchParams();
  if (p.period !== "30d") sp.set("period", p.period);
  if (p.classification !== "all") sp.set("classification", p.classification);
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

interface InsightRow {
  ad_id: string;
  ad_name: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  initiated_checkouts: number;
  video_3s_views: number;
  video_thruplays: number;
  video_p100_views: number;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; classification?: string }>;
}) {
  const auth = await requireAdmin();
  // Reusa a permissão de Meta Ads — criativos é uma visão dos mesmos dados.
  if (!canAccessSection(auth, "meta_ads")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const classification = parseClassification(sp.classification);
  const start = periodStart(period, sp.from);
  const end = periodEnd(period, sp.to);
  const startDate = start?.toISOString().slice(0, 10);
  const endDate = end?.toISOString().slice(0, 10);

  const sb = createSupabaseAdmin();

  // Insights do período
  let q = sb
    .from("meta_ad_insights_daily")
    .select(
      "ad_id, ad_name, spend_cents, impressions, clicks, landing_page_views, initiated_checkouts, video_3s_views, video_thruplays, video_p100_views, classification",
    )
    .limit(100000);
  if (startDate) q = q.gte("date_start", startDate);
  if (endDate) q = q.lt("date_start", endDate);
  if (classification !== "all") q = q.eq("classification", classification);

  // Atribuições do período (receita + compradores únicos por ad_id)
  let attrQ = sb
    .from("utm_sales_attribution")
    .select("ad_id, purchases!inner(amount, status, created_at, customer_id)")
    .eq("matched", true)
    .eq("is_active", true)
    .eq("purchases.status", "paid")
    .not("ad_id", "is", null)
    .limit(50000);
  if (start) attrQ = attrQ.gte("purchases.created_at", start.toISOString());
  if (end) attrQ = attrQ.lt("purchases.created_at", end.toISOString());

  const [{ data: insRaw }, { data: attrRaw }] = await Promise.all([q, attrQ]);
  const insights = (insRaw ?? []) as unknown as InsightRow[];
  const attrs = (attrRaw ?? []) as unknown as Array<{
    ad_id: string | null;
    purchases:
      | { amount: number; customer_id: string }
      | Array<{ amount: number; customer_id: string }>;
  }>;

  // ad_id → ad_name (do período). Usado pra reagrupar receita por nome.
  const adIdToName = new Map<string, string>();
  for (const i of insights) {
    if (i.ad_id) adIdToName.set(i.ad_id, i.ad_name?.trim() || "(sem nome)");
  }

  // Agrega insights por ad_name
  interface Agg {
    ad_ids: Set<string>;
    spend_cents: number;
    impressions: number;
    clicks: number;
    lpv: number;
    ic: number;
    video_3s: number;
    video_thruplays: number;
    video_p100: number;
    revenue_cents: number;
    buyers: Set<string>;
  }
  const byName = new Map<string, Agg>();
  const emptyAgg = (): Agg => ({
    ad_ids: new Set(),
    spend_cents: 0,
    impressions: 0,
    clicks: 0,
    lpv: 0,
    ic: 0,
    video_3s: 0,
    video_thruplays: 0,
    video_p100: 0,
    revenue_cents: 0,
    buyers: new Set(),
  });

  for (const i of insights) {
    const name = i.ad_name?.trim() || "(sem nome)";
    const a = byName.get(name) ?? emptyAgg();
    if (i.ad_id) a.ad_ids.add(i.ad_id);
    a.spend_cents += Number(i.spend_cents ?? 0);
    a.impressions += Number(i.impressions ?? 0);
    a.clicks += Number(i.clicks ?? 0);
    a.lpv += Number(i.landing_page_views ?? 0);
    a.ic += Number(i.initiated_checkouts ?? 0);
    a.video_3s += Number(i.video_3s_views ?? 0);
    a.video_thruplays += Number(i.video_thruplays ?? 0);
    a.video_p100 += Number(i.video_p100_views ?? 0);
    byName.set(name, a);
  }

  // Receita + compradores por ad_name (via ad_id → nome)
  for (const at of attrs) {
    if (!at.ad_id) continue;
    const name = adIdToName.get(at.ad_id);
    if (!name) continue; // ad_id sem insight no período (sem spend) → ignora
    const p = Array.isArray(at.purchases) ? at.purchases[0] : at.purchases;
    if (!p) continue;
    const a = byName.get(name) ?? emptyAgg();
    a.revenue_cents += Math.round(Number(p.amount ?? 0) * 100);
    if (p.customer_id) a.buyers.add(p.customer_id);
    byName.set(name, a);
  }

  const rows: CreativeRow[] = [...byName.entries()].map(([ad_name, a]) => ({
    ad_name,
    ad_count: a.ad_ids.size,
    spend_cents: a.spend_cents,
    impressions: a.impressions,
    clicks: a.clicks,
    lpv: a.lpv,
    ic: a.ic,
    video_3s: a.video_3s,
    video_thruplays: a.video_thruplays,
    video_p100: a.video_p100,
    revenue_cents: a.revenue_cents,
    buyers: a.buyers.size,
  }));

  // KPIs do topo
  const totalSpend = rows.reduce((s, r) => s + r.spend_cents, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue_cents, 0);
  const totalBuyers = rows.reduce((s, r) => s + r.buyers, 0);
  const roasGeral = totalSpend > 0 ? totalRevenue / totalSpend : null;

  const periods: Period[] = ["today", "yesterday", "7d", "30d", "month", "all"];
  const PERIOD_LABEL: Record<Period, string> = {
    today: "Hoje", yesterday: "Ontem", "7d": "7d", "30d": "30d", month: "Mês", all: "Tudo", custom: "Custom",
  };
  const classifications: Classification[] = ["all", "acquisition", "monetization", "other"];
  const CLASS_LABEL: Record<Classification, string> = {
    all: "Tudo", acquisition: "Aquisição", monetization: "Monetização", other: "Outros",
  };

  return (
    <>
      <PageHeader
        title="Ranking de criativos"
        subtitle="Performance por criativo (ad name) — unifica todas as veiculações. Clique em qualquer coluna pra ordenar ↑↓."
        right={
          <Link href="/meta-ads" className="btn btn-sm btn-ghost">
            Meta Ads →
          </Link>
        }
      />

      <PageBody>
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {periods.map((p) => (
            <Link
              key={p}
              href={`/criativos${buildQuery({ period: p, classification, from: sp.from, to: sp.to })}`}
              className={`btn-sm ${period === p ? "btn-primary" : "btn-ghost"}`}
            >
              {PERIOD_LABEL[p]}
            </Link>
          ))}
          <span className="mx-2 text-muted">·</span>
          {classifications.map((c) => (
            <Link
              key={c}
              href={`/criativos${buildQuery({ period, classification: c, from: sp.from, to: sp.to })}`}
              className={`btn-sm ${classification === c ? "btn-primary" : "btn-ghost"}`}
            >
              {CLASS_LABEL[c]}
            </Link>
          ))}
        </div>

        {/* KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Criativos" value={String(rows.length)} hint="Nomes únicos no período" />
          <StatCard label="Investimento" value={<Hideable kind="money">{fmtMoney(totalSpend)}</Hideable>} tone="accent" />
          <StatCard label="Receita atribuída" value={<Hideable kind="money">{fmtMoney(totalRevenue)}</Hideable>} hint={<Hideable kind="count">{`${totalBuyers} vendas`}</Hideable>} />
          <StatCard label="ROAS geral" value={roasGeral != null ? <Hideable kind="count">{roasGeral.toFixed(2).replace(".", ",")}</Hideable> : "—"} hint="Receita ÷ Spend" />
        </section>

        {/* Tabela ordenável */}
        <CreativesTable rows={rows} />

        <p className="text-2xs text-muted">
          <strong>Hook</strong> = vídeo 3s ÷ impressões · <strong>Hold</strong> = ThruPlay ÷ impressões ·
          {" "}<strong>Retenção</strong> = assistiu 100% ÷ vídeo 3s · <strong>Vendas</strong> = compradores únicos ·
          {" "}métricas de vídeo só preenchem após o próximo sync. Receita atribuída via UTM (ad_id → ad name).
        </p>
      </PageBody>
    </>
  );
}
