import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

interface AppRow {
  id: string;
  respondi_respondent_id: string;
  form_id: string;
  form_name: string | null;
  email: string | null;
  phone: string | null;
  score: number | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  answers: Record<string, unknown>;
  raw_payload: unknown;
  qualification: string | null;
  customer_id: string | null;
  received_at: string;
}

interface DeliveryRow {
  id: string;
  destination: string;
  status: string;
  http_status: number | null;
  attempts: number;
  last_error: string | null;
  url: string;
  payload: unknown;
  response_body: string | null;
  created_at: string;
}

const STATUS: Record<string, { dot: string; text: string; label: string }> = {
  success: { dot: "bg-accent", text: "text-accent", label: "Sucesso" },
  pending: { dot: "bg-warn", text: "text-warn", label: "Pendente" },
  failed: { dot: "bg-danger", text: "text-danger", label: "Falhou" },
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo",
  });
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "applications")) redirect("/?error=no_access");

  const { id } = await params;
  const sb = createSupabaseAdmin();

  const [{ data: respData }, { data: delivData }] = await Promise.all([
    sb.from("survey_responses").select("*").eq("id", id).maybeSingle(),
    sb
      .from("outbound_deliveries")
      .select("id, destination, status, http_status, attempts, last_error, url, payload, response_body, created_at")
      .eq("source_ref", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!respData) notFound();
  const r = respData as AppRow;
  const deliveries = (delivData ?? []) as unknown as DeliveryRow[];

  const utms = [
    { k: "source", v: r.utm_source },
    { k: "medium", v: r.utm_medium },
    { k: "campaign", v: r.utm_campaign },
    { k: "content", v: r.utm_content },
    { k: "term", v: r.utm_term },
  ];
  const hasUtm = utms.some((u) => u.v);

  return (
    <>
      <PageHeader
        title={`Aplicação ${r.id.slice(0, 8)}`}
        subtitle={`${r.form_name ?? r.form_id} · ${fmtDateTime(r.received_at)}`}
        right={
          <div className="flex items-center gap-2">
            <Link href="/aplicacoes/posts" className="btn btn-sm btn-ghost">Monitoramento</Link>
            <Link href="/aplicacoes" className="btn btn-sm">← Aplicações</Link>
          </div>
        }
      />
      <PageBody>
        {/* Resumo */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card p-3">
            <div className="label mb-1.5">Score</div>
            <div className="text-2xl tabular-nums">{r.score ?? "—"}</div>
          </div>
          <div className="card p-3">
            <div className="label mb-1.5">Email</div>
            <div className="text-xs font-mono break-all">{r.email ?? "—"}</div>
          </div>
          <div className="card p-3">
            <div className="label mb-1.5">Telefone</div>
            <div className="text-xs font-mono">{r.phone ?? "—"}</div>
          </div>
          <div className="card p-3">
            <div className="label mb-1.5">Envio GHL</div>
            {deliveries.length === 0 ? (
              <span className="text-muted text-xs">Nenhum</span>
            ) : (
              (() => {
                const st = STATUS[deliveries[0]!.status] ?? { dot: "bg-text2", text: "text-text2", label: deliveries[0]!.status };
                return <span className="chip"><span className={`dot ${st.dot}`} /><span className={st.text}>{st.label}</span></span>;
              })()
            )}
          </div>
        </section>

        {/* UTMs */}
        {hasUtm && (
          <section className="card">
            <header className="px-4 py-3 border-b border-line"><h2 className="text-sm font-medium">UTMs</h2></header>
            <dl className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 text-sm">
              {utms.map((u) => (
                <div key={u.k}>
                  <dt className="label mb-1">{u.k}</dt>
                  <dd className="font-mono text-xs break-all">{u.v ?? <span className="text-muted">—</span>}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Cliente vinculado */}
        {r.customer_id && (
          <Link href={`/customers/${r.customer_id}`} className="card p-4 hover:bg-surface2 transition flex items-center justify-between gap-3">
            <div>
              <div className="label mb-1">Cliente vinculado</div>
              <div className="text-sm">Esse respondente também tem registro no hub</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted"><path d="m9 18 6-6-6-6"/></svg>
          </Link>
        )}

        {/* Respostas da aplicação */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line"><h2 className="text-sm font-medium">Respostas da aplicação</h2></header>
          <ul className="divide-y divide-line">
            {Object.entries(r.answers ?? {}).map(([q, a]) => (
              <li key={q} className="px-4 py-3">
                <div className="text-xs text-muted mb-1">{q}</div>
                <div className="text-sm">{typeof a === "string" ? a : JSON.stringify(a)}</div>
              </li>
            ))}
            {Object.keys(r.answers ?? {}).length === 0 && (
              <li className="px-4 py-6 text-sm text-muted text-center">Nenhuma resposta capturada.</li>
            )}
          </ul>
        </section>

        {/* Envio(s) ao GHL — payload exato + resposta */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Envio ao GoHighLevel</h2>
            <span className="text-2xs text-muted">Confira aqui o que foi mapeado/enviado</span>
          </header>
          {deliveries.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted text-center">
              Nenhum envio. Configure o destino em{" "}
              <Link href="/connections/outbound" className="text-brand hover:underline">Conexões → Webhooks de saída</Link>{" "}
              (evento <code className="font-mono">survey.application</code>).
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {deliveries.map((d) => {
                const st = STATUS[d.status] ?? { dot: "bg-text2", text: "text-text2", label: d.status };
                return (
                  <li key={d.id} className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="chip"><span className={`dot ${st.dot}`} /><span className={st.text}>{st.label}</span></span>
                      <span className="text-sm font-medium">{d.destination}</span>
                      {d.http_status != null && <span className="text-2xs text-muted">HTTP {d.http_status}</span>}
                      {d.attempts > 0 && <span className="text-2xs text-muted">· {d.attempts} tentativa{d.attempts > 1 ? "s" : ""}</span>}
                      <span className="text-2xs text-muted ml-auto tabular-nums">{fmtDateTime(d.created_at)}</span>
                    </div>
                    {d.last_error && <div className="text-2xs text-danger mb-2 break-all">{d.last_error}</div>}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                      <div>
                        <div className="text-2xs text-muted mb-1">Payload enviado · <span className="font-mono break-all">{d.url}</span></div>
                        <pre className="text-2xs bg-surface2/50 border border-line rounded p-2 overflow-x-auto max-h-80">{JSON.stringify(d.payload, null, 2)}</pre>
                      </div>
                      <div>
                        <div className="text-2xs text-muted mb-1">Resposta do GHL</div>
                        <pre className="text-2xs bg-surface2/50 border border-line rounded p-2 overflow-x-auto max-h-80">{d.response_body || "—"}</pre>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Raw payload Respondi (debug) */}
        <details className="card">
          <summary className="px-4 py-3 cursor-pointer text-sm text-muted hover:bg-surface2 transition list-none">
            Payload bruto do Respondi (debug)
          </summary>
          <pre className="px-4 py-3 text-xs font-mono overflow-x-auto whitespace-pre border-t border-line bg-surface2/30">
            {JSON.stringify(r.raw_payload, null, 2)}
          </pre>
        </details>
      </PageBody>
    </>
  );
}
