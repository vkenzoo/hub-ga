import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { PageBody, PageHeader, Field } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

async function updateProfile(formData: FormData) {
  "use server";
  const { user, email } = await requireAdmin();
  const admin = createSupabaseAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const avatar = formData.get("avatar") as File | null;
  const removeAvatar = formData.get("remove_avatar") === "on";

  const currentMeta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const nextMeta: Record<string, unknown> = { ...currentMeta };

  if (name) {
    nextMeta.name = name;
  } else {
    delete nextMeta.name;
  }

  // Avatar — upload novo se veio arquivo válido, ou remove se pediu
  if (avatar && avatar.size > 0) {
    if (!ALLOWED_AVATAR_TYPES.includes(avatar.type)) {
      redirect("/profile?error=invalid_type");
    }
    if (avatar.size > MAX_AVATAR_BYTES) {
      redirect("/profile?error=too_large");
    }
    const ext = (avatar.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
    const path = `${user.id}/${Date.now()}.${ext}`;
    const bytes = new Uint8Array(await avatar.arrayBuffer());

    const { error: upErr } = await admin.storage
      .from("avatars")
      .upload(path, bytes, { contentType: avatar.type, upsert: true });

    if (upErr) {
      console.error("[profile] avatar upload failed:", upErr);
      redirect("/profile?error=upload_failed");
    }

    const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
    nextMeta.avatar_url = pub.publicUrl;
  } else if (removeAvatar) {
    delete nextMeta.avatar_url;
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: nextMeta,
  });

  if (error) {
    console.error("[profile] update failed:", error);
    redirect("/profile?error=update_failed");
  }

  await logAudit({
    actor: email,
    action: "profile.update",
    target: email,
    payload: {
      name_changed: name !== (currentMeta.name ?? ""),
      avatar_changed: !!(avatar && avatar.size > 0) || removeAvatar,
    },
  });

  revalidatePath("/profile");
  redirect("/profile?saved=1");
}

const ERROR_LABELS: Record<string, string> = {
  invalid_type: "Tipo de imagem não suportado. Use PNG, JPG, WEBP ou GIF.",
  too_large: "Imagem muito grande. Máximo 2 MB.",
  upload_failed: "Falha ao subir a imagem. Tente novamente.",
  update_failed: "Falha ao salvar perfil. Tente novamente.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const { user, email, name, avatarUrl } = await requireAdmin();
  const displayName = name?.trim() || email.split("@")[0] || email;
  const errorMsg = sp.error ? ERROR_LABELS[sp.error] ?? "Algo deu errado." : null;

  return (
    <>
      <PageHeader
        title="Perfil"
        subtitle="Como você aparece pra outros admins do hub."
      />

      <PageBody>
        {sp.saved && (
          <div className="card border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
            Perfil atualizado.
          </div>
        )}
        {errorMsg && (
          <div className="card border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            {errorMsg}
          </div>
        )}

        <form action={updateProfile} className="card" encType="multipart/form-data">
          <header className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-medium">Identidade</h2>
          </header>

          <div className="p-4 grid grid-cols-1 md:grid-cols-[120px_1fr] gap-6 items-start">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-3">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-24 h-24 rounded-full object-cover border border-line"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-surface2 border border-line grid place-items-center text-3xl text-text2">
                  {displayName[0]?.toUpperCase()}
                </div>
              )}
              <label className="text-xs text-text2 cursor-pointer hover:text-text transition">
                <input
                  type="file"
                  name="avatar"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                />
                Trocar foto
              </label>
              {avatarUrl && (
                <label className="text-2xs text-muted hover:text-danger transition flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" name="remove_avatar" className="rounded border-line bg-surface" />
                  Remover
                </label>
              )}
            </div>

            {/* Campos */}
            <div className="space-y-4">
              <Field
                name="name"
                label="Nome"
                defaultValue={name ?? ""}
                placeholder="Como você quer ser chamado"
              />
              <div>
                <span className="label block mb-1.5">Email</span>
                <input
                  type="text"
                  value={email}
                  disabled
                  className="input opacity-60 cursor-not-allowed"
                />
                <p className="text-2xs text-muted mt-1.5">
                  Email vem do Supabase Auth e não pode ser alterado aqui.
                </p>
              </div>
              <div>
                <span className="label block mb-1.5">ID do usuário</span>
                <code className="text-2xs font-mono text-muted">{user.id}</code>
              </div>
            </div>
          </div>

          <footer className="px-4 py-3 border-t border-line flex justify-end gap-2">
            <SubmitButton>Salvar alterações</SubmitButton>
          </footer>
        </form>

        <p className="text-2xs text-muted">
          Foto: PNG/JPG/WEBP/GIF até 2 MB. Imagens ficam no bucket público <code className="font-mono">avatars</code> do Supabase.
        </p>
      </PageBody>
    </>
  );
}
