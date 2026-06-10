import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { PageBody, PageHeader } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import {
  FUNNEL_POSITIONS,
  POSITION_LABEL,
  isFunnelPosition,
} from "@/lib/funnel/positions";

// ── Server action: define/atualiza/remove a posição de uma oferta ──
async function setMapping(formData: FormData) {
  "use server";
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "funnel")) redirect("/?error=no_access");
  const sb = createSupabaseAdmin();

  const offerId = String(formData.get("gateway_offer_id") ?? "").trim();
  const productId = String(formData.get("gateway_product_id") ?? "").trim() || null;
  const productName = String(formData.get("product_name") ?? "").trim() || null;
  const offerName = String(formData.get("offer_name") ?? "").trim() || null;
  const position = String(formData.get("funnel_position") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim().replace(",", ".");
  const price = priceRaw && Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null;

  if (!offerId) redirect("/funil/mapeamento?error=missing_offer");

  // Sempre limpa a regra anterior dessa oferta (idempotente, evita duplicata)
  await sb.from("funnel_mapping").delete().eq("gateway", "assiny").eq("gateway_offer_id", offerId);

  if (position && isFunnelPosition(position)) {
    await sb.from("funnel_mapping").insert({
      gateway: "assiny",
      gateway_product_id: productId,
      gateway_offer_id: offerId,
      funnel_position: position,
      product_name: productName,
      offer_name: offerName,
      price,
    });
    await logAudit({
      actor: auth.email,
      action: "funnel.map_set",
      target: offerId,
      payload: { position, product_name: productName, price },
    });
  } else {
    await logAudit({
      actor: auth.email,
      action: "funnel.map_unset",
      target: offerId,
      payload: { product_name: productName },
    });
  }

  revalidatePath("/funil/mapeamento");
  revalidatePath("/funil");
  redirect("/funil/mapeamento?saved=1");
}

type ProductRel = { name: string | null; gateway_ids: Record<string, string> | null } | null;
interface PurchaseRow {
  gateway_offer_id: string | null;
  gateway_offer_name: string | null;
  product_id: string | null;
  products: ProductRel | ProductRel[];
}
interface MappingRow {
  gateway_offer_id: string | null;
  funnel_position: string;
  price: number | null;
}

interface OfferRow {
  offerId: string;
  offerName: string | null;
  productName: string | null;
  gatewayProductId: string | null;
  count: number;
  position: string | null;
  price: number | null;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "funnel")) redirect("/?error=no_access");
  const sp = await searchParams;
  const sb = createSupabaseAdmin();

  const [{ data: purchRaw }, { data: mapRaw }] = await Promise.all([
    sb
      .from("purchases")
      .select("gateway_offer_id, gateway_offer_name, product_id, products(name, gateway_ids)")
      .eq("gateway", "assiny")
      .not("gateway_offer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(20000),
    sb
      .from("funnel_mapping")
      .select("gateway_offer_id, funnel_position, price")
      .eq("gateway", "assiny")
      .eq("active", true)
      .limit(5000),
  ]);

  const mapByOffer = new Map<string, MappingRow>();
  for (const m of (mapRaw ?? []) as MappingRow[]) {
    if (m.gateway_offer_id) mapByOffer.set(m.gateway_offer_id, m);
  }

  // Dedupe ofertas vistas nas vendas (mais recente primeiro)
  const byOffer = new Map<string, OfferRow>();
  for (const p of (purchRaw ?? []) as unknown as PurchaseRow[]) {
    const offerId = p.gateway_offer_id;
    if (!offerId) continue;
    const existing = byOffer.get(offerId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const m = mapByOffer.get(offerId);
    const prod = Array.isArray(p.products) ? p.products[0] : p.products;
    byOffer.set(offerId, {
      offerId,
      offerName: p.gateway_offer_name,
      productName: prod?.name ?? null,
      gatewayProductId: prod?.gateway_ids?.assiny ?? null,
      count: 1,
      position: m?.funnel_position ?? null,
      price: m?.price ?? null,
    });
  }
  const offers = [...byOffer.values()].sort((a, b) => {
    // não mapeadas primeiro, depois por volume
    if ((a.position == null) !== (b.position == null)) return a.position == null ? -1 : 1;
    return b.count - a.count;
  });

  const mapped = offers.filter((o) => o.position).length;

  return (
    <>
      <PageHeader
        title="Mapeamento de Funil"
        subtitle="Associe cada oferta da Assiny à posição no funil. Alimenta o KPI Funil."
        right={
          <div className="flex items-center gap-2">
            <span className="chip"><span className="dot bg-accent" /> {mapped}/{offers.length} mapeadas</span>
            <Link href="/funil" className="btn btn-sm btn-ghost">← KPI Funil</Link>
          </div>
        }
      />
      <PageBody>
        {sp.saved && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            Mapeamento salvo.
          </div>
        )}
        {sp.error === "missing_offer" && (
          <div className="card border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            Oferta inválida.
          </div>
        )}

        <div className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-medium">Ofertas vistas nas vendas</h2>
            <span className="text-2xs text-muted uppercase tracking-wider">Assiny · últimas 20k vendas</span>
          </header>
          {offers.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">
              Nenhuma oferta Assiny encontrada nas vendas ainda.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-2xs uppercase tracking-wider text-muted border-b border-line bg-surface2/30">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Produto / Oferta</th>
                    <th className="text-right font-medium px-4 py-2.5 w-20">Vendas</th>
                    <th className="text-left font-medium px-4 py-2.5 w-48">Posição no funil</th>
                    <th className="text-left font-medium px-4 py-2.5 w-32">Preço R$</th>
                    <th className="text-right font-medium px-4 py-2.5 w-24"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {offers.map((o) => (
                    <tr key={o.offerId} className={`hover:bg-surface2/30 transition ${o.position ? "" : "bg-warn/5"}`}>
                      <td className="px-4 py-2.5">
                        <div className="text-sm">{o.productName ?? "(produto desconhecido)"}</div>
                        <div className="text-2xs text-muted">{o.offerName ?? "—"}</div>
                        <div className="text-2xs text-muted font-mono">{o.offerId}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted">{o.count}</td>
                      <td className="px-4 py-2.5" colSpan={3}>
                        <form action={setMapping} className="flex items-center gap-2">
                          <input type="hidden" name="gateway_offer_id" value={o.offerId} />
                          <input type="hidden" name="gateway_product_id" value={o.gatewayProductId ?? ""} />
                          <input type="hidden" name="product_name" value={o.productName ?? ""} />
                          <input type="hidden" name="offer_name" value={o.offerName ?? ""} />
                          <select name="funnel_position" defaultValue={o.position ?? ""} className="input w-48">
                            <option value="">— não mapeado —</option>
                            {FUNNEL_POSITIONS.map((p) => (
                              <option key={p} value={p}>{POSITION_LABEL[p]}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            name="price"
                            defaultValue={o.price != null ? String(o.price) : ""}
                            placeholder="0,00"
                            className="input w-24"
                          />
                          <SubmitButton pendingLabel="Salvando">Salvar</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-2xs text-muted">
          Dica: ofertas <strong>não mapeadas</strong> (fundo amarelo) ficam fora do KPI Funil até receberem uma posição.
          Posições: Produto Principal, Order 01-05 (bumps), Upsell 01-02, Downsell 01-02.
        </p>
      </PageBody>
    </>
  );
}
