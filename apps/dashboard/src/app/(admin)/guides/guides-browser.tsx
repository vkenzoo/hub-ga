"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Guide, GuideCategory } from "@/content/guides";

interface Props {
  guides: Array<Guide & { readMinutes: number; recent: boolean }>;
  categoryOrder: GuideCategory[];
  categoryLabel: Record<GuideCategory, string>;
  categoryShort: Record<GuideCategory, string>;
  categoryDesc: Record<GuideCategory, string>;
  categoryColor: Record<GuideCategory, string>;
}

const CATEGORY_ICONS: Record<GuideCategory, React.ReactNode> = {
  operacao: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  ),
  vendas: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
  ),
  produtos: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
  ),
  equipe: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  ),
  integracoes: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V7a3 3 0 0 1 6 0v4"/><path d="M5 11h14v10H5z"/><path d="M12 16v2"/></svg>
  ),
  emails: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
  ),
};

function colorBg(color: string): string {
  switch (color) {
    case "accent": return "bg-accent";
    case "brand": return "bg-brand";
    case "info": return "bg-info";
    case "warn": return "bg-warn";
    case "danger": return "bg-danger";
    default: return "bg-muted";
  }
}

function fmtDate(iso: string): string {
  return new Date(iso + "T03:00:00.000Z").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function GuideCard({
  guide,
  categoryShort,
  categoryColor,
}: {
  guide: Guide & { readMinutes: number; recent: boolean };
  categoryShort: Record<GuideCategory, string>;
  categoryColor: Record<GuideCategory, string>;
}) {
  const color = categoryColor[guide.category];
  return (
    <Link
      href={`/guides/${guide.slug}`}
      className="card p-4 hover:border-line2 hover:bg-surface2 transition group flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-md grid place-items-center bg-surface2 text-text2 group-hover:text-text`}>
          {CATEGORY_ICONS[guide.category]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-2xs text-muted uppercase tracking-wider mb-1">
            {categoryShort[guide.category]}
          </div>
          <h3 className="text-sm font-medium leading-snug text-text">
            {guide.title}
          </h3>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0 group-hover:text-text mt-1"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      <p className="text-xs text-muted leading-relaxed">{guide.summary}</p>
      <div className="flex items-center justify-between text-2xs text-muted pt-2 border-t border-line/40">
        <span className="flex items-center gap-1">
          <span className={`dot ${colorBg(color)}`} />
          {guide.readMinutes} min
        </span>
        <span>Atualizado {fmtDate(guide.updatedAt)}</span>
      </div>
    </Link>
  );
}

export function GuidesBrowser({
  guides,
  categoryOrder,
  categoryLabel,
  categoryShort,
  categoryDesc,
  categoryColor,
}: Props) {
  const [q, setQ] = useState("");
  const [activeCat, setActiveCat] = useState<GuideCategory | "all">("all");

  const filtered = useMemo(() => {
    let list = guides;
    if (activeCat !== "all") list = list.filter((g) => g.category === activeCat);
    if (q.trim()) {
      const ql = q.toLowerCase().trim();
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(ql) ||
          g.summary.toLowerCase().includes(ql) ||
          g.content.toLowerCase().includes(ql),
      );
    }
    return list;
  }, [guides, q, activeCat]);

  const featured = guides.filter((g) => g.featured);

  // Quando categoria/busca ativa, mostra grid flat. Caso contrário, agrupa por categoria.
  const isFiltering = activeCat !== "all" || q.trim().length > 0;

  const grouped = useMemo(() => {
    const map = new Map<GuideCategory, typeof guides>();
    for (const g of filtered) {
      if (!map.has(g.category)) map.set(g.category, []);
      map.get(g.category)!.push(g);
    }
    return categoryOrder
      .filter((c) => map.has(c))
      .map((category) => ({ category, items: map.get(category) ?? [] }));
  }, [filtered, categoryOrder]);

  return (
    <>
      {/* Stats + Search */}
      <div className="card p-4 md:p-5">
        <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
          <div className="flex gap-6">
            <div>
              <div className="text-2xs text-muted uppercase tracking-wider">Guias</div>
              <div className="text-2xl font-medium mt-0.5">{guides.length}</div>
            </div>
            <div>
              <div className="text-2xs text-muted uppercase tracking-wider">Categorias</div>
              <div className="text-2xl font-medium mt-0.5">{categoryOrder.length}</div>
            </div>
            <div>
              <div className="text-2xs text-muted uppercase tracking-wider">Novos (30d)</div>
              <div className="text-2xl font-medium mt-0.5">
                {guides.filter((g) => g.recent).length}
              </div>
            </div>
          </div>

          <div className="relative md:w-80">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              type="text"
              placeholder="Buscar nos guias…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="input pl-9 w-full"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text text-xs px-1.5"
                aria-label="Limpar"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveCat("all")}
          className={`btn-sm ${activeCat === "all" ? "btn-primary" : "btn-ghost"}`}
        >
          Todas
        </button>
        {categoryOrder.map((c) => {
          const active = activeCat === c;
          const count = guides.filter((g) => g.category === c).length;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setActiveCat(c)}
              className={`btn-sm ${active ? "btn-primary" : "btn-ghost"} inline-flex items-center gap-1.5`}
            >
              <span className={`dot ${colorBg(categoryColor[c])}`} />
              {categoryShort[c]}
              <span className="text-2xs opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Featured (só quando não tem filtro ativo) */}
      {!isFiltering && featured.length > 0 && (
        <section>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="label">Destaques</span>
            <span className="text-2xs text-muted">os essenciais pra começar</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {featured.map((g) => (
              <GuideCard
                key={g.slug}
                guide={g}
                categoryShort={categoryShort}
                categoryColor={categoryColor}
              />
            ))}
          </div>
        </section>
      )}

      {/* Grid: agrupado por categoria ou plano se filtrando */}
      {isFiltering ? (
        <section>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="label">
              {filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}
            </span>
            {q && <span className="text-2xs text-muted">pra &quot;{q}&quot;</span>}
          </div>
          {filtered.length === 0 ? (
            <div className="card p-8 text-center text-sm text-muted">
              Nada encontrado. Tenta outra palavra ou limpa o filtro.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((g) => (
                <GuideCard
                  key={g.slug}
                  guide={g}
                  categoryShort={categoryShort}
                  categoryColor={categoryColor}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        grouped.map(({ category, items }) => (
          <section key={category}>
            <div className="flex items-baseline gap-2 mb-3">
              <span className={`dot ${colorBg(categoryColor[category])}`} />
              <h2 className="label">{categoryLabel[category]}</h2>
              <span className="text-2xs text-muted">· {categoryDesc[category]}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((g) => (
                <GuideCard
                  key={g.slug}
                  guide={g}
                  categoryShort={categoryShort}
                  categoryColor={categoryColor}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
