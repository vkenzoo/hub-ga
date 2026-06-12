import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, StatCard } from "@/components/page";
import { Hideable } from "@/components/hideable";

interface AppRow {
  id: string;
  form_name: string | null;
  form_id: string;
  email: string | null;
  phone: string | null;
  score: number | null;
  answers: Record<string, unknown> | null;
  customer_id: string | null;
  received_at: string;
  customers: { id: string; name: string | null; email: string } | null;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  });
}

/** Extrai a resposta cuja PERGUNTA casa com o termo (ex: "investimento"). */
function findAnswer(answers: Record<string, unknown> | null, term: RegExp): string | null {
  if (!answers) return null;
  for (const [k, v] of Object.entries(answers)) {
    if (term.test(k) && (typeof v === "string" || typeof v === "number")) return String(v);
  }
  return null;
}

type ForwardStatus = "success" | "pending" | "failed" | "none";
const STATUS_CHIP: Record<ForwardStatus, { dot: string; label: string }> = {
  success: { dot: "bg-accent", label: "Enviado" },
  pending: { dot: "bg-warn", label: "Pendente" },
  failed: { dot: "bg-danger", label: "Falhou" },
  none: { dot: "bg-text2", label: "—" },
};

export default async function Page() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "applications")) redirect("/?error=no_access");
  const sb = createSupabaseAdmin();

  const { data } = await sb
    .from("survey_responses")
    .select("id, form_name, form_id, email, phone, score, answers, customer_id, received_at, customers(id, name, email)")
    .ilike("form_name", "%aplica%")
    .order("received_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as unknown as AppRow[];

  // Status do forward GHL por resposta (via outbound_deliveries.source_ref)
  const ids = rows.map((r) => r.id);
  const statusByRef = new Map<string, ForwardStatus>();
  if (ids.length > 0) {
    const { data: deliv } = await sb
      .from("outbound_deliveries")
      .select("source_ref, status")
      .in("source_ref", ids)
      .limit(5000);
    for (const d of (deliv ?? []) as Array<{ source_ref: string | null; status: string }>) {
      if (!d.source_ref) continue;
      const cur = statusByRef.get(d.source_ref);
      // prioridade: success > pending > failed (mostra o melhor resultado)
      const rank = (s: ForwardStatus) => (s === "success" ? 3 : s === "pending" ? 2 : s === "failed" ? 1 : 0);
      const next = d.status as ForwardStatus;
      if (!cur || rank(next) > rank(cur)) statusByRef.set(d.source_ref, next);
    }
  }

  const total = rows.length;
  let enviadas = 0, pendentes = 0, falhas = 0;
  for (const r of rows) {
    const s = statusByRef.get(r.id) ?? "none";
    if (s === "success") enviadas++;
    else if (s === "pending") pendentes++;
    else if (s === "failed") falhas++;
  }

  return (
    <>
      <PageHeader
        title="Aplicações"
        subtitle="Respostas de formulários de aplicação (call comercial) — encaminhadas pro GoHighLevel."
        right={
          <div className="flex items-center gap-2">
            <Link href="/aplicacoes/posts" className="btn btn-sm btn-ghost">Monitoramento</Link>
            <Link href="/connections/outbound" className="btn btn-sm btn-ghost">Configurar GHL</Link>
          </div>
        }
      />
      <PageBody>
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Aplicações" value={<Hideable kind="count">{String(total)}</Hideable>} hint="Forms com 'aplica' no nome" />
          <StatCard label="Enviadas ao GHL" value={<Hideable kind="count">{String(enviadas)}</Hideable>} tone="accent" />
          <StatCard label="Pendentes" value={<Hideable kind="count">{String(pendentes)}</Hideable>} hint="Na fila / retry" />
          <StatCard label="Falhas" value={<Hideable kind="count">{String(falhas)}</Hideable>} hint="Após retries" />
        </section>

        {falhas > 0 || (total > 0 && enviadas === 0 && pendentes === 0) ? (
          <div className="card border-warn/30 bg-warn/5 px-4 py-2.5 text-sm text-text2">
            Sem destino GHL configurado ou com falhas. Cadastre o Inbound Webhook do GHL em{" "}
            <Link href="/connections/outbound" className="text-brand hover:underline">Conexões → Webhooks de saída</Link>{" "}
            (evento <code className="font-mono">survey.application</code>) e veja os envios em{" "}
            <Link href="/aplicacoes/posts" className="text-brand hover:underline">Monitoramento</Link>.
          </div>
        ) : null}

        <div className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">{total} {total === 1 ? "aplicação" : "aplicações"}</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Últimas 500</span>
          </header>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">
              Nenhuma aplicação ainda. Crie um form no Respondi com &quot;Aplicação&quot; no nome.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5 w-28">Quando</th>
                    <th className="text-left font-medium px-4 py-2.5">Contato</th>
                    <th className="text-left font-medium px-4 py-2.5">Form</th>
                    <th className="text-left font-medium px-4 py-2.5">Investimento</th>
                    <th className="text-left font-medium px-4 py-2.5 w-24">Score</th>
                    <th className="text-left font-medium px-4 py-2.5 w-28">GHL</th>
                    <th className="text-right font-medium px-4 py-2.5 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const invest = findAnswer(r.answers, /investiment|invest/i);
                    const s = statusByRef.get(r.id) ?? "none";
                    const chip = STATUS_CHIP[s];
                    return (
                      <tr key={r.id} className="hover:bg-surface2/30 transition">
                        <td className="px-4 py-2.5 text-xs text-muted tabular-nums whitespace-nowrap">{fmtDateTime(r.received_at)}</td>
                        <td className="px-4 py-2.5">
                          {r.customers ? (
                            <Link href={`/customers/${r.customers.id}`} className="hover:text-brand transition">
                              <div className="text-xs"><Hideable kind="text">{r.customers.name ?? r.customers.email}</Hideable></div>
                              <div className="text-2xs text-muted"><Hideable kind="email">{r.email ?? "—"}</Hideable></div>
                            </Link>
                          ) : (
                            <div>
                              <div className="text-xs"><Hideable kind="email">{r.email ?? "—"}</Hideable></div>
                              {r.phone && <div className="text-2xs text-muted"><Hideable kind="phone">{r.phone}</Hideable></div>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs">{r.form_name ?? <code className="font-mono">{r.form_id}</code>}</td>
                        <td className="px-4 py-2.5 text-xs">
                          {invest ? <span className="text-text2">{invest}</span> : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs tabular-nums">{r.score != null ? r.score : <span className="text-muted">—</span>}</td>
                        <td className="px-4 py-2.5">
                          <span className="chip"><span className={`dot ${chip.dot}`} />{chip.label}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link href={`/aplicacoes/${r.id}`} className="btn btn-sm btn-ghost">→</Link>
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
