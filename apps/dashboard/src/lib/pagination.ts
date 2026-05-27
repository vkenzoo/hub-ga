/**
 * Cursor-based pagination pra tabelas grandes.
 *
 * Cursor = base64url({ t: created_at_iso, id: row_id }).
 * Ordenação: created_at DESC, id DESC (id como tie-breaker estável).
 *
 * Query pattern:
 *   .order("created_at", { ascending: false })
 *   .order("id", { ascending: false })
 *   .limit(size + 1)
 *   // se cursor: .or(`created_at.lt.${t},and(created_at.eq.${t},id.lt.${id})`)
 *
 * O `size + 1` é truque pra detectar "tem próxima página": se voltou
 * mais que size linhas, tem mais.
 */

export interface PageCursor {
  t: string; // created_at ISO
  id: string;
}

export function encodeCursor(c: PageCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string | undefined): PageCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const c = JSON.parse(json) as Partial<PageCursor>;
    if (typeof c.t === "string" && typeof c.id === "string") {
      return { t: c.t, id: c.id };
    }
    return null;
  } catch {
    return null;
  }
}

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 50;

export function parsePageSize(raw: string | undefined): PageSize {
  const n = Number(raw);
  if (n === 25 || n === 50 || n === 100) return n;
  return DEFAULT_PAGE_SIZE;
}

/**
 * Aplica cursor numa query Supabase. Retorna a query modificada.
 * Espera que a query JÁ tenha .order("created_at", desc) + .order("id", desc).
 */
export function applyCursor<Q extends { or(filter: string): Q }>(
  query: Q,
  cursor: PageCursor | null,
): Q {
  if (!cursor) return query;
  return query.or(
    `created_at.lt.${cursor.t},and(created_at.eq.${cursor.t},id.lt.${cursor.id})`,
  );
}

/**
 * Após query, separa rows da página e calcula próximo cursor.
 *
 * Uso:
 *   const { rows, nextCursor } = sliceWithCursor(data, size);
 */
export function sliceWithCursor<T extends { created_at: string; id: string }>(
  data: T[],
  size: number,
): { rows: T[]; nextCursor: string | null } {
  const hasMore = data.length > size;
  const rows = hasMore ? data.slice(0, size) : data;
  const last = rows[rows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ t: last.created_at, id: last.id }) : null;
  return { rows, nextCursor };
}
