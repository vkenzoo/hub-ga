import { redirect } from "next/navigation";
import { createSupabaseAdmin, createSupabaseServer } from "./supabase/server";

export type AdminRole = "admin" | "member";

export type Section =
  | "home"
  | "sales"
  | "subscriptions"
  | "customers"
  | "systems"
  | "products"
  | "webhooks"
  | "executions"
  | "connections"
  | "acquisition"
  | "guides"
  | "surveys"
  | "recovery"
  | "refunds"
  | "meta_ads";

export const ALL_SECTIONS: Section[] = [
  "home",
  "sales",
  "subscriptions",
  "customers",
  "systems",
  "products",
  "webhooks",
  "executions",
  "connections",
  "acquisition",
  "guides",
  "surveys",
  "recovery",
  "refunds",
  "meta_ads",
];

export const SECTION_LABEL: Record<Section, string> = {
  home: "Resumo",
  sales: "Vendas",
  subscriptions: "Assinaturas",
  customers: "Clientes",
  systems: "Sistemas",
  products: "Produtos",
  webhooks: "Webhooks",
  executions: "Executions",
  connections: "Conexões",
  acquisition: "Aquisição",
  guides: "Guias",
  surveys: "Pesquisa",
  recovery: "Recuperação",
  refunds: "Reembolsos",
  meta_ads: "Meta Ads",
};

const SECTION_PATH: Record<Section, string> = {
  home: "/",
  sales: "/sales",
  subscriptions: "/subscriptions",
  customers: "/customers",
  systems: "/systems",
  products: "/products",
  webhooks: "/webhooks",
  executions: "/executions",
  connections: "/connections",
  acquisition: "/acquisition",
  guides: "/guides",
  surveys: "/surveys",
  recovery: "/recovery",
  refunds: "/refunds",
  meta_ads: "/meta-ads",
};

/**
 * Retorna a Section correspondente ao pathname, ou null se o caminho não
 * pertence a nenhuma seção controlada (ex: /profile, /team).
 */
export function pathToSection(pathname: string): Section | null {
  if (pathname === "/") return "home";
  for (const section of ALL_SECTIONS) {
    const path = SECTION_PATH[section];
    if (path === "/") continue;
    if (pathname === path || pathname.startsWith(path + "/")) return section;
  }
  return null;
}

interface AuthSnapshot {
  role: AdminRole;
  allowedSections: Section[] | null;
}

export function canAccessSection(auth: AuthSnapshot, section: Section): boolean {
  if (auth.role === "admin") return true;
  if (auth.allowedSections === null) return true; // membro sem restrição
  return auth.allowedSections.includes(section);
}

export async function requireAdmin() {
  const sb = await createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user?.email) redirect("/login");

  // Normaliza pra eliminar case-mismatch entre auth.users (pode ter casing original)
  // e admin_users (cadastra via team page que já lowercase). Sem isso, "Fulano@x.com"
  // vs "fulano@x.com" não casaria → loop de redirect.
  const userEmail = user.email.toLowerCase().trim();

  const admin = createSupabaseAdmin();

  // Em paralelo: pega o registro do admin_users + flag global open_access.
  // Settings é resiliente: se a tabela não existir (pré-migration) ou query falhar,
  // assume open_access=false (comportamento original = whitelist obrigatório).
  // ilike permite match case-insensitive (defensivo).
  const [adminRes, settingsRes] = await Promise.allSettled([
    admin
      .from("admin_users")
      .select("email, role, allowed_sections")
      .ilike("email", userEmail)
      .maybeSingle(),
    admin.from("app_settings").select("open_access").eq("id", true).maybeSingle(),
  ]);

  const data = adminRes.status === "fulfilled" ? adminRes.value.data : null;
  const settings = settingsRes.status === "fulfilled" ? settingsRes.value.data : null;
  const openAccess = (settings?.open_access ?? false) === true;

  // Se o usuário não está no whitelist E o toggle global está OFF → bloqueia.
  // Se o toggle está ON → libera como 'member' com acesso a tudo (exceto gerenciar equipe).
  if (!data && !openAccess) redirect("/login?error=not_admin");

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.name === "string" ? meta.name : null;
  const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : null;
  const role = (data?.role ?? "member") as AdminRole;

  // allowed_sections é text[] no banco. Filtra valores válidos pra não confiar em garbage.
  // Quando open_access libera um usuário não-cadastrado, allowed_sections fica null
  // (= todas as seções permitidas como member).
  const rawSections = (data?.allowed_sections ?? null) as string[] | null;
  const allowedSections: Section[] | null = rawSections
    ? rawSections.filter((s): s is Section => ALL_SECTIONS.includes(s as Section))
    : null;

  return {
    user,
    email: user.email,
    name,
    avatarUrl,
    role,
    allowedSections,
  };
}

/**
 * Garante que o usuário é 'admin' (super admin). Membros são redirecionados
 * pra home com aviso. Usar em pages/actions que só super admin pode tocar.
 */
export async function requireSuperAdmin() {
  const auth = await requireAdmin();
  if (auth.role !== "admin") redirect("/?error=not_super_admin");
  return auth;
}
