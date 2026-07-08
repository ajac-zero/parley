import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { ParleyMark } from "~/components/app-sidebar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/auth/sign-in")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ to: search.redirect ?? "/chat" });
    }
  },
  component: SignInPage,
});

function SignInPage() {
  const { config } = Route.useRouteContext();
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: authError } = await authClient.signIn.email({
      email,
      password,
    });
    setPending(false);
    if (authError) {
      setError(authError.message ?? "Sign in failed.");
      return;
    }
    window.location.href = search.redirect ?? "/chat";
  };

  return (
    <AuthShell
      config={config}
      title={`Welcome back`}
      subtitle={`Sign in to continue to ${config.appName}`}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {config.registrationEnabled && (
        <p className="mt-6 text-center text-muted-foreground text-sm">
          No account yet?{" "}
          <Link
            to="/auth/sign-up"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Create one
          </Link>
        </p>
      )}
    </AuthShell>
  );
}

export function AuthShell({
  config,
  title,
  subtitle,
  children,
}: {
  config: { appName: string; appLogoUrl: string | null };
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {config.appLogoUrl ? (
            <img
              src={config.appLogoUrl}
              alt=""
              className="size-10 rounded-xl object-contain"
            />
          ) : (
            <ParleyMark className="size-10" />
          )}
          <div>
            <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
            <p className="mt-1 text-muted-foreground text-sm">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
