import { createSystemServiceClient } from "@hub/db";

export interface CreateSystemUserResult {
  created: boolean;
  alreadyExisted: boolean;
  userId?: string;
  error?: string;
}

/**
 * Cria (ou confirma a existência de) um usuário no Supabase Auth do sistema-alvo.
 * Senha vem de DEFAULT_PROVISION_PASSWORD; flag must_change_password força a
 * troca no primeiro login (o app do sistema-alvo deve checar isso).
 */
export async function createSystemUser(
  systemSlug: string,
  email: string,
): Promise<CreateSystemUserResult> {
  const password = process.env.DEFAULT_PROVISION_PASSWORD;
  if (!password) {
    return { created: false, alreadyExisted: false, error: "DEFAULT_PROVISION_PASSWORD não configurada" };
  }

  let sb;
  try {
    sb = createSystemServiceClient(systemSlug);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { created: false, alreadyExisted: false, error: msg };
  }

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { must_change_password: true },
  });

  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return { created: false, alreadyExisted: true };
    }
    return { created: false, alreadyExisted: false, error: error.message };
  }

  return { created: true, alreadyExisted: false, userId: data.user?.id };
}
