import {
  Check,
  ChevronRight,
  Copy,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Loader2,
  MousePointerClick,
  Paperclip,
  Pencil,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { A2uiActionHandler } from "~/components/a2ui/context";
import { A2uiToolSurfaces } from "~/components/a2ui/surface";
import { Markdown } from "~/components/chat/markdown";
import { useShowReasoning } from "~/components/reasoning-preference";
import { Action, Actions } from "~/components/ui/actions";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "~/components/ui/reasoning";
import { Textarea } from "~/components/ui/textarea";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolState,
} from "~/components/ui/tool";
import { type A2uiCallSurfaces, messageA2uiActions } from "~/lib/a2ui";
import {
  type ContentPart,
  type DownloadableArtifactItem,
  type FunctionCallItem,
  type FunctionCallOutputItem,
  type MessageItem,
  messageText,
  type ORItem,
  type ParleyAttachmentItem,
  type ReasoningItem,
  reasoningSummaryText,
} from "~/lib/openresponses";
import { cn } from "~/lib/utils";

const FILE_REF_PREFIX = "parley-file:";

export const fileRefToUrl = (ref: string): string =>
  ref.startsWith(FILE_REF_PREFIX)
    ? `/api/files/${ref.slice(FILE_REF_PREFIX.length)}`
    : ref;

const parleyFileUrl = (ref: string): string | null => {
  if (!ref.startsWith(FILE_REF_PREFIX)) return null;
  const id = ref.slice(FILE_REF_PREFIX.length);
  return /^file_[a-z0-9]+$/.test(id) ? `/api/files/${id}` : null;
};

export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  let unit = 0;
  // Compare the displayed (rounded) value so e.g. 999,999 B renders as
  // "1 MB" rather than "1,000 KB".
  while (unit < units.length - 1 && Math.round(value * 10) / 10 >= 1000) {
    value /= 1000;
    unit += 1;
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

export function isDownloadableArtifactItem(
  item: ORItem,
): item is DownloadableArtifactItem {
  const value = item as Partial<DownloadableArtifactItem>;
  return (
    value.type === "ajac-zero:artifact" &&
    value.status === "completed" &&
    typeof value.filename === "string" &&
    typeof value.mime_type === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0
  );
}

export function isParleyAttachmentItem(
  item: ORItem,
): item is ParleyAttachmentItem {
  const value = item as Partial<ParleyAttachmentItem>;
  return (
    value.type === "parley:attachment" &&
    value.status === "completed" &&
    typeof value.filename === "string" &&
    typeof value.mime_type === "string" &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    typeof value.file_url === "string" &&
    parleyFileUrl(value.file_url) !== null
  );
}

export type AttachmentKind =
  | "spreadsheet"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "code"
  | "pdf"
  | "text"
  | "file";

export function attachmentKindForMime(mimeType: string): AttachmentKind {
  const mime = mimeType.toLowerCase();
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv"
  ) {
    return "spreadsheet";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (
    mime.includes("zip") ||
    mime.includes("compressed") ||
    mime.includes("archive") ||
    mime.includes("tar")
  ) {
    return "archive";
  }
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("xml") ||
    mime.includes("yaml")
  ) {
    return "code";
  }
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "file";
}

const ATTACHMENT_VISUAL = {
  spreadsheet: {
    Icon: FileSpreadsheet,
    color: "text-emerald-600 dark:text-emerald-400",
  },
  image: { Icon: FileImage, color: "text-violet-600 dark:text-violet-400" },
  audio: { Icon: FileAudio, color: "text-amber-600 dark:text-amber-400" },
  video: { Icon: FileVideo, color: "text-pink-600 dark:text-pink-400" },
  archive: { Icon: FileArchive, color: "text-orange-600 dark:text-orange-400" },
  code: { Icon: FileCode, color: "text-sky-600 dark:text-sky-400" },
  pdf: { Icon: FileText, color: "text-red-600 dark:text-red-400" },
  text: { Icon: FileText, color: "text-blue-600 dark:text-blue-400" },
  file: { Icon: Paperclip, color: "text-muted-foreground" },
} as const;

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return { copied, copy };
}

/* ------------------------------ user message ----------------------------- */

export const UserMessage = memo(function UserMessage({
  item,
  onEdit,
  disabled,
}: {
  item: MessageItem;
  onEdit?: (newText: string) => void;
  disabled?: boolean;
}) {
  const text = messageText(item);
  const { copied, copy } = useCopy(text);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const parts: ContentPart[] =
    typeof item.content === "string"
      ? [{ type: "input_text", text: item.content }]
      : item.content;

  const images = parts.filter((p) => p.type === "input_image");
  const files = parts.filter((p) => p.type === "input_file");
  const a2uiActions = useMemo(() => messageA2uiActions(item), [item]);

  /* A UI interaction routed back through the agent: show a compact chip
   * instead of the machine-readable text fallback. */
  if (a2uiActions.length > 0) {
    return (
      <div className="flex w-full justify-end">
        <div className="flex max-w-[85%] items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-muted-foreground text-sm">
          <MousePointerClick className="size-3.5 shrink-0" />
          <span className="truncate">
            {a2uiActions.map((action) => action.name).join(", ")}
          </span>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex w-full flex-col items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-24 w-full max-w-[85%] resize-y rounded-2xl text-[15px]"
          autoFocus
        />
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setDraft(text);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={draft.trim().length === 0}
            onClick={() => {
              setEditing(false);
              onEdit?.(draft);
            }}
          >
            Send
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/user flex w-full flex-col items-end gap-1.5">
      {images.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {images.map((part, i) => {
            const url = (part as { image_url?: string }).image_url ?? "";
            return (
              <img
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                key={i}
                src={fileRefToUrl(url)}
                alt="attachment"
                className="max-h-64 rounded-xl border object-cover"
              />
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {files.map((part, i) => {
            const record = part as { filename?: string; file_url?: string };
            return (
              <a
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                key={i}
                href={record.file_url ? fileRefToUrl(record.file_url) : "#"}
                className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent"
                download={record.filename}
              >
                📄 {record.filename ?? "attachment"}
              </a>
            );
          })}
        </div>
      )}
      {text.length > 0 && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-secondary px-4 py-2.5 text-[15px] text-secondary-foreground leading-6">
          {text}
        </div>
      )}
      <Actions className="gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100">
        <Action
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={copy}
          aria-label="Copy message"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Action>
        {onEdit && (
          <Action
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => setEditing(true)}
            disabled={disabled}
            aria-label="Edit message"
          >
            <Pencil className="size-3.5" />
          </Action>
        )}
      </Actions>
    </div>
  );
});

/* --------------------------- assistant message --------------------------- */

export const AssistantMessage = memo(function AssistantMessage({
  item,
  streaming,
  onRegenerate,
  isLast,
}: {
  item: MessageItem;
  streaming?: boolean;
  onRegenerate?: () => void;
  isLast?: boolean;
}) {
  const text = messageText(item);
  const { copied, copy } = useCopy(text);

  const refusal = useMemo(() => {
    if (typeof item.content === "string") return null;
    const part = item.content.find((p) => p.type === "refusal") as
      | { refusal?: string }
      | undefined;
    return part?.refusal ?? null;
  }, [item.content]);

  return (
    <div className="group/assistant w-full">
      {refusal ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[15px]">
          {refusal}
        </div>
      ) : (
        <Markdown text={text} streaming={streaming} />
      )}
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-foreground/70 align-text-bottom" />
      )}
      {!streaming && (
        <Actions className="mt-1.5 gap-0.5 opacity-0 transition-opacity group-hover/assistant:opacity-100">
          <Action
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={copy}
            aria-label="Copy response"
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Action>
          {isLast && onRegenerate && (
            <Action
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={onRegenerate}
              aria-label="Regenerate response"
            >
              <RefreshCw className="size-3.5" />
            </Action>
          )}
        </Actions>
      )}
    </div>
  );
});

export const AssistantAttachment = memo(function AssistantAttachment({
  item,
}: {
  item: ParleyAttachmentItem;
}) {
  const url = parleyFileUrl(item.file_url);
  if (!url) return null;
  const { Icon: FileIcon, color } =
    ATTACHMENT_VISUAL[attachmentKindForMime(item.mime_type)];
  return (
    <a
      href={url}
      download={item.filename}
      className="flex w-fit max-w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-sm transition-colors hover:bg-accent"
    >
      <FileIcon className={cn("size-4 shrink-0", color)} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{item.filename}</span>
        <span className="text-muted-foreground text-xs">
          {item.mime_type} · {formatFileSize(item.size)}
        </span>
      </span>
    </a>
  );
});

export const PreparingArtifact = memo(function PreparingArtifact({
  item,
}: {
  item: DownloadableArtifactItem;
}) {
  return (
    <div
      role="status"
      aria-label={`Preparing download ${item.filename}`}
      className="flex w-fit max-w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-sm"
    >
      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{item.filename}</span>
        <span className="text-muted-foreground text-xs">
          Preparing download · {formatFileSize(item.size)}
        </span>
      </span>
    </div>
  );
});

/* -------------------------------- reasoning ------------------------------ */

export const ReasoningBlock = memo(function ReasoningBlock({
  item,
  streaming,
}: {
  item: ReasoningItem;
  streaming?: boolean;
}) {
  const summary = reasoningSummaryText(item);
  const hasContent = summary.trim().length > 0;
  // The "show reasoning" preference (see settings) is the block's default
  // open/closed state — on, it starts (and stays) expanded so it can be
  // read at whatever pace the user wants, with no auto-collapse fighting
  // long or short reasoning; off, it starts collapsed and only opens if
  // the user clicks it.
  const { showReasoning } = useShowReasoning();

  if (!hasContent) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
        {streaming ? (
          <span className="animate-pulse">Thinking…</span>
        ) : (
          "Thought process"
        )}
      </div>
    );
  }

  return (
    <Reasoning
      className="w-full"
      isStreaming={streaming}
      defaultOpen={showReasoning}
    >
      <ReasoningTrigger />
      <ReasoningContent>{summary}</ReasoningContent>
    </Reasoning>
  );
});

/* ------------------------------- tool calls ------------------------------ */

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export const ToolCallBlock = memo(function ToolCallBlock({
  call,
  output,
  streaming,
  a2ui,
  onA2uiAction,
  disabled,
}: {
  call: FunctionCallItem;
  output?: FunctionCallOutputItem | null;
  streaming?: boolean;
  /**
   * A2UI surfaces anchored at this call, reduced conversation-wide by the
   * thread (later tool results may have updated them in place). They render
   * as native UI below the tool card; the raw result stays available inside
   * the collapsible.
   */
  a2ui?: A2uiCallSurfaces | null;
  /** Routes an A2UI action from a rendered surface back to the agent. */
  onA2uiAction?: A2uiActionHandler;
  disabled?: boolean;
}) {
  const outputText = useMemo(() => {
    if (!output) return null;
    if (typeof output.output === "string") return tryPrettyJson(output.output);
    return JSON.stringify(output.output, null, 2);
  }, [output]);

  const state: ToolState = output
    ? "completed"
    : streaming
      ? "running"
      : "pending";

  /* When the result rendered as an A2UI surface — or applied updates to a
   * surface elsewhere in the thread — the surface is the response, so the
   * full tool card is demoted to a compact disclosure chip. It stays one
   * click from the raw args/output (a surface shows what the tool wants
   * seen; the raw result shows what it actually returned), and the full
   * card still appears while the call is running (progress) and for
   * unsupported/fallback results (the card is the content there). */
  const demoted =
    output != null &&
    a2ui != null &&
    (a2ui.surfaces.some((surface) => surface.supported) ||
      (a2ui.surfaces.length === 0 && !a2ui.showFallback));

  return (
    <div className="flex w-full flex-col gap-3">
      {demoted ? (
        <Collapsible className="w-full">
          <CollapsibleTrigger className="group inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent/50">
            <Wrench className="size-3 shrink-0" />
            <span className="truncate font-mono">{call.name}</span>
            <Check className="size-3 shrink-0 text-green-600" />
            <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-3 overflow-hidden rounded-xl border bg-card px-3.5 py-3">
              <ToolInput input={tryPrettyJson(call.arguments || "{}")} />
              <ToolOutput output={outputText} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <Tool>
          <ToolHeader title={call.name} state={state} />
          <ToolContent>
            <ToolInput input={tryPrettyJson(call.arguments || "{}")} />
            <ToolOutput output={outputText} />
          </ToolContent>
        </Tool>
      )}
      {a2ui ? (
        <A2uiToolSurfaces
          group={a2ui}
          onAction={onA2uiAction}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
});

/* ------------------------------ unknown items ---------------------------- */

export const UnknownItemBlock = memo(function UnknownItemBlock({
  item,
}: {
  item: ORItem;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full overflow-hidden rounded-xl border border-dashed bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-muted-foreground text-sm hover:bg-accent/50"
      >
        <span className="font-mono text-xs">{item.type}</span>
        <ChevronRight
          className={cn(
            "ml-auto size-4 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t bg-muted/50 p-3 font-mono text-xs leading-relaxed scrollbar-thin">
          {JSON.stringify(item, null, 2)}
        </pre>
      )}
    </div>
  );
});

/* ------------------------------- indicators ------------------------------ */

export function ThinkingDot() {
  return (
    <div className="flex h-7 items-center">
      <span className="size-3 animate-pulse rounded-full bg-foreground/80" />
    </div>
  );
}
