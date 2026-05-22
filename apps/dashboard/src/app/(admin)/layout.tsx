import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  requireAdmin,
  pathToSection,
  canAccessSection,
} from "@/lib/auth";
import { Sidebar } from "@/components/nav";

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
  );
}
