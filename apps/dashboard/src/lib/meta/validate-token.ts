/**
 * Valida um token Meta antes de persistir. Faz 4 chamadas pra garantir:
 *   1. Token é válido (/me)
 *   2. Tem escopos necessários (/me/permissions)
 *   3. BM informado existe e é acessível (/{bm_id})
 *   4. System User tem ad accounts atribuídas (/{bm_id}/owned_ad_accounts + client)
 *
 * Cada falha vira mensagem acionável pra UI mostrar instrução de fix.
 */
import { GraphError, graphGet, isInvalidTokenError } from "./graph-client";

export type ValidationError =
  | "invalid_token"     // EAA... falso ou revogado
  | "wrong_bm"          // BM ID não bate com token
  | "missing_scope"     // faltou ads_management
  | "no_accounts"       // BM existe mas System User não tem ad accounts atribuídas
  | "rate_limited"
  | "network";

export interface ValidatedAdAccount {
  id: string;              // 'act_xxxxx'
  account_id: string;      // só dígitos
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
  balance_cents: number;
  amount_spent_cents: number;
}

export interface ValidationOk {
  ok: true;
  fb_user_id: string;
  fb_user_name: string;
  business_manager_id: string;
  business_manager_name: string;
  granted_scopes: string[];
  ad_accounts: ValidatedAdAccount[];
}

export interface ValidationFail {
  ok: false;
  error: ValidationError;
  detail?: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

const REQUIRED_SCOPES = ["ads_management"]; // mínimo. ads_read e business_management são opcionais

interface MeResp { id: string; name: string }
interface PermsResp { data: Array<{ permission: string; status: string }> }
interface BmResp { id: string; name: string }
interface AdAcctResp {
  data: Array<{
    id: string;
    account_id: string;
    name?: string;
    currency?: string;
    timezone_name?: string;
    account_status?: number;
    balance?: string;
    amount_spent?: string;
  }>;
}

function toCents(v: string | undefined | null): number {
  if (!v) return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function validateToken(
  accessToken: string,
  businessManagerId: string,
  appSecret: string,
): Promise<ValidationResult> {
  try {
    // 1. Token válido?
    const me = await graphGet<MeResp>(accessToken, "/me", { fields: "id,name" }, appSecret);

    // 2. Escopos OK?
    const perms = await graphGet<PermsResp>(accessToken, "/me/permissions", {}, appSecret);
    const granted = perms.data.filter((p) => p.status === "granted").map((p) => p.permission);
    const missing = REQUIRED_SCOPES.filter((r) => !granted.includes(r));
    if (missing.length > 0) {
      return { ok: false, error: "missing_scope", detail: missing.join(", ") };
    }

    // 3. BM existe e é acessível?
    let bm: BmResp;
    try {
      bm = await graphGet<BmResp>(
        accessToken,
        `/${businessManagerId}`,
        { fields: "id,name" },
        appSecret,
      );
    } catch (e) {
      if (e instanceof GraphError && (e.code === "100" || e.httpStatus === 404)) {
        return { ok: false, error: "wrong_bm" };
      }
      throw e;
    }

    // 4. Ad accounts (owned + client, alguns BMs só têm um dos lados)
    const fields = "id,account_id,name,currency,timezone_name,account_status,balance,amount_spent";
    const [ownedRes, clientRes] = await Promise.all([
      graphGet<AdAcctResp>(
        accessToken,
        `/${businessManagerId}/owned_ad_accounts`,
        { fields, limit: 200 },
        appSecret,
      ).catch(() => ({ data: [] }) as AdAcctResp),
      graphGet<AdAcctResp>(
        accessToken,
        `/${businessManagerId}/client_ad_accounts`,
        { fields, limit: 200 },
        appSecret,
      ).catch(() => ({ data: [] }) as AdAcctResp),
    ]);

    const dedupMap = new Map<string, ValidatedAdAccount>();
    for (const acc of [...ownedRes.data, ...clientRes.data]) {
      dedupMap.set(acc.id, {
        id: acc.id,
        account_id: acc.account_id,
        name: acc.name ?? acc.id,
        currency: acc.currency ?? "BRL",
        timezone_name: acc.timezone_name ?? "America/Sao_Paulo",
        account_status: acc.account_status ?? 0,
        balance_cents: toCents(acc.balance),
        amount_spent_cents: toCents(acc.amount_spent),
      });
    }
    const accounts = Array.from(dedupMap.values());
    if (accounts.length === 0) {
      return { ok: false, error: "no_accounts" };
    }

    return {
      ok: true,
      fb_user_id: me.id,
      fb_user_name: me.name,
      business_manager_id: bm.id,
      business_manager_name: bm.name,
      granted_scopes: granted,
      ad_accounts: accounts,
    };
  } catch (e) {
    if (isInvalidTokenError(e)) return { ok: false, error: "invalid_token" };
    if (e instanceof GraphError && e.code === "4") return { ok: false, error: "rate_limited" };
    return {
      ok: false,
      error: "network",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Helper pra UI: traduz código de erro em mensagem PT-BR acionável.
 */
export function validationErrorLabel(err: ValidationError, detail?: string): string {
  switch (err) {
    case "invalid_token":
      return "Token inválido. Gere um novo em business.facebook.com/settings/system-users.";
    case "wrong_bm":
      return "Esse Business Manager ID não bate com o token, ou o System User não tem acesso ao BM.";
    case "missing_scope":
      return `Faltam permissões: ${detail ?? "ads_management"}. Refaça o token marcando todas as boxes.`;
    case "no_accounts":
      return "Nenhuma ad account atribuída ao System User. Em Atribuir Ativos → Contas de Anúncios.";
    case "rate_limited":
      return "Meta rate-limited. Aguarde alguns minutos e tente de novo.";
    case "network":
      return `Erro de rede: ${detail ?? "tente novamente"}`;
  }
}
