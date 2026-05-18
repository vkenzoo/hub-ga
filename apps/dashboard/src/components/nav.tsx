"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";

interface Item {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const I = {
  resumo: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
  ),
  customers: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  ),
  sales: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
  ),
  systems: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
  ),
  products: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
  ),
  webhooks: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 16.98-5.99.01a6 6 0 1 1-3.59-10.74"/><path d="m12 12-2.43 5.05"/><circle cx="6.18" cy="17.18" r="2.18"/><circle cx="17.82" cy="17.18" r="2.18"/><circle cx="12" cy="6.82" r="2.18"/></svg>
  ),
  executions: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
  ),
  subs: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
  ),
  team: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="10" cy="7" r="4"/></svg>
  ),
  audit: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h6"/><path d="M22 12h-6"/><path d="M12 2v6"/><path d="M12 22v-6"/><path d="M20 16l-4-4 4-4"/><path d="M4 8l4 4-4 4"/><path d="M16 4l-4 4-4-4"/><path d="M8 20l4-4 4 4"/></svg>
  ),
  connections: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V7a3 3 0 0 1 6 0v4"/><path d="M5 11h14v10H5z"/><path d="M12 16v2"/></svg>
  ),
};

type Section =
  | "home"
  | "sales"
  | "subscriptions"
  | "customers"
  | "systems"
  | "products"
  | "webhooks"
  | "executions"
  | "connections";

interface ItemWithRole extends Item {
  section?: Section;
  superAdminOnly?: boolean;
}

const ITEMS: ItemWithRole[] = [
  { href: "/", label: "Resumo", icon: I.resumo, section: "home" },
  { href: "/sales", label: "Vendas", icon: I.sales, section: "sales" },
  { href: "/subscriptions", label: "Assinaturas", icon: I.subs, section: "subscriptions" },
  { href: "/customers", label: "Clientes", icon: I.customers, section: "customers" },
  { href: "/systems", label: "Sistemas", icon: I.systems, section: "systems" },
  { href: "/products", label: "Produtos", icon: I.products, section: "products" },
  { href: "/webhooks", label: "Webhooks", icon: I.webhooks, section: "webhooks" },
  { href: "/connections", label: "Conexões", icon: I.connections, section: "connections" },
  { href: "/executions", label: "Executions", icon: I.executions, section: "executions" },
  { href: "/team", label: "Equipe", icon: I.team, superAdminOnly: true },
  { href: "/audit", label: "Auditoria", icon: I.audit, superAdminOnly: true },
];

function isActiveLink(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  email,
  name,
  avatarUrl,
  role,
  allowedSections,
}: {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  role?: "admin" | "member";
  allowedSections?: Section[] | null;
}) {
  const pathname = usePathname() ?? "/";
  const displayName = name?.trim() || email.split("@")[0] || email;
  const isProfileActive = pathname === "/profile";
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleItems = ITEMS.filter((it) => {
    if (it.superAdminOnly) return role === "admin";
    if (role === "admin") return true;
    if (!it.section) return true;
    if (!allowedSections) return true; // null = todas
    return allowedSections.includes(it.section);
  });

  // Fecha o drawer ao mudar de rota
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Bloqueia scroll do body quando o drawer está aberto
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [mobileOpen]);

  return (
    <>
      {/* Top bar mobile — só aparece <md */}
      <header className="md:hidden sticky top-0 z-30 bg-bg border-b border-line flex items-center justify-between px-3 py-2.5">
        <Link href="/" className="flex items-center">
          <Image
            src="/logo.png"
            alt="Geração A"
            width={200}
            height={40}
            priority
            className="h-5 w-auto"
          />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="p-1.5 rounded-md hover:bg-surface2 transition"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
        </button>
      </header>

      {/* Backdrop mobile */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar — fixa em md+, drawer em mobile */}
      <aside
        className={`
          w-60 shrink-0 border-r border-line bg-surface/95 md:bg-surface/40
          flex flex-col h-screen
          fixed md:sticky top-0 left-0 z-50
          transition-transform duration-200
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        <div className="px-4 py-4 border-b border-line flex items-start justify-between">
          <div>
            <Image
              src="/logo.png"
              alt="Geração A"
              width={200}
              height={40}
              priority
              className="h-6 w-auto"
            />
            <div className="text-2xs text-muted mt-2 uppercase tracking-wider">Hub Admin</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
            className="md:hidden p-1 rounded-md hover:bg-surface2 transition text-muted"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="px-4 pt-5 pb-2">
          <span className="label">Geral</span>
        </div>

        <nav className="px-2 space-y-0.5 overflow-y-auto">
          {visibleItems.map((it) => {
            const isActive = isActiveLink(it.href, pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${
                  isActive ? "bg-surface2 text-text" : "text-text2 hover:bg-surface hover:text-text"
                }`}
              >
                <span className={isActive ? "text-brand" : ""}>{it.icon}</span>
                {it.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-line p-3">
          <div className="flex items-center gap-2 px-1 py-1">
            <Link
              href="/profile"
              className={`flex items-center gap-2.5 flex-1 min-w-0 rounded-md p-1 transition ${
                isProfileActive ? "bg-surface2" : "hover:bg-surface2"
              }`}
              title="Editar perfil"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-7 h-7 rounded-full object-cover border border-line"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-surface2 border border-line grid place-items-center text-xs text-text2">
                  {displayName[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text truncate" title={email}>
                  {displayName}
                </div>
                <div className="text-2xs text-muted uppercase tracking-wider">
                  {role === "admin" ? "Admin" : "Membro"}
                </div>
              </div>
            </Link>
            <form action={signOut}>
              <button
                title="Sair"
                className="p-1.5 rounded-md text-muted hover:text-text hover:bg-surface2 transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
