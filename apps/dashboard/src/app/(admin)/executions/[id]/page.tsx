import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

interface ExecutionRow {
  id: string;
  gateway: string;
  raw_headers: Record<string, string>;
  raw_body: string;
  body_size_bytes: number;
  client_ip: string | null;
  user_agent: string | null;
  raw_event_type: string | null;
  classified_as: string | null;
  status: string;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  customer_id: string | null;
  purchase_id: string | null;
  gateway_event_id: string | null;
  created_at: string;
  completed_at: string | null;
}

interface LogRow {
  id: string;
  kind: string;
  level: string;
  payload: unknown;
  created_at: string;
}

interface CustomerLite {
  id: string;
  email: string;
  name: string | null;
}

interface PurchaseLite {
  id: string;
  amount: number;
  status: string;
  products: { name: string } | null;
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

const LEVEL_STYLES: Record<string, { dot: string; text: string }> = {
  info:  { dot: "bg-info",   text: "text-info" },
  warn:  { dot: "bg-warn",   text: "text-warn" },
  error: { dot: "bg-danger", text: "text-danger" },
};

const LEVEL_DEFAULT = { dot: "bg-info", text: "text-info" };

function statusInfo(status: string) {
  return STATUS_STYLES[status] ?? { dot: "bg-text2", text: "text-text2", label: status };
}

function levelStyle(level: string) {
  return LEVEL_STYLES[level] ?? LEVEL_DEFAULT;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtMoney(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createSupabaseAdmin();

  const { data: exec } = await sb
    .from("webhook_executions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!exec) notFound();
  const e = exec as ExecutionRow;

  const [{ data: logs }, customerRes, purchaseRes] = await Promise.all([
    sb
      .from("events_log")
      .select("id,kind,level,payload,created_at")
      .eq("webhook_execution_id", id)
      .order("created_at", { ascending: true }),
    e.customer_id
      ? sb.from("customers").select("id,email,name").eq("id", e.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    e.purchase_id
      ? sb
          .from("purchases")
          .select("id,amount,status,products(name)")
          .eq("id", e.purchase_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const ls = (logs ?? []) as LogRow[];
  const customer = (customerRes.data as unknown as CustomerLite | null) ?? null;
  const purchase = (purchaseRes.data as unknown as PurchaseLite | null) ?? null;

  const s = statusInfo(e.status);
  const bodyPretty = prettyJson(e.raw_body);

  return (
    <>
      <PageHeader
        title={`Execution ${e.id.slice(0, 8)}`}
        subtitle={`${e.gateway} · ${fmtDateTime(e.created_at)}`}
        right={
          <Link href="/executions" className="btn btn-sm">
            ← Executions
          </Link>
        }
      />

      <PageBody>
        {/* Resumo */}
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="card p-3">
            <div className="label mb-1.5">Status</div>
            <span className="chip">
              <span className={`dot ${s.dot}`} />
              <span className={s.text}>{s.label}</span>
            </span>
          </div>
          <div className="card p-3">
            <div className="label mb-1.5">HTTP</div>
            <div className="text-lg font-mono tabular-nums">{e.http_status ?? "—"}</div>
          </div>
          <div className="card p-3">
            <div className="label mb-1.5">Duração</div>
            <div className="text-lg tabular-nums">{fmtDuration(e.duration_ms)}</div>
          </div>
          <div className="card p-3">
            <div className="label mb-1.5">Gateway</div>
            <span className="chip text-2xs uppercase">{e.gateway}</span>
          </div>
          <div className="card p-3">
            <div className="label mb-1.5">Evento</div>
            <code className="font-mono text-xs">
              {e.raw_event_type ?? <span className="text-muted">—</span>}
            </code>
          </div>
          <div className="card p-3">
            <div className="label mb-1.5">Tamanho</div>
            <div className="text-sm tabular-nums">{fmtBytes(e.body_size_bytes)}</div>
          </div>
        </section>

        {/* Classificação + erro */}
        {(e.classified_as || e.error_message || e.gateway_event_id) && (
          <section className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Resultado</h2>
            </header>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 text-sm">
              {e.classified_as && (
                <div>
                  <dt className="label mb-1">Classificado como</dt>
                  <dd className="font-mono text-xs">{e.classified_as}</dd>
                </div>
              )}
              {e.gateway_event_id && (
                <div>
                  <dt className="label mb-1">Gateway event ID</dt>
                  <dd className="font-mono text-xs break-all">{e.gateway_event_id}</dd>
                </div>
              )}
              {e.completed_at && (
                <div>
                  <dt className="label mb-1">Concluído em</dt>
                  <dd className="font-mono text-xs">{fmtDateTime(e.completed_at)}</dd>
                </div>
              )}
              {e.error_message && (
                <div className="md:col-span-3">
                  <dt className="label mb-1 text-danger">Erro</dt>
                  <dd className="font-mono text-xs text-danger whitespace-pre-wrap break-all bg-danger/5 border border-danger/20 rounded p-3">
                    {e.error_message}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* Entidades ligadas */}
        {(customer || purchase) && (
          <section className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Entidades</h2>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
              {customer && (
                <Link
                  href={`/customers/${customer.id}`}
                  className="border border-line rounded p-3 hover:bg-surface2/30 transition"
                >
                  <div className="label mb-1">Cliente</div>
                  <div className="text-sm font-mono">{customer.email}</div>
                  {customer.name && (
                    <div className="text-xs text-muted mt-0.5">{customer.name}</div>
                  )}
                </Link>
              )}
              {purchase && (
                <div className="border border-line rounded p-3">
                  <div className="label mb-1">Compra</div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">{purchase.products?.name ?? "—"}</div>
                    <div className="text-sm tabular-nums">{fmtMoney(Number(purchase.amount))}</div>
                  </div>
                  <div className="text-2xs text-muted mt-1 uppercase">{purchase.status}</div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Request */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Request</h2>
            <div className="text-2xs text-muted">
              {e.client_ip && <span className="font-mono">{e.client_ip}</span>}
            </div>
          </header>
          <details className="border-b border-line">
            <summary className="px-4 py-2.5 cursor-pointer text-xs text-muted hover:text-text2 select-none">
              Headers ({Object.keys(e.raw_headers).length})
            </summary>
            <div className="px-4 pb-3">
              <table className="w-full text-xs font-mono">
                <tbody className="divide-y divide-line">
                  {Object.entries(e.raw_headers).map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-1.5 pr-4 text-muted whitespace-nowrap align-top">{k}</td>
                      <td className="py-1.5 break-all">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="p-4">
            <div className="label mb-2">Body</div>
            <pre className="bg-surface2/30 border border-line rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre max-h-[60vh]">
              {bodyPretty}
            </pre>
          </div>
        </section>

        {/* Timeline */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Timeline</h2>
              <p className="text-xs text-muted mt-0.5">
                Eventos do events_log ligados a essa execution.
              </p>
            </div>
            <span className="chip">{ls.length}</span>
          </header>
          {ls.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted">Sem eventos registrados.</div>
          ) : (
            <ul className="divide-y divide-line">
              {ls.map((l) => {
                const lv = levelStyle(l.level);
                const hasPayload = l.payload != null && Object.keys(l.payload as object).length > 0;
                return (
                  <li key={l.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`dot ${lv.dot}`} />
                        <code className="font-mono text-xs">{l.kind}</code>
                        <span className={`text-2xs uppercase ${lv.text}`}>{l.level}</span>
                      </div>
                      <span className="text-2xs text-muted tabular-nums shrink-0">
                        {fmtDateTime(l.created_at)}
                      </span>
                    </div>
                    {hasPayload && (
                      <details className="mt-2">
                        <summary className="text-2xs text-muted hover:text-text2 cursor-pointer select-none">
                          payload
                        </summary>
                        <pre className="mt-1.5 bg-surface2/30 border border-line rounded p-2 text-xs font-mono overflow-x-auto whitespace-pre">
                          {JSON.stringify(l.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </PageBody>
    </>
  );
}
