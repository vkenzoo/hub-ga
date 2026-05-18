import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";

interface SubscriptionRow {
  id: string;
  gateway: string;
  gateway_subscription_id: string;
  status: string;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
  customers: { id: string; email: string; name: string | null } | null;
  products: { id: string; name: string } | null;
}

const STATUS_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  active:    { dot: "bg-accent",  text: "text-accent",  label: "Ativa" },
  trialing:  { dot: "bg-info",    text: "text-info",    label: "Trial" },
  past_due:  { dot: "bg-warn",    text: "text-warn",    label: "Atrasada" },
  cancelled: { dot: "bg-danger",  text: "text-danger",  label: "Cancelada" },
};

function statusInfo(status: string) {
  return STATUS_STYLES[status] ?? { dot: "bg-text2", text: "text-text2", label: status };
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function urgencyChip(days: number | null) {
  if (days == null) return null;
  if (days < 0) return { dot: "bg-danger", text: "text-danger", label: `vencida há ${Math.abs(days)}d` };
  if (days === 0) return { dot: "bg-warn", text: "text-warn", label: "hoje" };
  if (days <= 3) return { dot: "bg-warn", text: "text-warn", label: `em ${days}d` };
  if (days <= 7) return { dot: "bg-info", text: "text-info", label: `em ${days}d` };
  return { dot: "bg-text2", text: "text-text2", label: `em ${days}d` };
}

async function listSubs(filters: { status?: string; gateway?: string; q?: string }): Promise<SubscriptionRow[]> {
  const sb = createSupabaseAdmin();
  let query = sb
    .from("subscriptions")
    .select(
      `id, gateway, gateway_subscription_id, status, current_period_end, created_at, updated_at,
       customers(id, email, name),
       products(id, name)`,
    )
    // Ativas primeiro, ordenado por proximidade da renovação
    .order("status", { ascending: true })
    .order("current_period_end", { ascending: true, nullsFirst: false })
    .limit(500);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.gateway && filters.gateway !== "all") {
    query = query.eq("gateway", filters.gateway);
  }

  const { data } = await query;
  let rows = (data ?? []) as unknown as SubscriptionRow[];

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

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; gateway?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const subs = await listSubs(sp);

  const active = subs.filter((s) => s.status === "active");
  const pastDue = subs.filter((s) => s.status === "past_due");
  const cancelled = subs.filter((s) => s.status === "cancelled");
  const renewingSoon = active.filter((s) => {
    const d = daysUntil(s.current_period_end);
    return d != null && d >= 0 && d <= 7;
  });

  return (
    <>
      <PageHeader
        title="Assinaturas"
        subtitle="Cobranças recorrentes em curso, renovações próximas e atrasadas."
      />

      <PageBody>
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Ativas" value={active.length} tone="accent" />
          <StatCard
            label="Renovam em ≤7d"
            value={renewingSoon.length}
            hint={renewingSoon.length > 0 ? "Acompanhar de perto" : undefined}
          />
          <StatCard label="Atrasadas" value={pastDue.length} hint={pastDue.length > 0 ? "Cartão recusado / pix vencido" : undefined} />
          <StatCard label="Canceladas" value={cancelled.length} />
        </section>

        {/* Filtros */}
        <form className="card p-3 grid grid-cols-1 md:grid-cols-[1fr_160px_160px_auto_auto] gap-2 items-center">
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Buscar email, nome ou produto..."
            className="input"
          />
          <select name="status" defaultValue={sp.status ?? "all"} className="input">
            <option value="all">Todos status</option>
            <option value="active">Ativas</option>
            <option value="past_due">Atrasadas</option>
            <option value="cancelled">Canceladas</option>
            <option value="trialing">Trial</option>
          </select>
          <select name="gateway" defaultValue={sp.gateway ?? "all"} className="input">
            <option value="all">Todos gateways</option>
            <option value="assiny">Assiny</option>
            <option value="hotmart">Hotmart</option>
          </select>
          <button className="btn btn-sm">Filtrar</button>
          <Link href="/subscriptions" className="btn btn-sm btn-ghost">Limpar</Link>
        </form>

        {/* Tabela */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">{subs.length} {subs.length === 1 ? "assinatura" : "assinaturas"}</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Próx. cobrança ↑</span>
          </div>

          {subs.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">Nenhuma assinatura encontrada.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Cliente</th>
                    <th className="text-left font-medium px-4 py-2.5">Produto</th>
                    <th className="text-left font-medium px-4 py-2.5 w-24">Gateway</th>
                    <th className="text-left font-medium px-4 py-2.5 w-28">Status</th>
                    <th className="text-left font-medium px-4 py-2.5 w-28">Próx. cobrança</th>
                    <th className="text-left font-medium px-4 py-2.5 w-32">Urgência</th>
                    <th className="text-right font-medium px-4 py-2.5 w-28">Iniciada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {subs.map((s) => {
                    const st = statusInfo(s.status);
                    const days = daysUntil(s.current_period_end);
                    const urgency = s.status === "active" ? urgencyChip(days) : null;
                    return (
                      <tr key={s.id} className="hover:bg-surface2/30 transition">
                        <td className="px-4 py-2.5">
                          {s.customers ? (
                            <Link
                              href={`/customers/${s.customers.id}`}
                              className="block hover:text-brand transition"
                            >
                              {s.customers.name && (
                                <div className="text-text">{s.customers.name}</div>
                              )}
                              <div className={s.customers.name ? "text-xs text-muted" : ""}>
                                {s.customers.email}
                              </div>
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
                        <td className="px-4 py-2.5">
                          <span className="chip">
                            <span className={`dot ${st.dot}`} />
                            <span className={st.text}>{st.label}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs tabular-nums">
                          {fmtDate(s.current_period_end)}
                        </td>
                        <td className="px-4 py-2.5">
                          {urgency ? (
                            <span className="chip">
                              <span className={`dot ${urgency.dot}`} />
                              <span className={urgency.text}>{urgency.label}</span>
                            </span>
                          ) : (
                            <span className="text-muted text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-muted tabular-nums whitespace-nowrap">
                          {fmtDate(s.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Aviso sobre retry */}
        <div className="card border-info/30 bg-info/5 px-4 py-3 text-sm">
          <div className="flex gap-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-info shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            <div className="text-text2">
              <strong className="text-text">Retentativa de pagamento:</strong> Assiny não tem API pública, então o retry roda na própria plataforma deles. Pagamentos recusados aparecem aqui como <span className="chip text-warn"><span className="dot bg-warn" />Atrasada</span> quando o webhook de <code className="font-mono text-xs">past_due</code> chega. Configure dunning automatizado direto no admin da Assiny.
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
