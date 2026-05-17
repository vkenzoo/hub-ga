import { Resend } from "resend";

export interface WelcomeEmailParams {
  to: string;
  customerName?: string | null;
  productName: string;
  systemName: string;
  loginUrl: string;
  password: string;
}

function htmlTemplate(p: WelcomeEmailParams): string {
  const safeName = (p.customerName ?? "").replace(/[<>&]/g, "");
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:32px auto;padding:24px;color:#111">
  <h2 style="margin:0 0 16px">Bem-vindo${safeName ? ", " + safeName : ""}!</h2>
  <p>Seu acesso ao <strong>${p.systemName}</strong> está liberado.</p>
  <p>Use os dados abaixo para fazer login:</p>
  <table cellspacing="0" cellpadding="8" style="border-collapse:collapse;background:#f5f5f5;border-radius:8px;margin:16px 0">
    <tr><td><strong>Email</strong></td><td><code>${p.to}</code></td></tr>
    <tr><td><strong>Senha</strong></td><td><code>${p.password}</code></td></tr>
  </table>
  <p><a href="${p.loginUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Acessar ${p.systemName}</a></p>
  <p style="color:#666;font-size:14px">No primeiro acesso, você será solicitado a trocar a senha por uma sua.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Produto: ${p.productName}</p>
</body></html>`;
}

/**
 * Envia email de boas-vindas. Se RESEND_API_KEY ou RESEND_FROM não estiverem
 * configurados, retorna { skipped: true } sem lançar erro — o provisionamento
 * não deve quebrar por falta de email.
 */
export async function sendWelcomeEmail(p: WelcomeEmailParams): Promise<
  { skipped: true; reason: string } | { skipped: false; id: string }
> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    return { skipped: true, reason: "resend_not_configured" };
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: p.to,
    subject: `Acesso liberado: ${p.systemName}`,
    html: htmlTemplate(p),
  });
  if (error || !data) {
    throw new Error(`Resend error: ${error?.message ?? "unknown"}`);
  }
  return { skipped: false, id: data.id };
}
