import { createFileRoute } from "@tanstack/react-router";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTheme } from "~/components/theme";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { session } = Route.useRouteContext();
  const { preference, setPreference } = useTheme();

  const [name, setName] = useState(session?.user.name ?? "");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const saveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    const { error } = await authClient.updateUser({ name: name.trim() });
    setSavingName(false);
    if (error) toast.error(error.message ?? "Could not update your name.");
    else {
      toast.success("Name updated.");
      window.location.reload();
    }
  };

  const changePassword = async () => {
    setSavingPassword(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setSavingPassword(false);
    if (error) toast.error(error.message ?? "Could not change your password.");
    else {
      toast.success("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
    }
  };

  return (
    <main className="h-full flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-2xl px-4 pt-16 pb-16 md:px-6">
        <h1 className="font-semibold text-2xl tracking-tight">Settings</h1>

        <section className="mt-8 space-y-4">
          <h2 className="font-medium text-lg">Appearance</h2>
          <div className="flex gap-2">
            {(
              [
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
                ["system", "System", Monitor],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPreference(value)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors hover:bg-accent",
                  preference === value && "border-foreground",
                )}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="font-medium text-lg">Profile</h2>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              value={session?.user.email ?? ""}
              disabled
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <div className="flex gap-2">
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                onClick={saveName}
                disabled={savingName || name.trim() === session?.user.name}
              >
                Save
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="font-medium text-lg">Password</h2>
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <Button
            onClick={changePassword}
            disabled={
              savingPassword ||
              currentPassword.length === 0 ||
              newPassword.length < 8
            }
          >
            {savingPassword ? "Changing…" : "Change password"}
          </Button>
        </section>
      </div>
    </main>
  );
}
