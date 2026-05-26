/**
 * DELETE /api/meta/disconnect/[id]
 *
 * Remove conexão Meta. Cascade apaga ad_accounts.
 */
import { NextResponse } from "next/server";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!canAccessSection(auth, "connections")) {
    return NextResponse.json({ error: "no_access" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const sb = createSupabaseAdmin();

  const { data: before } = await sb
    .from("meta_connections")
    .select("business_manager_id, business_manager_name")
    .eq("id", id)
    .maybeSingle();

  await sb.from("meta_connections").delete().eq("id", id);

  await logAudit({
    actor: auth.email,
    action: "meta.delete",
    target: id,
    payload: { previous: before ?? null },
  });

  revalidatePath("/connections");
  revalidatePath("/connections/meta-ads");

  return NextResponse.json({ ok: true, removed: before ?? null });
}
