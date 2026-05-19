// Classifica campanhas Meta Ads em Aquisição/Monetização/Outro
// baseado nas regras configuradas em /acquisition/rules.

export type MatchType = "contains" | "equals" | "starts_with" | "regex";
export type Classification = "acquisition" | "monetization" | "other";

export interface CampaignRule {
  pattern: string;
  match_type: MatchType;
  classification: Classification;
  active: boolean;
  priority: number;
}

/**
 * Retorna a classificação da campanha pelo nome, ou null se nenhuma regra ativa
 * casar. Vence a regra de menor priority. Matching é case-insensitive (exceto regex
 * que respeita flags do próprio padrão — adiciona 'i' por padrão).
 */
export function classifyCampaign(
  name: string | null | undefined,
  rules: CampaignRule[],
): Classification | null {
  if (!name) return null;
  const sorted = rules.filter((r) => r.active).sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
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
