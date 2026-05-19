import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { marked } from "marked";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/page";
import { findGuide, CATEGORY_LABEL } from "@/content/guides";

// Configura marked: headings com id (pra anchor links), code blocks com linguagem,
// links abertos em nova aba quando externos
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

  const html = await marked.parse(guide.content);

  return (
    <>
      <PageHeader
        title={guide.title}
        subtitle={`${CATEGORY_LABEL[guide.category]} · Atualizado em ${fmtDate(guide.updatedAt)}`}
        right={
          <Link href="/guides" className="btn btn-sm">
            ← Guias
          </Link>
        }
      />
      <PageBody>
        <article
          className="card p-6 md:p-8 prose-guide"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <p className="text-2xs text-muted text-center">
          Esse guia é mantido no código. Pra atualizar, peça via Claude.
        </p>
      </PageBody>
    </>
  );
}
