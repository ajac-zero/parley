import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { AuthShell } from "./sign-in";

export const Route = createFileRoute("/auth/sign-up")({
  beforeLoad: ({ context }) => {
    if (context.session) {
      throw redirect({ to: "/chat" });
    }
  },
  component: SignUpPage,
});

function SignUpPage() {
  const { config } = Route.useRouteContext();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: authError } = await authClient.signUp.email({
      name,
      email,
      password,
    });
    setPending(false);
    if (authError) {
      setError(authError.message ?? "Sign up failed.");
      return;
    }
    window.location.href = "/chat";
  };

  return (
    <AuthShell
      config={config}
      title={`Create your account`}
      subtitle={`Get started with ${config.appName}`}
    >
      {config.registrationEnabled ? (
        <>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
              />
            </div>
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
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Creating account…" : "Create account"}
            </Button>
          </form>
          <p className="mt-6 text-center text-muted-foreground text-sm">
            Already have an account?{" "}
            <Link
              to="/auth/sign-in"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </>
      ) : (
        <div className="rounded-xl border bg-card px-4 py-6 text-center text-sm">
          <p>Registration is disabled on this deployment.</p>
          <p className="mt-2 text-muted-foreground">
            Ask an administrator for an account, then{" "}
            <Link
              to="/auth/sign-in"
              className="font-medium text-foreground underline underline-offset-4"
            >
              sign in
            </Link>
            .
          </p>
        </div>
      )}
    </AuthShell>
  );
}
