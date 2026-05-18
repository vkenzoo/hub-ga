import Image from "next/image";
import { signInWithPassword } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <Image
            src="/logo.png"
            alt="Geração A"
            width={200}
            height={40}
            priority
            className="h-9 w-auto"
          />
          <div className="text-2xs text-muted mt-2 uppercase tracking-wider">Hub Admin</div>
        </div>

        <h1 className="text-xl font-medium mb-1">Entrar</h1>
        <p className="text-sm text-muted mb-8">
          Use seu email e senha cadastrados.
        </p>

        {sp.error === "not_admin" && (
          <Banner tone="danger">
            Email fora da whitelist <code className="font-mono">admin_users</code>.
          </Banner>
        )}
        {sp.error === "invalid_credentials" && (
          <Banner tone="danger">Email ou senha incorretos.</Banner>
        )}
        {sp.error && sp.error !== "not_admin" && sp.error !== "invalid_credentials" && (
          <Banner tone="danger">Erro: <code className="font-mono">{sp.error}</code></Banner>
        )}

        <form action={signInWithPassword} className="space-y-3">
          <div>
            <label htmlFor="email" className="label block mb-1.5">Email</label>
            <input
              id="email"
              required
              type="email"
              name="email"
              placeholder="voce@dominio.com"
              className="input"
              autoFocus
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="password" className="label block mb-1.5">Senha</label>
            <input
              id="password"
              required
              type="password"
              name="password"
              placeholder="••••••••"
              className="input"
              autoComplete="current-password"
            />
          </div>
          <input type="hidden" name="next" value={sp.next ?? "/"} />
          <button type="submit" className="btn btn-primary w-full">
            Entrar
          </button>
        </form>

        <p className="mt-8 text-xs text-muted">
          Acesso restrito. Só emails em <code className="font-mono text-text2">admin_users</code>.
        </p>
      </div>
    </main>
  );
}

function Banner({ tone, children }: { tone: "danger" | "ok"; children: React.ReactNode }) {
  const cls =
    tone === "danger"
      ? "border-danger/30 bg-danger/10 text-danger"
      : "border-accent/30 bg-accent/10 text-accent";
  return (
    <div className={`mb-4 rounded-md border ${cls} px-3 py-2 text-sm`}>{children}</div>
  );
}
