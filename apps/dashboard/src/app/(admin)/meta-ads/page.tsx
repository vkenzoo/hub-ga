import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { Hideable } from "@/components/hideable";

// ── Tipos ────────────────────────────────────────────────────
interface InsightRow {
  id: string;
  ad_account_id: string;
  date_start: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  reach: number | null;
  classification: "acquisition" | "monetization" | "other" | null;
}

interface AdAccountInfo {
  id: string;
  account_id: string;
  name: string | null;
}

interface CampaignAgg {
  campaign_id: string;
  campaign_name: string;
  ad_account_name: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  ads_count: number;
  days: number;
  classification: "acquisition" | "monetization" | "other" | null;
  // Atribuição UTM
  revenue_cents: number;
  sales_count: number;
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

function classificationChip(c: CampaignAgg["classification"]) {
  if (c === "acquisition") return { dot: "bg-brand", label: "Aquisição" };
  if (c === "monetization") return { dot: "bg-info", label: "Monetização" };
  if (c === "other") return { dot: "bg-muted", label: "Outros" };
  return { dot: "bg-text2", label: "Sem regra" };
}

function buildQuery(sp: { period: Period; classification: Classification; account?: string; from?: string; to?: string }): string {
  const p = new URLSearchParams();
  if (sp.period !== "30d") p.set("period", sp.period);
  if (sp.classification !== "all") p.set("classification", sp.classification);
  if (sp.account) p.set("account", sp.account);
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
  }>;
}) {
  const auth = await requireAdmin();
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

  // Carrega ad accounts pra filtros + nomes
  const { data: acctsRaw } = await sb
    .from("ad_accounts")
    .select("id, account_id, name");
  const accounts = (acctsRaw ?? []) as AdAccountInfo[];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Carrega insights do período
  let q = sb
    .from("meta_ad_insights_daily")
    .select("*")
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

  // Atribuições UTM no período (matched=true, is_active=true)
  let attrQ = sb
    .from("utm_sales_attribution")
    .select(`
      purchase_id, campaign_id, match_confidence,
      purchases!inner(amount, status, created_at)
    `)
    .eq("matched", true)
    .eq("is_active", true)
    .eq("purchases.status", "paid")
    .limit(50000);
  if (start) attrQ = attrQ.gte("purchases.created_at", start.toISOString());
  if (end) attrQ = attrQ.lt("purchases.created_at", end.toISOString());

  const [{ data: rowsRaw }, { data: attrRaw }] = await Promise.all([q, attrQ]);
  const rows = (rowsRaw ?? []) as InsightRow[];
  // Supabase retorna join 1:1 como array. Acessa [0] pra pegar a row.
  const attrs = (attrRaw ?? []) as unknown as Array<{
    purchase_id: string;
    campaign_id: string | null;
    match_confidence: number | null;
    purchases: { amount: number; status: string; created_at: string } | Array<{ amount: number; status: string; created_at: string }>;
  }>;

  // Agrega receita atribuída por campaign_id
  const revenueByCampaign = new Map<string, { revenue_cents: number; sales_count: number }>();
  for (const a of attrs) {
    if (!a.campaign_id) continue;
    const p = Array.isArray(a.purchases) ? a.purchases[0] : a.purchases;
    const amount = Number(p?.amount ?? 0);
    if (!revenueByCampaign.has(a.campaign_id)) {
      revenueByCampaign.set(a.campaign_id, { revenue_cents: 0, sales_count: 0 });
    }
    const r = revenueByCampaign.get(a.campaign_id)!;
    r.revenue_cents += Math.round(amount * 100);  // purchases.amount em reais → centavos
    r.sales_count += 1;
  }

  const totalRevenueCents = Array.from(revenueByCampaign.values()).reduce(
    (s, r) => s + r.revenue_cents,
    0,
  );
  const totalSales = Array.from(revenueByCampaign.values()).reduce(
    (s, r) => s + r.sales_count,
    0,
  );

  // ── KPIs gerais ────────────────────────────────────────
  const totalSpendCents = rows.reduce((s, r) => s + (r.spend_cents ?? 0), 0);
  const totalImpressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const totalClicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const cpc = totalClicks > 0 ? totalSpendCents / totalClicks : 0; // cents
  const cpm = totalImpressions > 0 ? (totalSpendCents / totalImpressions) * 1000 : 0;

  // ── Agrega por campanha ────────────────────────────────
  const campMap = new Map<string, CampaignAgg>();
  for (const r of rows) {
    const key = r.campaign_id;
    if (!campMap.has(key)) {
      const rev = revenueByCampaign.get(key);
      campMap.set(key, {
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name ?? "(sem nome)",
        ad_account_name: accountById.get(r.ad_account_id)?.name ?? null,
        spend_cents: 0,
        impressions: 0,
        clicks: 0,
        ads_count: 0,
        days: 0,
        classification: r.classification,
        revenue_cents: rev?.revenue_cents ?? 0,
        sales_count: rev?.sales_count ?? 0,
      });
    }
    const c = campMap.get(key)!;
    c.spend_cents += r.spend_cents ?? 0;
    c.impressions += r.impressions ?? 0;
    c.clicks += r.clicks ?? 0;
  }

  // Conta ads e dias únicos por campanha (segunda passada — Set é mais limpo)
  const adsByCampaign = new Map<string, Set<string>>();
  const daysByCampaign = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!adsByCampaign.has(r.campaign_id)) adsByCampaign.set(r.campaign_id, new Set());
    if (!daysByCampaign.has(r.campaign_id)) daysByCampaign.set(r.campaign_id, new Set());
    adsByCampaign.get(r.campaign_id)!.add(r.ad_id);
    daysByCampaign.get(r.campaign_id)!.add(r.date_start);
  }
  for (const [campId, ads] of adsByCampaign) {
    const c = campMap.get(campId);
    if (c) c.ads_count = ads.size;
  }
  for (const [campId, days] of daysByCampaign) {
    const c = campMap.get(campId);
    if (c) c.days = days.size;
  }

  const campaigns = Array.from(campMap.values()).sort(
    (a, b) => b.spend_cents - a.spend_cents,
  );

  return (
    <>
      <PageHeader
        title="Meta Ads"
        subtitle="Spend, impressões e cliques das campanhas conectadas via Marketing API."
        right={
          <div className="flex flex-wrap gap-1.5">
            {(["today", "7d", "30d", "month", "all"] as Period[]).map((p) => {
              const label = p === "today" ? "Hoje" : p === "month" ? "Mês" : p === "all" ? "Tudo" : p;
              const active = period === p;
              return (
                <Link
                  key={p}
                  href={`/meta-ads${buildQuery({ period: p, classification, account: sp.account, from: sp.from, to: sp.to })}`}
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
        {/* Stats */}
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
            hint={`CTR ${fmtPct(ctr)} · CPM ${fmtMoney(Math.round(cpm))}`}
          />
        </section>

        {/* Filtros: classificação + ad account */}
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
                href={`/meta-ads${buildQuery({ period, classification: c, account: sp.account, from: sp.from, to: sp.to })}`}
                className={`btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
              >
                {label}
              </Link>
            );
          })}

          {accounts.length > 1 && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-2xs text-muted uppercase tracking-wider">Conta:</span>
              <Link
                href={`/meta-ads${buildQuery({ period, classification, from: sp.from, to: sp.to })}`}
                className={`btn-sm ${!sp.account ? "btn-primary" : "btn-ghost"}`}
              >
                Todas
              </Link>
              {accounts.map((a) => (
                <Link
                  key={a.id}
                  href={`/meta-ads${buildQuery({ period, classification, account: a.account_id, from: sp.from, to: sp.to })}`}
                  className={`btn-sm ${sp.account === a.account_id ? "btn-primary" : "btn-ghost"}`}
                  title={a.account_id}
                >
                  {a.name ?? a.account_id}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Tabela campanhas */}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text2 border-b border-line">
              <tr>
                <th className="px-3 py-2.5 font-normal">Campanha</th>
                <th className="px-3 py-2.5 font-normal">Classif.</th>
                <th className="px-3 py-2.5 font-normal text-right">Spend</th>
                <th className="px-3 py-2.5 font-normal text-right">Receita</th>
                <th className="px-3 py-2.5 font-normal text-right">ROAS</th>
                <th className="px-3 py-2.5 font-normal text-right">Vendas</th>
                <th className="px-3 py-2.5 font-normal text-right">Impressões</th>
                <th className="px-3 py-2.5 font-normal text-right">Cliques</th>
                <th className="px-3 py-2.5 font-normal text-right">CTR</th>
                <th className="px-3 py-2.5 font-normal text-right">CPC</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted">
                    Nenhuma campanha com spend no período.
                  </td>
                </tr>
              )}
              {campaigns.map((c) => {
                const chip = classificationChip(c.classification);
                const campCtr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
                const campCpc = c.clicks > 0 ? c.spend_cents / c.clicks : 0;
                const campRoas = c.spend_cents > 0 ? c.revenue_cents / c.spend_cents : null;
                return (
                  <tr
                    key={c.campaign_id}
                    className="border-b border-line/40 hover:bg-surface2/30"
                  >
                    <td className="px-3 py-2.5">
                      <div className="text-text leading-snug">{c.campaign_name}</div>
                      <div className="text-2xs text-muted font-mono mt-0.5">
                        {c.ad_account_name ?? c.campaign_id}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="chip">
                        <span className={`dot ${chip.dot}`} />
                        {chip.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      <Hideable kind="money">{fmtMoney(c.spend_cents)}</Hideable>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {c.revenue_cents > 0 ? (
                        <span className="text-accent font-medium">
                          <Hideable kind="money">{fmtMoney(c.revenue_cents)}</Hideable>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {campRoas != null ? (
                        <span className={campRoas >= 1 ? "text-accent" : "text-warn"}>
                          <Hideable kind="count">{campRoas.toFixed(2).replace(".", ",")}</Hideable>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-text2">
                      <Hideable kind="count">{String(c.sales_count)}</Hideable>
                    </td>
                    <td className="px-3 py-2.5 text-right text-text2">
                      <Hideable kind="count">{fmtNum(c.impressions)}</Hideable>
                    </td>
                    <td className="px-3 py-2.5 text-right text-text2">
                      <Hideable kind="count">{fmtNum(c.clicks)}</Hideable>
                    </td>
                    <td className="px-3 py-2.5 text-right text-text2">
                      <Hideable kind="count">{fmtPct(campCtr)}</Hideable>
                    </td>
                    <td className="px-3 py-2.5 text-right text-text2">
                      <Hideable kind="money">{fmtMoney(Math.round(campCpc))}</Hideable>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-2xs text-muted">
          {campaigns.length} {campaigns.length === 1 ? "campanha" : "campanhas"} · {rows.length} linhas de insight
          {rows.length === 0 && (
            <>
              <br />
              <span className="text-warn">
                💡 Sem dados? Vai em <Link href="/connections/meta-ads" className="text-brand hover:underline">/connections/meta-ads</Link>{" "}
                e clica <strong>⟳ Sincronizar</strong>.
              </span>
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}
