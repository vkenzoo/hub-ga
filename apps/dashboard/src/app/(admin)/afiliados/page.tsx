import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { Hideable } from "@/components/hideable";

type Period = "today" | "yesterday" | "7d" | "30d" | "month" | "all" | "custom";

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

function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}%`;
}
function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR");
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  });
}

interface Row {
  id: string;
  amount: number;
  net_amount: number | null;
  status: string;
  affiliate_id: string | null;
  affiliate_name: string | null;
  customer_id: string;
  created_at: string;
  customers: { id: string; name: string | null; email: string } | null;
  products: { name: string } | null;
}

/** Receita real do produtor: líquido quando disponível, senão valor cheio. */
function netOf(r: { net_amount: number | null; amount: number }): number {
  return r.net_amount != null ? Number(r.net_amount) : Number(r.amount);
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const auth = await requireAdmin();
  // Reusa permissão de Vendas — afiliados é um recorte das vendas.
  if (!canAccessSection(auth, "sales")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const start = periodStart(period, sp.from);
  const end = periodEnd(period, sp.to);

  const sb = createSupabaseAdmin();

  let q = sb
    .from("purchases")
    .select(
      "id, amount, net_amount, status, affiliate_id, affiliate_name, customer_id, created_at, customers(id, name, email), products(name)",
    )
    .not("affiliate_id", "is", null)
    .in("status", ["paid", "refunded"])
    .order("created_at", { ascending: false })
    .limit(50000);
  if (start) q = q.gte("created_at", start.toISOString());
  if (end) q = q.lt("created_at", end.toISOString());

  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];

  const paid = rows.filter((r) => r.status === "paid");
  const refunded = rows.filter((r) => r.status === "refunded");

  // Agrega por afiliado (chave = affiliate_id; nome de exibição = affiliate_name ?? code)
  interface Agg {
    code: string;
    name: string | null;
    receita: number;
    reembolsos: number;
    vendas: number;
    clientes: Set<string>;
  }
  const byAff = new Map<string, Agg>();
  const get = (code: string, name: string | null): Agg => {
    let a = byAff.get(code);
    if (!a) {
      a = { code, name, receita: 0, reembolsos: 0, vendas: 0, clientes: new Set() };
      byAff.set(code, a);
    }
    if (!a.name && name) a.name = name;
    return a;
  };
  for (const r of paid) {
    const a = get(r.affiliate_id!, r.affiliate_name);
    a.receita += netOf(r);
    a.vendas += 1;
    a.clientes.add(r.customer_id);
  }
  for (const r of refunded) {
    const a = get(r.affiliate_id!, r.affiliate_name);
    a.reembolsos += netOf(r);
  }
  const ranking = [...byAff.values()].sort((a, b) => b.receita - a.receita);

  // KPIs
  const totalReceita = paid.reduce((s, r) => s + netOf(r), 0);
  const totalReembolsos = refunded.reduce((s, r) => s + netOf(r), 0);
  const totalVendas = paid.length;
  const ticketMedio = totalVendas > 0 ? totalReceita / totalVendas : 0;

  const periods: Period[] = ["today", "yesterday", "7d", "30d", "month", "all"];
  const PERIOD_LABEL: Record<Period, string> = {
    today: "Hoje", yesterday: "Ontem", "7d": "7d", "30d": "30d", month: "Mês", all: "Tudo", custom: "Custom",
  };

  return (
    <>
      <PageHeader
        title="Afiliados"
        subtitle="Vendas geradas por afiliados (Hotmart). Ranking por receita + transações detalhadas."
        right={
          <span className="chip">
            <span className="dot bg-accent" /> {ranking.length} {ranking.length === 1 ? "afiliado" : "afiliados"}
          </span>
        }
      />

      <PageBody>
        {/* Filtro de período */}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {periods.map((p) => (
            <Link
              key={p}
              href={p === "30d" ? "/afiliados" : `/afiliados?period=${p}`}
              className={`px-2.5 py-1 rounded transition ${
                period === p ? "bg-brand text-text" : "text-text2 hover:bg-surface2 hover:text-text"
              }`}
            >
              {PERIOD_LABEL[p]}
            </Link>
          ))}
        </div>

        {/* KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Receita de afiliados" value={<Hideable kind="money">{fmtMoney(totalReceita)}</Hideable>} tone="accent" hint={`${fmtNum(totalVendas)} vendas`} />
          <StatCard label="Reembolsos" value={<Hideable kind="money">{fmtMoney(totalReembolsos)}</Hideable>} hint={<Hideable kind="count">{totalReceita > 0 ? fmtPct((totalReembolsos / totalReceita) * 100) + " da receita" : "—"}</Hideable>} />
          <StatCard label="Afiliados ativos" value={<Hideable kind="count">{String(ranking.length)}</Hideable>} hint="Com venda no período" />
          <StatCard label="Ticket médio" value={<Hideable kind="money">{fmtMoney(ticketMedio)}</Hideable>} hint="Receita ÷ vendas" />
        </section>

        {/* Ranking por afiliado */}
        <section className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Ranking por afiliado</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Por receita</span>
          </header>
          {ranking.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">Nenhuma venda de afiliado no período.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5 w-8">#</th>
                    <th className="text-left font-medium px-4 py-2.5">Afiliado</th>
                    <th className="text-right font-medium px-4 py-2.5 w-20">Vendas</th>
                    <th className="text-right font-medium px-4 py-2.5 w-28">Receita</th>
                    <th className="text-right font-medium px-4 py-2.5 w-28">Reembolsos</th>
                    <th className="text-right font-medium px-4 py-2.5 w-24">% Reemb.</th>
                    <th className="text-right font-medium px-4 py-2.5 w-24">Clientes</th>
                    <th className="text-right font-medium px-4 py-2.5 w-28">Ticket médio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ranking.map((a, i) => {
                    const pct = a.receita > 0 ? (a.reembolsos / a.receita) * 100 : 0;
                    const ticket = a.vendas > 0 ? a.receita / a.vendas : 0;
                    return (
                      <tr key={a.code} className="hover:bg-surface2/30 transition">
                        <td className="px-4 py-2.5 text-2xs text-muted tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="text-text"><Hideable kind="text">{a.name ?? a.code}</Hideable></div>
                          {a.name && <div className="text-2xs text-muted font-mono">{a.code}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums"><Hideable kind="count">{fmtNum(a.vendas)}</Hideable></td>
                        <td className="px-4 py-2.5 text-right tabular-nums"><Hideable kind="money">{fmtMoney(a.receita)}</Hideable></td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted">
                          {a.reembolsos > 0 ? <Hideable kind="money">{fmtMoney(a.reembolsos)}</Hideable> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {pct > 0 ? <span className={pct > 10 ? "text-warn" : "text-text2"}><Hideable kind="count">{fmtPct(pct)}</Hideable></span> : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums"><Hideable kind="count">{fmtNum(a.clientes.size)}</Hideable></td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs"><Hideable kind="money">{fmtMoney(ticket)}</Hideable></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Transações detalhadas */}
        <section className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Vendas de afiliados</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">{rows.length} no período (máx 500 exibidas)</span>
          </header>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">Nenhuma venda.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Cliente</th>
                    <th className="text-left font-medium px-4 py-2.5">Afiliado</th>
                    <th className="text-left font-medium px-4 py-2.5">Produto</th>
                    <th className="text-right font-medium px-4 py-2.5 w-24">Valor</th>
                    <th className="text-left font-medium px-4 py-2.5 w-20">Status</th>
                    <th className="text-right font-medium px-4 py-2.5 w-32">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.slice(0, 500).map((r) => (
                    <tr key={r.id} className="hover:bg-surface2/30 transition">
                      <td className="px-4 py-2.5">
                        {r.customers ? (
                          <Link href={`/customers/${r.customers.id}`} className="hover:text-brand transition">
                            <div className="text-xs"><Hideable kind="text">{r.customers.name ?? r.customers.email}</Hideable></div>
                          </Link>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs"><Hideable kind="text">{r.affiliate_name ?? r.affiliate_id}</Hideable></td>
                      <td className="px-4 py-2.5 text-xs text-text2">{r.products?.name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <Hideable kind="money">{fmtMoney(netOf(r))}</Hideable>
                        {r.net_amount != null && Number(r.net_amount) !== Number(r.amount) && (
                          <div className="text-2xs text-muted line-through">{fmtMoney(Number(r.amount))}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="chip">
                          <span className={`dot ${r.status === "paid" ? "bg-accent" : "bg-warn"}`} />
                          {r.status === "paid" ? "Pago" : "Estornado"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted tabular-nums whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PageBody>
    </>
  );
}
