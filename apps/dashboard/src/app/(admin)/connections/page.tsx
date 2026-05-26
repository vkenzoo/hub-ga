import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

interface CardConfig {
  href: string;
  title: string;
  description: string;
  iconBg: string;
  icon: React.ReactNode;
  count: number;
}

export default async function Page() {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "connections")) {
    redirect("/?error=no_access");
  }

  const sb = createSupabaseAdmin();
  const [{ data: connections }, { data: outbound }, { data: surveyForms }, { data: metaConns }] = await Promise.all([
    sb.from("connections").select("kind"),
    sb.from("outbound_webhooks").select("id"),
    sb.from("survey_responses").select("form_id"),
    sb.from("meta_connections").select("id"),
  ]);

  const conns = (connections ?? []) as Array<{ kind: string }>;
  const byKind = conns.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});
  const metaConnCount = (metaConns ?? []).length;

  // Conta forms únicos do Respondi (cada form configurado = 1 conexão lógica)
  const respondiForms = new Set<string>();
  for (const r of (surveyForms ?? []) as Array<{ form_id: string }>) {
    if (r.form_id) respondiForms.add(r.form_id);
  }

  const cards: CardConfig[] = [
    {
      href: "/connections/meta-ads",
      title: "Meta Ads",
      description: "Conecte Business Managers via Marketing API pra analisar tráfego.",
      iconBg: "bg-info/10 text-info",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V14H8v-2h2V9.5C10 7.57 11.57 6 13.5 6H16v2h-2c-.55 0-1 .45-1 1v3h3l-.5 2H13v7.95c5.05-.5 9-4.76 9-9.95C22 6.48 17.52 2 12 2z"/></svg>
      ),
      count: metaConnCount,
    },
    {
      href: "/connections/inlead",
      title: "InLead",
      description: "Receba leads via webhook do Make/InLead numa URL única.",
      iconBg: "bg-warn/10 text-warn",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>
      ),
      count: byKind.inlead ?? 0,
    },
    {
      href: "/connections/cademi",
      title: "Cademí",
      description: "API key da Cademí pra sincronizar cursos e matrículas.",
      iconBg: "bg-accent/10 text-accent",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
      ),
      count: byKind.cademi ?? 0,
    },
    {
      href: respondiForms.size > 0 ? "/surveys" : "/surveys/setup",
      title: "Respondi.app",
      description: "Recebe respostas de pesquisas via webhook e qualifica leads automaticamente.",
      iconBg: "bg-warn/10 text-warn",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      ),
      count: respondiForms.size,
    },
    {
      href: "/connections/outbound",
      title: "Webhooks de saída",
      description: "URLs externas que o hub vai chamar quando eventos acontecerem.",
      iconBg: "bg-brand/10 text-brand",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 16.98-5.99.01a6 6 0 1 1-3.59-10.74"/><path d="m12 12-2.43 5.05"/><circle cx="6.18" cy="17.18" r="2.18"/><circle cx="17.82" cy="17.18" r="2.18"/><circle cx="12" cy="6.82" r="2.18"/></svg>
      ),
      count: (outbound ?? []).length,
    },
  ];

  return (
    <>
      <PageHeader
        title="Conexões"
        subtitle="Integre o hub com ferramentas externas e configure webhooks de saída."
      />
      <PageBody>
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="card p-5 hover:border-line2 hover:bg-surface2 transition group flex items-start gap-4"
            >
              <div className={`w-11 h-11 rounded-md grid place-items-center shrink-0 ${c.iconBg}`}>
                {c.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="text-sm font-medium leading-tight">{c.title}</h3>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0 group-hover:text-text"><path d="m9 18 6-6-6-6"/></svg>
                </div>
                <p className="text-xs text-muted leading-relaxed">{c.description}</p>
                <div className="mt-3">
                  {c.count > 0 ? (
                    <span className="chip">
                      <span className="dot bg-accent" />
                      {c.count} {c.count === 1 ? "configurado" : "configurados"}
                    </span>
                  ) : (
                    <span className="chip text-muted">
                      <span className="dot bg-text2" />
                      Não configurado
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </section>
      </PageBody>
    </>
  );
}
