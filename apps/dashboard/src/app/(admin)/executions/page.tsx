import Link from "next/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";
import { ReplayDuplicatesButton } from "./replay-duplicates-button";
import { ReplayBumpsButton } from "./replay-bumps-button";
import { ReplayInvalidButton } from "./replay-invalid-button";
import { ReplayFailedButton } from "./replay-failed-button";
import { FixTimestampsButton } from "./fix-timestamps-button";

interface ExecutionRow {
  id: string;
  gateway: string;
  raw_event_type: string | null;
  classified_as: string | null;
  status: string;
  http_status: number | null;
  duration_ms: number | null;
  client_ip: string | null;
  user_agent: string | null;
  customer_id: string | null;
  purchase_id: string | null;
  gateway_event_id: string | null;
  error_message: string | null;
  body_size_bytes: number;
  created_at: string;
}

const STATUS_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  completed:       { dot: "bg-accent",  text: "text-accent",  label: "Processado" },
  duplicate:       { dot: "bg-info",    text: "text-info",    label: "Duplicado" },
  test_event:      { dot: "bg-text2",   text: "text-text2",   label: "Teste" },
  unknown_event:   { dot: "bg-warn",    text: "text-warn",    label: "Evento desconhecido" },
  unknown_product: { dot: "bg-warn",    text: "text-warn",    label: "Produto desconhecido" },
  missing_data:    { dot: "bg-warn",    text: "text-warn",    label: "Dados faltando" },
  rejected_auth:   { dot: "bg-danger",  text: "text-danger",  label: "Auth rejeitada" },
  invalid_payload: { dot: "bg-danger",  text: "text-danger",  label: "Payload inválido" },
  failed:          { dot: "bg-danger",  text: "text-danger",  label: "Erro" },
  received:        { dot: "bg-text2",   text: "text-text2",   label: "Recebido" },
};

function statusInfo(status: string) {
  return STATUS_STYLES[status] ?? { dot: "bg-text2", text: "text-text2", label: status };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function listExecutions(filter: { gateway?: string; status?: string; q?: string }): Promise<ExecutionRow[]> {
  const sb = createSupabaseAdmin();
  let q = sb
    .from("webhook_executions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter.gateway && filter.gateway !== "all") q = q.eq("gateway", filter.gateway);
  if (filter.status && filter.status !== "all") q = q.eq("status", filter.status);
  const { data } = await q;
  let rows = (data ?? []) as ExecutionRow[];
  if (filter.q) {
    const ql = filter.q.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.raw_event_type ?? "").toLowerCase().includes(ql) ||
        (r.gateway_event_id ?? "").toLowerCase().includes(ql) ||
        (r.client_ip ?? "").includes(ql) ||
        (r.error_message ?? "").toLowerCase().includes(ql),
    );
  }
  return rows;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ gateway?: string; status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const rows = await listExecutions({ gateway: sp.gateway, status: sp.status, q: sp.q });

  const total = rows.length;
  const ok = rows.filter((r) => r.status === "completed").length;
  const failed = rows.filter((r) => ["failed", "invalid_payload", "rejected_auth"].includes(r.status)).length;
  const skipped = total - ok - failed;

  return (
    <>
      <PageHeader
        title="Executions"
        subtitle="Auditoria de cada webhook recebido — payload, status, duração e cadeia de eventos."
        right={
          <div className="flex items-center gap-2">
            <ReplayFailedButton />
            <FixTimestampsButton />
            <ReplayBumpsButton />
            <ReplayDuplicatesButton />
            <ReplayInvalidButton />
            <span className="chip"><span className="dot bg-accent" /> {ok} OK</span>
            {skipped > 0 && <span className="chip"><span className="dot bg-warn" /> {skipped} skip</span>}
            {failed > 0 && <span className="chip text-danger"><span className="dot bg-danger" /> {failed} erro</span>}
          </div>
        }
      />

      <PageBody>
        <form className="card p-3 grid grid-cols-1 md:grid-cols-[1fr_140px_180px_auto_auto] gap-2 items-center">
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Buscar event, ID, IP, erro..."
            className="input"
          />
          <select name="gateway" defaultValue={sp.gateway ?? "all"} className="input">
            <option value="all">Todas plataformas</option>
            <option value="assiny">Assiny</option>
            <option value="hotmart">Hotmart</option>
            <option value="respondi">Respondi</option>
          </select>
          <select name="status" defaultValue={sp.status ?? "all"} className="input">
            <option value="all">Todos status</option>
            <option value="completed">Processado</option>
            <option value="duplicate">Duplicado</option>
            <option value="test_event">Teste</option>
            <option value="unknown_event">Evento desconhecido</option>
            <option value="unknown_product">Produto desconhecido</option>
            <option value="rejected_auth">Auth rejeitada</option>
            <option value="invalid_payload">Payload inválido</option>
            <option value="failed">Erro</option>
          </select>
          <button className="btn btn-sm">Filtrar</button>
          <Link href="/executions" className="btn btn-sm btn-ghost">Limpar</Link>
        </form>

        <div className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">{total} {total === 1 ? "execução" : "execuções"}</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Últimas 200</span>
          </header>

          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">Nenhuma execução.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5 w-32">Quando</th>
                  <th className="text-left font-medium px-4 py-2.5 w-24">Plataforma</th>
                  <th className="text-left font-medium px-4 py-2.5">Evento</th>
                  <th className="text-left font-medium px-4 py-2.5 w-44">Status</th>
                  <th className="text-right font-medium px-4 py-2.5 w-20">Duração</th>
                  <th className="text-right font-medium px-4 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const s = statusInfo(r.status);
                  return (
                    <tr key={r.id} className="hover:bg-surface2/30 transition">
                      <td className="px-4 py-2.5 text-xs text-muted tabular-nums whitespace-nowrap">
                        {fmtDate(r.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="chip text-2xs uppercase">{r.gateway}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <code className="font-mono text-xs">
                          {r.raw_event_type ?? <span className="text-muted">—</span>}
                        </code>
                        {r.classified_as && r.classified_as !== "processed" && (
                          <span className="text-muted text-2xs ml-2">→ {r.classified_as}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="chip">
                          <span className={`dot ${s.dot}`} />
                          <span className={s.text}>{s.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums text-muted">
                        {fmtDuration(r.duration_ms)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/executions/${r.id}`} className="btn btn-sm btn-ghost">
                          →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </PageBody>
    </>
  );
}
