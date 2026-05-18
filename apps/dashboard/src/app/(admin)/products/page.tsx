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
  pending_config: boolean;
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
  const drafts = products.filter((p) => p.pending_config);
  const live = products.filter((p) => !p.pending_config);

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle={`${live.length} ativos${drafts.length > 0 ? ` · ${drafts.length} aguardando configuração` : ""}.`}
        right={
          drafts.length > 0 ? (
            <span className="chip text-warn">
              <span className="dot bg-warn" /> {drafts.length} rascunho{drafts.length === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
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

        {/* Drafts */}
        {drafts.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">Descobertos via webhook</h2>
              <p className="text-xs text-muted">
                Auto-cadastrados quando uma venda chegou. Configure entitlements pra liberar acesso.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {drafts.map((p) => (
                <ProductCard key={p.id} p={p} />
              ))}
            </div>
          </section>
        )}

        {/* Live */}
        {live.length > 0 && (
          <section>
            {drafts.length > 0 && (
              <h2 className="text-sm font-medium mb-3">Catálogo configurado</h2>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {live.map((p) => (
                <ProductCard key={p.id} p={p} />
              ))}
            </div>
          </section>
        )}

        {products.length === 0 && (
          <p className="text-sm text-muted">Nenhum produto cadastrado.</p>
        )}
      </PageBody>
    </>
  );
}

function ProductCard({ p }: { p: ProductRow }) {
  const aOk = p.gateway_ids?.assiny && p.gateway_ids.assiny !== "TODO";
  const hOk = p.gateway_ids?.hotmart && p.gateway_ids.hotmart !== "TODO";
  return (
    <Link
      href={`/products/${p.id}`}
      className={`card p-4 hover:border-line2 hover:bg-surface2 transition group ${
        p.pending_config ? "border-warn/40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-sm font-medium leading-snug flex-1 min-w-0">{p.name}</h3>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0 group-hover:text-text"><path d="m9 18 6-6-6-6"/></svg>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {p.pending_config && (
          <span className="chip text-warn">
            <span className="dot bg-warn" /> Aguardando configuração
          </span>
        )}
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
}
