import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { verifyAssiny } from "@/lib/hmac";
import { assinyEventSchema } from "@/lib/parsers/assiny.schema";
import { handleAssinyEvent } from "@/lib/handlers/assiny";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-assiny-signature") ?? req.headers.get("x-signature");
  const secret = process.env.ASSINY_WEBHOOK_SECRET;

  if (!secret) {
    console.error("[assiny] ASSINY_WEBHOOK_SECRET ausente");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  if (!verifyAssiny(rawBody, signature, secret)) {
    const hub = createHubServiceClient();
    await logEvent(hub, "webhook.invalid_signature", {
      level: "warn",
      payload: { gateway: "assiny", signature_header: signature?.slice(0, 20) ?? null },
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = assinyEventSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const hub = createHubServiceClient();
    await logEvent(hub, "webhook.invalid_payload", {
      level: "warn",
      payload: { gateway: "assiny", errors: parsed.error.flatten() },
    });
    // 200 para evitar retry infinito por payload malformado
    return NextResponse.json({ ok: true, ignored: "invalid_payload" });
  }

  try {
    const hub = createHubServiceClient();
    const result = await handleAssinyEvent(hub, parsed.data);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[assiny] handler error:", err);
    // 500 deixa o gateway re-tentar
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
