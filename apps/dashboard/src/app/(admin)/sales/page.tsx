import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

// ── Tipos ────────────────────────────────────────────────────
interface SaleRow {
  id: string;
  amount: number;
  status: string;
  gateway: string;
  gateway_event_id: string;
  created_at: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  affiliate_id: string | null;
  customers: { id: string; email: string; name: string | null } | null;
  products: { id: string; name: string } | null;
}

// ── Configuração de colunas ─────────────────────────────────
const OPTIONAL_COLUMNS = [
  { key: "utm_source", label: "utm_source" },
  { key: "utm_medium", label: "utm_medium" },
  { key: "utm_campaign", label: "utm_campaign" },
  { key: "utm_content", label: "utm_content" },
  { key: "utm_term", label: "utm_term" },
  { key: "affiliate_id", label: "affiliate" },
] as const;

type OptionalKey = (typeof OPTIONAL_COLUMNS)[number]["key"];

const DEFAULT_COLS: OptionalKey[] = ["utm_source", "utm_campaign", "affiliate_id"];

function fmtMoney(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function statusChip(status: string) {
  if (status === "paid") return { dot: "bg-accent", label: "Pago" };
  if (status === "refunded") return { dot: "bg-warn", label: "Estornado" };
  if (status === "chargeback") return { dot: "bg-danger", label: "Chargeback" };
  return { dot: "bg-text2", label: status };
}

function parseCols(raw: string | string[] | undefined): OptionalKey[] {
  if (!raw) return DEFAULT_COLS;
  const arr = Array.isArray(raw) ? raw : raw.split(",");
  const valid = new Set(OPTIONAL_COLUMNS.map((c) => c.key));
  return arr.filter((c): c is OptionalKey => valid.has(c as OptionalKey));
}

async function listSales(filters: {
  q?: string;
  gateway?: string;
  status?: string;
}): Promise<SaleRow[]> {
  const sb = createSupabaseAdmin();
  let query = sb
    .from("purchases")
    .select(
      `id, amount, status, gateway, gateway_event_id, created_at,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term, affiliate_id,
       customers(id, email, name),
       products(id, name)`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.gateway && filters.gateway !== "all") {
    query = query.eq("gateway", filters.gateway);
  }
  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const { data } = await query;
  let rows = (data ?? []) as unknown as SaleRow[];

  // Filtro por texto (email/nome/produto) feito client-side pra evitar joins complicados
  if (filters.q) {
    const ql = filters.q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.customers?.email.toLowerCase().includes(ql) ||
        r.customers?.name?.toLowerCase().includes(ql) ||
        r.products?.name.toLowerCase().includes(ql),
    );
  }
  return rows;
}

// ── Página ─────────────────────────────────────────────────
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    gateway?: string;
    status?: string;
    cols?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const cols = parseCols(sp.cols);
  const colsSet = new Set<string>(cols);
  const sales = await listSales({ q: sp.q, gateway: sp.gateway, status: sp.status });

  const totalPaid = sales.filter((s) => s.status === "paid").reduce((sum, s) => sum + Number(s.amount), 0);
  const totalRefunded = sales.filter((s) => s.status === "refunded").reduce((sum, s) => sum + Number(s.amount), 0);

  return (
    <>
      <PageHeader
        title="Vendas"
        subtitle="Todas as transações registradas via webhook. Liga UTMs, afiliados e produtos."
        right={
          <div className="flex items-center gap-2">
            <span className="chip">
              <span className="dot bg-accent" />
              {fmtMoney(totalPaid)} pagos
            </span>
            {totalRefunded > 0 && (
              <span className="chip text-warn">
                <span className="dot bg-warn" />
                {fmtMoney(totalRefunded)} estornados
              </span>
            )}
          </div>
        }
      />

      <PageBody>
        {/* Filtros + Colunas */}
        <form className="card p-3 grid grid-cols-1 md:grid-cols-[1fr_140px_140px_auto_auto] gap-2 items-center">
          {/* Preserva cols selecionadas ao filtrar */}
          {cols.map((c) => (
            <input key={c} type="hidden" name="cols" value={c} />
          ))}
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Buscar email, nome ou produto..."
            className="input"
          />
          <select name="gateway" defaultValue={sp.gateway ?? "all"} className="input">
            <option value="all">Todos gateways</option>
            <option value="assiny">Assiny</option>
            <option value="hotmart">Hotmart</option>
          </select>
          <select name="status" defaultValue={sp.status ?? "all"} className="input">
            <option value="all">Todos status</option>
            <option value="paid">Pago</option>
            <option value="refunded">Estornado</option>
            <option value="chargeback">Chargeback</option>
            <option value="pending">Pendente</option>
          </select>
          <button className="btn btn-sm">Filtrar</button>
          <Link
            href="/sales"
            className="btn btn-sm btn-ghost"
            title="Limpar todos os filtros"
          >
            Limpar
          </Link>
        </form>

        {/* Toggle de colunas */}
        <ColumnsToggle current={cols} filters={{ q: sp.q, gateway: sp.gateway, status: sp.status }} />

        {/* Tabela */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {sales.length} venda{sales.length === 1 ? "" : "s"}
            </h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Últimas 200</span>
          </div>

          {sales.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">
              Nenhuma venda encontrada.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Cliente</th>
                    <th className="text-left font-medium px-4 py-2.5">Produto</th>
                    <th className="text-left font-medium px-4 py-2.5 w-20">Gateway</th>
                    <th className="text-right font-medium px-4 py-2.5 w-28">Valor</th>
                    <th className="text-left font-medium px-4 py-2.5 w-24">Status</th>
                    {OPTIONAL_COLUMNS.map(
                      (c) =>
                        colsSet.has(c.key) && (
                          <th key={c.key} className="text-left font-medium px-4 py-2.5 font-mono normal-case">
                            {c.label}
                          </th>
                        ),
                    )}
                    <th className="text-right font-medium px-4 py-2.5 w-32">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sales.map((s) => {
                    const stChip = statusChip(s.status);
                    return (
                      <tr key={s.id} className="hover:bg-surface2/30 transition">
                        <td className="px-4 py-2.5">
                          {s.customers ? (
                            <Link
                              href={`/customers/${s.customers.id}`}
                              className="block hover:text-accent transition"
                            >
                              <div>{s.customers.email}</div>
                              {s.customers.name && (
                                <div className="text-xs text-muted">{s.customers.name}</div>
                              )}
                            </Link>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {s.products?.name ?? <span className="text-muted">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="chip text-2xs uppercase">{s.gateway}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {fmtMoney(s.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="chip">
                            <span className={`dot ${stChip.dot}`} /> {stChip.label}
                          </span>
                        </td>
                        {OPTIONAL_COLUMNS.map((c) => {
                          if (!colsSet.has(c.key)) return null;
                          const value = s[c.key as keyof SaleRow] as string | null;
                          return (
                            <td key={c.key} className="px-4 py-2.5 font-mono text-xs">
                              {value ? (
                                <span className="text-text2">{value}</span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-right text-xs text-muted tabular-nums whitespace-nowrap">
                          {fmtDateTime(s.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}

// ── Componente de toggle de colunas ─────────────────────────
function ColumnsToggle({
  current,
  filters,
}: {
  current: OptionalKey[];
  filters: { q?: string; gateway?: string; status?: string };
}) {
  const set = new Set<string>(current);
  return (
    <details className="card group">
      <summary className="cursor-pointer list-none px-4 py-2.5 flex items-center justify-between text-sm hover:bg-surface2 transition">
        <span className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
          <span>Colunas — {current.length} ativa{current.length === 1 ? "" : "s"}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted transition group-open:rotate-90"><path d="m9 18 6-6-6-6"/></svg>
      </summary>
      <form className="p-4 border-t border-line bg-surface2/40 flex flex-wrap items-end gap-3">
        {/* Preserva filtros atuais */}
        {filters.q && <input type="hidden" name="q" value={filters.q} />}
        {filters.gateway && <input type="hidden" name="gateway" value={filters.gateway} />}
        {filters.status && <input type="hidden" name="status" value={filters.status} />}

        <div className="flex flex-wrap gap-3 flex-1">
          {OPTIONAL_COLUMNS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm font-mono">
              <input
                type="checkbox"
                name="cols"
                value={c.key}
                defaultChecked={set.has(c.key)}
                className="rounded border-line bg-surface text-accent focus:ring-accent/40 focus:ring-offset-0"
              />
              {c.label}
            </label>
          ))}
        </div>
        <button className="btn btn-sm">Aplicar</button>
      </form>
    </details>
  );
}
