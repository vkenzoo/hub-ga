import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";

interface SurveyRow {
  id: string;
  respondi_respondent_id: string;
  form_id: string;
  form_name: string | null;
  email: string | null;
  phone: string | null;
  score: number | null;
  utm_source: string | null;
  utm_campaign: string | null;
  qualification: string | null;
  customer_id: string | null;
  received_at: string;
  customers: { id: string; email: string; name: string | null } | null;
}

const QUAL_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  a: { dot: "bg-accent", text: "text-accent", label: "Lead A" },
  b: { dot: "bg-info", text: "text-info", label: "Lead B" },
  c: { dot: "bg-warn", text: "text-warn", label: "Lead C" },
  d: { dot: "bg-text2", text: "text-text2", label: "Lead D" },
  e: { dot: "bg-muted", text: "text-muted", label: "Lead E" },
};

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

function fmtPct(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}%`;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ form?: string; qual?: string; q?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "surveys")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const sb = createSupabaseAdmin();

  let query = sb
    .from("survey_responses")
    .select(
      "id, respondi_respondent_id, form_id, form_name, email, phone, score, utm_source, utm_campaign, qualification, customer_id, received_at, customers(id, email, name)",
    )
    .order("received_at", { ascending: false })
    .limit(500);

  if (sp.form && sp.form !== "all") query = query.eq("form_id", sp.form);
  if (sp.qual && sp.qual !== "all") query = query.eq("qualification", sp.qual);

  const { data } = await query;
  let rows = (data ?? []) as unknown as SurveyRow[];

  if (sp.q) {
    const ql = sp.q.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.email ?? "").toLowerCase().includes(ql) ||
        (r.phone ?? "").includes(ql) ||
        (r.form_name ?? "").toLowerCase().includes(ql),
    );
  }

  // Stats agregadas
  const totalResponses = rows.length;
  const uniqueByContact = new Set(
    rows.map((r) => r.email ?? r.phone ?? r.respondi_respondent_id),
  ).size;
  const matchedCustomers = rows.filter((r) => r.customer_id).length;
  const conversionRate = uniqueByContact > 0 ? (matchedCustomers / uniqueByContact) * 100 : 0;

  const byQual = rows.reduce<Record<string, number>>((acc, r) => {
    const k = r.qualification ?? "_none";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  // Lista de forms únicos pra filtro
  const forms = [...new Set(rows.map((r) => r.form_id))].slice(0, 20);
  const formNames = new Map<string, string>();
  for (const r of rows) {
    if (r.form_id && r.form_name) formNames.set(r.form_id, r.form_name);
  }

  return (
    <>
      <PageHeader
        title="Pesquisa"
        subtitle="Respostas do Respondi.app com qualificação automática de leads."
        right={
          <div className="flex items-center gap-2">
            <Link href="/surveys/rules" className="btn btn-sm">
              Regras
            </Link>
            <Link href="/surveys/setup" className="btn btn-sm">
              Setup
            </Link>
          </div>
        }
      />

      <PageBody>
        {/* KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Respostas (últimas 500)" value={totalResponses} />
          <StatCard label="Únicas por contato" value={uniqueByContact} />
          <StatCard
            label="Respostas válidas"
            value={matchedCustomers}
            tone="accent"
            hint="Email ou telefone bate com cliente da base"
          />
          <StatCard
            label="% Conversão"
            value={fmtPct(conversionRate)}
            hint="Respostas válidas ÷ únicas por contato"
          />
          <StatCard
            label="Não classificados"
            value={byQual._none ?? 0}
            hint="Nenhuma regra casou"
          />
        </section>

        {/* Distribuição A/B/C/D/E */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(["a", "b", "c", "d", "e"] as const).map((q) => {
            const c = QUAL_STYLES[q]!;
            const count = byQual[q] ?? 0;
            const pct = totalResponses > 0 ? (count / totalResponses) * 100 : 0;
            return (
              <div key={q} className="card p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="label">{c.label}</span>
                  <span className="text-2xs text-muted">{fmtPct(pct)}</span>
                </div>
                <div className={`text-2xl md:text-3xl font-medium ${c.text}`}>{count}</div>
              </div>
            );
          })}
        </section>

        {/* Filtros */}
        <form className="card p-3 grid grid-cols-1 md:grid-cols-[1fr_180px_160px_auto_auto] gap-2 items-center">
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Buscar email, telefone, form..."
            className="input"
          />
          <select name="form" defaultValue={sp.form ?? "all"} className="input">
            <option value="all">Todos os forms</option>
            {forms.map((f) => (
              <option key={f} value={f}>
                {formNames.get(f) ?? f}
              </option>
            ))}
          </select>
          <select name="qual" defaultValue={sp.qual ?? "all"} className="input">
            <option value="all">Todos os leads</option>
            <option value="a">Lead A</option>
            <option value="b">Lead B</option>
            <option value="c">Lead C</option>
            <option value="d">Lead D</option>
            <option value="e">Lead E</option>
          </select>
          <button className="btn btn-sm">Filtrar</button>
          <Link href="/surveys" className="btn btn-sm btn-ghost">
            Limpar
          </Link>
        </form>

        {/* Tabela */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {rows.length} {rows.length === 1 ? "resposta" : "respostas"}
            </h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Últimas 500</span>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">
              Nenhuma resposta ainda. Configure o webhook em <Link href="/surveys/setup" className="text-brand hover:underline">Setup</Link>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5 w-28">Quando</th>
                    <th className="text-left font-medium px-4 py-2.5">Contato</th>
                    <th className="text-left font-medium px-4 py-2.5">Form</th>
                    <th className="text-left font-medium px-4 py-2.5 w-24">Score</th>
                    <th className="text-left font-medium px-4 py-2.5 w-28">Lead</th>
                    <th className="text-left font-medium px-4 py-2.5 w-32">Origem</th>
                    <th className="text-right font-medium px-4 py-2.5 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const qChip = r.qualification ? QUAL_STYLES[r.qualification] : null;
                    return (
                      <tr key={r.id} className="hover:bg-surface2/30 transition">
                        <td className="px-4 py-2.5 text-xs text-muted tabular-nums whitespace-nowrap">
                          {fmtDateTime(r.received_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.customers ? (
                            <Link
                              href={`/customers/${r.customers.id}`}
                              className="hover:text-brand transition"
                            >
                              <div className="text-xs">{r.email ?? "—"}</div>
                              {r.customers.name && (
                                <div className="text-2xs text-muted">{r.customers.name}</div>
                              )}
                            </Link>
                          ) : (
                            <div>
                              <div className="text-xs">{r.email ?? "—"}</div>
                              {r.phone && <div className="text-2xs text-muted">{r.phone}</div>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {r.form_name ?? <code className="font-mono">{r.form_id}</code>}
                        </td>
                        <td className="px-4 py-2.5 text-xs tabular-nums">
                          {r.score != null ? r.score : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {qChip ? (
                            <span className="chip">
                              <span className={`dot ${qChip.dot}`} />
                              <span className={qChip.text}>{qChip.label}</span>
                            </span>
                          ) : (
                            <span className="text-muted text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {r.utm_source ? (
                            <span className="font-mono text-text2">
                              {r.utm_source}
                              {r.utm_campaign ? ` · ${r.utm_campaign}` : ""}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link href={`/surveys/${r.id}`} className="btn btn-sm btn-ghost">
                            →
                          </Link>
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
