import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { RevenueChart, PaymentMethodChart, PaymentPie } from "./charts";

// Taxa de gateway aplicada sobre faturamento bruto (fórmula da Margem de Contribuição)
const GATEWAY_FEE_RATE = 0.065;

type Period = "today" | "7d" | "30d" | "month" | "all" | "custom";

const PERIOD_LABEL: Record<Period, string> = {
  today: "Hoje",
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

  // Puxa todas as compras no período (paid + refunded) DE PRODUTOS DE AQUISIÇÃO.
  // Inner join filtra fora monetização/outros. Limit alto pra escala atual.
  let q = sb
    .from("purchases")
    .select(
      "id, amount, status, payment_method, customer_id, product_id, utm_source, created_at, products!inner(name, role)",
    )
    .eq("products.role", "acquisition")
    .in("status", ["paid", "refunded"])
    .order("created_at", { ascending: true })
    .limit(50000);
  if (startISO) q = q.gte("created_at", startISO);
  if (endISO) q = q.lt("created_at", endISO);
  const { data: rows } = await q;

  interface Row {
    id: string;
    amount: number;
    status: string;
    payment_method: string | null;
    customer_id: string;
    product_id: string | null;
    utm_source: string | null;
    created_at: string;
    products: { name: string; role: string } | null;
  }
  const purchases = (rows ?? []) as unknown as Row[];

  // ── Agregações de KPI ────────────────────────────────────
  const paid = purchases.filter((p) => p.status === "paid");
  const refunded = purchases.filter((p) => p.status === "refunded");

  const receita = paid.reduce((s, p) => s + Number(p.amount), 0);
  const reembolsos = refunded.reduce((s, p) => s + Number(p.amount), 0);
  const investimento = 0; // MVP — virá do Meta na fase 2
  const taxas = receita * GATEWAY_FEE_RATE;
  const margem = receita - taxas - reembolsos - investimento;
  const margemPct = receita > 0 ? (margem / receita) * 100 : 0;
  const taxaReembolso = receita > 0 ? (reembolsos / receita) * 100 : 0;
  const compradores = new Set(paid.map((p) => p.customer_id)).size;
  const tmf = compradores > 0 ? receita / compradores : 0;
  const roas = investimento > 0 ? receita / investimento : null;
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
    { receita: number; reembolsos: number; pix: number; cartao: number; boleto: number; outros: number }
  >();
  for (const day of daysBetween(firstDay, lastDay)) {
    dailyMap.set(day, { receita: 0, reembolsos: 0, pix: 0, cartao: 0, boleto: 0, outros: 0 });
  }
  for (const p of paid) {
    const day = isoDayBRT(p.created_at);
    const row = dailyMap.get(day) ?? { receita: 0, reembolsos: 0, pix: 0, cartao: 0, boleto: 0, outros: 0 };
    row.receita += Number(p.amount);
    const kind = classifyPayment(p.payment_method);
    row[kind] += Number(p.amount);
    dailyMap.set(day, row);
  }
  for (const p of refunded) {
    const day = isoDayBRT(p.created_at);
    const row = dailyMap.get(day) ?? { receita: 0, reembolsos: 0, pix: 0, cartao: 0, boleto: 0, outros: 0 };
    row.reembolsos += Number(p.amount);
    dailyMap.set(day, row);
  }
  const revenueSeries = [...dailyMap.entries()].sort().map(([date, r]) => ({
    date,
    receita: r.receita,
    reembolsos: r.reembolsos,
    margem: r.receita - r.receita * GATEWAY_FEE_RATE - r.reembolsos,
  }));
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
    row.receita += Number(p.amount);
    row.vendas += 1;
    byProduct.set(k, row);
  }
  for (const p of refunded) {
    const k = p.product_id ?? "?";
    const name = p.products?.name ?? "(removido)";
    const row = byProduct.get(k) ?? { name, receita: 0, reembolsos: 0, vendas: 0 };
    row.reembolsos += Number(p.amount);
    byProduct.set(k, row);
  }
  const productRows = [...byProduct.values()].sort((a, b) => b.receita - a.receita);

  // ── Payment method totals (pra pie) ──────────────────────
  const paymentTotals = {
    pix: paid.filter((p) => classifyPayment(p.payment_method) === "pix").reduce((s, p) => s + Number(p.amount), 0),
    cartao: paid.filter((p) => classifyPayment(p.payment_method) === "cartao").reduce((s, p) => s + Number(p.amount), 0),
    boleto: paid.filter((p) => classifyPayment(p.payment_method) === "boleto").reduce((s, p) => s + Number(p.amount), 0),
    outros: paid.filter((p) => classifyPayment(p.payment_method) === "outros").reduce((s, p) => s + Number(p.amount), 0),
  };
  const paymentPieData = [
    { name: "PIX", value: paymentTotals.pix, color: "#22c55e" },
    { name: "Cartão", value: paymentTotals.cartao, color: "#3b82f6" },
    { name: "Boleto", value: paymentTotals.boleto, color: "#fbbf24" },
    { name: "Outros", value: paymentTotals.outros, color: "#737373" },
  ].filter((d) => d.value > 0);

  // ── Chip selector de período ─────────────────────────────
  const periods: Period[] = ["today", "7d", "30d", "month", "all"];
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
          <StatCard label="Faturamento" value={fmtMoney(receita)} tone="accent" hint="Vendas pagas" />
          <StatCard label="Reembolsos" value={fmtMoney(reembolsos)} hint={fmtPct(taxaReembolso) + " do faturamento"} />
          <StatCard
            label="Margem de contribuição"
            value={fmtMoney(margem)}
            hint={`${fmtPct(margemPct)} · taxa ${(GATEWAY_FEE_RATE * 100).toFixed(1)}%`}
          />
          <StatCard label="Compradores únicos" value={fmtNum(compradores)} hint="Cliente único no período" />
        </section>

        {/* KPIs secundários */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Ticket médio (TMF)" value={fmtMoney(tmf)} hint="Receita ÷ compradores" />
          <StatCard
            label="Investimento"
            value={investimento > 0 ? fmtMoney(investimento) : "—"}
            hint="Conecte Meta Ads"
          />
          <StatCard
            label="ROAS"
            value={roas != null ? roas.toFixed(2).replace(".", ",") : "—"}
            hint="Receita ÷ investimento"
          />
          <StatCard
            label="CPA"
            value={cpa != null ? fmtMoney(cpa) : "—"}
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
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums">{fmtNum(p.vendas)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(p.receita)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted">
                          {p.reembolsos > 0 ? fmtMoney(p.reembolsos) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {pct > 0 ? (
                            <span className={pct > 10 ? "text-warn" : "text-text2"}>
                              {fmtPct(pct)}
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
