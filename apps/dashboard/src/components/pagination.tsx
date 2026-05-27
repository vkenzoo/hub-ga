"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PAGE_SIZES, type PageSize } from "@/lib/pagination";

interface Props {
  /** Path base sem query (ex: "/sales") */
  basePath: string;
  /** Query params preservados (filtros), SEM cursor/size. */
  preservedParams: Record<string, string | undefined>;
  /** Tamanho da página atual */
  pageSize: PageSize;
  /** Cursor pra próxima página, ou null se é a última */
  nextCursor: string | null;
  /** Se está em página interna (não a primeira) — habilita botão Anterior */
  hasPrev: boolean;
  /** Quantas linhas estão visíveis */
  rowsCount: number;
}

function buildUrl(
  basePath: string,
  preserved: Record<string, string | undefined>,
  overrides: Record<string, string | null>,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(preserved)) {
    if (v != null && v !== "") p.set(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function Pagination({
  basePath,
  preservedParams,
  pageSize,
  nextCursor,
  hasPrev,
  rowsCount,
}: Props) {
  const router = useRouter();

  const nextUrl = nextCursor
    ? buildUrl(basePath, preservedParams, {
        cursor: nextCursor,
        size: String(pageSize),
      })
    : null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-line text-xs">
      <div className="flex items-center gap-3 text-text2">
        <span>
          {rowsCount} {rowsCount === 1 ? "linha" : "linhas"}
        </span>
        <span className="text-muted">|</span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted">Por página:</span>
          {PAGE_SIZES.map((s) => {
            const url = buildUrl(basePath, preservedParams, {
              size: String(s),
              cursor: null, // mudar tamanho reseta pra primeira página
            });
            const active = pageSize === s;
            return (
              <Link
                key={s}
                href={url}
                className={`px-1.5 py-0.5 rounded ${
                  active ? "bg-brand/15 text-brand font-medium" : "text-text2 hover:text-text"
                }`}
              >
                {s}
              </Link>
            );
          })}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={!hasPrev}
          className="btn-sm btn-ghost disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Anterior
        </button>
        {nextUrl ? (
          <Link href={nextUrl} className="btn-sm btn-ghost">
            Próximo →
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="btn-sm btn-ghost opacity-30 cursor-not-allowed"
          >
            Próximo →
          </button>
        )}
      </div>
    </div>
  );
}
