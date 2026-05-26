/**
 * POST /api/meta/sync/[id]
 *
 * Dispara sync manual de 1 conexão Meta. Auth via admin session (cookie).
 * Sem cron secret aqui — esse é o disparo do botão na UI.
 */
import { NextResponse } from "next/server";
import { requireAdmin, canAccessSection } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { syncMetaConnection } from "@/lib/meta/sync";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  try {
    const result = await syncMetaConnection(sb, id, 30);

    await logAudit({
      actor: auth.email,
      action: "meta.sync.manual",
      target: id,
      payload: {
        ad_accounts_processed: result.ad_accounts_processed,
        rows_upserted: result.rows_upserted,
        errors: result.errors.length,
      },
    });

    revalidatePath("/connections/meta-ads");
    revalidatePath("/acquisition");

    return NextResponse.json(result);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[meta/sync] failed:", e);
    return NextResponse.json({ error: "sync_failed", detail }, { status: 500 });
  }
}
