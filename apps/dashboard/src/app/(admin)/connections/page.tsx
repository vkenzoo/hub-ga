import Link from "next/link";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { SecretInput } from "@/components/secret-input";
import {
  createMetaAds,
  createInLead,
  createCademi,
  createOutbound,
  deleteConnection,
  deleteOutbound,
  toggleOutbound,
} from "./actions";

type Tab = "meta_ads" | "inlead" | "cademi" | "outbound";

const TABS: { key: Tab; label: string }[] = [
  { key: "meta_ads", label: "Meta Ads" },
  { key: "inlead", label: "InLead" },
  { key: "cademi", label: "Cademí" },
  { key: "outbound", label: "Saída" },
];

const OUTBOUND_EVENTS = [
  { value: "purchase.paid", label: "Venda paga" },
  { value: "purchase.refunded", label: "Venda estornada" },
  { value: "purchase.chargeback", label: "Chargeback" },
  { value: "subscription.renewed", label: "Assinatura renovada" },
  { value: "subscription.past_due", label: "Assinatura atrasada" },
  { value: "subscription.cancelled", label: "Assinatura cancelada" },
  { value: "customer.created", label: "Cliente novo" },
];

interface Connection {
  id: string;
  kind: string;
  label: string;
  status: string;
  config: Record<string, unknown>;
  created_at: string;
}

interface OutboundRow {
  id: string;
  label: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  last_fired_at: string | null;
  last_status_code: number | null;
  created_at: string;
}

const ERROR_LABELS: Record<string, string> = {
  missing_fields: "Preencha todos os campos obrigatórios.",
  missing_label: "Dê um nome pra essa conexão.",
  invalid_url: "URL precisa começar com https://",
  no_events: "Selecione ao menos um evento pra disparar.",
  insert_failed: "Falha ao salvar. Tente novamente.",
  no_access: "Você não tem permissão pra essa seção.",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function statusChip(status: string) {
  if (status === "active") return { dot: "bg-accent", label: "Ativo" };
  if (status === "error") return { dot: "bg-danger", label: "Erro" };
  if (status === "disabled") return { dot: "bg-text2", label: "Desativado" };
  return { dot: "bg-warn", label: "Pendente" };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
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
  const activeTab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "meta_ads") as Tab;

  const sb = createSupabaseAdmin();
  const [{ data: connections }, { data: outbound }] = await Promise.all([
    sb
      .from("connections")
      .select("id, kind, label, status, config, created_at")
      .order("created_at", { ascending: false }),
    sb
      .from("outbound_webhooks")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  const conns = (connections ?? []) as Connection[];
  const outbounds = (outbound ?? []) as OutboundRow[];
  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;

  return (
    <>
      <PageHeader
        title="Conexões"
        subtitle="Integrações com ferramentas externas e webhooks de saída."
      />

      <PageBody>
        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {TABS.map((t) => {
            const isActive = t.key === activeTab;
            return (
              <Link
                key={t.key}
                href={`/connections?tab=${t.key}`}
                className={`px-3 py-1.5 rounded transition ${
                  isActive
                    ? "bg-brand text-text"
                    : "text-text2 hover:bg-surface2 hover:text-text"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {/* Banners de status */}
        {sp.saved && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            <strong>{sp.saved}</strong> criado(a).
          </div>
        )}
        {sp.removed && (
          <div className="card border-warn/30 bg-warn/5 px-4 py-2.5 text-sm text-warn">
            <strong>{sp.removed}</strong> removido(a).
          </div>
        )}
        {errorMsg && (
          <div className="card border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            {errorMsg}
          </div>
        )}

        {/* Conteúdo da aba */}
        {activeTab === "meta_ads" && (
          <MetaAdsTab
            connections={conns.filter((c) => c.kind === "meta_ads")}
          />
        )}
        {activeTab === "inlead" && (
          <InLeadTab connections={conns.filter((c) => c.kind === "inlead")} />
        )}
        {activeTab === "cademi" && (
          <CademiTab connections={conns.filter((c) => c.kind === "cademi")} />
        )}
        {activeTab === "outbound" && (
          <OutboundTab
            rows={outbounds}
            newSecret={sp.new_secret}
            newId={sp.new_id}
          />
        )}
      </PageBody>
    </>
  );
}

// ── Meta Ads ────────────────────────────────────────────────────

function MetaAdsTab({ connections }: { connections: Connection[] }) {
  return (
    <>
      {/* Lista */}
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
                      <input type="hidden" name="tab" value="meta_ads" />
                      <button
                        className="btn btn-sm btn-ghost text-muted hover:text-danger"
                        title="Remover conexão"
                      >
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
            <h2 className="text-sm font-medium">Pegar credenciais <span className="text-xs text-muted">~2 min</span></h2>
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
                  escolhe o app criado no passo 1, marca os escopos <code className="font-mono">ads_management</code>,{" "}
                  <code className="font-mono">ads_read</code> e <code className="font-mono">business_management</code>.
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
    </>
  );
}

// ── InLead ──────────────────────────────────────────────────────

function InLeadTab({ connections }: { connections: Connection[] }) {
  return (
    <>
      <div className="card border-info/30 bg-info/5 px-4 py-3 text-sm text-text2">
        <strong className="text-info">Como funciona:</strong> cada conexão InLead gera uma URL única
        que você cola no <strong>Make</strong> ou direto no InLead. A cada lead recebido, o hub
        registra o cliente.
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
                        <input type="hidden" name="tab" value="inlead" />
                        <button className="btn btn-sm btn-ghost text-muted hover:text-danger">✕</button>
                      </form>
                    </div>
                  </div>
                  <div>
                    <div className="label mb-1">Webhook URL</div>
                    <SecretInput name={`url-${c.id}`} defaultValue={url} readOnly showCopy />
                  </div>
                  <div>
                    <div className="label mb-1">Secret (header <code className="font-mono">x-inlead-secret</code>)</div>
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
    </>
  );
}

// ── Cademí ──────────────────────────────────────────────────────

function CademiTab({ connections }: { connections: Connection[] }) {
  return (
    <>
      <div className="card border-info/30 bg-info/5 px-4 py-3 text-sm text-text2">
        <strong className="text-info">Como funciona:</strong> cole sua API key da Cademí pra futuras
        sincronizações de matrículas e cursos. <a href="https://api-docs.cademi.com.br/" target="_blank" rel="noreferrer" className="text-brand hover:underline">Ver docs →</a>
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
                      <input type="hidden" name="tab" value="cademi" />
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
    </>
  );
}

// ── Outbound (Saída) ────────────────────────────────────────────

function OutboundTab({
  rows,
  newSecret,
  newId,
}: {
  rows: OutboundRow[];
  newSecret?: string;
  newId?: string;
}) {
  return (
    <>
      <div className="card border-info/30 bg-info/5 px-4 py-3 text-sm text-text2">
        <strong className="text-info">Webhooks de saída:</strong> URLs que o hub vai chamar quando
        eventos selecionados acontecerem. Disparo real é uma fase futura — por enquanto só guarda a config.
      </div>

      {newSecret && newId && (
        <section className="card border-accent/40 bg-accent/5">
          <header className="px-4 py-3 border-b border-accent/20">
            <h2 className="text-sm font-medium text-accent">Webhook criado — copie o secret agora</h2>
            <p className="text-xs text-text2 mt-1">Esse secret aparece <strong>uma única vez</strong>. Vai ser usado pra assinar o body via HMAC quando o disparo for ligado.</p>
          </header>
          <div className="p-4">
            <SecretInput name="new_secret_view" defaultValue={newSecret} readOnly showCopy />
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <section className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">{rows.length} {rows.length === 1 ? "webhook configurado" : "webhooks configurados"}</h2>
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
    </>
  );
}
