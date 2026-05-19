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
  | "guides";

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

  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from("admin_users")
    .select("email, role, allowed_sections")
    .eq("email", user.email)
    .maybeSingle();

  if (!data) redirect("/login?error=not_admin");

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.name === "string" ? meta.name : null;
  const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : null;
  const role = (data.role ?? "member") as AdminRole;

  // allowed_sections é text[] no banco. Filtra valores válidos pra não confiar em garbage.
  const rawSections = (data.allowed_sections ?? null) as string[] | null;
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
