import { redirect } from "next/navigation";
import { createSupabaseAdmin, createSupabaseServer } from "./supabase/server";

export async function requireAdmin() {
  const sb = await createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user?.email) redirect("/login");

  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from("admin_users")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  if (!data) redirect("/login?error=not_admin");

  return { user, email: user.email };
}
