import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";

interface SystemRow {
  id: string;
  slug: string;
  name: string;
  supabase_url: string;
  service_key_env: string;
  base_app_url: string;
}

async function listSystems(): Promise<SystemRow[]> {
  const sb = createSupabaseAdmin();
  const { data } = await sb.from("systems").select("*").order("slug");
  return (data ?? []) as SystemRow[];
}

async function updateSystem(formData: FormData) {
  "use server";
  const sb = createSupabaseAdmin();
  const id = String(formData.get("id"));
  const patch = {
    name: String(formData.get("name") ?? "").trim(),
    supabase_url: String(formData.get("supabase_url") ?? "").trim(),
    service_key_env: String(formData.get("service_key_env") ?? "").trim(),
    base_app_url: String(formData.get("base_app_url") ?? "").trim(),
  };
  await sb.from("systems").update(patch).eq("id", id);
  revalidatePath("/systems");
}

function isConfigured(s: SystemRow) {
  return (
    s.supabase_url &&
    !s.supabase_url.includes("TODO") &&
    s.service_key_env &&
    s.base_app_url
  );
}

export default async function Page() {
  const systems = await listSystems();
  const configured = systems.filter(isConfigured).length;

  return (
    <>
      <PageHeader
        title="Sistemas"
        subtitle="SaaS downstream onde o hub provisiona acesso. Service_role keys vivem em env vars."
        right={
          <span className="chip">
            {configured}/{systems.length} configurados
          </span>
        }
      />

      <PageBody>
        {systems.map((s) => {
          const ok = isConfigured(s);
          return (
            <form key={s.id} action={updateSystem} className="card">
              <input type="hidden" name="id" value={s.id} />

              <header className="px-5 py-3 border-b border-line flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-surface2 border border-line grid place-items-center text-text2 text-sm font-mono">
                  {s.slug[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium">{s.name || s.slug}</h2>
                    <code className="text-xs text-muted font-mono">slug: {s.slug}</code>
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {ok ? "Pronto pra provisionar" : "Faltam dados de conexão"}
                  </div>
                </div>
                <span className={`chip ${ok ? "text-accent" : "text-warn"}`}>
                  <span className={`dot ${ok ? "bg-accent" : "bg-warn"}`} />
                  {ok ? "OK" : "Pendente"}
                </span>
              </header>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field name="name" label="Nome" defaultValue={s.name} required />
                <Field
                  name="base_app_url"
                  label="URL pública (login)"
                  defaultValue={s.base_app_url}
                  placeholder="https://app.exemplo.com"
                  mono
                />
                <Field
                  name="supabase_url"
                  label="URL do Supabase"
                  defaultValue={s.supabase_url}
                  placeholder="https://xxx.supabase.co"
                  mono
                />
                <Field
                  name="service_key_env"
                  label="Env var da service_role"
                  defaultValue={s.service_key_env}
                  placeholder="SCALO_SERVICE_ROLE_KEY"
                  mono
                />
              </div>

              <footer className="px-5 py-3 border-t border-line flex items-center justify-between">
                <span className="text-xs text-muted">
                  O valor da key vive no Vercel/.env.local, nunca aqui.
                </span>
                <button className="btn btn-primary btn-sm">Salvar</button>
              </footer>
            </form>
          );
        })}
        {systems.length === 0 && (
          <p className="text-sm text-muted">Nenhum sistema cadastrado.</p>
        )}
      </PageBody>
    </>
  );
}
