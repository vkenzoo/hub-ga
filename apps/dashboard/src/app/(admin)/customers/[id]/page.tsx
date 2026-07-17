import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { Hideable } from "@/components/hideable";

interface CustomerRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  source: string | null;
  first_seen_at: string;
}

interface PurchaseRow {
  id: string;
  amount: number;
  status: string;
  gateway: string;
  gateway_event_id: string;
  created_at: string;
  utm_source: string | null;
  utm_campaign: string | null;
  affiliate_id: string | null;
  products: { id: string; name: string } | null;
}

interface SubscriptionRow {
  id: string;
  gateway: string;
  status: string;
  current_period_end: string | null;
  created_at: string;
  products: { id: string; name: string } | null;
}

interface GrantRow {
  id: string;
  granted_at: string;
  expires_at: string | null;
  entitlements: {
    kind: "system_access" | "cademi_course";
    tier: string | null;
    cademi_course_id: string | null;
    systems: { slug: string; name: string } | null;
  } | null;
  products?: { name: string } | null;
}

function fmtMoney(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function purchaseStatusChip(status: string) {
  if (status === "paid") return { dot: "bg-accent", label: "Pago" };
  if (status === "refunded") return { dot: "bg-warn", label: "Estornado" };
  if (status === "chargeback") return { dot: "bg-danger", label: "Chargeback" };
  if (status === "refused") return { dot: "bg-text2", label: "Recusado" };
  if (status === "refund_requested") return { dot: "bg-warn", label: "Reembolso solicitado" };
  return { dot: "bg-text2", label: status };
}

function subscriptionStatusChip(status: string) {
  if (status === "active") return { dot: "bg-accent", label: "Ativa" };
  if (status === "past_due") return { dot: "bg-warn", label: "Atrasada" };
  if (status === "cancelled") return { dot: "bg-danger", label: "Cancelada" };
  if (status === "trialing") return { dot: "bg-info", label: "Trial" };
  return { dot: "bg-text2", label: status };
}

function grantStatus(g: GrantRow): { dot: string; label: string } {
  if (!g.expires_at) return { dot: "bg-accent", label: "Vitalício" };
  const exp = new Date(g.expires_at);
  if (exp <= new Date()) return { dot: "bg-danger", label: "Expirado" };
  return { dot: "bg-accent", label: `Ativo até ${fmtDate(g.expires_at)}` };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createSupabaseAdmin();
  const [
    { data: customer },
    { data: purchases },
    { data: subscriptions },
    { data: grants },
  ] = await Promise.all([
    sb.from("customers").select("*").eq("id", id).maybeSingle(),
    sb
      .from("purchases")
      .select("id,amount,status,gateway,gateway_event_id,created_at,utm_source,utm_campaign,affiliate_id,products(id,name)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    sb
      .from("subscriptions")
      .select("id,gateway,status,current_period_end,created_at,products(id,name)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    sb
      .from("access_grants")
      .select(
        "id,granted_at,expires_at,entitlements(kind,tier,cademi_course_id,systems(slug,name))",
      )
      .eq("customer_id", id)
      .order("granted_at", { ascending: false }),
  ]);

  if (!customer) notFound();
  const c = customer as CustomerRow;
  const ps = (purchases ?? []) as unknown as PurchaseRow[];
  const subs = (subscriptions ?? []) as unknown as SubscriptionRow[];
  const gs = (grants ?? []) as unknown as GrantRow[];

  const totalSpent = ps.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
  const activeGrants = gs.filter((g) => !g.expires_at || new Date(g.expires_at) > new Date());

  return (
    <>
      <PageHeader
        title={<Hideable kind="email">{c.email}</Hideable>}
        subtitle={<Hideable kind="text">{c.name ?? "Cliente sem nome cadastrado"}</Hideable>}
        right={
          <Link href="/customers" className="btn btn-sm">
            ← Clientes
          </Link>
        }
      />

      <PageBody>
        {/* Stats */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total gasto" value={<Hideable kind="money">{fmtMoney(totalSpent)}</Hideable>} tone="accent" />
          <StatCard label="Vendas" value={<Hideable kind="count">{String(ps.length)}</Hideable>} />
          <StatCard label="Assinaturas" value={<Hideable kind="count">{String(subs.length)}</Hideable>} />
          <StatCard label="Acessos ativos" value={<Hideable kind="count">{String(activeGrants.length)}</Hideable>} />
        </section>

        {/* Identidade */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Identidade</h2>
          </header>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 text-sm">
            <div>
              <dt className="label mb-1">Email</dt>
              <dd className="font-mono text-xs"><Hideable kind="email">{c.email}</Hideable></dd>
            </div>
            <div>
              <dt className="label mb-1">Nome</dt>
              <dd>{c.name ? <Hideable kind="text">{c.name}</Hideable> : <span className="text-muted">—</span>}</dd>
            </div>
            <div>
              <dt className="label mb-1">Telefone</dt>
              <dd>{c.phone ? <Hideable kind="phone">{c.phone}</Hideable> : <span className="text-muted">—</span>}</dd>
            </div>
            <div>
              <dt className="label mb-1">Primeiro gateway</dt>
              <dd>
                {c.source ? (
                  <span className="chip text-2xs uppercase">{c.source}</span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
            <div className="md:col-span-4">
              <dt className="label mb-1">Cliente desde</dt>
              <dd>{fmtDateTime(c.first_seen_at)}</dd>
            </div>
          </dl>
        </section>

        {/* Acessos ativos */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Acessos</h2>
              <p className="text-xs text-muted mt-0.5">
                Tudo que esse cliente já ganhou via compras (ativos + expirados).
              </p>
            </div>
            <span className="chip">{gs.length}</span>
          </header>
          {gs.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted">Nenhum acesso registrado.</div>
          ) : (
            <ul className="divide-y divide-line">
              {gs.map((g) => {
                const s = grantStatus(g);
                const e = g.entitlements;
                return (
                  <li key={g.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {e?.kind === "system_access" ? (
                        <>
                          <span className="chip"><span className="dot bg-accent" /> Sistema</span>
                          <span className="text-sm">{e.systems?.name ?? "?"}</span>
                          <span className="chip">nível: <span className="font-mono">{e.tier}</span></span>
                        </>
                      ) : e?.kind === "cademi_course" ? (
                        <>
                          <span className="chip"><span className="dot bg-info" /> Cademí</span>
                          <span className="font-mono text-xs">{e.cademi_course_id}</span>
                        </>
                      ) : (
                        <span className="text-muted">entitlement removido</span>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="chip">
                        <span className={`dot ${s.dot}`} /> {s.label}
                      </span>
                      <div className="text-2xs text-muted mt-1">
                        Desde {fmtDate(g.granted_at)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Assinaturas */}
        {subs.length > 0 && (
          <section className="card">
            <header className="px-4 py-3 border-b border-line flex items-center justify-between">
              <h2 className="text-sm font-medium">Assinaturas</h2>
              <span className="chip">{subs.length}</span>
            </header>
            <ul className="divide-y divide-line">
              {subs.map((s) => {
                const status = subscriptionStatusChip(s.status);
                return (
                  <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm">{s.products?.name ?? "produto removido"}</div>
                      <div className="text-xs text-muted">
                        {s.gateway} · próxima cobrança: {fmtDate(s.current_period_end)}
                      </div>
                    </div>
                    <span className="chip">
                      <span className={`dot ${status.dot}`} /> {status.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Compras */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Histórico de compras</h2>
            <span className="chip">{ps.length}</span>
          </header>
          {ps.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted">Sem vendas registradas.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Produto</th>
                  <th className="text-left font-medium px-4 py-2.5 w-24">Gateway</th>
                  <th className="text-right font-medium px-4 py-2.5 w-28">Valor</th>
                  <th className="text-left font-medium px-4 py-2.5 w-28">Status</th>
                  <th className="text-left font-medium px-4 py-2.5 w-32">Origem</th>
                  <th className="text-right font-medium px-4 py-2.5 w-28">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ps.map((p) => {
                  const s = purchaseStatusChip(p.status);
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5">{p.products?.name ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="chip text-2xs uppercase">{p.gateway}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <Hideable kind="money">{fmtMoney(p.amount)}</Hideable>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="chip">
                          <span className={`dot ${s.dot}`} /> {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {p.affiliate_id ? (
                          <span className="font-mono text-text2">aff: {p.affiliate_id}</span>
                        ) : p.utm_source ? (
                          <span className="font-mono text-text2">
                            {p.utm_source}
                            {p.utm_campaign ? ` · ${p.utm_campaign}` : ""}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted tabular-nums">
                        {fmtDateTime(p.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </PageBody>
    </>
  );
}
