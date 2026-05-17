import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";

interface EventRow {
  id: string;
  kind: string;
  level: string;
  created_at: string;
}

async function getOverview() {
  const sb = createSupabaseAdmin();
  const tables = ["customers", "purchases", "subscriptions", "products", "systems", "access_grants"];
  const counts = await Promise.all(
    tables.map(async (t) => {
      const { count } = await sb.from(t).select("*", { count: "exact", head: true });
      return [t, count ?? 0] as const;
    }),
  );

  const { data: latestEvents } = await sb
    .from("events_log")
    .select("id,kind,level,created_at")
    .order("created_at", { ascending: false })
    .limit(8);

  const { data: latestPurchases } = await sb
    .from("purchases")
    .select("id,amount,gateway,status,created_at,customers(email),products(name)")
    .order("created_at", { ascending: false })
    .limit(5);

  return {
    stats: Object.fromEntries(counts) as Record<string, number>,
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

const HUMAN: Record<string, string> = {
  customers: "Clientes",
  purchases: "Vendas",
  subscriptions: "Assinaturas",
  products: "Produtos",
  systems: "Sistemas",
  access_grants: "Acessos",
};

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

export default async function Page() {
  const { stats, events, purchases } = await getOverview();

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
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(stats).map(([k, v]) => (
            <StatCard key={k} label={HUMAN[k] ?? k} value={v} />
          ))}
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
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QuickLink href="/systems" title="Sistemas" hint="3 cadastrados" />
          <QuickLink href="/products" title="Produtos" hint={`${stats.products} no catálogo`} />
          <QuickLink href="/webhooks" title="Webhooks" hint="URLs + auditoria" />
        </section>
      </PageBody>
    </>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="px-4 py-8 text-sm text-muted">{msg}</div>;
}

function QuickLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="card p-4 hover:border-line2 hover:bg-surface2 transition flex items-center justify-between"
    >
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted mt-0.5">{hint}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted"><path d="m9 18 6-6-6-6"/></svg>
    </Link>
  );
}
