import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { PageBody, PageHeader } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

// ── Server action: reenfileira uma entrega (falha) ──
async function resend(formData: FormData) {
  "use server";
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "applications")) redirect("/?error=no_access");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = createSupabaseAdmin();
  await sb
    .from("outbound_deliveries")
    .update({ status: "pending", run_after: new Date().toISOString(), attempts: 0, last_error: null })
    .eq("id", id);
  await logAudit({ actor: auth.email, action: "outbound.resend", target: id, payload: {} });
  revalidatePath("/aplicacoes/posts");
  redirect("/aplicacoes/posts?resent=1");
}

interface DeliveryRow {
  id: string;
  destination: string;
  event: string;
  source_ref: string | null;
  url: string;
  payload: unknown;
  status: string;
  http_status: number | null;
  response_body: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  completed_at: string | null;
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

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; resent?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "applications")) redirect("/?error=no_access");
  const sp = await searchParams;
  const sb = createSupabaseAdmin();

  let q = sb
    .from("outbound_deliveries")
    .select("id, destination, event, source_ref, url, payload, status, http_status, response_body, attempts, last_error, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (sp.status && ["pending", "success", "failed"].includes(sp.status)) {
    q = q.eq("status", sp.status);
  }
  const { data } = await q;
  const rows = (data ?? []) as unknown as DeliveryRow[];

  const counts = { success: 0, pending: 0, failed: 0 } as Record<string, number>;
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const filters: Array<{ key: string; label: string }> = [
    { key: "all", label: "Todos" },
    { key: "success", label: "Sucesso" },
    { key: "pending", label: "Pendente" },
    { key: "failed", label: "Falhou" },
  ];
  const active = sp.status && ["pending", "success", "failed"].includes(sp.status) ? sp.status : "all";

  return (
    <>
      <PageHeader
        title="Monitoramento de Posts"
        subtitle="Cada envio do hub pra fora (GoHighLevel etc): destino, status, payload e resposta."
        right={<Link href="/aplicacoes" className="btn btn-sm btn-ghost">← Aplicações</Link>}
      />
      <PageBody>
        {sp.resent && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            Reenfileirado — o cron vai tentar de novo em instantes.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1 text-xs">
          {filters.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/aplicacoes/posts" : `/aplicacoes/posts?status=${f.key}`}
              className={`px-2.5 py-1 rounded transition ${active === f.key ? "bg-brand text-text" : "text-text2 hover:bg-surface2 hover:text-text"}`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <div className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">{rows.length} {rows.length === 1 ? "envio" : "envios"}</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Últimos 300</span>
          </header>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">Nenhum envio ainda.</div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const st = STATUS[r.status] ?? { dot: "bg-text2", text: "text-text2", label: r.status };
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="chip"><span className={`dot ${st.dot}`} /><span className={st.text}>{st.label}</span></span>
                        <span className="text-sm font-medium">{r.destination}</span>
                        <span className="text-2xs text-muted font-mono">{r.event}</span>
                        {r.http_status != null && <span className="text-2xs text-muted">HTTP {r.http_status}</span>}
                        {r.attempts > 0 && <span className="text-2xs text-muted">· {r.attempts} tentativa{r.attempts > 1 ? "s" : ""}</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-2xs text-muted tabular-nums">{fmtDateTime(r.created_at)}</span>
                        {r.status === "failed" && (
                          <form action={resend}>
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton pendingLabel="...">Reenviar</SubmitButton>
                          </form>
                        )}
                      </div>
                    </div>
                    {r.last_error && <div className="text-2xs text-danger mt-1 break-all">{r.last_error}</div>}
                    <details className="mt-2">
                      <summary className="text-2xs text-muted cursor-pointer hover:text-text">payload / resposta</summary>
                      <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
                        <div>
                          <div className="text-2xs text-muted mb-1">Payload enviado · <span className="font-mono">{r.url}</span></div>
                          <pre className="text-2xs bg-surface2/50 border border-line rounded p-2 overflow-x-auto max-h-64">{JSON.stringify(r.payload, null, 2)}</pre>
                        </div>
                        <div>
                          <div className="text-2xs text-muted mb-1">Resposta</div>
                          <pre className="text-2xs bg-surface2/50 border border-line rounded p-2 overflow-x-auto max-h-64">{r.response_body || "—"}</pre>
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PageBody>
    </>
  );
}
