import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { marked } from "marked";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/page";
import {
  findGuide,
  getAdjacentGuides,
  estimateReadMinutes,
  isRecent,
  CATEGORY_LABEL,
  CATEGORY_COLOR,
} from "@/content/guides";

marked.setOptions({
  gfm: true,
  breaks: false,
});

function fmtDate(iso: string): string {
  return new Date(iso + "T03:00:00.000Z").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Extrai H2s do markdown (## Heading) pra montar table of contents.
 * Retorna { id, text } onde id é o slug pra usar como anchor.
 */
function extractTOC(content: string): Array<{ id: string; text: string }> {
  const lines = content.split("\n");
  const out: Array<{ id: string; text: string }> = [];
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      const text = m[1]!.trim();
      out.push({ id: slugify(text), text });
    }
  }
  return out;
}

/**
 * Pós-processa o HTML do marked pra adicionar id nos h2 (TOC anchors).
 * marked não gera ids por default; injetamos via regex no HTML final.
 */
function addHeadingIds(html: string): string {
  return html.replace(/<h2>([^<]+)<\/h2>/g, (_, text) => {
    const id = slugify(text);
    return `<h2 id="${id}"><a href="#${id}" class="anchor">#</a>${text}</h2>`;
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "guides")) {
    redirect("/?error=no_access");
  }

  const { slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();

  const html = addHeadingIds(await marked.parse(guide.content));
  const toc = extractTOC(guide.content);
  const readMin = estimateReadMinutes(guide.content);
  const recent = isRecent(guide.updatedAt);
  const { prev, next } = getAdjacentGuides(slug);
  const catColor = CATEGORY_COLOR[guide.category];

  return (
    <>
      <PageHeader
        title={guide.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
            <Link href="/guides" className="hover:text-text">Guias</Link>
            <span>›</span>
            <Link
              href={`/guides?cat=${guide.category}`}
              className="hover:text-text inline-flex items-center gap-1"
            >
              <span className={`dot ${colorBg(catColor)}`} />
              {CATEGORY_LABEL[guide.category]}
            </Link>
          </span>
        }
        right={
          <Link href="/guides" className="btn btn-sm btn-ghost">
            ← Voltar
          </Link>
        }
      />

      <div className="px-4 md:px-6 py-4 md:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">
          {/* Conteúdo principal */}
          <article className="min-w-0 space-y-4">
            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {readMin} min de leitura
              </span>
              <span>·</span>
              <span>Atualizado em {fmtDate(guide.updatedAt)}</span>
              {recent && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-brand/15 text-brand font-medium uppercase tracking-wider">
                  Novo
                </span>
              )}
            </div>

            {/* Conteúdo */}
            <div
              className="card p-6 md:p-8 prose-guide"
              dangerouslySetInnerHTML={{ __html: html }}
            />

            {/* Prev / Next */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              {prev ? (
                <Link
                  href={`/guides/${prev.slug}`}
                  className="card p-3 hover:border-line2 hover:bg-surface2 transition group"
                >
                  <div className="text-2xs text-muted uppercase tracking-wider mb-1">
                    ← Anterior
                  </div>
                  <div className="text-sm text-text2 group-hover:text-text leading-snug">
                    {prev.title}
                  </div>
                </Link>
              ) : (
                <div />
              )}
              {next ? (
                <Link
                  href={`/guides/${next.slug}`}
                  className="card p-3 hover:border-line2 hover:bg-surface2 transition group text-right"
                >
                  <div className="text-2xs text-muted uppercase tracking-wider mb-1">
                    Próximo →
                  </div>
                  <div className="text-sm text-text2 group-hover:text-text leading-snug">
                    {next.title}
                  </div>
                </Link>
              ) : (
                <div />
              )}
            </div>

            <p className="text-2xs text-muted text-center pt-2">
              Esse guia é mantido no código. Pra atualizar, peça via Claude.
            </p>
          </article>

          {/* TOC sidebar */}
          {toc.length > 0 && (
            <aside className="hidden lg:block">
              <div className="sticky top-6">
                <div className="label mb-3">Nesta página</div>
                <nav className="space-y-1.5">
                  {toc.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="block text-xs text-text2 hover:text-text leading-relaxed py-0.5"
                    >
                      {item.text}
                    </a>
                  ))}
                </nav>
              </div>
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
