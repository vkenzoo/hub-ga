import { createHmac, timingSafeEqual } from "node:crypto";

// Compara duas strings em tempo constante; evita timing attacks.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Assiny: assume HMAC-SHA256 do raw body com segredo compartilhado.
// O header exato pode variar — ajustamos quando virmos o primeiro webhook real.
export function verifyAssiny(rawBody: string, headerSignature: string | null, secret: string): boolean {
  if (!headerSignature) return false;
  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
  const cleaned = headerSignature.replace(/^sha256=/i, "").trim();
  return safeEqual(computed, cleaned);
}

// Hotmart: HotTok é um token estático enviado no header. Comparação direta.
export function verifyHotmart(headerToken: string | null, secret: string): boolean {
  if (!headerToken) return false;
  return safeEqual(headerToken.trim(), secret);
}

// Hubla: x-hubla-token é um token estático compartilhado (não é HMAC).
// Doc: https://hubla.gitbook.io/docs/webhooks/proteja-seu-endpoint
export function verifyHubla(headerToken: string | null, secret: string): boolean {
  if (!headerToken) return false;
  return safeEqual(headerToken.trim(), secret);
}
