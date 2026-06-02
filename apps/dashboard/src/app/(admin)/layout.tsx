import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  requireAdmin,
  pathToSection,
  canAccessSection,
  SECTION_PATH,
  type Section,
} from "@/lib/auth";
import { Sidebar } from "@/components/nav";
import { HideValuesProvider, HIDE_VALUES_COOKIE_NAME } from "@/components/hide-values-context";

// Rotas que só admin pode acessar — espelha o flag `superAdminOnly` do sidebar.
// Bloqueia também acesso por URL direta de membros que tentem burlar.
const ADMIN_ONLY_PREFIXES = [
  "/team",
  "/audit",
  "/connections",
  "/webhooks",
  "/executions",
];

function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdmin();
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/";

  const ck = await cookies();
  const hideValues = ck.get(HIDE_VALUES_COOKIE_NAME)?.value === "1";

  // Helper: pra onde mandar o member quando ele bate em uma rota proibida.
  // SEMPRE redireciona pra uma seção que ele PODE acessar — senão entra em loop
  // (ex: member sem acesso a "home" sendo redirecionado pra "/" que de novo é "home").
  function fallbackPath(): string {
    if (auth.role === "admin") return "/";
    const allowed = auth.allowedSections ?? null;
    // Member sem restrições (null) → home funciona
    if (allowed === null) return "/";
    // Member com seções → primeira permitida (que não seja "home" se ele não tiver home)
    const first = allowed[0] as Section | undefined;
    return first ? SECTION_PATH[first] : "/login?error=no_sections";
  }

  // Bloqueia membros em rotas admin-only
  if (isAdminOnlyPath(pathname) && auth.role !== "admin") {
    redirect(`${fallbackPath()}?error=no_access`);
  }

  // Bloqueia seções fora da lista permitida (admin sempre passa).
  // Se a seção atual JÁ é o fallback, não redireciona (evita loop) — só renderiza
  // o layout sem conteúdo permitido. Isso só acontece em corner case.
  const section = pathToSection(pathname);
  if (section && !canAccessSection(auth, section)) {
    const fb = fallbackPath();
    if (fb !== pathname) redirect(`${fb}?error=no_access`);
  }

  return (
    <HideValuesProvider initialHidden={hideValues}>
      <div className="min-h-screen md:flex">
        <Sidebar
          email={auth.email}
          name={auth.name}
          avatarUrl={auth.avatarUrl}
          role={auth.role}
          allowedSections={auth.allowedSections}
        />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </HideValuesProvider>
  );
}
