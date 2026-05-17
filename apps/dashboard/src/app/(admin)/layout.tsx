import { requireAdmin } from "@/lib/auth";
import { Sidebar } from "@/components/nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireAdmin();
  return (
    <div className="min-h-screen flex">
      <Sidebar email={email} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
