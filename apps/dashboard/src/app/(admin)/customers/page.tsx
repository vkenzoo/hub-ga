import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

interface CustomerListRow {
  id: string;
  email: string;
  name: string | null;
  source: string | null;
  first_seen_at: string;
  total_spent: number;
  total_purchases: number;
  active_grants: number;
}

async function listCustomers(q: string): Promise<CustomerListRow[]> {
  const sb = createSupabaseAdmin();
  let query = sb
    .from("customers")
    .select(
      `id, email, name, source, first_seen_at,
       purchases(amount, status),
       access_grants!access_grants_customer_id_fkey(expires_at)`,
    )
    .order("first_seen_at", { ascending: false })
    .limit(100);

  if (q) {
    query = query.or(`email.ilike.%${q}%,name.ilike.%${q}%`);
  }

  const { data } = await query;

  const now = new Date();
  return ((data ?? []) as unknown[]).map((c) => {
    const row = c as {
      id: string;
      email: string;
      name: string | null;
      source: string | null;
      first_seen_at: string;
      purchases: Array<{ amount: number | string; status: string }>;
      access_grants: Array<{ expires_at: string | null }>;
    };
    const paid = row.purchases.filter((p) => p.status === "paid");
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      source: row.source,
      first_seen_at: row.first_seen_at,
      total_spent: paid.reduce((s, p) => s + Number(p.amount), 0),
      total_purchases: row.purchases.length,
      active_grants: row.access_grants.filter(
        (g) => g.expires_at === null || new Date(g.expires_at) > now,
      ).length,
    };
  });
}

function formatMoney(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const customers = await listCustomers(q);

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Quem comprou, quanto gastou, e o que tem de acesso ativo."
        right={
          <form className="flex items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar email ou nome..."
              className="input text-sm w-64"
            />
            {q && (
              <Link href="/customers" className="btn btn-sm">
                Limpar
              </Link>
            )}
          </form>
        }
      />

      <PageBody>
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {customers.length} cliente{customers.length === 1 ? "" : "s"}
              {q && <span className="text-muted"> · filtro: “{q}”</span>}
            </h2>
            <span className="text-2xs text-muted uppercase tracking-wider">
              Ordenado por mais recente
            </span>
          </div>

          {customers.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">
              {q
                ? "Nenhum cliente encontrado pra essa busca."
                : "Nenhum cliente ainda. Quando uma venda chegar, ele aparece aqui."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Cliente</th>
                  <th className="text-left font-medium px-4 py-2.5 w-24">Source</th>
                  <th className="text-right font-medium px-4 py-2.5 w-28">Vendas</th>
                  <th className="text-right font-medium px-4 py-2.5 w-32">Total gasto</th>
                  <th className="text-right font-medium px-4 py-2.5 w-28">Acessos</th>
                  <th className="text-right font-medium px-4 py-2.5 w-24">Desde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-surface2 transition">
                    <td className="px-4 py-3">
                      <Link href={`/customers/${c.id}`} className="block">
                        <div className="text-text">{c.email}</div>
                        {c.name && <div className="text-xs text-muted">{c.name}</div>}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {c.source ? (
                        <span className="chip text-2xs uppercase">{c.source}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.total_purchases}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(c.total_spent)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.active_grants > 0 ? (
                        <span className="chip">
                          <span className="dot bg-accent" /> {c.active_grants}
                        </span>
                      ) : (
                        <span className="text-muted text-xs">nenhum</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted tabular-nums">
                      {formatDate(c.first_seen_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </PageBody>
    </>
  );
}
