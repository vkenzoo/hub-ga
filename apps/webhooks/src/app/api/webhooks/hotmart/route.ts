import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { verifyHotmart } from "@/lib/hmac";
import { hotmartEventSchema } from "@/lib/parsers/hotmart.schema";
import { handleHotmartEvent } from "@/lib/handlers/hotmart";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  // Hotmart envia o token estático em "x-hotmart-hottok" ou "hottok".
  const token =
    req.headers.get("x-hotmart-hottok") ??
    req.headers.get("hottok") ??
    req.headers.get("x-hottok");
  const secret = process.env.HOTMART_WEBHOOK_SECRET;

  if (!secret) {
    console.error("[hotmart] HOTMART_WEBHOOK_SECRET ausente");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  if (!verifyHotmart(token, secret)) {
    const hub = createHubServiceClient();
    await logEvent(hub, "webhook.invalid_signature", {
      level: "warn",
      payload: { gateway: "hotmart", token_present: !!token },
    });
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = hotmartEventSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const hub = createHubServiceClient();
    await logEvent(hub, "webhook.invalid_payload", {
      level: "warn",
      payload: { gateway: "hotmart", errors: parsed.error.flatten() },
    });
    return NextResponse.json({ ok: true, ignored: "invalid_payload" });
  }

  try {
    const hub = createHubServiceClient();
    const result = await handleHotmartEvent(hub, parsed.data);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[hotmart] handler error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
