import { NextResponse } from "next/server";
import { createHubServiceClient } from "@hub/db";
import { verifyAssiny } from "@/lib/hmac";
import { assinyEventSchema } from "@/lib/parsers/assiny.schema";
import { handleAssinyEvent } from "@/lib/handlers/assiny";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nomes de headers que conhecemos pra signature HMAC (case insensitive).
// Assiny não assina hoje, mas mantemos a lógica caso passe a assinar no futuro.
const SIGNATURE_HEADERS = [
  "x-assiny-signature",
  "x-signature",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-webhook-signature",
];

function findSignature(headers: Headers): string | null {
  for (const name of SIGNATURE_HEADERS) {
    const v = headers.get(name);
    if (v) return v;
  }
  return null;
}

// Assiny envia via go-resty. Bloqueia tráfego direto não-Assiny.
// É proteção fraca (User-Agent é forjável), mas evita spam aleatório.
function isLikelyAssiny(headers: Headers): boolean {
  const ua = headers.get("user-agent")?.toLowerCase() ?? "";
  return ua.includes("go-resty") || ua.includes("assiny");
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = findSignature(req.headers);
  const secret = process.env.ASSINY_WEBHOOK_SECRET;

  if (!secret) {
    console.error("[assiny] ASSINY_WEBHOOK_SECRET ausente");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Se VEIO uma signature, valida HMAC. Se NÃO veio (Assiny atual), aceita
  // baseado em User-Agent. Quando Assiny passar a assinar, a verificação
  // entra em ação automaticamente.
  if (signature) {
    if (!verifyAssiny(rawBody, signature, secret)) {
      const hub = createHubServiceClient();
      await logEvent(hub, "webhook.invalid_signature", {
        level: "warn",
        payload: {
          gateway: "assiny",
          signature_preview: signature.slice(0, 20),
        },
      });
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  } else {
    if (!isLikelyAssiny(req.headers)) {
      const hub = createHubServiceClient();
      await logEvent(hub, "webhook.rejected_no_auth", {
        level: "warn",
        payload: {
          gateway: "assiny",
          user_agent: req.headers.get("user-agent") ?? null,
          ip: req.headers.get("x-real-ip") ?? null,
        },
      });
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
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
      payload: {
        gateway: "assiny",
        errors: parsed.error.flatten(),
        body_preview: rawBody.slice(0, 500),
      },
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
