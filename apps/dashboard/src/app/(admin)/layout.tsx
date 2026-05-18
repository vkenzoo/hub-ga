import { requireAdmin } from "@/lib/auth";
import { Sidebar } from "@/components/nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email, name, avatarUrl } = await requireAdmin();
  return (
    <div className="min-h-screen md:flex">
      <Sidebar email={email} name={name} avatarUrl={avatarUrl} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
