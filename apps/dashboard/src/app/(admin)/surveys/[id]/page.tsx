import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

interface SurveyRow {
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
  raw_answers: unknown;
  raw_payload: unknown;
  qualification: string | null;
  customer_id: string | null;
  received_at: string;
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
    second: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "surveys")) {
    redirect("/?error=no_access");
  }

  const { id } = await params;
  const sb = createSupabaseAdmin();
  const { data } = await sb.from("survey_responses").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as SurveyRow;

  const qChip = r.qualification ? QUAL_STYLES[r.qualification] : null;

  return (
    <>
      <PageHeader
        title={`Resposta ${r.id.slice(0, 8)}`}
        subtitle={`${r.form_name ?? r.form_id} · ${fmtDateTime(r.received_at)}`}
        right={
          <Link href="/surveys" className="btn btn-sm">
            ← Pesquisa
          </Link>
        }
      />

      <PageBody>
        {/* Resumo */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card p-3">
            <div className="label mb-1.5">Lead</div>
            {qChip ? (
              <span className="chip">
                <span className={`dot ${qChip.dot}`} />
                <span className={qChip.text}>{qChip.label}</span>
              </span>
            ) : (
              <span className="text-muted text-xs">Não classificado</span>
            )}
          </div>
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
        </section>

        {/* UTMs */}
        {(r.utm_source || r.utm_medium || r.utm_campaign || r.utm_content || r.utm_term) && (
          <section className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">UTMs</h2>
            </header>
            <dl className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 text-sm">
              {[
                { k: "source", v: r.utm_source },
                { k: "medium", v: r.utm_medium },
                { k: "campaign", v: r.utm_campaign },
                { k: "content", v: r.utm_content },
                { k: "term", v: r.utm_term },
              ].map((u) => (
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
          <Link
            href={`/customers/${r.customer_id}`}
            className="card p-4 hover:bg-surface2 transition flex items-center justify-between gap-3"
          >
            <div>
              <div className="label mb-1">Cliente vinculado</div>
              <div className="text-sm">Esse respondente também tem compras no hub</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted"><path d="m9 18 6-6-6-6"/></svg>
          </Link>
        )}

        {/* Respostas */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Respostas</h2>
          </header>
          <ul className="divide-y divide-line">
            {Object.entries(r.answers).map(([q, a]) => (
              <li key={q} className="px-4 py-3">
                <div className="text-xs text-muted mb-1">{q}</div>
                <div className="text-sm">{typeof a === "string" ? a : JSON.stringify(a)}</div>
              </li>
            ))}
            {Object.keys(r.answers).length === 0 && (
              <li className="px-4 py-6 text-sm text-muted text-center">Nenhuma resposta capturada.</li>
            )}
          </ul>
        </section>

        {/* Raw payload */}
        <details className="card">
          <summary className="px-4 py-3 cursor-pointer text-sm text-muted hover:bg-surface2 transition list-none">
            Payload bruto (debug)
          </summary>
          <pre className="px-4 py-3 text-xs font-mono overflow-x-auto whitespace-pre border-t border-line bg-surface2/30">
            {JSON.stringify(r.raw_payload, null, 2)}
          </pre>
        </details>
      </PageBody>
    </>
  );
}
