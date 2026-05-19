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
  const color = p.primaryColor || "#000000";
  const name = p.customerName ? escapeHtml(p.customerName) : "";
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.55;font-size:15px">
  <div style="max-width:520px;margin:0 auto">
    <p style="margin:0 0 16px">${greeting}</p>
    <p style="margin:0 0 16px">Seu acesso ao <strong>${escapeHtml(p.systemName)}</strong> foi criado. Use as credenciais abaixo pra entrar:</p>

    <p style="margin:0 0 4px"><strong>Email:</strong> ${escapeHtml(p.to)}</p>
    <p style="margin:0 0 16px"><strong>Senha provisória:</strong> <code style="background:#f4f4f5;padding:2px 6px;border-radius:3px;font-family:Menlo,monospace;font-size:14px">${escapeHtml(p.password)}</code></p>

    <p style="margin:0 0 16px">No primeiro acesso você precisa trocar a senha por uma sua.</p>

    <p style="margin:0 0 16px">Link de acesso: <a href="${escapeHtml(p.loginUrl)}" style="color:${color}">${escapeHtml(p.loginUrl)}</a></p>

    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">
    <p style="margin:0;color:#71717a;font-size:13px">
      Produto: ${escapeHtml(p.productName)}<br>
      ${p.replyToEmail ? "Dúvidas? Responda esse email." : ""}
    </p>
  </div>
</body>
</html>`;
}

function welcomeText(p: WelcomeEmailParams): string {
  const name = p.customerName ? `Olá, ${p.customerName}.` : "Olá.";
  return `${name}

Seu acesso ao ${p.systemName} foi criado. Use as credenciais abaixo pra entrar:

Email: ${p.to}
Senha provisória: ${p.password}

No primeiro acesso você precisa trocar a senha por uma sua.

Link de acesso: ${p.loginUrl}

---
Produto: ${p.productName}
${p.replyToEmail ? "Dúvidas? Responda esse email." : ""}`;
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
    subject: `Sua senha do ${p.systemName}`,
    html: welcomeHtml(p),
    text: welcomeText(p),
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
  const loginUrl = p.loginUrl || "https://hubgeracaoa.com/login";
  const roleLabel = p.role === "admin" ? "Admin" : "Membro";

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.55;font-size:15px">
  <div style="max-width:520px;margin:0 auto">
    <p style="margin:0 0 16px">Olá.</p>
    <p style="margin:0 0 16px"><strong>${escapeHtml(p.inviterEmail)}</strong> te adicionou ao Hub da Geração A como <strong>${roleLabel}</strong>. Use as credenciais abaixo pra entrar:</p>

    <p style="margin:0 0 4px"><strong>Email:</strong> ${escapeHtml(p.to)}</p>
    <p style="margin:0 0 16px"><strong>Senha provisória:</strong> <code style="background:#f4f4f5;padding:2px 6px;border-radius:3px;font-family:Menlo,monospace;font-size:14px">${escapeHtml(p.tempPassword)}</code></p>

    <p style="margin:0 0 16px">Troque a senha no primeiro acesso.</p>

    <p style="margin:0 0 16px">Link de acesso: <a href="${escapeHtml(loginUrl)}" style="color:#111">${escapeHtml(loginUrl)}</a></p>

    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">
    <p style="margin:0;color:#71717a;font-size:13px">Esse convite é pessoal. Não compartilhe.</p>
  </div>
</body>
</html>`;
}

function inviteText(p: InviteEmailParams): string {
  const loginUrl = p.loginUrl || "https://hubgeracaoa.com/login";
  const roleLabel = p.role === "admin" ? "Admin" : "Membro";
  return `Olá.

${p.inviterEmail} te adicionou ao Hub da Geração A como ${roleLabel}. Use as credenciais abaixo pra entrar:

Email: ${p.to}
Senha provisória: ${p.tempPassword}

Troque a senha no primeiro acesso.

Link de acesso: ${loginUrl}

---
Esse convite é pessoal. Não compartilhe.`;
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
    subject: "Sua senha do Hub Geração A",
    html: inviteHtml(p),
    text: inviteText(p),
  });
  if (error || !data) {
    throw new Error(`Resend error: ${error?.message ?? "unknown"}`);
  }
  return { skipped: false, id: data.id };
}
