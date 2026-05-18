import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { SecretInput } from "@/components/secret-input";
import { createCademi, deleteConnection } from "../actions";
import { fmtDate, statusChip, ERROR_LABELS, type Connection } from "../helpers";

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
    .eq("kind", "cademi")
    .order("created_at", { ascending: false });

  const connections = (data ?? []) as Connection[];
  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;

  return (
    <>
      <PageHeader
        title="Cademí"
        subtitle="API key da Cademí pra sincronizar cursos e matrículas."
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
          <strong className="text-info">Como funciona:</strong> cole sua API key da Cademí pra
          futuras sincronizações de matrículas e cursos.{" "}
          <a
            href="https://api-docs.cademi.com.br/"
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
          >
            Ver docs →
          </a>
        </div>

        {connections.length > 0 && (
          <section className="card overflow-hidden">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Conexões Cademí</h2>
            </header>
            <ul className="divide-y divide-line">
              {connections.map((c) => {
                const chip = statusChip(c.status);
                return (
                  <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{c.label}</div>
                      <div className="text-xs text-muted mt-0.5">desde {fmtDate(c.created_at)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="chip">
                        <span className={`dot ${chip.dot}`} /> {chip.label}
                      </span>
                      <form action={deleteConnection}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="section" value="cademi" />
                        <button className="btn btn-sm btn-ghost text-muted hover:text-danger">✕</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <form action={createCademi} className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Nova conexão Cademí</h2>
          </header>
          <div className="p-4 space-y-3">
            <Field name="label" label="Nome da conexão" placeholder="ex: Cademí Principal" required />
            <label className="block">
              <span className="label block mb-1.5">API Key</span>
              <SecretInput name="api_key" placeholder="cdmi_..." required />
            </label>
          </div>
          <footer className="px-4 py-3 border-t border-line flex justify-end">
            <SubmitButton pendingLabel="Salvando...">Adicionar conexão</SubmitButton>
          </footer>
        </form>
      </PageBody>
    </>
  );
}
