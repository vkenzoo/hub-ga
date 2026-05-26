import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { SecretInput } from "@/components/secret-input";
import { connectMetaBM } from "./actions";
import { ConnectionActions } from "./connection-actions";
import { fmtDate, statusChip } from "../helpers";
import { validationErrorLabel, type ValidationError } from "@/lib/meta/validate-token";

interface MetaConnRow {
  id: string;
  business_manager_id: string;
  business_manager_name: string | null;
  fb_user_name: string | null;
  granted_scopes: string[];
  status: string;
  last_synced_at: string | null;
  last_healthcheck_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface AdAccountRow {
  id: string;
  meta_connection_id: string;
  account_id: string;
  name: string | null;
  account_status: number | null;
}

const META_ERROR_LABELS: Record<string, string> = {
  missing_fields: "Preencha todos os campos obrigatórios.",
  not_found: "Conexão não encontrada.",
  insert_failed: "Falha ao salvar. Tente novamente.",
  encryption_misconfigured:
    "ENCRYPTION_KEY não está configurada no Vercel (ou tem tamanho errado). Veja o guia em /guides ou cole openssl rand -base64 32 como env var e dê Redeploy.",
  sync_failed: "Sync falhou.",
};

function errorMsg(code: string, detail?: string): string {
  const validation = ["invalid_token", "wrong_bm", "missing_scope", "no_accounts", "rate_limited", "network"] as const;
  if (validation.includes(code as (typeof validation)[number])) {
    return validationErrorLabel(code as ValidationError, detail);
  }
  return META_ERROR_LABELS[code] ?? "Algo deu errado.";
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  return fmtDate(iso);
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    detail?: string;
    saved?: string;
    accounts?: string;
    checked?: string;
    removed?: string;
    synced?: string;
    rows?: string;
  }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "connections")) {
    redirect("/?error=no_access");
  }

  const sp = await searchParams;
  const sb = createSupabaseAdmin();

  const [{ data: conns }, { data: accts }] = await Promise.all([
    sb
      .from("meta_connections")
      .select(
        "id, business_manager_id, business_manager_name, fb_user_name, granted_scopes, status, last_synced_at, last_healthcheck_at, last_error, created_at",
      )
      .order("created_at", { ascending: false }),
    sb
      .from("ad_accounts")
      .select("id, meta_connection_id, account_id, name, account_status"),
  ]);

  const connections = (conns ?? []) as MetaConnRow[];
  const adAccounts = (accts ?? []) as AdAccountRow[];

  // Agrupa ad accounts por meta_connection_id
  const accountsByConn = new Map<string, AdAccountRow[]>();
  for (const a of adAccounts) {
    if (!accountsByConn.has(a.meta_connection_id)) accountsByConn.set(a.meta_connection_id, []);
    accountsByConn.get(a.meta_connection_id)!.push(a);
  }

  return (
    <>
      <PageHeader
        title="Meta Ads"
        subtitle="Sem espera, sem app review. Gere um System User Token vitalício no Business Manager e cole aqui."
        right={
          <Link href="/connections" className="btn btn-sm">
            ← Conexões
          </Link>
        }
      />

      <PageBody>
        {sp.saved && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            ✓ <strong>{sp.saved}</strong> conectado · {sp.accounts ?? "?"} ad accounts importadas.
          </div>
        )}
        {sp.checked && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            ✓ <strong>{sp.checked}</strong> — token válido, contas re-sincronizadas.
          </div>
        )}
        {sp.synced && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            ✓ Sync completo — <strong>{sp.synced}</strong> contas processadas,{" "}
            <strong>{sp.rows ?? "0"}</strong> rows upserted.
          </div>
        )}
        {sp.removed && (
          <div className="card border-warn/30 bg-warn/5 px-4 py-2.5 text-sm text-warn">
            <strong>{sp.removed}</strong> removido.
          </div>
        )}
        {sp.error && (
          <div className="card border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            {errorMsg(sp.error, sp.detail)}
          </div>
        )}

        {/* Lista de BMs conectados */}
        {connections.length > 0 && (
          <section className="card overflow-hidden">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">
                Business Managers conectados ({connections.length})
              </h2>
            </header>
            <ul className="divide-y divide-line">
              {connections.map((c) => {
                const chip = statusChip(c.status);
                const accts = accountsByConn.get(c.id) ?? [];
                const activeAccts = accts.filter((a) => a.account_status === 1).length;
                return (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {c.business_manager_name ?? "—"}
                          </span>
                          <span className="chip">
                            <span className={`dot ${chip.dot}`} /> {chip.label}
                          </span>
                        </div>
                        <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>
                            BM: <code className="font-mono">{c.business_manager_id}</code>
                          </span>
                          {c.fb_user_name && <span>Sys User: {c.fb_user_name}</span>}
                          <span>Desde {fmtDate(c.created_at)}</span>
                          <span>Último check: {fmtRelative(c.last_healthcheck_at)}</span>
                        </div>
                        {c.last_error && (
                          <div className="text-2xs text-danger mt-1 font-mono">
                            ⚠ {c.last_error}
                          </div>
                        )}
                        {accts.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="text-2xs text-muted">
                              {accts.length} {accts.length === 1 ? "conta" : "contas"} · {activeAccts} ativa{activeAccts === 1 ? "" : "s"}:
                            </span>
                            {accts.slice(0, 6).map((a) => (
                              <span
                                key={a.id}
                                className="text-2xs px-1.5 py-0.5 rounded bg-surface2 text-text2"
                                title={a.account_id}
                              >
                                {a.name ?? a.account_id}
                              </span>
                            ))}
                            {accts.length > 6 && (
                              <span className="text-2xs text-muted">+{accts.length - 6}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <ConnectionActions connectionId={c.id} />
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
                Pegar credenciais <span className="text-xs text-muted">~5 min</span>
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
                    Acesse <code className="font-mono">developers.facebook.com/apps</code> →{" "}
                    botão <strong>Criar app</strong>. Tipo <strong>Empresarial</strong>.
                    Adicione o produto <strong>Marketing API</strong>.
                  </p>
                  <p>
                    Em <strong>Configurações → Básico</strong>, copia <strong>App ID</strong> e{" "}
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
                    Acesse <code className="font-mono">business.facebook.com/settings</code>. O{" "}
                    <strong>ID</strong> de 15+ dígitos fica no topo, abaixo do nome do BM.
                  </p>
                </div>
              </details>

              <details className="border border-line rounded-md group">
                <summary className="px-3 py-2 cursor-pointer text-sm flex items-center justify-between hover:bg-surface2 transition">
                  <span><strong>3.</strong> Crie o System User e gere o token</span>
                  <span className="text-2xs text-muted">2 min</span>
                </summary>
                <div className="px-3 py-3 text-xs text-text2 space-y-2 border-t border-line">
                  <p>
                    Em <strong>Configurações → Usuários → Usuários do Sistema</strong>, crie um com
                    papel <strong>Admin</strong>.
                  </p>
                  <p>
                    <strong>Atribuir Ativos → Contas de Anúncios</strong>: marca as contas que esse
                    System User vai gerenciar com permissão <strong>Acesso total</strong>.
                  </p>
                  <p className="text-warn">
                    ⚠ Sem esse passo, o token não enxerga nenhuma conta — o validador vai falhar
                    com &quot;no_accounts&quot;.
                  </p>
                  <p>
                    Click em <strong>Gerar novo token</strong> → escolhe o app do passo 1 →
                    validade <strong>Nunca</strong> → marca os escopos:
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    <li><code className="font-mono">ads_management</code> (obrigatório)</li>
                    <li><code className="font-mono">ads_read</code></li>
                    <li><code className="font-mono">business_management</code></li>
                    <li><code className="font-mono">read_insights</code></li>
                  </ul>
                  <p className="text-warn">
                    ⚠ Token aparece <strong>uma única vez</strong>. Copia agora.
                  </p>
                </div>
              </details>
            </div>
          </div>

          <form action={connectMetaBM} className="card">
            <header className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-medium">Colar e validar</h2>
              <p className="text-xs text-muted mt-0.5">
                Vamos validar token + escopos + BM + contas antes de salvar.
              </p>
            </header>
            <div className="p-4 space-y-3">
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
                <span className="label block mb-1.5">System User Access Token</span>
                <SecretInput name="access_token" placeholder="EAABwzLixnjYB07ZB..." required />
              </label>
            </div>
            <footer className="px-4 py-3 border-t border-line flex justify-end">
              <SubmitButton pendingLabel="Validando...">Conectar BM</SubmitButton>
            </footer>
          </form>
        </section>
      </PageBody>
    </>
  );
}
