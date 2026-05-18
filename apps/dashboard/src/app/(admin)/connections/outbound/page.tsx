import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { SecretInput } from "@/components/secret-input";
import { createOutbound, deleteOutbound, toggleOutbound } from "../actions";
import { ERROR_LABELS, OUTBOUND_EVENTS, type OutboundRow } from "../helpers";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    removed?: string;
    new_secret?: string;
    new_id?: string;
  }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "connections")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const sb = createSupabaseAdmin();
  const { data } = await sb
    .from("outbound_webhooks")
    .select("*")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as OutboundRow[];
  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;

  return (
    <>
      <PageHeader
        title="Webhooks de saída"
        subtitle="URLs externas que o hub vai chamar quando eventos acontecerem."
        right={
          <Link href="/connections" className="btn btn-sm">
            ← Conexões
          </Link>
        }
      />

      <PageBody>
        {sp.saved && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            <strong>{sp.saved}</strong> criado.
          </div>
        )}
        {sp.removed && (
          <div className="card border-warn/30 bg-warn/5 px-4 py-2.5 text-sm text-warn">
            <strong>{sp.removed}</strong> removido.
          </div>
        )}
        {errorMsg && (
          <div className="card border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            {errorMsg}
          </div>
        )}

        <div className="card border-info/30 bg-info/5 px-4 py-3 text-sm text-text2">
          <strong className="text-info">Disparo real:</strong> por enquanto só guarda a config. A
          rota que dispara HMAC assinado fica pra fase futura.
        </div>

        {sp.new_secret && sp.new_id && (
          <section className="card border-accent/40 bg-accent/5">
            <header className="px-4 py-3 border-b border-accent/20">
              <h2 className="text-sm font-medium text-accent">
                Webhook criado — copie o secret agora
              </h2>
              <p className="text-xs text-text2 mt-1">
                Esse secret aparece <strong>uma única vez</strong>. Vai ser usado pra assinar o body
                via HMAC quando o disparo for ligado.
              </p>
            </header>
            <div className="p-4">
              <SecretInput name="new_secret_view" defaultValue={sp.new_secret} readOnly showCopy />
            </div>
          </section>
        )}

        {rows.length > 0 && (
          <section className="card overflow-hidden">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">
                {rows.length} {rows.length === 1 ? "webhook configurado" : "webhooks configurados"}
              </h2>
            </header>
            <ul className="divide-y divide-line">
              {rows.map((w) => (
                <li key={w.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{w.label}</div>
                      <code className="block font-mono text-xs text-text2 truncate mt-0.5">{w.url}</code>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="chip">
                        <span className={`dot ${w.active ? "bg-accent" : "bg-text2"}`} />
                        {w.active ? "Ativo" : "Pausado"}
                      </span>
                      <form action={toggleOutbound}>
                        <input type="hidden" name="id" value={w.id} />
                        <button className="btn btn-sm btn-ghost" title={w.active ? "Pausar" : "Ativar"}>
                          {w.active ? "⏸" : "▶"}
                        </button>
                      </form>
                      <form action={deleteOutbound}>
                        <input type="hidden" name="id" value={w.id} />
                        <button className="btn btn-sm btn-ghost text-muted hover:text-danger">✕</button>
                      </form>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {w.events.map((e) => (
                      <span key={e} className="chip text-2xs font-mono">
                        {e}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <form action={createOutbound} className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Novo webhook de saída</h2>
          </header>
          <div className="p-4 space-y-4">
            <Field name="label" label="Nome" placeholder="ex: Notificar Slack" required />
            <Field name="url" label="URL (HTTPS)" placeholder="https://hooks.slack.com/..." required mono />
            <div>
              <span className="label block mb-1.5">Eventos pra disparar</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 border border-line rounded-md p-3">
                {OUTBOUND_EVENTS.map((e) => (
                  <label
                    key={e.value}
                    className="flex items-center gap-2 text-sm py-1 cursor-pointer hover:bg-surface2 -mx-1 px-1 rounded"
                  >
                    <input
                      type="checkbox"
                      name="events"
                      value={e.value}
                      className="rounded border-line bg-surface text-brand focus:ring-brand/40 focus:ring-offset-0"
                    />
                    <span>{e.label}</span>
                    <code className="font-mono text-2xs text-muted ml-auto">{e.value}</code>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <footer className="px-4 py-3 border-t border-line flex justify-end">
            <SubmitButton pendingLabel="Salvando...">Criar webhook</SubmitButton>
          </footer>
        </form>
      </PageBody>
    </>
  );
}
