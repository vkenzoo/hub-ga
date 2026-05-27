/**
 * Cópia do classifier de apps/webhooks/src/lib/surveys.ts.
 * Duplicado pra rota de admin (reclassify) sem cross-app import.
 * Quando atualizar lá, espelha aqui.
 */

export interface QualificationRule {
  question_key: string;
  match_type: "contains" | "equals" | "starts_with" | "regex";
  answer_pattern: string;
  classification: "a" | "b" | "c" | "d" | "e";
  active: boolean;
  form_id: string | null;
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\?+$/, "");
}

function findAnswer(
  answers: Record<string, unknown>,
  questionKey: string,
): string | null {
  const target = normalize(questionKey);
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== "string") continue;
    if (normalize(key) === target) return value;
  }
  return null;
}

export function classifyResponse(
  answers: Record<string, unknown>,
  rules: QualificationRule[],
  formId: string,
): "a" | "b" | "c" | "d" | "e" | null {
  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.form_id && rule.form_id !== formId) continue;

    const answerVal = findAnswer(answers, rule.question_key);
    if (!answerVal) continue;

    const a = normalize(answerVal);
    const p = normalize(rule.answer_pattern);

    let match = false;
    if (rule.match_type === "contains") match = a.includes(p);
    else if (rule.match_type === "equals") match = a === p;
    else if (rule.match_type === "starts_with") match = a.startsWith(p);
    else if (rule.match_type === "regex") {
      try {
        match = new RegExp(rule.answer_pattern, "i").test(answerVal);
      } catch {
        continue;
      }
    }

    if (match) return rule.classification;
  }
  return null;
}
