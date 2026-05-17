import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EffectiveEntitlementRow {
  customer_id: string;
  kind: "system_access" | "cademi_course";
  system_id: string | null;
  tier: string | null;
  cademi_course_id: string | null;
  expires_at: string | null;
}

interface SystemRow {
  id: string;
  slug: string;
}

/**
 * GET /api/entitlements/{email}
 *
 * Headers:
 *   Authorization: Bearer ${HUB_PUBLIC_API_KEY}
 *
 * Query params:
 *   system={slug}   → filtra só esse sistema
 *   include=expired → inclui grants já expirados (default: só ativos)
 *
 * Response:
 *   {
 *     email: "user@example.com",
 *     found: true|false,
 *     customer_id: "...",
 *     entitlements: [
 *       { kind: "system_access", system: "scalo", tier: "full", expires_at: null }
 *     ]
 *   }
 *
 * Códigos:
 *   200 — sempre que autenticado, mesmo se cliente não existir (found: false)
 *   401 — sem auth ou key inválida
 *   500 — erro interno
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ email: string }> },
) {
  // 1. Auth
  const expected = process.env.HUB_PUBLIC_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Decode email + parse query
  const { email: rawEmail } = await ctx.params;
  const email = decodeURIComponent(rawEmail).trim().toLowerCase();
  const url = new URL(req.url);
  const systemFilter = url.searchParams.get("system");

  const hub = createHubServiceClient();

  // 3. Acha customer
  const { data: customer } = await hub
    .from("customers")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ email, found: false, entitlements: [] });
  }
  const customerId = customer.id as string;

  // 4. Busca entitlements efetivos (view já cuida do "tier mais alto" e "não expirados")
  const { data, error } = await hub
    .from("effective_entitlements")
    .select("customer_id,kind,system_id,tier,cademi_course_id,expires_at")
    .eq("customer_id", customerId);

  if (error) {
    console.error("[entitlements] query failed:", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  // 5. Resolve system_ids → slugs
  const rows = (data ?? []) as EffectiveEntitlementRow[];
  const systemIds = rows
    .map((r) => r.system_id)
    .filter((id): id is string => !!id);
  const slugById = new Map<string, string>();
  if (systemIds.length > 0) {
    const { data: systems } = await hub
      .from("systems")
      .select("id,slug")
      .in("id", systemIds);
    for (const s of (systems ?? []) as SystemRow[]) {
      slugById.set(s.id, s.slug);
    }
  }

  // 6. Formata resposta
  let entitlements = rows.map((r) => ({
    kind: r.kind,
    system: r.system_id ? slugById.get(r.system_id) ?? null : null,
    tier: r.tier,
    cademi_course_id: r.cademi_course_id,
    expires_at: r.expires_at,
  }));

  if (systemFilter) {
    entitlements = entitlements.filter((e) => e.system === systemFilter);
  }

  // Audit log (não bloqueia resposta)
  logEvent(hub, "public_api.entitlements.query", {
    payload: { email, system: systemFilter, returned: entitlements.length },
    customerId,
  }).catch(() => {});

  return NextResponse.json({
    email,
    found: true,
    customer_id: customerId,
    entitlements,
  });
}
