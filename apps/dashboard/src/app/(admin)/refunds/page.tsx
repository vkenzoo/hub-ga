import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";

// ── Tipos ────────────────────────────────────────────────────
type RefundStatus = "refunded" | "chargeback";
type ProductRole = "acquisition" | "monetization" | "other";

interface RefundRow {
  id: string;
  amount: number;
  status: RefundStatus;
  gateway: "assiny" | "hotmart";
  payment_method: string | null;
  created_at: string;
  utm_source: string | null;
  utm_campaign: string | null;
  customers: { id: string; email: string; name: string | null; phone: string | null } | null;
  products: { id: string; name: string; role: ProductRole } | null;
}

type Period = "today" | "7d" | "30d" | "month" | "all" | "custom";
type Filter = "all" | "refunded" | "chargeback";

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

function parseFilter(raw: string | undefined): Filter {
  if (raw === "refunded" || raw === "chargeback" || raw === "all") return raw;
  return "all";
}

function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPct(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}%`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `há ${d}d`;
  return fmtDateTime(iso);
}

function statusChip(s: RefundStatus) {
  if (s === "refunded") return { dot: "bg-warn", label: "Reembolso" };
  return { dot: "bg-danger", label: "Chargeback" };
}

function roleChip(role: ProductRole) {
  if (role === "acquisition") return { dot: "bg-brand", label: "Aquisição" };
  if (role === "monetization") return { dot: "bg-info", label: "Monetização" };
  return { dot: "bg-muted", label: "Outros" };
}

function buildQuery(sp: { period: Period; filter: Filter; from?: string; to?: string }): string {
  const p = new URLSearchParams();
  if (sp.period !== "30d") p.set("period", sp.period);
  if (sp.filter !== "all") p.set("filter", sp.filter);
  if (sp.from) p.set("from", sp.from);
  if (sp.to) p.set("to", sp.to);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function waLink(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "").slice(-11);
  if (digits.length < 10) return null;
  return `https://wa.me/55${digits}`;
}

async function listRefunds(filters: {
  startISO?: string;
  endISO?: string;
  filter: Filter;
}): Promise<RefundRow[]> {
  const sb = createSupabaseAdmin();
  let q = sb
    .from("purchases")
    .select(
      `id, amount, status, gateway, payment_method, created_at,
       utm_source, utm_campaign,
       customers(id, email, name, phone),
       products!inner(id, name, role)`,
    )
    .in("status", ["refunded", "chargeback"])
    .order("created_at", { ascending: false })
    .limit(500);

  if (filters.startISO) q = q.gte("created_at", filters.startISO);
  if (filters.endISO) q = q.lt("created_at", filters.endISO);
  if (filters.filter === "refunded") q = q.eq("status", "refunded");
  else if (filters.filter === "chargeback") q = q.eq("status", "chargeback");

  const { data } = await q;
  return (data ?? []) as unknown as RefundRow[];
}

/**
 * Taxa de reembolso de produtos de AQUISIÇÃO no período.
 *
 *   alunos    = distinct customer_id com purchase status='paid' em produto role='acquisition'
 *   reembolso = distinct customer_id com purchase status IN ('refunded','chargeback') em produto role='acquisition'
 *   taxa      = reembolso / alunos
 */
async function refundRate(startISO?: string, endISO?: string): Promise<{
  alunos: number;
  refunds: number;
  rate: number;
}> {
  const sb = createSupabaseAdmin();
  // Alunos
  let alunosQ = sb
    .from("purchases")
    .select("customer_id, products!inner(role)", { count: "exact" })
    .eq("status", "paid")
    .eq("products.role", "acquisition");
  if (startISO) alunosQ = alunosQ.gte("created_at", startISO);
  if (endISO) alunosQ = alunosQ.lt("created_at", endISO);
  const { data: alunosRows } = await alunosQ.limit(50000);
  const alunos = new Set<string>();
  for (const r of (alunosRows ?? []) as { customer_id: string | null }[]) {
    if (r.customer_id) alunos.add(r.customer_id);
  }

  // Reembolsos
  let refundsQ = sb
    .from("purchases")
    .select("customer_id, products!inner(role)")
    .in("status", ["refunded", "chargeback"])
    .eq("products.role", "acquisition");
  if (startISO) refundsQ = refundsQ.gte("created_at", startISO);
  if (endISO) refundsQ = refundsQ.lt("created_at", endISO);
  const { data: refundsRows } = await refundsQ.limit(50000);
  const refunds = new Set<string>();
  for (const r of (refundsRows ?? []) as { customer_id: string | null }[]) {
    if (r.customer_id) refunds.add(r.customer_id);
  }

  const a = alunos.size;
  const f = refunds.size;
  return { alunos: a, refunds: f, rate: a > 0 ? (f / a) * 100 : 0 };
}

// ── Página ─────────────────────────────────────────────────
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; filter?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "refunds")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const filter = parseFilter(sp.filter);
  const start = periodStart(period, sp.from);
  const end = periodEnd(period, sp.to);
  const startISO = start?.toISOString();
  const endISO = end?.toISOString();

  const [rows, rate] = await Promise.all([
    listRefunds({ startISO, endISO, filter }),
    refundRate(startISO, endISO),
  ]);

  // Stats
  const refundedRows = rows.filter((r) => r.status === "refunded");
  const chargebackRows = rows.filter((r) => r.status === "chargeback");
  const refundedTotal = refundedRows.reduce((a, r) => a + r.amount, 0);
  const chargebackTotal = chargebackRows.reduce((a, r) => a + r.amount, 0);
  const totalLost = refundedTotal + chargebackTotal;

  return (
    <>
      <PageHeader
        title="Reembolsos"
        subtitle="Reembolsos e chargebacks — receita perdida pós-venda"
        right={
          <div className="flex flex-wrap gap-1.5">
            {(["today", "7d", "30d", "month", "all"] as Period[]).map((p) => {
              const label = p === "today" ? "Hoje" : p === "month" ? "Mês" : p === "all" ? "Tudo" : p;
              const active = period === p;
              return (
                <Link
                  key={p}
                  href={`/refunds${buildQuery({ period: p, filter, from: sp.from, to: sp.to })}`}
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
              <form className="absolute right-0 mt-2 z-10 card p-3 w-72 space-y-2" action="/refunds">
                <input type="hidden" name="period" value="custom" />
                <input type="hidden" name="filter" value={filter} />
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Reembolsado"
            value={fmtMoney(refundedTotal)}
            hint={`${refundedRows.length} ${refundedRows.length === 1 ? "estorno" : "estornos"}`}
          />
          <StatCard
            label="Chargeback"
            value={fmtMoney(chargebackTotal)}
            hint={`${chargebackRows.length} ${chargebackRows.length === 1 ? "caso" : "casos"}`}
          />
          <StatCard
            label="Total perdido"
            value={fmtMoney(totalLost)}
            hint="reembolsos + chargebacks no período"
          />
          <StatCard
            label="Taxa de reembolso"
            value={fmtPct(rate.rate)}
            hint={`${rate.refunds} de ${rate.alunos} alunos (aquisição)`}
          />
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "refunded", "chargeback"] as Filter[]).map((f) => {
            const label =
              f === "all" ? "Tudo" :
              f === "refunded" ? "Reembolso" :
              "Chargeback";
            const active = filter === f;
            return (
              <Link
                key={f}
                href={`/refunds${buildQuery({ period, filter: f, from: sp.from, to: sp.to })}`}
                className={`btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Tabela */}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text2 border-b border-line">
              <tr>
                <th className="px-3 py-2.5 font-normal">Quando</th>
                <th className="px-3 py-2.5 font-normal">Status</th>
                <th className="px-3 py-2.5 font-normal">Cliente</th>
                <th className="px-3 py-2.5 font-normal">Produto</th>
                <th className="px-3 py-2.5 font-normal text-right">Valor</th>
                <th className="px-3 py-2.5 font-normal">Origem</th>
                <th className="px-3 py-2.5 font-normal">Plataforma</th>
                <th className="px-3 py-2.5 font-normal text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted">
                    Nenhum reembolso no período.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const chip = statusChip(r.status);
                const role = r.products ? roleChip(r.products.role) : null;
                const wa = waLink(r.customers?.phone ?? null);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-line/40 hover:bg-surface2/30"
                  >
                    <td className="px-3 py-2.5">
                      <div className="text-text">{timeAgo(r.created_at)}</div>
                      <div className="text-2xs text-muted">{fmtDateTime(r.created_at)}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="chip">
                        <span className={`dot ${chip.dot}`} />
                        {chip.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.customers ? (
                        <Link
                          href={`/customers/${r.customers.id}`}
                          className="text-text hover:text-brand"
                        >
                          {r.customers.email}
                        </Link>
                      ) : (
                        <span className="text-muted">(removido)</span>
                      )}
                      {r.customers?.phone && (
                        <div className="text-2xs text-muted">{r.customers.phone}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-text">{r.products?.name ?? "—"}</div>
                      {role && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`dot ${role.dot}`} />
                          <span className="text-2xs text-muted">{role.label}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {fmtMoney(r.amount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-text2 text-xs">
                        {r.utm_source ?? "—"}
                        {r.utm_campaign && ` · ${r.utm_campaign}`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-text2 capitalize">{r.gateway}</td>
                    <td className="px-3 py-2.5 text-right">
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-sm btn-ghost"
                          title="Abrir WhatsApp"
                        >
                          WhatsApp
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-2xs text-muted">
          {rows.length} {rows.length === 1 ? "registro" : "registros"} · até 500 últimos
        </div>
      </PageBody>
    </>
  );
}
