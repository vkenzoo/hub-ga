import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/page";
import {
  GUIDES,
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  CATEGORY_DESC,
  CATEGORY_COLOR,
  estimateReadMinutes,
  isRecent,
} from "@/content/guides";
import { GuidesBrowser } from "./guides-browser";

const CATEGORY_ORDER = [
  "operacao",
  "vendas",
  "produtos",
  "equipe",
  "integracoes",
  "emails",
] as const;

export default async function Page() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "guides")) {
    redirect("/?error=no_access");
  }

  const guides = GUIDES.map((g) => ({
    ...g,
    readMinutes: estimateReadMinutes(g.content),
    recent: isRecent(g.updatedAt),
  })).sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));

  return (
    <>
      <PageHeader
        title="Guias"
        subtitle="Documentação interna do time. Edita via código — sempre em sincronia com o sistema."
      />
      <PageBody>
        <GuidesBrowser
          guides={guides}
          categoryOrder={[...CATEGORY_ORDER]}
          categoryLabel={CATEGORY_LABEL}
          categoryShort={CATEGORY_SHORT}
          categoryDesc={CATEGORY_DESC}
          categoryColor={CATEGORY_COLOR}
        />
      </PageBody>
    </>
  );
}
