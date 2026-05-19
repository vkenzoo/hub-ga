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
  logo_url: string | null;
  primary_color: string | null;
  reply_to_email: string | null;
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
  const color = String(formData.get("primary_color") ?? "").trim();
  const patch = {
    name: String(formData.get("name") ?? "").trim(),
    supabase_url: String(formData.get("supabase_url") ?? "").trim(),
    service_key_env: String(formData.get("service_key_env") ?? "").trim(),
    base_app_url: String(formData.get("base_app_url") ?? "").trim(),
    logo_url: String(formData.get("logo_url") ?? "").trim() || null,
    primary_color: /^#[0-9a-f]{3,8}$/i.test(color) ? color : null,
    reply_to_email: String(formData.get("reply_to_email") ?? "").trim() || null,
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

              <details className="border-t border-line group">
                <summary className="px-5 py-2.5 cursor-pointer list-none flex items-center justify-between text-sm text-text2 hover:bg-surface2 transition">
                  <span>Branding do email de boas-vindas</span>
                  <span className="text-2xs text-muted">expandir / recolher</span>
                </summary>
                <div className="p-5 border-t border-line grid grid-cols-1 md:grid-cols-2 gap-4 bg-surface2/30">
                  <Field
                    name="logo_url"
                    label="URL pública da logo"
                    defaultValue={s.logo_url ?? ""}
                    placeholder="https://app.exemplo.com/logo.png"
                    mono
                  />
                  <Field
                    name="primary_color"
                    label="Cor primária (hex)"
                    defaultValue={s.primary_color ?? "#ec2d7c"}
                    placeholder="#ec2d7c"
                    mono
                  />
                  <Field
                    name="reply_to_email"
                    label="Reply-To"
                    defaultValue={s.reply_to_email ?? ""}
                    placeholder="contato@exemplo.com"
                    mono
                  />
                  <div className="text-2xs text-muted self-end pb-1">
                    Cliente vê logo, botão na cor escolhida e responder vai pro Reply-To.
                  </div>
                </div>
              </details>

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
