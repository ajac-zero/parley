import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
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
import { createAgent, importAgentCard, updateAgent } from "~/functions/agents";
import type { PublicAgent } from "~/server/services/agents";

interface AgentFormState {
  name: string;
  description: string;
  avatar: string;
  baseUrl: string;
  /** A2A well-known card URL this agent was imported from (null = manual). */
  cardUrl: string | null;
  apiKey: string;
  apiKeyDirty: boolean;
  model: string;
  instructions: string;
  continuation: "replay" | "previous_response_id";
  fileDelivery: "url" | "inline";
  supportsImages: boolean;
  supportsFiles: boolean;
  paramsText: string;
  isEnabled: boolean;
  global: boolean;
}

const emptyForm = (): AgentFormState => ({
  name: "",
  description: "",
  avatar: "",
  baseUrl: "",
  cardUrl: null,
  apiKey: "",
  apiKeyDirty: false,
  model: "",
  instructions: "",
  continuation: "replay",
  fileDelivery: "url",
  supportsImages: false,
  supportsFiles: false,
  paramsText: "",
  isEnabled: true,
  global: false,
});

const formFromAgent = (agent: PublicAgent): AgentFormState => ({
  name: agent.name,
  description: agent.description ?? "",
  avatar: agent.avatar ?? "",
  baseUrl: agent.baseUrl,
  cardUrl: agent.cardUrl,
  apiKey: "",
  apiKeyDirty: false,
  model: agent.model ?? "",
  instructions: agent.instructions ?? "",
  continuation: agent.continuation as "replay" | "previous_response_id",
  fileDelivery: agent.fileDelivery,
  supportsImages: agent.supportsImages,
  supportsFiles: agent.supportsFiles,
  paramsText: agent.params ? JSON.stringify(agent.params, null, 2) : "",
  isEnabled: agent.isEnabled,
  global: agent.isGlobal,
});

export function AgentDialog({
  open,
  onOpenChange,
  agent,
  isAdmin,
  allowUserAgents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create */
  agent: PublicAgent | null;
  isAdmin: boolean;
  allowUserAgents: boolean;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AgentFormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(agent ? formFromAgent(agent) : emptyForm());
      setFormError(null);
      setImportUrl("");
      setImportNote(null);
    }
  }, [open, agent]);

  const set = <K extends keyof AgentFormState>(
    key: K,
    value: AgentFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const importMutation = useMutation({
    mutationFn: (url: string) => importAgentCard({ data: { url } }),
    onSuccess: ({ cardUrl, prefill }) => {
      setForm((prev) => ({
        ...prev,
        name: prefill.name || prev.name,
        description: prefill.description ?? prev.description,
        baseUrl: prefill.baseUrl ?? prev.baseUrl,
        supportsImages: prefill.supportsImages,
        supportsFiles: prefill.supportsFiles,
        cardUrl,
      }));
      setFormError(null);
      if (prefill.baseUrl) {
        setImportNote("Agent card imported. Review the fields below and save.");
      } else {
        setImportNote(
          "Card imported, but it doesn't declare an Open Responses interface — enter the base URL manually.",
        );
      }
    },
    onError: (error) => setImportNote(error.message),
  });

  const runImport = (url: string) => {
    if (url.trim().length === 0 || importMutation.isPending) return;
    setImportNote(null);
    importMutation.mutate(url.trim());
  };

  const mutation = useMutation({
    mutationFn: async () => {
      let params: Record<string, unknown> | null = null;
      if (form.paramsText.trim().length > 0) {
        try {
          const parsed = JSON.parse(form.paramsText) as unknown;
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("not an object");
          }
          params = parsed as Record<string, unknown>;
        } catch {
          throw new Error("Extra parameters must be a JSON object.");
        }
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        avatar: form.avatar.trim() || null,
        baseUrl: form.baseUrl.trim(),
        cardUrl: form.cardUrl,
        // null = keep existing key, "" = clear it, other = set it
        apiKey: agent
          ? form.apiKeyDirty
            ? form.apiKey
            : null
          : form.apiKey || null,
        model: form.model.trim() || null,
        instructions: form.instructions.trim() || null,
        continuation: form.continuation,
        fileDelivery: form.fileDelivery,
        supportsImages: form.supportsImages,
        supportsFiles: form.supportsFiles,
        params,
        isEnabled: form.isEnabled,
        global: form.global,
      };
      return agent
        ? updateAgent({ data: { id: agent.id, agent: payload } })
        : createAgent({ data: payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success(agent ? "Agent updated." : "Agent created.");
      onOpenChange(false);
    },
    onError: (error) => setFormError(error.message),
  });

  const canSubmit =
    form.name.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl scrollbar-thin">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit agent" : "Add an agent"}</DialogTitle>
          <DialogDescription>
            Connect any endpoint that implements the{" "}
            <a
              href="https://openresponses.org"
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              Open Responses
            </a>{" "}
            spec.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          {!agent && (
            <div className="space-y-1.5 rounded-md border p-3">
              <Label htmlFor="agent-import-url">Import from agent card</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-import-url"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://my-agent.example.com"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runImport(importUrl);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    importUrl.trim().length === 0 || importMutation.isPending
                  }
                  onClick={() => runImport(importUrl)}
                >
                  {importMutation.isPending ? "Fetching…" : "Import"}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Fetches <code>/.well-known/agent-card.json</code> (A2A agent
                card) and prefills the form, including the Open Responses URL.
              </p>
              {importNote && <p className="text-xs">{importNote}</p>}
            </div>
          )}

          {agent && form.cardUrl && (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <p className="text-muted-foreground min-w-0 truncate text-xs">
                Imported from <code>{form.cardUrl}</code>
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={importMutation.isPending}
                onClick={() => runImport(form.cardUrl ?? "")}
              >
                {importMutation.isPending ? "Syncing…" : "Re-sync"}
              </Button>
            </div>
          )}
          {agent && form.cardUrl && importNote && (
            <p className="text-xs">{importNote}</p>
          )}

          <div className="grid grid-cols-[1fr_5.5rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">Name *</Label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="My Research Agent"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-avatar">Avatar</Label>
              <Input
                id="agent-avatar"
                value={form.avatar}
                onChange={(e) => set("avatar", e.target.value)}
                placeholder="🔎"
                maxLength={8}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-description">Description</Label>
            <Input
              id="agent-description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What is this agent good at?"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-url">Base URL *</Label>
            <Input
              id="agent-url"
              value={form.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              placeholder="https://my-agent.example.com/v1"
              required
            />
            <p className="text-muted-foreground text-xs">
              Requests go to <code>{"{base URL}"}/responses</code>.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-key">API key</Label>
            <Input
              id="agent-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => {
                set("apiKey", e.target.value);
                set("apiKeyDirty", true);
              }}
              placeholder={
                agent?.hasApiKey
                  ? "•••••••• (stored — leave blank to keep)"
                  : "Optional bearer token"
              }
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs">
              Sent as <code>Authorization: Bearer …</code> and stored encrypted.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">Model</Label>
              <Input
                id="agent-model"
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Conversation state</Label>
              <Select
                value={form.continuation}
                onValueChange={(value) =>
                  set(
                    "continuation",
                    value as "replay" | "previous_response_id",
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replay">
                    Replay transcript (stateless)
                  </SelectItem>
                  <SelectItem value="previous_response_id">
                    previous_response_id (agent stores state)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>File delivery</Label>
              <Select
                value={form.fileDelivery}
                onValueChange={(value) =>
                  set("fileDelivery", value as "url" | "inline")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="url">
                    Capability URL (agent fetches from Parley)
                  </SelectItem>
                  <SelectItem value="inline">
                    Inline base64 (agent cannot reach Parley)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-instructions">Instructions</Label>
            <Textarea
              id="agent-instructions"
              value={form.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder="Optional system instructions sent with every request"
              className="min-h-20"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-params">
              Extra request parameters (JSON)
            </Label>
            <Textarea
              id="agent-params"
              value={form.paramsText}
              onChange={(e) => set("paramsText", e.target.value)}
              placeholder={`{ "temperature": 0.7, "reasoning": { "effort": "medium" } }`}
              className="min-h-16 font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <ToggleRow
              label="Image input"
              checked={form.supportsImages}
              onChange={(v) => set("supportsImages", v)}
            />
            <ToggleRow
              label="File input"
              checked={form.supportsFiles}
              onChange={(v) => set("supportsFiles", v)}
            />
            <ToggleRow
              label="Enabled"
              checked={form.isEnabled}
              onChange={(v) => set("isEnabled", v)}
            />
            {isAdmin && (
              <ToggleRow
                label="Shared with everyone"
                checked={form.global}
                onChange={(v) => set("global", v)}
                disabled={agent !== null}
              />
            )}
          </div>

          {!isAdmin && !allowUserAgents && (
            <p className="text-muted-foreground text-sm">
              Personal agents are disabled on this deployment.
            </p>
          )}

          {formError && <p className="text-destructive text-sm">{formError}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending
                ? "Saving…"
                : agent
                  ? "Save changes"
                  : "Add agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </label>
  );
}
