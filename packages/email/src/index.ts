import { Resend } from "resend";

// ────────────────────────────────────────────────────────────────
// Welcome email — disparado após provisioning bem-sucedido
// ────────────────────────────────────────────────────────────────

export interface WelcomeEmailParams {
  to: string;
  customerName?: string | null;
  productName: string;
  systemName: string;
  loginUrl: string;
  password: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  replyToEmail?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] ?? c));
}

function welcomeHtml(p: WelcomeEmailParams): string {
  const color = p.primaryColor || "#ec2d7c";
  const name = p.customerName ? escapeHtml(p.customerName) : "";
  const greeting = name ? `Olá, ${name}!` : "Bem-vindo!";

  const logoBlock = p.logoUrl
    ? `<img src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.systemName)}" style="max-height:42px;max-width:200px;display:block">`
    : `<div style="font-size:20px;font-weight:700;color:#111">${escapeHtml(p.systemName)}</div>`;

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;color:#1d1d1f">
  <table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f5f5f7;padding:32px 16px">
    <tr>
      <td align="center">
        <table cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
          <tr>
            <td style="padding:32px 32px 24px;border-bottom:1px solid #f0f0f2">
              ${logoBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:32px">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:600;color:#1d1d1f">${greeting}</h1>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#3a3a3c">
                Seu acesso ao <strong>${escapeHtml(p.systemName)}</strong> está liberado.
              </p>

              <p style="margin:0 0 12px;font-size:14px;color:#3a3a3c">Use as credenciais abaixo pra entrar:</p>

              <table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8f8fa;border-radius:8px;margin:0 0 24px">
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid #ececef">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#86868b;margin-bottom:4px">Email</div>
                    <code style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:14px;color:#1d1d1f">${escapeHtml(p.to)}</code>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#86868b;margin-bottom:4px">Senha provisória</div>
                    <code style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:14px;color:#1d1d1f">${escapeHtml(p.password)}</code>
                  </td>
                </tr>
              </table>

              <table cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background:${color};border-radius:8px">
                    <a href="${escapeHtml(p.loginUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600">
                      Acessar ${escapeHtml(p.systemName)} →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:13px;color:#86868b;line-height:1.5">
                No primeiro acesso você precisa <strong>trocar a senha</strong> por uma sua.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8f8fa;font-size:12px;color:#86868b;line-height:1.5">
              Produto: <span style="color:#3a3a3c">${escapeHtml(p.productName)}</span><br>
              Esse email foi disparado automaticamente após sua compra.${p.replyToEmail ? ` Dúvidas: responda esse email.` : ""}
            </td>
          </tr>
        </table>
        <p style="font-size:11px;color:#86868b;margin:24px 0 0;text-align:center">
          Enviado por Geração A · <a href="https://hubgeracaoa.com" style="color:#86868b;text-decoration:underline">hubgeracaoa.com</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
    html: welcomeHtml(p),
    replyTo: p.replyToEmail || undefined,
  });
  if (error || !data) {
    throw new Error(`Resend error: ${error?.message ?? "unknown"}`);
  }
  return { skipped: false, id: data.id };
}

// ────────────────────────────────────────────────────────────────
// Invite email — disparado quando admin convida membro pro hub
// ────────────────────────────────────────────────────────────────

export interface InviteEmailParams {
  to: string;
  inviterEmail: string;
  tempPassword: string;
  role: "admin" | "member";
  loginUrl?: string;
}

function inviteHtml(p: InviteEmailParams): string {
  const color = "#ec2d7c";
  const loginUrl = p.loginUrl || "https://hubgeracaoa.com/login";
  const roleLabel = p.role === "admin" ? "Admin" : "Membro";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;color:#1d1d1f">
  <table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f5f5f7;padding:32px 16px">
    <tr>
      <td align="center">
        <table cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
          <tr>
            <td style="padding:32px 32px 24px;border-bottom:1px solid #f0f0f2">
              <div style="font-size:20px;font-weight:700;color:#1d1d1f">GERAÇÃO<span style="color:${color}">A</span></div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#86868b;margin-top:4px">Hub Admin</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:600">Você foi convidado pro hub</h1>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#3a3a3c">
                <strong>${escapeHtml(p.inviterEmail)}</strong> te adicionou ao Hub Geração A como <strong>${roleLabel}</strong>.
              </p>

              <table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8f8fa;border-radius:8px;margin:0 0 24px">
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid #ececef">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#86868b;margin-bottom:4px">Email</div>
                    <code style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:14px">${escapeHtml(p.to)}</code>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px">
                    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#86868b;margin-bottom:4px">Senha provisória</div>
                    <code style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:14px">${escapeHtml(p.tempPassword)}</code>
                  </td>
                </tr>
              </table>

              <table cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background:${color};border-radius:8px">
                    <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600">
                      Acessar o hub →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:13px;color:#86868b;line-height:1.5">
                Troque a senha no primeiro acesso. Esse convite é pessoal.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendInviteEmail(p: InviteEmailParams): Promise<
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
    subject: "Convite pro Hub Geração A",
    html: inviteHtml(p),
  });
  if (error || !data) {
    throw new Error(`Resend error: ${error?.message ?? "unknown"}`);
  }
  return { skipped: false, id: data.id };
}
