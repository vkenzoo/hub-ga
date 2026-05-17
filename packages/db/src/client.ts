import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createHubServiceClient(): SupabaseClient {
  const url = process.env.HUB_SUPABASE_URL;
  const key = process.env.HUB_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("HUB_SUPABASE_URL e HUB_SUPABASE_SERVICE_ROLE_KEY são obrigatórios");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function createSystemServiceClient(systemSlug: string): SupabaseClient {
  const urlEnv = `${systemSlug.toUpperCase()}_SUPABASE_URL`;
  const keyEnv = `${systemSlug.toUpperCase()}_SERVICE_ROLE_KEY`;
  const url = process.env[urlEnv];
  const key = process.env[keyEnv];
  if (!url || !key) {
    throw new Error(`Env vars ausentes para sistema "${systemSlug}": ${urlEnv}, ${keyEnv}`);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
