// Classifica campanhas Meta Ads em Aquisição/Monetização/Outro
// baseado nas regras configuradas em /acquisition/rules.

export type MatchType = "contains" | "equals" | "starts_with" | "regex";
export type Classification = "acquisition" | "monetization" | "other";

export interface CampaignRule {
  pattern: string;
  match_type: MatchType;
  classification: Classification;
  active: boolean;
  created_at?: string;
}

/**
 * Retorna a classificação da campanha pelo nome, ou null se nenhuma regra ativa
 * casar. Quando múltiplas regras casam, vence a primeira na ordem recebida —
 * assume que a lista já vem ordenada por created_at ASC do callsite.
 * Matching é case-insensitive (regex usa flag 'i').
 */
export function classifyCampaign(
  name: string | null | undefined,
  rules: CampaignRule[],
): Classification | null {
  if (!name) return null;
  for (const r of rules) {
    if (!r.active) continue;
    try {
      const lowerName = name.toLowerCase();
      const lowerPattern = r.pattern.toLowerCase();
      if (r.match_type === "contains" && lowerName.includes(lowerPattern)) return r.classification;
      if (r.match_type === "equals" && lowerName === lowerPattern) return r.classification;
      if (r.match_type === "starts_with" && lowerName.startsWith(lowerPattern)) return r.classification;
      if (r.match_type === "regex" && new RegExp(r.pattern, "i").test(name)) return r.classification;
    } catch {
      continue;
    }
  }
  return null;
}
