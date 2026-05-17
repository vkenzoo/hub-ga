import { headers } from "next/headers";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

interface EventRow {
  id: string;
  kind: string;
  level: string;
  payload: unknown;
  customer_id: string | null;
  purchase_id: string | null;
  created_at: string;
}

function levelDot(level: string) {
  if (level === "error") return "bg-danger";
  if (level === "warn") return "bg-warn";
  return "bg-text2";
}

export default async function Page() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "";
  const webhooksHost = host.replace(/:\d+$/, ":3001");
  const baseUrl = `${proto}://${webhooksHost}`;

  const sb = createSupabaseAdmin();
  const { data } = await sb
    .from("events_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  const events = (data ?? []) as EventRow[];

  const byKind = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle="URLs públicas e auditoria de tudo que o hub recebeu."
        right={<span className="chip">{events.length} eventos no log</span>}
      />

      <PageBody>
        {/* Endpoints */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Endpoints</h2>
            <p className="text-xs text-muted mt-0.5">
              Cole essas URLs no painel de cada gateway. O segredo HMAC/HotTok fica nas env vars.
            </p>
          </header>
          <div className="divide-y divide-line">
            {[
              { label: "Assiny", path: "/api/webhooks/assiny", tone: "bg-accent" },
              { label: "Hotmart", path: "/api/webhooks/hotmart", tone: "bg-info" },
              { label: "Health", path: "/api/health", tone: "bg-text2" },
            ].map((ep) => (
              <div key={ep.path} className="px-4 py-3 flex items-center gap-3">
                <span className={`dot ${ep.tone}`} />
                <span className="text-sm w-20">{ep.label}</span>
                <code className="font-mono text-xs text-text2 flex-1 truncate">
                  {baseUrl}{ep.path}
                </code>
              </div>
            ))}
          </div>
        </section>

        {/* Distribution */}
        {Object.keys(byKind).length > 0 && (
          <section className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Distribuição por tipo</h2>
            </header>
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(byKind).map(([k, n]) => (
                <div key={k} className="border border-line rounded-md p-3">
                  <div className="font-mono text-2xs text-muted uppercase tracking-wider break-words">
                    {k}
                  </div>
                  <div className="text-2xl font-medium mt-1">{n}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Events */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Log de eventos</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">
              Últimos {events.length}
            </span>
          </header>
          <div className="divide-y divide-line">
            {events.map((e) => {
              const p = (e.payload ?? {}) as Record<string, unknown>;
              const isReceived = e.kind === "webhook.received";
              const raw = typeof p.raw_event_type === "string" ? p.raw_event_type : null;
              const classified = typeof p.classified_as === "string" ? p.classified_as : null;
              const gateway = typeof p.gateway === "string" ? p.gateway : null;
              const isUnknown = classified === "unknown";
              return (
                <details key={e.id} className="group">
                  <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-3 hover:bg-surface2 transition">
                    <span className={`dot ${levelDot(e.level)}`} />
                    {isReceived && raw ? (
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        {gateway && (
                          <span className="chip text-2xs uppercase">{gateway}</span>
                        )}
                        <code className="font-mono text-xs text-text truncate">{raw}</code>
                        <span className="text-muted text-xs">→</span>
                        <code
                          className={`font-mono text-xs truncate ${
                            isUnknown ? "text-danger" : "text-accent"
                          }`}
                        >
                          {classified}
                        </code>
                      </div>
                    ) : (
                      <code className="font-mono text-xs text-text2 flex-1 truncate">{e.kind}</code>
                    )}
                    <span className="text-2xs uppercase tracking-wider text-muted w-12">
                      {e.level}
                    </span>
                    <span className="text-2xs text-muted shrink-0 w-32 text-right">
                      {new Date(e.created_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted transition group-open:rotate-90"><path d="m9 18 6-6-6-6"/></svg>
                  </summary>
                  {e.payload != null && (
                    <pre className="font-mono text-2xs leading-relaxed bg-bg border-t border-line p-4 overflow-auto max-h-72 text-text2">
{JSON.stringify(e.payload, null, 2)}
                    </pre>
                  )}
                </details>
              );
            })}
            {events.length === 0 && (
              <p className="px-4 py-8 text-sm text-muted">Nenhum evento registrado.</p>
            )}
          </div>
        </section>
      </PageBody>
    </>
  );
}
