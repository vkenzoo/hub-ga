import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";

interface EventRow {
  id: string;
  kind: string;
  level: string;
  created_at: string;
}

type Period = "today" | "7d" | "30d" | "month" | "all" | "custom";

const PERIOD_LABEL: Record<Period, string> = {
  today: "Hoje",
  "7d": "7d",
  "30d": "30d",
  month: "Mês",
  all: "Tudo",
  custom: "Personalizado",
};

const BRT_OFFSET_MIN = 180; // BRT = UTC-3

/** Converte um "YYYY-MM-DD" em data UTC representando meia-noite em BRT. */
function brtMidnightFromDateString(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  // 00:00 BRT = 03:00 UTC do mesmo dia
  return new Date(Date.UTC(y, mo, d, 3, 0, 0));
}

/**
 * Início do range em America/Sao_Paulo (UTC-3) pra um período dado.
 * Retorna null pra "all" (sem filtro).
 */
function periodStart(p: Period, from?: string): Date | null {
  if (p === "custom") {
    return from ? brtMidnightFromDateString(from) : null;
  }
  if (p === "all") return null;

  const nowLocalMs = Date.now() - BRT_OFFSET_MIN * 60_000;
  const local = new Date(nowLocalMs);
  local.setUTCHours(0, 0, 0, 0); // meia-noite "local"

  if (p === "7d") local.setUTCDate(local.getUTCDate() - 6);
  else if (p === "30d") local.setUTCDate(local.getUTCDate() - 29);
  else if (p === "month") local.setUTCDate(1);
  // "today" → mantém a meia-noite local
  return new Date(local.getTime() + BRT_OFFSET_MIN * 60_000);
}

/** Fim do range. Pra custom usa `to` (inclusivo, fim do dia em BRT). */
function periodEnd(p: Period, to?: string): Date | null {
  if (p !== "custom") return null;
  if (!to) return null;
  const start = brtMidnightFromDateString(to);
  if (!start) return null;
  // +1 dia (exclusivo) pra incluir todo o dia "to"
  return new Date(start.getTime() + 24 * 60 * 60_000);
}

function parsePeriod(raw: string | undefined): Period {
  if (raw === "7d" || raw === "30d" || raw === "month" || raw === "all" || raw === "custom") return raw;
  return "today";
}

function fmtDateLabel(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return `${m[3]}/${m[2]}`;
}

async function getOverview(period: Period, from?: string, to?: string) {
  const sb = createSupabaseAdmin();
  const start = periodStart(period, from);
  const end = periodEnd(period, to);
  const startISO = start?.toISOString();
  const endISO = end?.toISOString();

  // Tudo em paralelo — antes eram 5 batches sequenciais, agora 1 batch só.
  // Reduz ~600ms (5 RTTs) pra ~120ms (1 RTT) em ambientes com latência típica.
  const newStudentsQuery =
    startISO || endISO
      ? (() => {
          let q = sb.from("customers").select("*", { count: "exact", head: true });
          if (startISO) q = q.gte("first_seen_at", startISO);
          if (endISO) q = q.lt("first_seen_at", endISO);
          return q;
        })()
      : null;

  const [
    { count: customersCount },
    { count: subscriptionsCount },
    { count: productsCount },
    { count: systemsCount },
    { count: grantsCount },
    { data: paidRows },
    newStudentsResult,
    { data: latestEventsData },
    { data: latestPurchasesData },
  ] = await Promise.all([
    sb.from("customers").select("*", { count: "exact", head: true }),
    sb.from("subscriptions").select("*", { count: "exact", head: true }),
    sb.from("products").select("*", { count: "exact", head: true }),
    sb.from("systems").select("*", { count: "exact", head: true }),
    sb.from("access_grants").select("*", { count: "exact", head: true }),
    sb
      .from("purchases")
      .select("amount, subscription_cycle, created_at")
      .eq("status", "paid")
      .limit(50000),
    newStudentsQuery ?? Promise.resolve({ count: null as number | null }),
    sb
      .from("events_log")
      .select("id,kind,level,created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    sb
      .from("purchases")
      .select("id,amount,gateway,status,created_at,customers(email),products(name)")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const paid = (paidRows ?? []) as Array<{
    amount: number;
    subscription_cycle: number | null;
    created_at: string;
  }>;

  // Filtro por período em JS sobre os mesmos dados
  const inPeriod = paid.filter((p) => {
    if (startISO && p.created_at < startISO) return false;
    if (endISO && p.created_at >= endISO) return false;
    return true;
  });

  const totalRevenue = paid.reduce((s, p) => s + Number(p.amount), 0);
  const periodRevenue = inPeriod.reduce((s, p) => s + Number(p.amount), 0);
  const periodRenewalRevenue = inPeriod
    .filter((p) => (p.subscription_cycle ?? 1) > 1)
    .reduce((s, p) => s + Number(p.amount), 0);
  const periodSalesCount = inPeriod.length;

  const newStudents = newStudentsResult.count ?? customersCount ?? 0;
  const latestEvents = latestEventsData;
  const latestPurchases = latestPurchasesData;

  return {
    counts: {
      customers: customersCount ?? 0,
      subscriptions: subscriptionsCount ?? 0,
      products: productsCount ?? 0,
      systems: systemsCount ?? 0,
      grants: grantsCount ?? 0,
    },
    metrics: {
      periodRevenue,
      periodRenewalRevenue,
      totalRevenue,
      newStudents,
      periodSales: periodSalesCount,
    },
    events: (latestEvents ?? []) as EventRow[],
    purchases: (latestPurchases ?? []) as unknown as Array<{
      id: string;
      amount: number;
      gateway: string;
      status: string;
      created_at: string;
      customers: { email: string } | null;
      products: { name: string } | null;
    }>,
  };
}

function fmtMoney(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function levelDot(level: string) {
  if (level === "error") return "bg-danger";
  if (level === "warn") return "bg-warn";
  return "bg-text2";
}

function statusChip(status: string) {
  if (status === "paid") return { dot: "bg-accent", label: "Pago" };
  if (status === "refunded") return { dot: "bg-warn", label: "Estornado" };
  if (status === "chargeback") return { dot: "bg-danger", label: "Chargeback" };
  return { dot: "bg-text2", label: status };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const from = sp.from;
  const to = sp.to;
  const { counts, metrics, events, purchases } = await getOverview(period, from, to);

  const customLabel =
    period === "custom"
      ? [fmtDateLabel(from), fmtDateLabel(to)].filter(Boolean).join(" – ") || "Personalizado"
      : "Personalizado";

  const periodLabel = period === "custom" ? customLabel : PERIOD_LABEL[period];

  const periods: Period[] = ["today", "7d", "30d", "month", "all"];

  return (
    <>
      <PageHeader
        title="Resumo"
        subtitle="Estado vivo do hub. Reconstituído a partir dos webhooks."
        right={
          <span className="chip">
            <span className="dot bg-accent animate-pulse" /> Ao vivo
          </span>
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
                href={p === "today" ? "/" : `/?period=${p}`}
                className={`px-2.5 py-1 rounded transition ${
                  isActive
                    ? "bg-brand text-text"
                    : "text-text2 hover:bg-surface2 hover:text-text"
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
                  defaultValue={from ?? ""}
                  required
                  className="input"
                />
              </label>
              <label className="block mb-3">
                <span className="label block mb-1">Até</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={to ?? ""}
                  required
                  className="input"
                />
              </label>
              <button className="btn btn-sm btn-primary w-full">Aplicar</button>
            </form>
          </details>
        </div>

        {/* Métricas-chave */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard
            label="Receita no período"
            value={fmtMoney(metrics.periodRevenue)}
            tone="accent"
            hint={periodLabel}
          />
          <StatCard
            label="Receita de renovações"
            value={fmtMoney(metrics.periodRenewalRevenue)}
            hint={`${periodLabel} · ciclo > 1`}
          />
          <StatCard
            label="Receita acumulada"
            value={fmtMoney(metrics.totalRevenue)}
            hint="Histórico completo"
          />
          <StatCard
            label="Novos alunos"
            value={metrics.newStudents}
            hint={period === "all" ? "Total de clientes únicos" : `Cadastrados ${periodLabel.toLowerCase()}`}
          />
          <StatCard
            label="Vendas no período"
            value={metrics.periodSales}
            hint={periodLabel}
          />
        </section>

        {/* Counts secundários do domínio */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Produtos" value={counts.products} />
          <StatCard label="Assinaturas" value={counts.subscriptions} />
          <StatCard label="Acessos" value={counts.grants} />
          <StatCard label="Sistemas" value={counts.systems} />
          <StatCard label="Clientes" value={counts.customers} />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Vendas recentes */}
          <div className="card xl:col-span-2">
            <header className="px-4 py-3 border-b border-line flex items-center justify-between">
              <h2 className="text-sm font-medium">Vendas recentes</h2>
              <span className="text-2xs text-muted uppercase tracking-wider">
                Últimas {purchases.length}
              </span>
            </header>
            {purchases.length === 0 ? (
              <Empty msg="Nenhuma venda ainda. Cadastre os webhooks no Assiny/Hotmart." />
            ) : (
              <ul className="divide-y divide-line">
                {purchases.map((p) => {
                  const s = statusChip(p.status);
                  return (
                    <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text truncate">
                            {p.products?.name ?? "produto removido"}
                          </span>
                          <span className="chip">
                            <span className={`dot ${s.dot}`} /> {s.label}
                          </span>
                          <span className="chip text-2xs uppercase">{p.gateway}</span>
                        </div>
                        <div className="text-xs text-muted truncate mt-0.5">
                          {p.customers?.email ?? "—"}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium">
                          R$ {p.amount.toFixed(2).replace(".", ",")}
                        </div>
                        <div className="text-2xs text-muted">
                          {new Date(p.created_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          })}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Eventos */}
          <div className="card">
            <header className="px-4 py-3 border-b border-line flex items-center justify-between">
              <h2 className="text-sm font-medium">Eventos</h2>
              <Link href="/webhooks" className="text-2xs text-muted hover:text-text uppercase tracking-wider">
                Ver todos →
              </Link>
            </header>
            {events.length === 0 ? (
              <Empty msg="Nenhum evento de webhook." />
            ) : (
              <ul className="divide-y divide-line">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-2.5 flex items-center gap-2.5">
                    <span className={`dot ${levelDot(e.level)}`} />
                    <code className="font-mono text-xs text-text2 flex-1 truncate">{e.kind}</code>
                    <span className="text-2xs text-muted shrink-0">
                      {new Date(e.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

      </PageBody>
    </>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="px-4 py-8 text-sm text-muted">{msg}</div>;
}
