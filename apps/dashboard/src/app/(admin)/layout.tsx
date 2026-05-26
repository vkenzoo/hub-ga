import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  requireAdmin,
  pathToSection,
  canAccessSection,
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

  // Bloqueia membros em rotas admin-only
  if (isAdminOnlyPath(pathname) && auth.role !== "admin") {
    redirect("/?error=no_access");
  }

  // Bloqueia seções fora da lista permitida (admin sempre passa)
  const section = pathToSection(pathname);
  if (section && !canAccessSection(auth, section)) {
    redirect("/?error=no_access");
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
