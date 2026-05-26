/**
 * Sync de insights diários da Marketing API.
 *
 * Pra cada ad_account de uma conexão, busca /act_xxx/insights com:
 *   - level=ad (granularidade máxima — agrega depois pro nível desejado)
 *   - fields=spend,impressions,clicks,reach,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name
 *   - time_increment=1 (1 row por dia)
 *   - date_preset ou time_range
 *
 * Aplica classifyCampaign em cada row (acquisition/monetization/other) usando
 * as regras ativas de campaign_rules.
 *
 * Upsert via UNIQUE (ad_id, date_start) — re-syncs sobre o mesmo período são idempotentes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { GraphError, graphGet, isInvalidTokenError } from "./graph-client";
import { decryptCredentials } from "./conn-credentials";
import { classifyCampaign, type CampaignRule } from "../campaign-rules";

interface MetaConnRow {
  id: string;
  business_manager_id: string;
  access_token_ciphertext: string;
  app_secret_ciphertext: string;
}

interface AdAccountRow {
  id: string;
  account_id: string;       // 'act_xxxxx'
  meta_connection_id: string;
}

interface InsightRow {
  date_start: string;       // 'YYYY-MM-DD'
  date_stop?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;           // string em moeda da conta (ex: "10.50")
  impressions?: string;
  clicks?: string;
  reach?: string;
}

interface InsightsResp {
  data: InsightRow[];
  paging?: { next?: string; cursors?: { after?: string } };
}

interface SyncResult {
  ok: boolean;
  ad_accounts_processed: number;
  rows_upserted: number;
  errors: Array<{ ad_account_id?: string; error: string }>;
}

/**
 * Converte spend em string (ex: "10.50") pra centavos (1050).
 * Meta retorna em moeda da conta (BRL/USD), aceita ponto decimal.
 */
function toCents(spend: string | undefined): number {
  if (!spend) return 0;
  const n = parseFloat(spend);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function toInt(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

interface FetchInsightsOpts {
  token: string;
  appSecret: string;
  accountId: string;          // 'act_xxx'
  sinceDays: number;          // backfill (ex: 30)
}

/**
 * Pagina todas as insights da conta no período. Acumula em memória.
 * Pra dashboards de aquisição, 30 dias × N ads geralmente < 10k rows — OK na memória.
 */
async function fetchInsightsForAccount(opts: FetchInsightsOpts): Promise<InsightRow[]> {
  const { token, appSecret, accountId, sinceDays } = opts;

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  const all: InsightRow[] = [];
  let path: string = `/${accountId}/insights`;
  let params: Record<string, string> = {
    level: "ad",
    fields:
      "spend,impressions,clicks,reach,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
  };

  // Pagina via cursor
  // (Meta usa paging.cursors.after pra forward; paging.next dá URL completa)
  for (let page = 0; page < 50; page++) { // hard cap em 50 páginas pra evitar loop infinito
    const resp = await graphGet<InsightsResp>(token, path, params, appSecret);
    all.push(...(resp.data ?? []));

    const after = resp.paging?.cursors?.after;
    if (!after || (resp.data?.length ?? 0) === 0) break;
    params = { ...params, after };
  }

  return all;
}

/**
 * Sync uma conexão inteira: itera ad_accounts, fetch insights, upsert.
 * Marca status='invalid' na conexão se detectar token revogado.
 */
export async function syncMetaConnection(
  hub: SupabaseClient,
  connectionId: string,
  sinceDays = 30,
): Promise<SyncResult> {
  const result: SyncResult = {
    ok: true,
    ad_accounts_processed: 0,
    rows_upserted: 0,
    errors: [],
  };

  // 1. Carrega conexão + credenciais
  const { data: connData, error: connErr } = await hub
    .from("meta_connections")
    .select(
      "id, business_manager_id, access_token_ciphertext, app_secret_ciphertext",
    )
    .eq("id", connectionId)
    .eq("status", "active")
    .maybeSingle();

  if (connErr || !connData) {
    result.ok = false;
    result.errors.push({ error: "connection_not_found_or_inactive" });
    return result;
  }
  const conn = connData as MetaConnRow;

  let token: string;
  let appSecret: string;
  try {
    const creds = decryptCredentials(conn);
    token = creds.token;
    appSecret = creds.appSecret;
  } catch (e) {
    result.ok = false;
    result.errors.push({
      error: `decrypt_failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return result;
  }

  // 2. Carrega ad_accounts da conexão
  const { data: acctsData } = await hub
    .from("ad_accounts")
    .select("id, account_id, meta_connection_id")
    .eq("meta_connection_id", connectionId);
  const accounts = (acctsData ?? []) as AdAccountRow[];

  if (accounts.length === 0) {
    result.errors.push({ error: "no_ad_accounts" });
    return result;
  }

  // 3. Carrega campaign_rules ativas pra classificar
  const { data: rulesData } = await hub
    .from("campaign_rules")
    .select("pattern, match_type, classification, active, created_at")
    .eq("active", true)
    .order("created_at", { ascending: true });
  const rules = (rulesData ?? []) as CampaignRule[];

  // 4. Loop por ad account, fetch insights, upsert
  for (const acc of accounts) {
    try {
      const insights = await fetchInsightsForAccount({
        token,
        appSecret,
        accountId: acc.account_id,
        sinceDays,
      });

      // 4a. Mapeia pra rows do banco
      const rows = insights
        .filter((i) => i.ad_id && i.date_start)
        .map((i) => ({
          ad_account_id: acc.id,
          date_start: i.date_start,
          campaign_id: i.campaign_id ?? "",
          campaign_name: i.campaign_name ?? null,
          adset_id: i.adset_id ?? null,
          adset_name: i.adset_name ?? null,
          ad_id: i.ad_id!,
          ad_name: i.ad_name ?? null,
          spend_cents: toCents(i.spend),
          impressions: toInt(i.impressions),
          clicks: toInt(i.clicks),
          reach: i.reach ? toInt(i.reach) : null,
          classification: classifyCampaign(i.campaign_name ?? null, rules),
          last_synced_at: new Date().toISOString(),
        }));

      // 4b. Upsert em chunks de 500 (Supabase limite por request)
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error: upErr } = await hub
          .from("meta_ad_insights_daily")
          .upsert(chunk, { onConflict: "ad_id,date_start" });
        if (upErr) {
          result.errors.push({
            ad_account_id: acc.account_id,
            error: `upsert: ${upErr.message}`,
          });
          break;
        }
        result.rows_upserted += chunk.length;
      }

      // 4c. Atualiza last_synced_at na ad_account
      await hub
        .from("ad_accounts")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", acc.id);

      result.ad_accounts_processed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({ ad_account_id: acc.account_id, error: msg });

      // Token caiu → marca conexão como invalid e para
      if (isInvalidTokenError(e)) {
        await hub
          .from("meta_connections")
          .update({
            status: "invalid",
            last_error: `token_invalid_during_sync: ${msg}`,
          })
          .eq("id", connectionId);
        result.ok = false;
        break;
      }

      // Rate-limit em uma conta — segue pra próxima
      if (e instanceof GraphError && e.code === "17") {
        continue;
      }
    }
  }

  // 5. Atualiza last_synced_at na conexão
  await hub
    .from("meta_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
    })
    .eq("id", connectionId);

  return result;
}

/**
 * Sync de todas as conexões ativas — chamado pelo cron.
 */
export async function syncAllMetaConnections(
  hub: SupabaseClient,
  sinceDays = 30,
): Promise<{ connections: number; total_rows: number; errors: number }> {
  const { data: conns } = await hub
    .from("meta_connections")
    .select("id")
    .eq("status", "active");

  let totalRows = 0;
  let totalErrors = 0;

  for (const c of (conns ?? []) as Array<{ id: string }>) {
    const r = await syncMetaConnection(hub, c.id, sinceDays);
    totalRows += r.rows_upserted;
    totalErrors += r.errors.length;
  }

  return {
    connections: (conns ?? []).length,
    total_rows: totalRows,
    errors: totalErrors,
  };
}
