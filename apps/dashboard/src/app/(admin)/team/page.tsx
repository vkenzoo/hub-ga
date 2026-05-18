import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requireSuperAdmin,
  ALL_SECTIONS,
  SECTION_LABEL,
  type Section,
} from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

type Role = "admin" | "member";
type AccessMode = "admin" | "member_all" | "member_custom";

interface TeamRow {
  email: string;
  role: Role;
  allowed_sections: string[] | null;
  created_at: string;
  invited_by: string | null;
  invited_at: string | null;
}

function generateTempPassword(): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const nums = "23456789";
  const syms = "!@#$%*";
  const all = lower + upper + nums + syms;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)] ?? "x";
  let pwd = pick(lower) + pick(upper) + pick(nums) + pick(syms);
  for (let i = 0; i < 8; i++) pwd += pick(all);
  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/**
 * Resolve {accessMode, sections[]} do form em {role, allowed_sections}
 * que vai pro banco. Filtra seções inválidas pra não confiar em garbage.
 */
function resolveAccess(
  accessMode: AccessMode,
  sections: string[],
): { role: Role; allowed_sections: Section[] | null } {
  if (accessMode === "admin") return { role: "admin", allowed_sections: null };
  if (accessMode === "member_all") return { role: "member", allowed_sections: null };
  // member_custom: filtra pelas seções válidas
  const valid = sections.filter((s): s is Section => ALL_SECTIONS.includes(s as Section));
  return { role: "member", allowed_sections: valid };
}

async function inviteMember(formData: FormData) {
  "use server";
  const me = await requireSuperAdmin();
  const sb = createSupabaseAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const accessMode = (String(formData.get("access_mode") ?? "member_all") as AccessMode);
  const sections = formData.getAll("sections").map(String);

  if (!email || !email.includes("@")) {
    redirect("/team?error=invalid_email");
  }

  const { data: existing } = await sb
    .from("admin_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    redirect(`/team?error=already_exists&e=${encodeURIComponent(email)}`);
  }

  const { role, allowed_sections } = resolveAccess(accessMode, sections);

  if (accessMode === "member_custom" && (!allowed_sections || allowed_sections.length === 0)) {
    redirect("/team?error=no_sections");
  }

  const tempPassword = generateTempPassword();

  const { error: authErr } = await sb.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { must_change_password: true },
  });

  if (authErr) {
    if (!String(authErr.message).toLowerCase().includes("already")) {
      console.error("[team] auth createUser failed:", authErr);
      redirect("/team?error=auth_failed");
    }
  }

  const { error: insErr } = await sb.from("admin_users").insert({
    email,
    role,
    allowed_sections,
    invited_by: me.email,
    invited_at: new Date().toISOString(),
  });

  if (insErr) {
    console.error("[team] admin_users insert failed:", insErr);
    redirect("/team?error=insert_failed");
  }

  revalidatePath("/team");
  redirect(
    `/team?invited=${encodeURIComponent(email)}&pwd=${encodeURIComponent(tempPassword)}&mode=${accessMode}`,
  );
}

async function updateAccess(formData: FormData) {
  "use server";
  const me = await requireSuperAdmin();
  const sb = createSupabaseAdmin();

  const email = String(formData.get("email") ?? "");
  const accessMode = (String(formData.get("access_mode") ?? "member_all") as AccessMode);
  const sections = formData.getAll("sections").map(String);

  const { role, allowed_sections } = resolveAccess(accessMode, sections);

  if (email === me.email && role === "member") {
    redirect("/team?error=cant_demote_self");
  }

  await sb.from("admin_users").update({ role, allowed_sections }).eq("email", email);
  revalidatePath("/team");
  redirect(`/team?changed=${encodeURIComponent(email)}`);
}

async function removeMember(formData: FormData) {
  "use server";
  const me = await requireSuperAdmin();
  const sb = createSupabaseAdmin();

  const email = String(formData.get("email") ?? "");
  if (email === me.email) {
    redirect("/team?error=cant_remove_self");
  }

  await sb.from("admin_users").delete().eq("email", email);
  revalidatePath("/team");
  redirect(`/team?removed=${encodeURIComponent(email)}`);
}

const ERROR_LABELS: Record<string, string> = {
  invalid_email: "Email inválido.",
  already_exists: "Esse email já está cadastrado na equipe.",
  auth_failed: "Falha ao criar conta. Tente novamente.",
  insert_failed: "Falha ao salvar. Tente novamente.",
  cant_demote_self: "Você não pode rebaixar a si mesmo de Admin pra Membro.",
  cant_remove_self: "Você não pode remover a si mesmo.",
  no_sections: "Selecione ao menos uma seção pra acesso personalizado.",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rowAccessMode(row: TeamRow): AccessMode {
  if (row.role === "admin") return "admin";
  if (!row.allowed_sections) return "member_all";
  return "member_custom";
}

function accessChip(mode: AccessMode, sections: string[] | null) {
  if (mode === "admin") return { dot: "bg-brand", label: "Admin" };
  if (mode === "member_all") return { dot: "bg-info", label: "Membro · tudo" };
  return { dot: "bg-accent", label: `Personalizado · ${sections?.length ?? 0}` };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    invited?: string;
    pwd?: string;
    mode?: string;
    changed?: string;
    removed?: string;
    e?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await requireSuperAdmin();
  const sb = createSupabaseAdmin();

  const { data } = await sb
    .from("admin_users")
    .select("email, role, allowed_sections, created_at, invited_by, invited_at")
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as TeamRow[];

  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;
  const justInvited = sp.invited && sp.pwd;

  return (
    <>
      <PageHeader
        title="Equipe"
        subtitle={`${rows.length} pessoa${rows.length === 1 ? "" : "s"} com acesso ao hub.`}
        right={
          <span className="chip">
            <span className="dot bg-brand" /> Restrito a Admin
          </span>
        }
      />

      <PageBody>
        {sp.changed && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            Acesso de <strong>{sp.changed}</strong> atualizado.
          </div>
        )}
        {sp.removed && (
          <div className="card border-warn/30 bg-warn/5 px-4 py-2.5 text-sm text-warn">
            <strong>{sp.removed}</strong> removido (não pode mais entrar).
          </div>
        )}
        {errorMsg && (
          <div className="card border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            {errorMsg}
            {sp.e && <span className="font-mono ml-2">{sp.e}</span>}
          </div>
        )}

        {justInvited && (
          <section className="card border-accent/40 bg-accent/5">
            <header className="px-4 py-3 border-b border-accent/20">
              <h2 className="text-sm font-medium text-accent">
                Convite criado — envie essas credenciais
              </h2>
              <p className="text-xs text-text2 mt-1">
                Essa senha aparece <strong>uma única vez</strong>. Copie e mande pro novo
                membro por WhatsApp ou email. Ele troca no primeiro login.
              </p>
            </header>
            <div className="p-4 space-y-3">
              <div>
                <div className="label mb-1">Email</div>
                <code className="block font-mono text-sm bg-surface2 border border-line rounded p-2.5 break-all">
                  {sp.invited}
                </code>
              </div>
              <div>
                <div className="label mb-1">Senha temporária</div>
                <code className="block font-mono text-sm bg-surface2 border border-line rounded p-2.5 break-all">
                  {sp.pwd}
                </code>
              </div>
              <div className="text-xs text-muted pt-1">
                Link de acesso: <code className="font-mono text-text2">https://hubgeracaoa.com/login</code>
              </div>
            </div>
          </section>
        )}

        {/* Convite */}
        <section className="card">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Convidar novo membro</h2>
            <p className="text-xs text-muted mt-1">
              Senha aleatória é gerada automaticamente; você compartilha manualmente.
            </p>
          </header>
          <form action={inviteMember} className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field name="email" label="Email" placeholder="fulano@geracaoa.com" required />
              <label className="block">
                <span className="label block mb-1.5">Nível de acesso</span>
                <select name="access_mode" defaultValue="member_all" className="input" id="invite-mode">
                  <option value="member_all">Membro — tudo (exceto gerenciar equipe)</option>
                  <option value="admin">Admin — controle total</option>
                  <option value="member_custom">Personalizado — escolho as seções</option>
                </select>
              </label>
            </div>
            <details className="border border-line rounded-md group">
              <summary className="px-3 py-2.5 cursor-pointer list-none flex items-center justify-between text-sm text-text2 hover:bg-surface2 transition">
                <span>
                  Seções (use só com <strong>Personalizado</strong>)
                </span>
                <span className="text-2xs text-muted group-open:hidden">expandir</span>
                <span className="text-2xs text-muted hidden group-open:inline">recolher</span>
              </summary>
              <div className="p-3 border-t border-line grid grid-cols-2 md:grid-cols-4 gap-2">
                {ALL_SECTIONS.map((s) => (
                  <label
                    key={s}
                    className="flex items-center gap-2 text-sm py-1 cursor-pointer hover:bg-surface2 -mx-1 px-1 rounded"
                  >
                    <input
                      type="checkbox"
                      name="sections"
                      value={s}
                      className="rounded border-line bg-surface text-brand focus:ring-brand/40 focus:ring-offset-0"
                    />
                    {SECTION_LABEL[s]}
                  </label>
                ))}
              </div>
            </details>
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Criando...">Criar acesso</SubmitButton>
            </div>
          </form>
        </section>

        {/* Lista */}
        <section className="card overflow-hidden">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">{rows.length} {rows.length === 1 ? "pessoa" : "pessoas"}</h2>
          </header>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted text-center">Nenhum membro ainda.</div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const isSelf = r.email === me.email;
                const mode = rowAccessMode(r);
                const chip = accessChip(mode, r.allowed_sections);
                return (
                  <li key={r.email} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <code className="font-mono text-xs">{r.email}</code>
                        {isSelf && <span className="text-2xs text-muted">(você)</span>}
                        <span className="chip">
                          <span className={`dot ${chip.dot}`} /> {chip.label}
                        </span>
                      </div>
                      {mode === "member_custom" && r.allowed_sections && (
                        <div className="text-2xs text-text2 mt-1">
                          {r.allowed_sections
                            .map((s) => SECTION_LABEL[s as Section] ?? s)
                            .join(" · ")}
                        </div>
                      )}
                      <div className="text-2xs text-muted mt-1">
                        Desde {fmtDate(r.invited_at ?? r.created_at)}
                        {r.invited_by && ` · convidado por ${r.invited_by}`}
                      </div>
                    </div>
                    <details className="md:justify-self-end relative">
                      <summary className="btn btn-sm btn-ghost list-none cursor-pointer">
                        Editar acesso
                      </summary>
                      <form
                        action={updateAccess}
                        className="absolute right-0 top-full mt-1 card p-3 z-10 shadow-lg w-72 space-y-3"
                      >
                        <input type="hidden" name="email" value={r.email} />
                        <label className="block">
                          <span className="label block mb-1.5">Nível</span>
                          <select
                            name="access_mode"
                            defaultValue={mode}
                            className="input"
                            disabled={isSelf && r.role === "admin"}
                          >
                            <option value="admin">Admin</option>
                            <option value="member_all">Membro — tudo</option>
                            <option value="member_custom">Personalizado</option>
                          </select>
                        </label>
                        <div>
                          <span className="label block mb-1.5">Seções (só pra Personalizado)</span>
                          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                            {ALL_SECTIONS.map((s) => (
                              <label
                                key={s}
                                className="flex items-center gap-1.5 text-xs py-1 cursor-pointer hover:bg-surface2 px-1 rounded"
                              >
                                <input
                                  type="checkbox"
                                  name="sections"
                                  value={s}
                                  defaultChecked={r.allowed_sections?.includes(s) ?? false}
                                  className="rounded border-line bg-surface text-brand focus:ring-brand/40 focus:ring-offset-0"
                                />
                                {SECTION_LABEL[s]}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="flex justify-between gap-2 pt-1">
                          <button
                            type="submit"
                            formAction={removeMember}
                            className="btn btn-sm btn-ghost text-muted hover:text-danger"
                            disabled={isSelf}
                            title="Remover do whitelist"
                          >
                            Remover
                          </button>
                          <SubmitButton pendingLabel="Salvando...">Salvar</SubmitButton>
                        </div>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="text-2xs text-muted">
          Remover do whitelist bloqueia login, mas mantém a conta no Supabase Auth (pra re-convite rápido).
          Membros com seções personalizadas só veem (e só conseguem acessar via URL) as seções marcadas.
        </p>
      </PageBody>
    </>
  );
}
