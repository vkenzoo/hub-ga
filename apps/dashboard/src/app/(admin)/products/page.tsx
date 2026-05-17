import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/page";

interface ProductRow {
  id: string;
  name: string;
  billing_type: string;
  gateway_ids: Record<string, string> | null;
  requires_app_access: boolean;
}

const BILLING: Record<string, string> = {
  one_time: "Avulso",
  recurring_monthly: "Mensal",
  recurring_yearly: "Anual",
};

async function createProduct(formData: FormData) {
  "use server";
  const sb = createSupabaseAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const billing_type = String(formData.get("billing_type") ?? "one_time");
  if (!name) return;
  const { data } = await sb
    .from("products")
    .insert({ name, billing_type, gateway_ids: {}, requires_app_access: true })
    .select("id")
    .single();
  revalidatePath("/products");
  if (data?.id) redirect(`/products/${data.id}`);
}

export default async function Page() {
  const sb = createSupabaseAdmin();
  const { data } = await sb.from("products").select("*").order("name");
  const products = (data ?? []) as ProductRow[];

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle={`${products.length} no catálogo. Cada produto agrupa entitlements que liberam acesso.`}
      />

      <PageBody>
        {/* Create form */}
        <form action={createProduct} className="card p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <span className="label block mb-1.5">Novo produto</span>
            <input
              name="name"
              required
              placeholder="Ex: Gerador de Vendas Automáticas"
              className="input"
            />
          </div>
          <div className="w-44">
            <span className="label block mb-1.5">Cobrança</span>
            <select name="billing_type" className="input">
              <option value="one_time">Avulso</option>
              <option value="recurring_monthly">Mensal</option>
              <option value="recurring_yearly">Anual</option>
            </select>
          </div>
          <button className="btn btn-primary">Criar produto</button>
        </form>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {products.map((p) => {
            const aOk = p.gateway_ids?.assiny && p.gateway_ids.assiny !== "TODO";
            const hOk = p.gateway_ids?.hotmart && p.gateway_ids.hotmart !== "TODO";
            return (
              <Link
                key={p.id}
                href={`/products/${p.id}`}
                className="card p-4 hover:border-line2 hover:bg-surface2 transition group"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h3 className="text-sm font-medium leading-snug flex-1 min-w-0">{p.name}</h3>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0 group-hover:text-text"><path d="m9 18 6-6-6-6"/></svg>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  <span className="chip">
                    <span className="dot bg-info" /> {BILLING[p.billing_type] ?? p.billing_type}
                  </span>
                  {p.requires_app_access && (
                    <span className="chip">
                      <span className="dot bg-accent" /> SaaS
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="label">Assiny</div>
                    <div className={`font-mono text-xs mt-0.5 truncate ${aOk ? "text-text2" : "text-muted"}`}>
                      {aOk ? p.gateway_ids?.assiny : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="label">Hotmart</div>
                    <div className={`font-mono text-xs mt-0.5 truncate ${hOk ? "text-text2" : "text-muted"}`}>
                      {hOk ? p.gateway_ids?.hotmart : "—"}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
          {products.length === 0 && (
            <p className="text-sm text-muted">Nenhum produto cadastrado.</p>
          )}
        </div>
      </PageBody>
    </>
  );
}
