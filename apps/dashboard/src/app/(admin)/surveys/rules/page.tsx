import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { PageBody, PageHeader } from "@/components/page";
import { RuleForm } from "./rule-form";

type MatchType = "contains" | "equals" | "starts_with" | "regex";
type Classification = "a" | "b" | "c" | "d" | "e";

interface RuleRow {
  id: string;
  form_id: string | null;
  question_key: string;
  match_type: MatchType;
  answer_pattern: string;
  classification: Classification;
  active: boolean;
  description: string | null;
  created_at: string;
}

const MATCH_LABEL: Record<MatchType, string> = {
  contains: "Contém",
  equals: "Igual a",
  starts_with: "Começa com",
  regex: "Regex",
};

const CLASS_STYLES: Record<Classification, { dot: string; text: string; label: string }> = {
  a: { dot: "bg-accent", text: "text-accent", label: "Lead A" },
  b: { dot: "bg-info", text: "text-info", label: "Lead B" },
  c: { dot: "bg-warn", text: "text-warn", label: "Lead C" },
  d: { dot: "bg-text2", text: "text-text2", label: "Lead D" },
  e: { dot: "bg-muted", text: "text-muted", label: "Lead E" },
};

async function createRule(formData: FormData) {
  "use server";
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "surveys")) redirect("/?error=no_access");
  const sb = createSupabaseAdmin();

  const formIdRaw = String(formData.get("form_id") ?? "").trim();
  const question_key = String(formData.get("question_key") ?? "").trim();
  const match_type = String(formData.get("match_type") ?? "contains") as MatchType;
  const answer_pattern = String(formData.get("answer_pattern") ?? "").trim();
  const classification = String(formData.get("classification") ?? "a") as Classification;
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!question_key || !answer_pattern) {
    redirect("/surveys/rules?error=missing_fields");
  }

  if (match_type === "regex") {
    try {
      new RegExp(answer_pattern);
    } catch {
      redirect("/surveys/rules?error=invalid_regex");
    }
  }

  const { data, error } = await sb
    .from("lead_qualification_rules")
    .insert({
      form_id: formIdRaw || null,
      question_key,
      match_type,
      answer_pattern,
      classification,
      description,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[surveys.rules] insert failed:", error);
    redirect("/surveys/rules?error=insert_failed");
  }

  await logAudit({
    actor: auth.email,
    action: "survey_rule.create",
    target: data.id as string,
    payload: { form_id: formIdRaw || null, question_key, match_type, answer_pattern, classification },
  });

  revalidatePath("/surveys/rules");
  redirect(`/surveys/rules?saved=${encodeURIComponent(question_key)}`);
}

async function toggleRule(formData: FormData) {
  "use server";
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "surveys")) redirect("/?error=no_access");
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id") ?? "");
  const { data: current } = await sb
    .from("lead_qualification_rules")
    .select("active, question_key")
    .eq("id", id)
    .maybeSingle();
  const next = !(current?.active ?? true);

  await sb
    .from("lead_qualification_rules")
    .update({ active: next, updated_at: new Date().toISOString() })
    .eq("id", id);

  await logAudit({
    actor: auth.email,
    action: "survey_rule.toggle",
    target: id,
    payload: { question_key: current?.question_key, active: next },
  });

  revalidatePath("/surveys/rules");
  redirect("/surveys/rules");
}

async function deleteRule(formData: FormData) {
  "use server";
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "surveys")) redirect("/?error=no_access");
  const sb = createSupabaseAdmin();

  const id = String(formData.get("id") ?? "");
  // Loga a regra INTEIRA antes de apagar — assim um delete acidental é 100%
  // recuperável pelo audit_log (re-insert com os mesmos campos).
  const { data: before } = await sb
    .from("lead_qualification_rules")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  await sb.from("lead_qualification_rules").delete().eq("id", id);

  await logAudit({
    actor: auth.email,
    action: "survey_rule.delete",
    target: id,
    payload: { previous: before },
  });

  revalidatePath("/surveys/rules");
  redirect(`/surveys/rules?removed=${encodeURIComponent(before?.question_key ?? id)}`);
}

const ERROR_LABELS: Record<string, string> = {
  missing_fields: "Preencha pergunta e padrão da resposta.",
  invalid_regex: "Regex inválido.",
  insert_failed: "Falha ao salvar. Tente novamente.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; removed?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "surveys")) redirect("/?error=no_access");

  const sp = await searchParams;
  const sb = createSupabaseAdmin();
  const [{ data: rulesData }, { data: responsesData }] = await Promise.all([
    sb
      .from("lead_qualification_rules")
      .select("*")
      .order("created_at", { ascending: true }),
    sb
      .from("survey_responses")
      .select("form_id, form_name, answers")
      .limit(2000),
  ]);
  const rules = (rulesData ?? []) as RuleRow[];

  // Mapa GLOBAL (pergunta → respostas) + mapa POR FORM (form → pergunta → respostas).
  // O "por form" é o que faz o dropdown mostrar só as respostas do formulário escolhido.
  const allSets: Record<string, Set<string>> = {};
  const byFormSets: Record<string, Record<string, Set<string>>> = {};
  const formNameMap = new Map<string, string>();
  for (const r of (responsesData ?? []) as Array<{
    form_id: string;
    form_name: string | null;
    answers: Record<string, unknown> | null;
  }>) {
    if (r.form_id && !formNameMap.has(r.form_id)) {
      formNameMap.set(r.form_id, r.form_name ?? r.form_id);
    }
    if (!r.answers) continue;
    for (const [q, a] of Object.entries(r.answers)) {
      if (typeof a !== "string" || !a.trim()) continue;
      (allSets[q] ??= new Set()).add(a);
      if (r.form_id) {
        (byFormSets[r.form_id] ??= {});
        (byFormSets[r.form_id]![q] ??= new Set()).add(a);
      }
    }
  }
  const sortMap = (m: Record<string, Set<string>>): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const q of Object.keys(m).sort()) out[q] = [...m[q]!].sort();
    return out;
  };
  const sortedQuestionMap = sortMap(allSets);
  const byForm: Record<string, Record<string, string[]>> = {};
  for (const [fid, qmap] of Object.entries(byFormSets)) byForm[fid] = sortMap(qmap);
  const forms = [...formNameMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;

  return (
    <>
      <PageHeader
        title="Regras de qualificação"
        subtitle="Quando uma resposta casa com uma regra, o lead é classificado automaticamente."
        right={
          <Link href="/surveys" className="btn btn-sm">
            ← Pesquisa
          </Link>
        }
      />

      <PageBody>
        {sp.saved && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            Regra <strong>{sp.saved}</strong> criada.
          </div>
        )}
        {sp.removed && (
          <div className="card border-warn/30 bg-warn/5 px-4 py-2.5 text-sm text-warn">
            Regra <strong>{sp.removed}</strong> removida.
          </div>
        )}
        {errorMsg && (
          <div className="card border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            {errorMsg}
          </div>
        )}

        {/* Criar */}
        <RuleForm
          questionMap={sortedQuestionMap}
          byForm={byForm}
          forms={forms}
          createAction={createRule}
        />

        {/* Lista */}
        <section className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {rules.length} {rules.length === 1 ? "regra" : "regras"}
            </h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Mais antigas primeiro</span>
          </header>
          {rules.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">Nenhuma regra cadastrada.</div>
          ) : (
            <ul className="divide-y divide-line">
              {rules.map((r) => {
                const cls = CLASS_STYLES[r.classification];
                return (
                  <li key={r.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="chip">
                          <span className={`dot ${cls.dot}`} />
                          <span className={cls.text}>{cls.label}</span>
                        </span>
                        <span className="chip text-2xs">{MATCH_LABEL[r.match_type]}</span>
                        {!r.active && (
                          <span className="chip text-muted text-2xs">
                            <span className="dot bg-muted" /> Pausada
                          </span>
                        )}
                      </div>
                      <div className="text-sm">
                        <span className="text-text2">"</span>
                        <span className="text-text">{r.question_key}</span>
                        <span className="text-text2">" </span>
                        <span className="text-muted">→ {MATCH_LABEL[r.match_type].toLowerCase()} </span>
                        <code className="font-mono text-xs">{r.answer_pattern}</code>
                      </div>
                      {r.description && (
                        <div className="text-2xs text-muted mt-1">{r.description}</div>
                      )}
                      {r.form_id && (
                        <div className="text-2xs text-muted mt-0.5">
                          Form específico: <code className="font-mono">{r.form_id}</code>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <form action={toggleRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          className="btn btn-sm btn-ghost"
                          title={r.active ? "Pausar" : "Ativar"}
                        >
                          {r.active ? "⏸" : "▶"}
                        </button>
                      </form>
                      <form action={deleteRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn btn-sm btn-ghost text-muted hover:text-danger">✕</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="text-2xs text-muted">
          Regras se aplicam às novas respostas que chegarem. Respostas antigas mantêm a classificação anterior.
        </p>
      </PageBody>
    </>
  );
}
