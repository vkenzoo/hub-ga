import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/page";
import { SecretInput } from "@/components/secret-input";

export default async function Page() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "surveys")) {
    redirect("/?error=no_access");
  }

  // O secret real está em env var no Vercel; aqui só mostro a estrutura da URL
  // com placeholder. O user troca pelo valor real ao colar no Respondi.
  const baseUrl = "https://webhooks.hubgeracaoa.com/api/webhooks/respondi";
  const placeholderSecret = process.env.RESPONDI_WEBHOOK_SECRET_HINT ?? "{SECRET_DO_VERCEL}";
  const fullUrl = `${baseUrl}/${placeholderSecret}`;

  return (
    <>
      <PageHeader
        title="Setup do webhook"
        subtitle="Configure o Respondi.app pra enviar respostas pro hub."
        right={
          <Link href="/surveys" className="btn btn-sm">
            ← Pesquisa
          </Link>
        }
      />

      <PageBody>
        {/* Passo 1: URL */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">1. URL do webhook</h2>
            <p className="text-xs text-muted mt-1">
              URL única que o Respondi vai chamar a cada resposta nova. O secret no path autentica.
            </p>
          </header>
          <div className="p-4 space-y-3">
            <div>
              <div className="label mb-1.5">URL completa</div>
              <SecretInput name="webhook-url" defaultValue={fullUrl} readOnly showCopy />
              <p className="text-2xs text-muted mt-1.5">
                O <code className="font-mono">{"{SECRET_DO_VERCEL}"}</code> é o valor de{" "}
                <code className="font-mono">RESPONDI_WEBHOOK_SECRET</code> que você cadastrou no Vercel.
                Substitua antes de colar no Respondi.
              </p>
            </div>
          </div>
        </section>

        {/* Passo 2: Cadastrar no Respondi */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">2. Cadastrar no Respondi.app</h2>
          </header>
          <div className="p-4 space-y-3 text-sm text-text2">
            <ol className="space-y-2 list-decimal pl-5">
              <li>Acesse <code className="font-mono text-text">respondi.app</code> e abra o formulário desejado</li>
              <li>Vá em <strong>Integrações</strong> ou <strong>Configurações → Webhooks</strong></li>
              <li>Ative o toggle <strong>Webhooks</strong></li>
              <li>Cole a URL completa (com o secret real no lugar do placeholder)</li>
              <li>Salve</li>
              <li>Use o botão <strong>Testar webhook</strong> do Respondi (se disponível) ou envie uma resposta de teste</li>
            </ol>
          </div>
        </section>

        {/* Passo 3: O que acontece */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">3. O que acontece quando uma resposta chega</h2>
          </header>
          <div className="p-4 space-y-2 text-sm text-text2">
            <p>O hub recebe via POST e:</p>
            <ol className="space-y-1.5 list-decimal pl-5">
              <li>Valida o secret na URL</li>
              <li>Dedup por <code className="font-mono">respondent_id + form_id</code></li>
              <li>Extrai email/telefone das respostas via heurística (regex)</li>
              <li>Captura UTMs de <code className="font-mono">respondent_utms</code></li>
              <li>Aplica regras de qualificação (Lead A/B/C/D/E)</li>
              <li>Tenta vincular cliente existente por email ou telefone normalizado</li>
              <li>Salva em <code className="font-mono">survey_responses</code></li>
            </ol>
            <p className="text-xs text-muted pt-2">
              Você vê todas as respostas em <Link href="/surveys" className="text-brand hover:underline">/surveys</Link>.
              Crie regras de qualificação em <Link href="/surveys/rules" className="text-brand hover:underline">/surveys/rules</Link>.
            </p>
          </div>
        </section>

        {/* Múltiplos pontos */}
        <div className="card border-info/30 bg-info/5 px-4 py-3 text-sm text-text2">
          <strong className="text-info">Múltiplos pontos de captura:</strong> você pode cadastrar a mesma URL em
          vários formulários do Respondi (área de membros, página de obrigado, onboarding WhatsApp). Use UTMs
          diferentes em cada um pra identificar a origem. O hub agrega todos numa única tabela com filtro por
          form ou UTM.
        </div>
      </PageBody>
    </>
  );
}
