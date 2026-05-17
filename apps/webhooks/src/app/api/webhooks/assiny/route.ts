import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { verifyAssiny } from "@/lib/hmac";
import { assinyEventSchema } from "@/lib/parsers/assiny.schema";
import { handleAssinyEvent } from "@/lib/handlers/assiny";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista expandida — Assiny pode usar qualquer um desses nomes
const SIGNATURE_HEADERS = [
  "x-assiny-signature",
  "x-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-webhook-signature",
  "x-assiny-token",
  "assiny-signature",
  "signature",
];

function findSignature(headers: Headers): { value: string | null; from: string | null } {
  for (const name of SIGNATURE_HEADERS) {
    const v = headers.get(name);
    if (v) return { value: v, from: name };
  }
  return { value: null, from: null };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const { value: signature, from: sigHeader } = findSignature(req.headers);
  const secret = process.env.ASSINY_WEBHOOK_SECRET;

  // Captura TODOS os headers pra debug enquanto descobrimos o nome certo
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    // Mascara valores de auth/cookies/secrets pra não vazar
    const lk = k.toLowerCase();
    if (lk.includes("auth") || lk === "cookie") {
      allHeaders[k] = v.slice(0, 12) + "...";
    } else {
      allHeaders[k] = v;
    }
  });

  if (!secret) {
    console.error("[assiny] ASSINY_WEBHOOK_SECRET ausente");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  if (!verifyAssiny(rawBody, signature, secret)) {
    const hub = createHubServiceClient();
    await logEvent(hub, "webhook.invalid_signature", {
      level: "warn",
      payload: {
        gateway: "assiny",
        signature_found_in: sigHeader,
        signature_preview: signature?.slice(0, 30) ?? null,
        all_headers: allHeaders,
        body_preview: rawBody.slice(0, 200),
      },
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
    return NextResponse.json({ ok: true, ignored: "invalid_payload" });
  }

  try {
    const hub = createHubServiceClient();
    const result = await handleAssinyEvent(hub, parsed.data);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[assiny] handler error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
