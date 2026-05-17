"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  if (!email || !password) redirect("/login?error=missing_credentials");

  const sb = await createSupabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    const code = error.message.toLowerCase().includes("invalid")
      ? "invalid_credentials"
      : encodeURIComponent(error.message);
    redirect(`/login?error=${code}`);
  }
  redirect(next);
}

export async function signOut() {
  const sb = await createSupabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
