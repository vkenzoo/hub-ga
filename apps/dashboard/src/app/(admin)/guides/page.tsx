import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/page";
import { getGuidesByCategory, CATEGORY_LABEL, GUIDES } from "@/content/guides";

function fmtDate(iso: string): string {
  return new Date(iso + "T03:00:00.000Z").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export default async function Page() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "guides")) {
    redirect("/?error=no_access");
  }

  const grouped = getGuidesByCategory();

  return (
    <>
      <PageHeader
        title="Guias"
        subtitle={`${GUIDES.length} guia${GUIDES.length === 1 ? "" : "s"} pra equipe. Atualizado conforme o sistema evolui.`}
      />
      <PageBody>
        {grouped.length === 0 ? (
          <div className="card p-8 text-center text-sm text-muted">
            Nenhum guia disponível.
          </div>
        ) : (
          grouped.map(({ category, guides }) => (
            <section key={category}>
              <h2 className="label mb-3">{CATEGORY_LABEL[category]}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {guides.map((g) => (
                  <Link
                    key={g.slug}
                    href={`/guides/${g.slug}`}
                    className="card p-4 hover:border-line2 hover:bg-surface2 transition group"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-sm font-medium leading-snug flex-1 min-w-0">
                        {g.title}
                      </h3>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0 group-hover:text-text"><path d="m9 18 6-6-6-6"/></svg>
                    </div>
                    <p className="text-xs text-muted leading-relaxed">{g.summary}</p>
                    <div className="text-2xs text-muted mt-3 uppercase tracking-wider">
                      Atualizado em {fmtDate(g.updatedAt)}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </PageBody>
    </>
  );
}
