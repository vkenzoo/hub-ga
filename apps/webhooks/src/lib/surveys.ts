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

/** Normaliza pra comparação: trim + lowercase + colapsa espaços + remove '?' final */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\?+$/, "");
}

/** Acha o valor da resposta pela question_key, comparando normalizado. */
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

/**
 * Aplica regras de qualificação na ordem recebida. Vence a primeira que casar.
 * Match tolerante: trim + lowercase + colapsa whitespace + ignora "?" final.
 */
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
