import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { SecretInput } from "@/components/secret-input";
import { createMetaAds, deleteConnection } from "../actions";
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
    .eq("kind", "meta_ads")
    .order("created_at", { ascending: false });

  const connections = (data ?? []) as Connection[];
  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;

  return (
    <>
      <PageHeader
        title="Meta Ads"
        subtitle="Sem espera, sem app review. Gere um token vitalício no Business Manager e cole aqui."
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

        {/* Lista de conexões */}
        {connections.length > 0 && (
          <section className="card overflow-hidden">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Conexões já ativas</h2>
            </header>
            <ul className="divide-y divide-line">
              {connections.map((c) => {
                const chip = statusChip(c.status);
                const bm = (c.config as Record<string, string>).business_manager_id ?? "—";
                return (
                  <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{c.label}</div>
                      <div className="text-xs text-muted mt-0.5">
                        BM: <code className="font-mono">{bm}</code> · desde {fmtDate(c.created_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="chip">
                        <span className={`dot ${chip.dot}`} /> {chip.label}
                      </span>
                      <form action={deleteConnection}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="section" value="meta-ads" />
                        <button className="btn btn-sm btn-ghost text-muted hover:text-danger" title="Remover">
                          ✕
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Tutorial + Form lado a lado */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">
                Pegar credenciais <span className="text-xs text-muted">~2 min</span>
              </h2>
            </header>
            <div className="p-4 space-y-3">
              <details className="border border-line rounded-md group" open>
                <summary className="px-3 py-2 cursor-pointer text-sm flex items-center justify-between hover:bg-surface2 transition">
                  <span><strong>1.</strong> Crie um app no Meta for Developers</span>
                  <span className="text-2xs text-muted">3 min</span>
                </summary>
                <div className="px-3 py-3 text-xs text-text2 space-y-2 border-t border-line">
                  <p>
                    Acesse <code className="font-mono">developers.facebook.com</code> →{" "}
                    <strong>Meus Apps</strong> → botão <strong>Criar App</strong>. Escolha tipo{" "}
                    <strong>Empresarial</strong>. Adicione o produto <strong>Marketing API</strong>.
                  </p>
                  <p>
                    Em <strong>Configurações → Básico</strong>, copie o <strong>App ID</strong> e o{" "}
                    <strong>App Secret</strong> (clica em Mostrar).
                  </p>
                  <a
                    href="https://developers.facebook.com/apps/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand hover:underline inline-flex items-center gap-1"
                  >
                    Abrir Meta for Developers →
                  </a>
                </div>
              </details>

              <details className="border border-line rounded-md group">
                <summary className="px-3 py-2 cursor-pointer text-sm flex items-center justify-between hover:bg-surface2 transition">
                  <span><strong>2.</strong> Encontre o ID do Business Manager</span>
                  <span className="text-2xs text-muted">30 s</span>
                </summary>
                <div className="px-3 py-3 text-xs text-text2 space-y-2 border-t border-line">
                  <p>
                    Acesse <code className="font-mono">business.facebook.com</code> → menu{" "}
                    <strong>Configurações do Negócio</strong>. O <strong>ID</strong> de 15+ dígitos
                    fica no topo, abaixo do nome do BM.
                  </p>
                </div>
              </details>

              <details className="border border-line rounded-md group">
                <summary className="px-3 py-2 cursor-pointer text-sm flex items-center justify-between hover:bg-surface2 transition">
                  <span><strong>3.</strong> Usuário do Sistema com permissão de Admin</span>
                  <span className="text-2xs text-muted">1 min</span>
                </summary>
                <div className="px-3 py-3 text-xs text-text2 space-y-2 border-t border-line">
                  <p>
                    Em <strong>Configurações do Negócio → Usuários → Usuários do Sistema</strong>,
                    crie um com papel <strong>Admin</strong>. Clica em <strong>Gerar Token</strong>,
                    escolhe o app criado no passo 1, marca os escopos{" "}
                    <code className="font-mono">ads_management</code>,{" "}
                    <code className="font-mono">ads_read</code> e{" "}
                    <code className="font-mono">business_management</code>.
                  </p>
                  <p>
                    Token gerado é <strong>vitalício</strong>. Copie e cole no formulário ao lado.
                  </p>
                </div>
              </details>
            </div>
          </div>

          <form action={createMetaAds} className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Colar e importar</h2>
            </header>
            <div className="p-4 space-y-3">
              <Field name="label" label="Nome da conexão" placeholder="ex: BM - Dose Saudável" required />
              <Field name="app_id" label="App ID" placeholder="123456789012345" required mono />
              <label className="block">
                <span className="label block mb-1.5">App Secret</span>
                <SecretInput name="app_secret" placeholder="abcdef1234567890..." required />
              </label>
              <Field
                name="business_manager_id"
                label="ID do Business Manager"
                placeholder="166952352663250"
                required
                mono
              />
              <label className="block">
                <span className="label block mb-1.5">Código de acesso (token vitalício)</span>
                <SecretInput name="access_token" placeholder="EAABwzLixnjYB07ZB..." required />
              </label>
            </div>
            <footer className="px-4 py-3 border-t border-line flex justify-end">
              <SubmitButton pendingLabel="Salvando...">Adicionar conexão</SubmitButton>
            </footer>
          </form>
        </section>
      </PageBody>
    </>
  );
}
