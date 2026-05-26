/**
 * Cliente HTTP pra Graph API do Facebook/Meta.
 *
 * Toda chamada inclui `appsecret_proof = HMAC-SHA256(access_token, app_secret).hex`.
 * Sem isso, atacante com só o token consegue fazer requests. Com o proof, ele
 * precisa do app_secret também (que está criptografado e nunca sai do servidor).
 *
 * Backoff exponencial em rate-limit (códigos 4, 17, 32).
 */
import { createHmac } from "node:crypto";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class GraphError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus: number,
    public raw: unknown,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export function appsecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

interface GraphErrorBody {
  message?: string;
  code?: number | string;
  error_subcode?: number | string;
  type?: string;
}

export async function graphGet<T>(
  accessToken: string,
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  appSecret: string,
  attempt = 0,
): Promise<T> {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${BASE_URL}${cleanPath}`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("appsecret_proof", appsecretProof(accessToken, appSecret));
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
  let json: { error?: GraphErrorBody; data?: unknown };
  try {
    json = (await res.json()) as { error?: GraphErrorBody; data?: unknown };
  } catch {
    throw new GraphError(`Resposta não-JSON (${res.status})`, String(res.status), res.status, null);
  }

  if (!res.ok) {
    const err = json.error ?? {};
    const code = err.code?.toString() ?? String(res.status);
    // Rate limit / app limit / user limit — backoff exponencial
    if (["4", "17", "32"].includes(code) && attempt < 2) {
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
      return graphGet<T>(accessToken, path, params, appSecret, attempt + 1);
    }
    throw new GraphError(err.message ?? "Erro Graph", code, res.status, err);
  }
  return json as T;
}

export async function graphPost<T>(
  accessToken: string,
  path: string,
  body: Record<string, string | number | boolean | null | undefined>,
  appSecret: string,
): Promise<T> {
  const form = new URLSearchParams();
  form.set("access_token", accessToken);
  form.set("appsecret_proof", appsecretProof(accessToken, appSecret));
  for (const [k, v] of Object.entries(body)) {
    if (v != null) form.set(k, String(v));
  }
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${BASE_URL}${cleanPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const json = (await res.json()) as { error?: GraphErrorBody };
  if (!res.ok) {
    const err = json.error ?? {};
    throw new GraphError(
      err.message ?? "Erro Graph",
      err.code?.toString() ?? String(res.status),
      res.status,
      err,
    );
  }
  return json as T;
}

/**
 * Token expirado/revogado — útil pra marcar a conexão como invalid.
 * Códigos Meta:
 *   190 — token inválido
 *   102 — sessão expirada
 *   HTTP 401 — auth genérica
 */
export function isInvalidTokenError(err: unknown): boolean {
  if (!(err instanceof GraphError)) return false;
  return err.code === "190" || err.code === "102" || err.httpStatus === 401;
}
