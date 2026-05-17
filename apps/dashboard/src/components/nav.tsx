"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
};

const ITEMS: Item[] = [
  { href: "/", label: "Resumo", icon: I.resumo },
  { href: "/sales", label: "Vendas", icon: I.sales },
  { href: "/customers", label: "Clientes", icon: I.customers },
  { href: "/systems", label: "Sistemas", icon: I.systems },
  { href: "/products", label: "Produtos", icon: I.products },
  { href: "/webhooks", label: "Webhooks", icon: I.webhooks },
];

function isActiveLink(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname() ?? "/";

  return (
    <aside className="w-60 shrink-0 border-r border-line bg-surface/40 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-4 flex items-center gap-2.5 border-b border-line">
        <div className="w-7 h-7 rounded-md bg-accent grid place-items-center text-bg font-semibold text-sm">
          H
        </div>
        <div>
          <div className="text-sm font-medium leading-tight">Hub Admin</div>
          <div className="text-2xs text-muted leading-tight">v0.1 · staging</div>
        </div>
      </div>

      <div className="px-4 pt-5 pb-2">
        <span className="label">Geral</span>
      </div>

      <nav className="px-2 space-y-0.5">
        {ITEMS.map((it) => {
          const isActive = isActiveLink(it.href, pathname);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${
                isActive ? "bg-surface2 text-text" : "text-text2 hover:bg-surface hover:text-text"
              }`}
            >
              <span className={isActive ? "text-accent" : ""}>{it.icon}</span>
              {it.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-line p-3">
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <div className="w-7 h-7 rounded-full bg-surface2 border border-line grid place-items-center text-xs text-text2">
            {email[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text truncate" title={email}>
              {email.split("@")[0]}
            </div>
            <div className="text-2xs text-muted uppercase tracking-wider">Admin</div>
          </div>
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
  );
}
