import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, Link2, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import {
  removeUser,
  setUserBanned,
  setUserRole,
  updateSettings,
} from "~/functions/admin";
import { A2UI_CATALOG_PLUGINS } from "~/lib/a2ui-catalog-plugins";
import { adminSettingsQuery, agentsQuery, usersQuery } from "~/lib/queries";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (!context.session?.isAdmin) {
      throw redirect({ to: "/chat" });
    }
  },
  component: AdminPage,
});

type Tab = "branding" | "catalogs" | "users";

function AdminPage() {
  const [tab, setTab] = useState<Tab>("branding");

  return (
    <main className="h-full flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-3xl px-4 pt-16 pb-16 md:px-6">
        <h1 className="font-semibold text-2xl tracking-tight">Admin</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Manage this deployment: branding, access, and members.
        </p>

        <div className="mt-6 flex gap-1 border-b">
          {(
            [
              ["branding", "Branding & access"],
              ["catalogs", "Catalogs"],
              ["users", "Members"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors",
                tab === value
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="pt-8">
          {tab === "branding" ? (
            <BrandingTab />
          ) : tab === "catalogs" ? (
            <CatalogsTab />
          ) : (
            <UsersTab />
          )}
        </div>
      </div>
    </main>
  );
}

/* -------------------------------- catalogs ------------------------------- */

function CatalogsTab() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(adminSettingsQuery());
  const [enabled, setEnabled] = useState<string[]>([]);

  useEffect(() => {
    if (settings) setEnabled([...settings.enabledA2uiCatalogPluginKeys]);
  }, [settings]);

  const mutation = useMutation({
    mutationFn: () =>
      updateSettings({ data: { enabledA2uiCatalogPluginKeys: enabled } }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      await router.invalidate();
      toast.success("Catalog settings saved.");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-medium text-lg">Installed catalog plugins</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          These trusted renderers are installed in this Parley build. Disabling
          one falls back to the tool's text response instead of rendering its
          UI.
        </p>
      </div>

      <div className="space-y-3">
        {A2UI_CATALOG_PLUGINS.map((plugin) => {
          const checked = enabled.includes(plugin.key);
          return (
            <div
              key={plugin.key}
              className="flex items-center justify-between gap-4 rounded-xl border p-4 text-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  {plugin.name}
                  {plugin.builtin && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-normal text-muted-foreground text-xs">
                      Built in
                    </span>
                  )}
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                      >
                        <Link2 />
                        Catalog ID
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          {plugin.name} ID
                          {plugin.catalogIds.length === 1 ? "" : "s"}
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                          Catalog ID{plugin.catalogIds.length === 1 ? "" : "s"}{" "}
                          for {plugin.name}.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-2">
                        {plugin.catalogIds.map((catalogId) => (
                          <CatalogIdRow key={catalogId} catalogId={catalogId} />
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {plugin.description}
                </p>
              </div>
              <Switch
                aria-label={`${checked ? "Disable" : "Enable"} ${plugin.name}`}
                checked={checked}
                onCheckedChange={(next) =>
                  setEnabled((current) =>
                    next
                      ? [...new Set([...current, plugin.key])]
                      : current.filter((key) => key !== plugin.key),
                  )
                }
              />
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        disabled={!settings || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Saving…" : "Save catalogs"}
      </Button>
    </div>
  );
}

function CatalogIdRow({ catalogId }: { catalogId: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(catalogId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy the catalog ID.");
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
      <span className="min-w-0 flex-1 select-all break-all px-1 py-0.5 font-mono text-xs">
        {catalogId}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Open catalog ID"
        asChild
      >
        <a href={catalogId} target="_blank" rel="noreferrer noopener">
          <ExternalLink />
        </a>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Catalog ID copied" : "Copy catalog ID"}
        onClick={copy}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/* -------------------------------- branding ------------------------------- */

function BrandingTab() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(adminSettingsQuery());
  const { data: agents = [] } = useQuery(agentsQuery());

  const [form, setForm] = useState({
    appName: "",
    appTagline: "",
    appLogoUrl: "",
    chatDisclaimer: "",
    customCss: "",
    registrationEnabled: true,
    allowUserAgents: true,
    defaultAgentId: "none",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        appName: settings.appName,
        appTagline: settings.appTagline ?? "",
        appLogoUrl: settings.appLogoUrl ?? "",
        chatDisclaimer: settings.chatDisclaimer ?? "",
        customCss: settings.customCss ?? "",
        registrationEnabled: settings.registrationEnabled,
        allowUserAgents: settings.allowUserAgents,
        defaultAgentId: settings.defaultAgentId ?? "none",
      });
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: () =>
      updateSettings({
        data: {
          appName: form.appName.trim() || "Parley",
          appTagline: form.appTagline.trim() || null,
          appLogoUrl: form.appLogoUrl.trim() || null,
          chatDisclaimer: form.chatDisclaimer.trim() || null,
          customCss: form.customCss.trim() || null,
          registrationEnabled: form.registrationEnabled,
          allowUserAgents: form.allowUserAgents,
          defaultAgentId:
            form.defaultAgentId === "none" ? null : form.defaultAgentId,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast.success("Settings saved. Reload to see branding changes.");
    },
    onError: (error) => toast.error(error.message),
  });

  const globalAgents = agents.filter((a) => a.isGlobal);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <section className="space-y-4">
        <h2 className="font-medium text-lg">Branding</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="app-name">App name</Label>
            <Input
              id="app-name"
              value={form.appName}
              onChange={(e) => setForm({ ...form, appName: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-tagline">Tagline</Label>
            <Input
              id="app-tagline"
              value={form.appTagline}
              onChange={(e) => setForm({ ...form, appTagline: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-logo">Logo URL</Label>
          <Input
            id="app-logo"
            value={form.appLogoUrl}
            onChange={(e) => setForm({ ...form, appLogoUrl: e.target.value })}
            placeholder="https://…/logo.svg (leave empty for the default mark)"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-disclaimer">Composer disclaimer</Label>
          <Input
            id="app-disclaimer"
            value={form.chatDisclaimer}
            onChange={(e) =>
              setForm({ ...form, chatDisclaimer: e.target.value })
            }
            placeholder="Agents can make mistakes. Verify important information."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-css">Theme CSS</Label>
          <Textarea
            id="custom-css"
            value={form.customCss}
            onChange={(e) => setForm({ ...form, customCss: e.target.value })}
            placeholder={`Paste a theme from tweakcn.com, e.g.\n:root { --primary: oklch(0.6 0.2 300); … }\n.dark { … }`}
            className="min-h-40 font-mono text-xs"
          />
          <p className="text-muted-foreground text-xs">
            Injected globally. Use{" "}
            <a
              href="https://tweakcn.com"
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              tweakcn.com
            </a>{" "}
            to generate a shadcn/ui theme and paste the CSS variables here.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-medium text-lg">Access</h2>
        <label className="flex items-center justify-between gap-4 rounded-xl border p-4 text-sm">
          <span>
            <span className="block font-medium">Open registration</span>
            <span className="text-muted-foreground">
              Allow anyone to create an account on this deployment.
            </span>
          </span>
          <Switch
            checked={form.registrationEnabled}
            onCheckedChange={(v) =>
              setForm({ ...form, registrationEnabled: v })
            }
          />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-xl border p-4 text-sm">
          <span>
            <span className="block font-medium">Personal agents</span>
            <span className="text-muted-foreground">
              Let members register their own agent endpoints.
            </span>
          </span>
          <Switch
            checked={form.allowUserAgents}
            onCheckedChange={(v) => setForm({ ...form, allowUserAgents: v })}
          />
        </label>
        <div className="space-y-1.5">
          <Label>Default agent for new chats</Label>
          <Select
            value={form.defaultAgentId}
            onValueChange={(v) => setForm({ ...form, defaultAgentId: v })}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No default</SelectItem>
              {globalAgents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}

/* ---------------------------------- users -------------------------------- */

function UsersTab() {
  const queryClient = useQueryClient();
  const { data: users = [] } = useQuery(usersQuery());

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  const roleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "admin" | "user" }) =>
      setUserRole({ data: input }),
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });

  const banMutation = useMutation({
    mutationFn: (input: { userId: string; banned: boolean }) =>
      setUserBanned({ data: input }),
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeUser({ data: { userId } }),
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-4 py-2.5 font-medium">Member</th>
            <th className="px-4 py-2.5 font-medium">Role</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="w-12 px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t">
              <td className="px-4 py-3">
                <div className="font-medium">{user.name}</div>
                <div className="text-muted-foreground text-xs">
                  {user.email}
                </div>
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs",
                    user.role === "admin" &&
                      "border-primary/40 font-medium text-primary",
                  )}
                >
                  {user.role}
                </span>
              </td>
              <td className="px-4 py-3">
                {user.banned ? (
                  <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-destructive text-xs">
                    banned
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">active</span>
                )}
              </td>
              <td className="px-4 py-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Manage ${user.email}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() =>
                        roleMutation.mutate({
                          userId: user.id,
                          role: user.role === "admin" ? "user" : "admin",
                        })
                      }
                    >
                      {user.role === "admin" ? "Demote to user" : "Make admin"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        banMutation.mutate({
                          userId: user.id,
                          banned: !user.banned,
                        })
                      }
                    >
                      {user.banned ? "Unban" : "Ban"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${user.email} and all their data? This cannot be undone.`,
                          )
                        ) {
                          removeMutation.mutate(user.id);
                        }
                      }}
                    >
                      Delete account
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
