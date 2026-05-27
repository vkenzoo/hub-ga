import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { Hideable } from "@/components/hideable";
import { ReattributeButton } from "./reattribute-button";
import { DrillDown, type RawInsight } from "./drilldown";
import { parseCols } from "./columns";

// ── Tipos ────────────────────────────────────────────────────
interface AdAccountInfo {
  id: string;
  account_id: string;
  name: string | null;
}

type Period = "today" | "7d" | "30d" | "month" | "all" | "custom";
type Classification = "all" | "acquisition" | "monetization" | "other" | "unclassified";

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
  if (p === "7d") local.setUTCDate(local.getUTCDate() - 6);
  else if (p === "30d") local.setUTCDate(local.getUTCDate() - 29);
  else if (p === "month") local.setUTCDate(1);
  return new Date(local.getTime() + BRT_OFFSET_MIN * 60_000);
}

function periodEnd(p: Period, to?: string): Date | null {
  if (p !== "custom" || !to) return null;
  const start = brtMidnightFromDateString(to);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60_000);
}

function parsePeriod(raw: string | undefined): Period {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "month" || raw === "all" || raw === "custom") return raw;
  return "30d";
}

function parseClassification(raw: string | undefined): Classification {
  if (raw === "acquisition" || raw === "monetization" || raw === "other" || raw === "unclassified") return raw;
  return "all";
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR");
}

function fmtPct(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}%`;
}

interface BuildQueryParams {
  period: Period;
  classification: Classification;
  account?: string;
  cols?: string;
  from?: string;
  to?: string;
}

function buildQuery(sp: BuildQueryParams): string {
  const p = new URLSearchParams();
  if (sp.period !== "30d") p.set("period", sp.period);
  if (sp.classification !== "all") p.set("classification", sp.classification);
  if (sp.account) p.set("account", sp.account);
  if (sp.cols) p.set("cols", sp.cols);
  if (sp.from) p.set("from", sp.from);
  if (sp.to) p.set("to", sp.to);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    classification?: string;
    account?: string;
    cols?: string | string[];
  }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "meta_ads")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const classification = parseClassification(sp.classification);
  const cols = parseCols(sp.cols);
  const start = periodStart(period, sp.from);
  const end = periodEnd(period, sp.to);
  const startDate = start?.toISOString().slice(0, 10);
  const endDate = end?.toISOString().slice(0, 10);

  const sb = createSupabaseAdmin();

  // Ad accounts
  const { data: acctsRaw } = await sb.from("ad_accounts").select("id, account_id, name");
  const accounts = (acctsRaw ?? []) as AdAccountInfo[];
  const accountNameById: Record<string, string | null> = {};
  for (const a of accounts) accountNameById[a.id] = a.name;

  // Insights do período
  let q = sb
    .from("meta_ad_insights_daily")
    .select(`
      ad_account_id, date_start,
      campaign_id, campaign_name,
      adset_id, adset_name,
      ad_id, ad_name,
      spend_cents, impressions, clicks,
      landing_page_views, initiated_checkouts,
      classification
    `)
    .order("date_start", { ascending: false })
    .limit(50000);

  if (startDate) q = q.gte("date_start", startDate);
  if (endDate) q = q.lt("date_start", endDate);
  if (sp.account) {
    const acct = accounts.find((a) => a.account_id === sp.account);
    if (acct) q = q.eq("ad_account_id", acct.id);
  }
  if (classification === "acquisition" || classification === "monetization" || classification === "other") {
    q = q.eq("classification", classification);
  } else if (classification === "unclassified") {
    q = q.is("classification", null);
  }

  // Atribuições UTM no período
  let attrQ = sb
    .from("utm_sales_attribution")
    .select(`
      purchase_id, campaign_id, adset_id, ad_id,
      purchases!inner(amount, status, created_at)
    `)
    .eq("matched", true)
    .eq("is_active", true)
    .eq("purchases.status", "paid")
    .limit(50000);
  if (start) attrQ = attrQ.gte("purchases.created_at", start.toISOString());
  if (end) attrQ = attrQ.lt("purchases.created_at", end.toISOString());

  const [{ data: rowsRaw }, { data: attrRaw }] = await Promise.all([q, attrQ]);
  const insights = (rowsRaw ?? []) as RawInsight[];
  const attrs = (attrRaw ?? []) as unknown as Array<{
    purchase_id: string;
    campaign_id: string | null;
    adset_id: string | null;
    ad_id: string | null;
    purchases: { amount: number; status: string; created_at: string } | Array<{ amount: number; status: string; created_at: string }>;
  }>;

  // Mapas de receita pra cada nível
  const revByCampaign: Record<string, { revenue_cents: number; sales_count: number }> = {};
  const revByAdset: Record<string, { revenue_cents: number; sales_count: number }> = {};
  const revByAd: Record<string, { revenue_cents: number; sales_count: number }> = {};
  for (const a of attrs) {
    const p = Array.isArray(a.purchases) ? a.purchases[0] : a.purchases;
    const amountCents = Math.round(Number(p?.amount ?? 0) * 100);
    if (a.campaign_id) {
      const r = revByCampaign[a.campaign_id] ?? { revenue_cents: 0, sales_count: 0 };
      r.revenue_cents += amountCents;
      r.sales_count += 1;
      revByCampaign[a.campaign_id] = r;
    }
    if (a.adset_id) {
      const r = revByAdset[a.adset_id] ?? { revenue_cents: 0, sales_count: 0 };
      r.revenue_cents += amountCents;
      r.sales_count += 1;
      revByAdset[a.adset_id] = r;
    }
    if (a.ad_id) {
      const r = revByAd[a.ad_id] ?? { revenue_cents: 0, sales_count: 0 };
      r.revenue_cents += amountCents;
      r.sales_count += 1;
      revByAd[a.ad_id] = r;
    }
  }

  // ── KPIs totais ────────────────────────────────────────
  const totalSpendCents = insights.reduce((s, r) => s + (r.spend_cents ?? 0), 0);
  const totalImpressions = insights.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const totalClicks = insights.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const totalLPVs = insights.reduce((s, r) => s + (r.landing_page_views ?? 0), 0);
  const totalICs = insights.reduce((s, r) => s + (r.initiated_checkouts ?? 0), 0);
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const cpc = totalClicks > 0 ? totalSpendCents / totalClicks : 0;
  const totalRevenueCents = Object.values(revByCampaign).reduce((s, r) => s + r.revenue_cents, 0);
  const totalSales = Object.values(revByCampaign).reduce((s, r) => s + r.sales_count, 0);

  // Query string pra preservar filtros em links do ColumnsToggle
  const preservedQuery = (() => {
    const p = new URLSearchParams();
    if (period !== "30d") p.set("period", period);
    if (classification !== "all") p.set("classification", classification);
    if (sp.account) p.set("account", sp.account);
    if (sp.from) p.set("from", sp.from);
    if (sp.to) p.set("to", sp.to);
    return p.toString();
  })();

  return (
    <>
      <PageHeader
        title="Meta Ads"
        subtitle="Spend + métricas de conversão via Marketing API. Marque campanhas pra ver adsets, marque adsets pra ver ads."
        right={
          <div className="flex flex-wrap gap-1.5">
            <ReattributeButton />
            {(["today", "7d", "30d", "month", "all"] as Period[]).map((p) => {
              const label = p === "today" ? "Hoje" : p === "month" ? "Mês" : p === "all" ? "Tudo" : p;
              const active = period === p;
              return (
                <Link
                  key={p}
                  href={`/meta-ads${buildQuery({ period: p, classification, account: sp.account, cols: cols.join(","), from: sp.from, to: sp.to })}`}
                  className={`btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
                >
                  {label}
                </Link>
              );
            })}
            <details className="relative">
              <summary className={`btn-sm ${period === "custom" ? "btn-primary" : "btn-ghost"} list-none cursor-pointer`}>
                📅 Personalizado
              </summary>
              <form className="absolute right-0 mt-2 z-10 card p-3 w-72 space-y-2" action="/meta-ads">
                <input type="hidden" name="period" value="custom" />
                <input type="hidden" name="classification" value={classification} />
                {sp.account && <input type="hidden" name="account" value={sp.account} />}
                <label className="block">
                  <span className="label">De</span>
                  <input type="date" name="from" defaultValue={sp.from} className="input" />
                </label>
                <label className="block">
                  <span className="label">Até</span>
                  <input type="date" name="to" defaultValue={sp.to} className="input" />
                </label>
                <button type="submit" className="btn btn-primary w-full">Aplicar</button>
              </form>
            </details>
          </div>
        }
      />

      <PageBody>
        {/* KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Investimento"
            value={<Hideable kind="money">{fmtMoney(totalSpendCents)}</Hideable>}
            tone="accent"
            hint={`${fmtNum(totalImpressions)} impressões`}
          />
          <StatCard
            label="Receita atribuída"
            value={<Hideable kind="money">{fmtMoney(totalRevenueCents)}</Hideable>}
            hint={<Hideable kind="count">{`${totalSales} ${totalSales === 1 ? "venda" : "vendas"}`}</Hideable>}
          />
          <StatCard
            label="ROAS"
            value={
              totalSpendCents > 0 ? (
                <Hideable kind="count">
                  {(totalRevenueCents / totalSpendCents).toFixed(2).replace(".", ",")}
                </Hideable>
              ) : "—"
            }
            hint="Receita ÷ Spend"
          />
          <StatCard
            label="CPC médio"
            value={<Hideable kind="money">{fmtMoney(Math.round(cpc))}</Hideable>}
            hint={`CTR ${fmtPct(ctr)} · LPVs ${fmtNum(totalLPVs)} · ICs ${fmtNum(totalICs)}`}
          />
        </section>

        {/* Filtros (classificação + conta) */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-2xs text-muted uppercase tracking-wider mr-2">Classificação:</span>
          {(["all", "acquisition", "monetization", "other", "unclassified"] as Classification[]).map((c) => {
            const label =
              c === "all" ? "Tudo" :
              c === "acquisition" ? "Aquisição" :
              c === "monetization" ? "Monetização" :
              c === "other" ? "Outros" :
              "Sem regra";
            const active = classification === c;
            return (
              <Link
                key={c}
                href={`/meta-ads${buildQuery({ period, classification: c, account: sp.account, cols: cols.join(","), from: sp.from, to: sp.to })}`}
                className={`btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
              >
                {label}
              </Link>
            );
          })}

          {accounts.length > 1 && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="text-2xs text-muted uppercase tracking-wider">Conta:</span>
              <Link
                href={`/meta-ads${buildQuery({ period, classification, cols: cols.join(","), from: sp.from, to: sp.to })}`}
                className={`btn-sm ${!sp.account ? "btn-primary" : "btn-ghost"}`}
              >
                Todas
              </Link>
              {accounts.map((a) => (
                <Link
                  key={a.id}
                  href={`/meta-ads${buildQuery({ period, classification, account: a.account_id, cols: cols.join(","), from: sp.from, to: sp.to })}`}
                  className={`btn-sm ${sp.account === a.account_id ? "btn-primary" : "btn-ghost"}`}
                  title={a.account_id}
                >
                  {a.name ?? a.account_id}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Drill-down em 3 seções */}
        <DrillDown
          insights={insights}
          accountNameById={accountNameById}
          revByCampaign={revByCampaign}
          revByAdset={revByAdset}
          revByAd={revByAd}
          cols={cols}
          preservedQuery={preservedQuery}
        />

        {insights.length === 0 && (
          <div className="text-2xs text-muted">
            💡 Sem dados? Vai em{" "}
            <Link href="/connections/meta-ads" className="text-brand hover:underline">
              /connections/meta-ads
            </Link>{" "}
            e clica <strong>⟳ Sincronizar</strong>.
          </div>
        )}
      </PageBody>
    </>
  );
}
