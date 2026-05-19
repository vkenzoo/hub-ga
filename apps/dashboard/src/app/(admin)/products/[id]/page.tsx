import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";

type DurationMode = "lifetime" | "follow_subscription" | "fixed_days";

type ProductRole = "acquisition" | "monetization" | "other";

interface ProductRow {
  id: string;
  name: string;
  billing_type: string;
  gateway_ids: Record<string, string> | null;
  requires_app_access: boolean;
  pending_config: boolean;
  role: ProductRole;
}
interface SystemRow { id: string; slug: string; name: string }
interface EntitlementRow {
  id: string;
  kind: "system_access" | "cademi_course";
  system_id: string | null;
  tier: string | null;
  cademi_course_id: string | null;
  duration_mode: DurationMode;
  duration_days: number | null;
}

// ────────────────────────────────────────────────────────
// Presets de duração — só select, nada de digitar
// ────────────────────────────────────────────────────────
const DURATION_PRESETS: Array<{ value: string; label: string }> = [
  { value: "lifetime", label: "Acesso pra sempre" },
  { value: "follow_subscription", label: "Enquanto a assinatura estiver paga" },
  { value: "7", label: "7 dias" },
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
  { value: "60", label: "60 dias" },
  { value: "90", label: "90 dias (3 meses)" },
  { value: "180", label: "180 dias (6 meses)" },
  { value: "365", label: "365 dias (1 ano)" },
  { value: "730", label: "730 dias (2 anos)" },
];

function entitlementToPreset(e: { duration_mode: DurationMode; duration_days: number | null }): string {
  if (e.duration_mode === "lifetime") return "lifetime";
  if (e.duration_mode === "follow_subscription") return "follow_subscription";
  return String(e.duration_days ?? 30);
}

function presetToDuration(value: string): { duration_mode: DurationMode; duration_days: number | null } {
  if (value === "lifetime") return { duration_mode: "lifetime", duration_days: null };
  if (value === "follow_subscription") return { duration_mode: "follow_subscription", duration_days: null };
  const n = parseInt(value, 10);
  return { duration_mode: "fixed_days", duration_days: Number.isFinite(n) ? n : 30 };
}

function presetLabel(e: EntitlementRow): string {
  const preset = entitlementToPreset(e);
  return DURATION_PRESETS.find((p) => p.value === preset)?.label ?? "—";
}

// ────────────────────────────────────────────────────────
// Server actions
// ────────────────────────────────────────────────────────
async function updateProduct(formData: FormData) {
  "use server";
  const sb = createSupabaseAdmin();
  const id = String(formData.get("id"));
  const role = String(formData.get("role") ?? "other") as ProductRole;
  const validRole: ProductRole =
    role === "acquisition" || role === "monetization" || role === "other" ? role : "other";
  await sb
    .from("products")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      billing_type: String(formData.get("billing_type") ?? "one_time"),
      requires_app_access: formData.get("requires_app_access") === "on",
      role: validRole,
      gateway_ids: {
        assiny: String(formData.get("assiny_id") ?? "").trim(),
        hotmart: String(formData.get("hotmart_id") ?? "").trim(),
      },
    })
    .eq("id", id);
  revalidatePath(`/products/${id}`);
  revalidatePath("/products");
  revalidatePath("/acquisition");
}

async function markConfigured(formData: FormData) {
  "use server";
  const sb = createSupabaseAdmin();
  const id = String(formData.get("id"));
  await sb.from("products").update({ pending_config: false }).eq("id", id);
  revalidatePath(`/products/${id}`);
  revalidatePath("/products");
}

async function deleteProduct(formData: FormData) {
  "use server";
  const sb = createSupabaseAdmin();
  await sb.from("products").delete().eq("id", String(formData.get("id")));
  revalidatePath("/products");
  redirect("/products");
}

async function addEntitlement(formData: FormData) {
  "use server";
  const sb = createSupabaseAdmin();
  const product_id = String(formData.get("product_id"));
  const kind = String(formData.get("kind"));
  const duration = presetToDuration(String(formData.get("duration_preset") ?? "lifetime"));
  if (kind === "system_access") {
    await sb.from("entitlements").insert({
      product_id,
      kind: "system_access",
      system_id: String(formData.get("system_id")),
      tier: String(formData.get("tier") ?? "full"),
      ...duration,
    });
  } else {
    await sb.from("entitlements").insert({
      product_id,
      kind: "cademi_course",
      cademi_course_id: String(formData.get("cademi_course_id") ?? "").trim(),
      ...duration,
    });
  }
  revalidatePath(`/products/${product_id}`);
}

async function updateEntitlementDuration(formData: FormData) {
  "use server";
  const sb = createSupabaseAdmin();
  const id = String(formData.get("id"));
  const product_id = String(formData.get("product_id"));
  const duration = presetToDuration(String(formData.get("duration_preset") ?? "lifetime"));
  await sb.from("entitlements").update(duration).eq("id", id);
  revalidatePath(`/products/${product_id}`);
}

async function removeEntitlement(formData: FormData) {
  "use server";
  const sb = createSupabaseAdmin();
  const id = String(formData.get("id"));
  const product_id = String(formData.get("product_id"));
  await sb.from("entitlements").delete().eq("id", id);
  revalidatePath(`/products/${product_id}`);
}

// ────────────────────────────────────────────────────────
// Componente
// ────────────────────────────────────────────────────────
const TIER_OPTIONS = [
  { value: "full", label: "full — acesso completo" },
  { value: "limited_100", label: "limited_100 — 100 ofertas (BLACKBELT)" },
  { value: "unlimited", label: "unlimited — ilimitado (BLACKBELT)" },
];

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createSupabaseAdmin();
  const [{ data: product }, { data: systems }, { data: entitlements }] = await Promise.all([
    sb.from("products").select("*").eq("id", id).maybeSingle(),
    sb.from("systems").select("id,slug,name").order("slug"),
    sb.from("entitlements").select("*").eq("product_id", id),
  ]);

  if (!product) notFound();
  const p = product as ProductRow;
  const sys = (systems ?? []) as SystemRow[];
  // Mostra só entitlements de sistema SaaS — Cademí é gerenciado lá, não aqui.
  const ents = ((entitlements ?? []) as EntitlementRow[]).filter((e) => e.kind === "system_access");
  const systemById = new Map(sys.map((s) => [s.id, s] as const));

  const defaultPreset = p.billing_type === "one_time" ? "lifetime" : "follow_subscription";

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle="Edição de produto e o que ele libera quando vendido."
        right={
          <Link href="/products" className="btn btn-sm">
            ← Voltar
          </Link>
        }
      />

      <PageBody>
        {/* Banner de configuração pendente */}
        {p.pending_config && (
          <div className="card border-warn/40 bg-warn/5 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-warn font-medium">Produto descoberto via webhook</div>
              <p className="text-xs text-text2 mt-0.5">
                Nome, gateway e ID já preenchidos pelo webhook. Configure abaixo os entitlements
                (sistema/tier/duração) e marque como configurado pra liberar provisionamento automático
                nas próximas vendas.
              </p>
            </div>
            <form action={markConfigured} className="shrink-0">
              <input type="hidden" name="id" value={p.id} />
              <button className="btn btn-sm btn-primary">Marcar como configurado</button>
            </form>
          </div>
        )}

        {/* Dados do produto */}
        <form action={updateProduct} className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Dados do produto</h2>
          </header>
          <input type="hidden" name="id" value={p.id} />

          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field name="name" label="Nome" defaultValue={p.name} required />
            <label className="block">
              <span className="label block mb-1.5">Tipo de cobrança</span>
              <select name="billing_type" defaultValue={p.billing_type} className="input">
                <option value="one_time">Avulso (compra única)</option>
                <option value="recurring_monthly">Mensal (recorrente)</option>
                <option value="recurring_yearly">Anual (recorrente)</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="label block mb-1.5">Categoria de receita</span>
              <select name="role" defaultValue={p.role} className="input">
                <option value="acquisition">Aquisição — vai pro dash de aquisição</option>
                <option value="monetization">Monetização — futuro dash separado</option>
                <option value="other">Outro / não classificado</option>
              </select>
              <p className="text-2xs text-muted mt-1.5">
                Vendas desse produto só aparecem no dash da categoria escolhida.
              </p>
            </label>
            <Field
              name="assiny_id"
              label="ID do produto no Assiny"
              defaultValue={p.gateway_ids?.assiny ?? ""}
              placeholder="ex: prod_abc123"
              mono
            />
            <Field
              name="hotmart_id"
              label="ID do produto no Hotmart"
              defaultValue={p.gateway_ids?.hotmart ?? ""}
              placeholder="ex: 999888"
              mono
            />
            <label className="flex items-center gap-2.5 text-sm md:col-span-2">
              <input
                type="checkbox"
                name="requires_app_access"
                defaultChecked={p.requires_app_access}
                className="rounded border-line bg-surface text-accent focus:ring-accent/40 focus:ring-offset-0"
              />
              <span>Esse produto libera acesso em algum sistema SaaS</span>
            </label>
          </div>

          <footer className="px-4 py-3 border-t border-line flex justify-end">
            <button className="btn btn-primary btn-sm">Salvar alterações</button>
          </footer>
        </form>

        {/* O que esse produto libera */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">O que esse produto libera quando vendido</h2>
            <p className="text-xs text-muted mt-1">
              Acesso aos seus sistemas SaaS. A Cademí já libera os cursos sozinha pela integração nativa
              com Assiny/Hotmart — não precisa configurar aqui.
            </p>
          </header>

          <ul className="divide-y divide-line">
            {ents.map((e) => (
              <li key={e.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_280px_auto] items-center gap-3">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  {e.kind === "system_access" ? (
                    <>
                      <span className="chip"><span className="dot bg-accent" /> Sistema</span>
                      <span className="text-sm">
                        {systemById.get(e.system_id ?? "")?.name ?? e.system_id}
                      </span>
                      <span className="chip">nível: <span className="font-mono text-text">{e.tier}</span></span>
                    </>
                  ) : (
                    <>
                      <span className="chip"><span className="dot bg-info" /> Curso Cademí</span>
                      <span className="font-mono text-xs text-text2">{e.cademi_course_id}</span>
                    </>
                  )}
                </div>

                <form action={updateEntitlementDuration} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="product_id" value={p.id} />
                  <select
                    name="duration_preset"
                    defaultValue={entitlementToPreset(e)}
                    className="input"
                    aria-label="Duração do acesso"
                  >
                    {DURATION_PRESETS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-sm"
                    title="Aplicar nova duração"
                    aria-label="Salvar duração"
                  >
                    ✓
                  </button>
                </form>

                <form action={removeEntitlement}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="product_id" value={p.id} />
                  <button className="btn btn-sm btn-ghost text-muted hover:text-danger" title="Remover">
                    ✕
                  </button>
                </form>

                {/* Linha auxiliar mostrando a duração atual em texto */}
                <div className="md:col-span-3 text-xs text-muted">
                  Hoje:{" "}
                  <span className="text-text2">{presetLabel(e)}</span>
                </div>
              </li>
            ))}
            {ents.length === 0 && (
              <li className="px-4 py-6 text-sm text-muted">
                Esse produto ainda não libera nada. Adicione abaixo.
              </li>
            )}
          </ul>

          {/* Adicionar — escondido até clicar */}
          <details className="border-t border-line group">
            <summary className="px-4 py-3 cursor-pointer list-none flex items-center gap-2 text-sm text-text2 hover:text-text hover:bg-surface2 transition">
              <span className="inline-block w-4 h-4 grid place-items-center rounded border border-line group-open:border-accent group-open:text-accent transition">
                <span className="inline-block group-open:hidden">+</span>
                <span className="hidden group-open:inline">−</span>
              </span>
              Adicionar acesso a um sistema
            </summary>
            <form
              action={addEntitlement}
              className="p-4 border-t border-line grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end bg-surface2/40"
            >
              <input type="hidden" name="product_id" value={p.id} />
              <input type="hidden" name="kind" value="system_access" />
              <label className="block">
                <span className="label block mb-1.5">Sistema</span>
                <select name="system_id" className="input" required>
                  {sys.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label block mb-1.5">Nível</span>
                <select name="tier" className="input" defaultValue="full">
                  {TIER_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label block mb-1.5">Duração</span>
                <select name="duration_preset" defaultValue={defaultPreset} className="input">
                  {DURATION_PRESETS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary btn-sm">Adicionar</button>
            </form>
          </details>
        </section>

        {/* Danger */}
        <section className="card border-danger/30">
          <header className="px-4 py-3 border-b border-danger/30 flex items-center justify-between">
            <h2 className="text-sm font-medium text-danger">Zona perigosa</h2>
          </header>
          <div className="p-4 flex items-center justify-between gap-4">
            <p className="text-sm text-text2">
              Excluir o produto remove também o que ele libera. Vendas históricas permanecem por FK.
            </p>
            <form action={deleteProduct}>
              <input type="hidden" name="id" value={p.id} />
              <button className="btn btn-sm btn-danger">Excluir produto</button>
            </form>
          </div>
        </section>
      </PageBody>
    </>
  );
}
