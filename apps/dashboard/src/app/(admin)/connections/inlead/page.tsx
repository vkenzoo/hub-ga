import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { SecretInput } from "@/components/secret-input";
import { createInLead, deleteConnection } from "../actions";
import { ERROR_LABELS, type Connection } from "../helpers";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; removed?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "connections")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const sb = createSupabaseAdmin();
  const { data } = await sb
    .from("connections")
    .select("id, kind, label, status, config, created_at")
    .eq("kind", "inlead")
    .order("created_at", { ascending: false });

  const connections = (data ?? []) as Connection[];
  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;

  return (
    <>
      <PageHeader
        title="InLead"
        subtitle="Receba leads via webhook do Make/InLead numa URL única."
        right={
          <Link href="/connections" className="btn btn-sm">
            ← Conexões
          </Link>
        }
      />

      <PageBody>
        {sp.saved && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            <strong>{sp.saved}</strong> criado. URL gerada abaixo.
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
          <strong className="text-info">Como funciona:</strong> cada conexão InLead gera uma URL
          única que você cola no <strong>Make</strong> ou direto no InLead. Quando um lead chega, o
          hub registra o cliente.
        </div>

        {connections.length > 0 && (
          <section className="card overflow-hidden">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Conexões InLead</h2>
            </header>
            <ul className="divide-y divide-line">
              {connections.map((c) => {
                const cfg = c.config as Record<string, string>;
                const url = `https://webhooks.hubgeracaoa.com/api/inbound/inlead/${c.id}`;
                return (
                  <li key={c.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{c.label}</div>
                      <div className="flex items-center gap-2">
                        <span className="chip text-warn">
                          <span className="dot bg-warn" /> Aguardando rota receptora
                        </span>
                        <form action={deleteConnection}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="section" value="inlead" />
                          <button className="btn btn-sm btn-ghost text-muted hover:text-danger">✕</button>
                        </form>
                      </div>
                    </div>
                    <div>
                      <div className="label mb-1">Webhook URL</div>
                      <SecretInput name={`url-${c.id}`} defaultValue={url} readOnly showCopy />
                    </div>
                    <div>
                      <div className="label mb-1">
                        Secret (header <code className="font-mono">x-inlead-secret</code>)
                      </div>
                      <SecretInput name={`secret-${c.id}`} defaultValue={cfg.secret} readOnly showCopy />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <form action={createInLead} className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Nova conexão InLead</h2>
          </header>
          <div className="p-4">
            <Field name="label" label="Nome da conexão" placeholder="ex: InLead Principal" required />
          </div>
          <footer className="px-4 py-3 border-t border-line flex justify-end">
            <SubmitButton pendingLabel="Gerando...">Gerar URL</SubmitButton>
          </footer>
        </form>
      </PageBody>
    </>
  );
}
