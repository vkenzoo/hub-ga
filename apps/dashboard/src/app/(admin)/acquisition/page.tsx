import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { Hideable } from "@/components/hideable";
import { RevenueChart, PaymentMethodChart, PaymentPie } from "./charts";

// Imposto sobre o investimento em mídia paga (Meta). Adicionado ao spend
// pra calcular o investimento total e descontado da margem de contribuição.
// Obs: a taxa de gateway NÃO entra mais aqui — a receita já é líquida (net_amount),
// então o gateway/Hotmart + comissão de afiliado já estão descontados por venda.
const META_TAX_RATE = 0.125;

type Period = "today" | "yesterday" | "7d" | "30d" | "month" | "all" | "custom";

const PERIOD_LABEL: Record<Period, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "7d",
  "30d": "30d",
  month: "Mês",
  all: "Tudo",
  custom: "Personalizado",
};

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
  // "Ontem" precisa de upper bound = meia-noite BRT de hoje (exclusivo).
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

function fmtDateLabel(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return `${m[3]}/${m[2]}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPct(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}%`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR");
}

/** Converte timestamp ISO em "YYYY-MM-DD" no fuso BRT */
function isoDayBRT(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - BRT_OFFSET_MIN * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Classifica payment_method em pix/cartao/boleto/outros */
function classifyPayment(method: string | null): "pix" | "cartao" | "boleto" | "outros" {
  if (!method) return "outros";
  const m = method.toUpperCase();
  if (m.includes("PIX")) return "pix";
  if (m.includes("CREDIT") || m.includes("CARD")) return "cartao";
  if (m.includes("BOLETO") || m.includes("BILLET")) return "boleto";
  return "outros";
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "acquisition")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const start = periodStart(period, sp.from);
  const end = periodEnd(period, sp.to);
  const startISO = start?.toISOString();
  const endISO = end?.toISOString();

  const sb = createSupabaseAdmin();

  interface Row {
    id: string;
    amount: number;
    net_amount: number | null;
    status: string;
    payment_method: string | null;
    customer_id: string;
    product_id: string | null;
    utm_source: string | null;
    created_at: string;
    products: { name: string; role: string } | null;
  }

  // Puxa TODAS as compras do período (paid + refunded) de produtos de aquisição,
  // PAGINANDO em blocos de 1000. O PostgREST corta cada request em ~1000 linhas;
  // com >100 vendas/dia, um único request perderia os dias recentes. Paginar
  // garante o dataset completo. Ordena por (created_at, id) pra paginação estável.
  //
  // EXCLUI vendas de afiliado (affiliate_id not null): elas não são aquisição do
  // seu funil — você recebe só a comissão e o afiliado trouxe o lead. Ficam no
  // dashboard /afiliados.
  async function fetchAllPurchases(): Promise<Row[]> {
    const PAGE = 1000;
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb
        .from("purchases")
        .select(
          "id, amount, net_amount, status, payment_method, customer_id, product_id, utm_source, created_at, products!inner(name, role)",
        )
        .eq("products.role", "acquisition")
        .in("status", ["paid", "refunded"])
        .is("affiliate_id", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (startISO) q = q.gte("created_at", startISO);
      if (endISO) q = q.lt("created_at", endISO);
      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      out.push(...(data as unknown as Row[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  // Investimento Meta — spend de campanhas 'acquisition' no período, TAMBÉM paginado
  // (per ad/dia pode passar de 1000 linhas num mês).
  const startDate = startISO ? startISO.slice(0, 10) : null;
  const endDate = endISO ? endISO.slice(0, 10) : null;
  interface MetaRow { spend_cents: number; date_start: string }
  async function fetchAllMeta(): Promise<MetaRow[]> {
    const PAGE = 1000;
    const out: MetaRow[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb
        .from("meta_ad_insights_daily")
        .select("id, spend_cents, date_start")
        .eq("classification", "acquisition")
        .order("date_start", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (startDate) q = q.gte("date_start", startDate);
      if (endDate) q = q.lt("date_start", endDate);
      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      out.push(...(data as unknown as MetaRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  const [purchases, metaRows] = await Promise.all([fetchAllPurchases(), fetchAllMeta()]);
  // Receita real do produtor: líquido quando disponível, senão valor cheio.
  const netOf = (p: { net_amount: number | null; amount: number }) =>
    p.net_amount != null ? Number(p.net_amount) : Number(p.amount);

  // ── Agregações de KPI ────────────────────────────────────
  const paid = purchases.filter((p) => p.status === "paid");
  const refunded = purchases.filter((p) => p.status === "refunded");

  // Receita = LÍQUIDO real do produtor (já desconta gateway/Hotmart + afiliado).
  // Por isso NÃO subtraímos taxa de gateway de novo (seria dupla contagem).
  const receita = paid.reduce((s, p) => s + netOf(p), 0);
  const reembolsos = refunded.reduce((s, p) => s + netOf(p), 0);
  // Meta ads insights são armazenados em centavos → divide por 100 pra alinhar com purchases (real)
  const investimentoCents = (metaRows ?? []).reduce(
    (s, r) => s + Number((r as { spend_cents: number }).spend_cents ?? 0),
    0,
  );
  const spendMeta = investimentoCents / 100;
  const impostoMeta = spendMeta * META_TAX_RATE;
  // Investimento "total" = spend Meta + imposto. Esse é o número que aparece
  // no card "Investimento" e que entra em CPA + ROI (não ROAS).
  const investimento = spendMeta + impostoMeta;
  // Gastos totais sobre a receita líquida = só spend + imposto Meta (o gateway já
  // está embutido no líquido de cada venda).
  const gastosTotais = spendMeta + impostoMeta;
  const margem = receita - reembolsos - investimento;
  const margemPct = receita > 0 ? (margem / receita) * 100 : 0;
  const taxaReembolso = receita > 0 ? (reembolsos / receita) * 100 : 0;
  const compradores = new Set(paid.map((p) => p.customer_id)).size;
  const tmf = compradores > 0 ? receita / compradores : 0;
  // ROAS = Receita líquida ÷ Spend Meta
  const roas = spendMeta > 0 ? receita / spendMeta : null;
  // ROI = Receita líquida ÷ Gastos totais (spend + imposto Meta)
  const roi = gastosTotais > 0 ? receita / gastosTotais : null;
  const cpa = compradores > 0 && investimento > 0 ? investimento / compradores : null;

  // ── Timeseries diário ────────────────────────────────────
  // Gera todos os dias do range pra mostrar buracos como 0
  function* daysBetween(startISO: string, endISO: string) {
    const s = new Date(startISO);
    const e = new Date(endISO);
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
      yield d.toISOString().slice(0, 10);
    }
  }
  const firstDay = startISO
    ? isoDayBRT(startISO)
    : paid[0]
      ? isoDayBRT(paid[0].created_at)
      : isoDayBRT(new Date().toISOString());
  const lastDay = endISO
    ? isoDayBRT(new Date(end!.getTime() - 1).toISOString())
    : isoDayBRT(new Date().toISOString());

  const dailyMap = new Map<
    string,
    { receita: number; reembolsos: number; investimento: number; pix: number; cartao: number; boleto: number; outros: number }
  >();
  const emptyDay = () => ({ receita: 0, reembolsos: 0, investimento: 0, pix: 0, cartao: 0, boleto: 0, outros: 0 });
  for (const day of daysBetween(firstDay, lastDay)) {
    dailyMap.set(day, emptyDay());
  }
  for (const p of paid) {
    const day = isoDayBRT(p.created_at);
    const row = dailyMap.get(day) ?? emptyDay();
    const v = netOf(p);
    row.receita += v;
    const kind = classifyPayment(p.payment_method);
    row[kind] += v;
    dailyMap.set(day, row);
  }
  for (const p of refunded) {
    const day = isoDayBRT(p.created_at);
    const row = dailyMap.get(day) ?? emptyDay();
    row.reembolsos += netOf(p);
    dailyMap.set(day, row);
  }
  // Investimento Meta (acquisition) por dia — date_start é DATE (YYYY-MM-DD direto)
  for (const r of (metaRows ?? []) as Array<{ spend_cents: number; date_start: string }>) {
    const day = r.date_start;
    const row = dailyMap.get(day) ?? emptyDay();
    row.investimento += Number(r.spend_cents ?? 0) / 100;
    dailyMap.set(day, row);
  }
  const revenueSeries = [...dailyMap.entries()].sort().map(([date, r]) => {
    const spendDay = r.investimento;                 // só spend Meta puro
    const investimentoTotal = spendDay * (1 + META_TAX_RATE); // spend + imposto
    // Receita já é líquida → margem = líquido - reembolsos - (spend + imposto).
    const margem = r.receita - r.reembolsos - investimentoTotal;
    // ROAS no chart = Receita líquida ÷ Spend, igual ao card.
    const roas = spendDay > 0 ? r.receita / spendDay : null;
    return {
      date,
      receita: r.receita,
      reembolsos: r.reembolsos,
      investimento: investimentoTotal,
      margem,
      roas,
    };
  });
  const paymentSeries = [...dailyMap.entries()].sort().map(([date, r]) => ({
    date,
    pix: r.pix,
    cartao: r.cartao,
    boleto: r.boleto,
    outros: r.outros,
  }));

  // ── Tabela de produtos ───────────────────────────────────
  const byProduct = new Map<string, { name: string; receita: number; reembolsos: number; vendas: number }>();
  for (const p of paid) {
    const k = p.product_id ?? "?";
    const name = p.products?.name ?? "(removido)";
    const row = byProduct.get(k) ?? { name, receita: 0, reembolsos: 0, vendas: 0 };
    row.receita += netOf(p);
    row.vendas += 1;
    byProduct.set(k, row);
  }
  for (const p of refunded) {
    const k = p.product_id ?? "?";
    const name = p.products?.name ?? "(removido)";
    const row = byProduct.get(k) ?? { name, receita: 0, reembolsos: 0, vendas: 0 };
    row.reembolsos += netOf(p);
    byProduct.set(k, row);
  }
  const productRows = [...byProduct.values()].sort((a, b) => b.receita - a.receita);

  // ── Payment method totals (pra pie) — sobre receita líquida ──
  const paymentTotals = {
    pix: paid.filter((p) => classifyPayment(p.payment_method) === "pix").reduce((s, p) => s + netOf(p), 0),
    cartao: paid.filter((p) => classifyPayment(p.payment_method) === "cartao").reduce((s, p) => s + netOf(p), 0),
    boleto: paid.filter((p) => classifyPayment(p.payment_method) === "boleto").reduce((s, p) => s + netOf(p), 0),
    outros: paid.filter((p) => classifyPayment(p.payment_method) === "outros").reduce((s, p) => s + netOf(p), 0),
  };
  const paymentPieData = [
    { name: "PIX", value: paymentTotals.pix, color: "#22c55e" },
    { name: "Cartão", value: paymentTotals.cartao, color: "#3b82f6" },
    { name: "Boleto", value: paymentTotals.boleto, color: "#fbbf24" },
    { name: "Outros", value: paymentTotals.outros, color: "#737373" },
  ].filter((d) => d.value > 0);

  // ── Chip selector de período ─────────────────────────────
  const periods: Period[] = ["today", "yesterday", "7d", "30d", "month", "all"];
  const customLabel =
    period === "custom"
      ? [fmtDateLabel(sp.from), fmtDateLabel(sp.to)].filter(Boolean).join(" – ") || "Personalizado"
      : "Personalizado";

  return (
    <>
      <PageHeader
        title="Aquisição"
        subtitle="Faturamento, margem, reembolsos e métricas por canal."
        right={
          <Link href="/acquisition/rules" className="btn btn-sm btn-ghost">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Regras de campanha
          </Link>
        }
      />
      <PageBody>
        {/* Filtro de período — compacto */}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {periods.map((p) => {
            const isActive = period === p;
            return (
              <Link
                key={p}
                href={p === "30d" ? "/acquisition" : `/acquisition?period=${p}`}
                className={`px-2.5 py-1 rounded transition ${
                  isActive ? "bg-brand text-text" : "text-text2 hover:bg-surface2 hover:text-text"
                }`}
              >
                {PERIOD_LABEL[p]}
              </Link>
            );
          })}
          <details className="relative">
            <summary
              className={`list-none cursor-pointer px-2.5 py-1 rounded transition flex items-center gap-1.5 ${
                period === "custom"
                  ? "bg-brand text-text"
                  : "text-text2 hover:bg-surface2 hover:text-text"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>
              {period === "custom" ? customLabel : "Personalizado"}
            </summary>
            <form className="absolute left-0 top-full mt-1 card p-3 z-10 shadow-lg w-64">
              <input type="hidden" name="period" value="custom" />
              <label className="block mb-2">
                <span className="label block mb-1">De</span>
                <input
                  type="date"
                  name="from"
                  defaultValue={sp.from ?? ""}
                  required
                  className="input"
                />
              </label>
              <label className="block mb-3">
                <span className="label block mb-1">Até</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={sp.to ?? ""}
                  required
                  className="input"
                />
              </label>
              <button className="btn btn-sm btn-primary w-full">Aplicar</button>
            </form>
          </details>
        </div>

        {/* KPIs principais */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Faturamento líquido" value={<Hideable kind="money">{fmtMoney(receita)}</Hideable>} tone="accent" hint="Sua comissão (já s/ gateway + afiliado)" />
          <StatCard label="Reembolsos" value={<Hideable kind="money">{fmtMoney(reembolsos)}</Hideable>} hint={<Hideable kind="count">{fmtPct(taxaReembolso) + " do faturamento"}</Hideable>} />
          <StatCard
            label="Margem de contribuição"
            value={<Hideable kind="money">{fmtMoney(margem)}</Hideable>}
            hint={
              <Hideable kind="count">
                {`${fmtPct(margemPct)} · líquido − reembolso − Meta ${(META_TAX_RATE * 100).toFixed(1)}%`}
              </Hideable>
            }
          />
          <StatCard label="Compradores únicos" value={<Hideable kind="count">{fmtNum(compradores)}</Hideable>} hint="Cliente único no período" />
        </section>

        {/* KPIs secundários */}
        <section className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <StatCard label="Ticket médio (TMF)" value={<Hideable kind="money">{fmtMoney(tmf)}</Hideable>} hint="Receita ÷ compradores" />
          <StatCard
            label="Investimento"
            value={investimento > 0 ? <Hideable kind="money">{fmtMoney(investimento)}</Hideable> : "—"}
            hint={
              investimento > 0 ? (
                <Hideable kind="money">{`Spend ${fmtMoney(spendMeta)} + Imposto`}</Hideable>
              ) : (
                "Conecte Meta Ads"
              )
            }
          />
          <StatCard
            label={`Imposto Meta (${(META_TAX_RATE * 100).toFixed(1)}%)`}
            value={impostoMeta > 0 ? <Hideable kind="money">{fmtMoney(impostoMeta)}</Hideable> : "—"}
            hint="Incluso no investimento"
          />
          <StatCard
            label="ROAS"
            value={roas != null ? <Hideable kind="count">{roas.toFixed(2).replace(".", ",")}</Hideable> : "—"}
            hint="Receita ÷ Spend Meta"
          />
          <StatCard
            label="ROI"
            value={roi != null ? <Hideable kind="count">{roi.toFixed(2).replace(".", ",")}</Hideable> : "—"}
            hint="Líquido ÷ (Spend + Imposto)"
          />
          <StatCard
            label="CPA"
            value={cpa != null ? <Hideable kind="money">{fmtMoney(cpa)}</Hideable> : "—"}
            hint="Investimento ÷ compradores"
          />
        </section>

        {/* Gráfico de receita/reembolso/margem diário */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Diário</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">
              {revenueSeries.length} {revenueSeries.length === 1 ? "dia" : "dias"}
            </span>
          </header>
          <div className="p-4">
            <RevenueChart data={revenueSeries} />
          </div>
        </section>

        {/* Tabela de produtos */}
        <section className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Por produto</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">
              {productRows.length} {productRows.length === 1 ? "produto" : "produtos"}
            </span>
          </header>
          {productRows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">Sem vendas no período.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Produto</th>
                    <th className="text-right font-medium px-4 py-2.5 w-24">Vendas</th>
                    <th className="text-right font-medium px-4 py-2.5 w-32">Receita</th>
                    <th className="text-right font-medium px-4 py-2.5 w-32">Reembolsos</th>
                    <th className="text-right font-medium px-4 py-2.5 w-28">% Reemb.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {productRows.map((p, i) => {
                    const pct = p.receita > 0 ? (p.reembolsos / p.receita) * 100 : 0;
                    return (
                      <tr key={i} className="hover:bg-surface2/30 transition">
                        <td className="px-4 py-2.5 text-sm">{p.name}</td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                          <Hideable kind="count">{fmtNum(p.vendas)}</Hideable>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <Hideable kind="money">{fmtMoney(p.receita)}</Hideable>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted">
                          {p.reembolsos > 0 ? <Hideable kind="money">{fmtMoney(p.reembolsos)}</Hideable> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {pct > 0 ? (
                            <span className={pct > 10 ? "text-warn" : "text-text2"}>
                              <Hideable kind="count">{fmtPct(pct)}</Hideable>
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Métodos de pagamento — diário + pizza */}
        <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          <div className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Pagamento por dia</h2>
              <p className="text-xs text-muted mt-0.5">PIX · Cartão · Boleto · Outros</p>
            </header>
            <div className="p-4">
              <PaymentMethodChart data={paymentSeries} />
            </div>
          </div>
          <div className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Mix de pagamento</h2>
              <p className="text-xs text-muted mt-0.5">% do faturamento total</p>
            </header>
            <div className="p-4">
              <PaymentPie data={paymentPieData} />
            </div>
          </div>
        </section>

        {/* Aviso sobre Meta */}
        <div className="card border-info/30 bg-info/5 px-4 py-3 text-sm text-text2">
          <strong className="text-info">Investimento, CPA, ROAS</strong> ficam vazios até o cron de
          sync com Meta Ads ser implementado (fase 2). As credenciais já podem ser cadastradas em{" "}
          <Link href="/connections/meta-ads" className="text-brand hover:underline">/connections/meta-ads</Link>.
        </div>
      </PageBody>
    </>
  );
}
