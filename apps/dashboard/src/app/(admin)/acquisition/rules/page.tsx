import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

type MatchType = "contains" | "equals" | "starts_with" | "regex";
type Classification = "acquisition" | "monetization" | "other";

interface RuleRow {
  id: string;
  pattern: string;
  match_type: MatchType;
  classification: Classification;
  priority: number;
  active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const MATCH_LABEL: Record<MatchType, string> = {
  contains: "Contém",
  equals: "Igual a",
  starts_with: "Começa com",
  regex: "Regex",
};

const CLASSIFICATION_CHIP: Record<Classification, { dot: string; label: string }> = {
  acquisition: { dot: "bg-brand", label: "Aquisição" },
  monetization: { dot: "bg-info", label: "Monetização" },
  other: { dot: "bg-text2", label: "Outro" },
};

const ERROR_LABELS: Record<string, string> = {
  missing_pattern: "Padrão é obrigatório.",
  invalid_regex: "Regex inválida — verifique a sintaxe.",
  insert_failed: "Falha ao salvar.",
};

async function createRule(formData: FormData) {
  "use server";
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "acquisition")) redirect("/?error=no_access");
  const sb = createSupabaseAdmin();

  const pattern = String(formData.get("pattern") ?? "").trim();
  const match_type = (String(formData.get("match_type") ?? "contains") as MatchType);
  const classification = (String(formData.get("classification") ?? "acquisition") as Classification);
  const priority = parseInt(String(formData.get("priority") ?? "100"), 10) || 100;
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!pattern) redirect("/acquisition/rules?error=missing_pattern");
  if (match_type === "regex") {
    try {
      new RegExp(pattern);
    } catch {
      redirect("/acquisition/rules?error=invalid_regex");
    }
  }

  const { data, error } = await sb
    .from("campaign_rules")
    .insert({ pattern, match_type, classification, priority, description })
    .select("id")
    .single();

  if (error) {
    console.error("[rules] insert failed:", error);
    redirect("/acquisition/rules?error=insert_failed");
  }

  await logAudit({
    actor: auth.email,
    action: "rule.create",
    target: data.id as string,
    payload: { pattern, match_type, classification, priority },
  });

  revalidatePath("/acquisition/rules");
  redirect(`/acquisition/rules?saved=${encodeURIComponent(pattern)}`);
}

async function toggleRule(formData: FormData) {
  "use server";
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "acquisition")) redirect("/?error=no_access");
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id"));
  const { data: current } = await sb
    .from("campaign_rules")
    .select("active, pattern")
    .eq("id", id)
    .maybeSingle();

  const next = !(current?.active ?? true);
  await sb.from("campaign_rules").update({ active: next, updated_at: new Date().toISOString() }).eq("id", id);

  await logAudit({
    actor: auth.email,
    action: "rule.toggle",
    target: id,
    payload: { pattern: current?.pattern, active: next },
  });

  revalidatePath("/acquisition/rules");
  redirect("/acquisition/rules");
}

async function deleteRule(formData: FormData) {
  "use server";
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "acquisition")) redirect("/?error=no_access");
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id"));
  const { data: before } = await sb
    .from("campaign_rules")
    .select("pattern, match_type, classification, priority")
    .eq("id", id)
    .maybeSingle();

  await sb.from("campaign_rules").delete().eq("id", id);

  await logAudit({
    actor: auth.email,
    action: "rule.delete",
    target: id,
    payload: { previous: before ?? null },
  });

  revalidatePath("/acquisition/rules");
  redirect(`/acquisition/rules?removed=${encodeURIComponent(before?.pattern ?? id)}`);
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; removed?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "acquisition")) redirect("/?error=no_access");

  const sp = await searchParams;
  const sb = createSupabaseAdmin();
  const { data } = await sb
    .from("campaign_rules")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });
  const rules = (data ?? []) as RuleRow[];

  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;

  return (
    <>
      <PageHeader
        title="Regras de classificação de campanha"
        subtitle="Classifica gastos do Meta Ads em Aquisição ou Monetização pelo nome da campanha."
        right={
          <Link href="/acquisition" className="btn btn-sm">
            ← Aquisição
          </Link>
        }
      />

      <PageBody>
        {sp.saved && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            Regra <code className="font-mono">{sp.saved}</code> criada.
          </div>
        )}
        {sp.removed && (
          <div className="card border-warn/30 bg-warn/5 px-4 py-2.5 text-sm text-warn">
            Regra <code className="font-mono">{sp.removed}</code> removida.
          </div>
        )}
        {errorMsg && (
          <div className="card border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            {errorMsg}
          </div>
        )}

        <div className="card border-info/30 bg-info/5 px-4 py-3 text-sm text-text2">
          <strong className="text-info">Como funciona:</strong> quando o sync com Meta Ads
          (fase 2) trouxer as campanhas, cada uma é classificada pela primeira regra ativa que
          casar com seu nome. Vence a regra com menor <code className="font-mono">priority</code>.
          Sem rule = não conta em nenhum dash.
        </div>

        {/* Lista de regras */}
        <section className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {rules.length} {rules.length === 1 ? "regra" : "regras"}
            </h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Priority ↑</span>
          </header>
          {rules.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">
              Nenhuma regra ainda. Crie a primeira abaixo.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((r) => {
                const chip = CLASSIFICATION_CHIP[r.classification];
                return (
                  <li key={r.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="chip">
                          <span className={`dot ${chip.dot}`} /> {chip.label}
                        </span>
                        <span className="chip text-2xs">{MATCH_LABEL[r.match_type]}</span>
                        <code className="font-mono text-sm text-text">{r.pattern}</code>
                        <span className="text-2xs text-muted">priority {r.priority}</span>
                        {!r.active && (
                          <span className="chip text-muted">
                            <span className="dot bg-text2" /> Pausada
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted mt-1">{r.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <form action={toggleRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn btn-sm btn-ghost" title={r.active ? "Pausar" : "Ativar"}>
                          {r.active ? "⏸" : "▶"}
                        </button>
                      </form>
                      <form action={deleteRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn btn-sm btn-ghost text-muted hover:text-danger" title="Remover">
                          ✕
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Form de criação */}
        <form action={createRule} className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Nova regra</h2>
            <p className="text-xs text-muted mt-1">
              Exemplo: padrão <code className="font-mono">[F01]</code> com tipo "Contém" e classificação
              "Aquisição" → toda campanha cujo nome contém <code className="font-mono">[F01]</code> conta como aquisição.
            </p>
          </header>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_180px] gap-3">
              <Field name="pattern" label="Padrão" placeholder="ex: [F01]" required mono />
              <label className="block">
                <span className="label block mb-1.5">Tipo de match</span>
                <select name="match_type" defaultValue="contains" className="input">
                  <option value="contains">Contém</option>
                  <option value="equals">Igual a</option>
                  <option value="starts_with">Começa com</option>
                  <option value="regex">Regex</option>
                </select>
              </label>
              <label className="block">
                <span className="label block mb-1.5">Classifica como</span>
                <select name="classification" defaultValue="acquisition" className="input">
                  <option value="acquisition">Aquisição</option>
                  <option value="monetization">Monetização</option>
                  <option value="other">Outro</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3">
              <label className="block">
                <span className="label block mb-1.5">Priority</span>
                <input
                  type="number"
                  name="priority"
                  defaultValue={100}
                  min={0}
                  max={9999}
                  className="input"
                />
              </label>
              <Field
                name="description"
                label="Descrição (opcional)"
                placeholder="Pra que serve essa regra"
              />
            </div>
          </div>
          <footer className="px-4 py-3 border-t border-line flex justify-end">
            <SubmitButton pendingLabel="Salvando...">Criar regra</SubmitButton>
          </footer>
        </form>

        <p className="text-2xs text-muted">
          Quando 2 regras casam com a mesma campanha, vence a de menor <code className="font-mono">priority</code>.
          Regex usa flag <code className="font-mono">i</code> (case-insensitive). Outros tipos também ignoram caixa.
        </p>
      </PageBody>
    </>
  );
}

