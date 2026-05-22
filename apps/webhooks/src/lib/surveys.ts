// Helpers de processamento das respostas do Respondi.app.

interface RawAnswer {
  question_id?: string;
  question?: string;
  answer?: string | string[];
  value?: string;
}

export interface QualificationRule {
  question_key: string;
  match_type: "contains" | "equals" | "starts_with" | "regex";
  answer_pattern: string;
  classification: "a" | "b" | "c" | "d" | "e";
  active: boolean;
  form_id: string | null;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_REGEX = /^[\d\s\-+().]{8,}$/;

/**
 * Acha o email no objeto answers via regex. Se não achar, tenta em raw_answers.
 */
export function extractEmail(
  answers: Record<string, unknown>,
  rawAnswers: RawAnswer[],
): string | null {
  for (const v of Object.values(answers)) {
    if (typeof v === "string" && EMAIL_REGEX.test(v.trim())) {
      return v.trim().toLowerCase();
    }
  }
  for (const ra of rawAnswers) {
    const candidate = ra.answer ?? ra.value;
    if (typeof candidate === "string" && EMAIL_REGEX.test(candidate.trim())) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Acha telefone (>= 8 dígitos quando limpa). Heurística: pega o valor que parece phone.
 * Filtra emails antes pra não confundir.
 */
export function extractPhone(
  answers: Record<string, unknown>,
  rawAnswers: RawAnswer[],
): string | null {
  const values: string[] = [];
  for (const v of Object.values(answers)) {
    if (typeof v === "string") values.push(v);
  }
  for (const ra of rawAnswers) {
    const candidate = ra.answer ?? ra.value;
    if (typeof candidate === "string") values.push(candidate);
  }
  for (const v of values) {
    const t = v.trim();
    if (EMAIL_REGEX.test(t)) continue; // pula emails
    if (PHONE_REGEX.test(t)) {
      const digits = t.replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) {
        return t;
      }
    }
  }
  return null;
}

/**
 * Aplica regras de qualificação na ordem recebida. Vence a primeira que casar.
 * answers: chave/valor da pergunta. Match por chave (question_key) primeiro.
 */
export function classifyResponse(
  answers: Record<string, unknown>,
  rules: QualificationRule[],
  formId: string,
): "a" | "b" | "c" | "d" | "e" | null {
  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.form_id && rule.form_id !== formId) continue;

    const answerVal = answers[rule.question_key];
    if (typeof answerVal !== "string") continue;

    const a = answerVal.toLowerCase();
    const p = rule.answer_pattern.toLowerCase();

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
