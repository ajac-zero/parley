import { Check, ChevronRight, Copy, Pencil, RefreshCw } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Markdown } from "~/components/chat/markdown";
import { Action, Actions } from "~/components/ui/actions";
import { Button } from "~/components/ui/button";
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
import {
  type ContentPart,
  type FunctionCallItem,
  type FunctionCallOutputItem,
  type MessageItem,
  messageText,
  type ORItem,
  type ReasoningItem,
  reasoningSummaryText,
} from "~/lib/openresponses";
import { cn } from "~/lib/utils";

const FILE_REF_PREFIX = "parley-file:";

export const fileRefToUrl = (ref: string): string =>
  ref.startsWith(FILE_REF_PREFIX)
    ? `/api/files/${ref.slice(FILE_REF_PREFIX.length)}`
    : ref;

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
  // Captured once at mount: whether this block was already streaming when
  // it first appeared. Reasoning's auto-close-after-streaming behavior only
  // makes sense for that case — a block for a persisted/historical item
  // mounts with streaming=false and should just stay closed, never
  // flash open. Passing a defaultOpen that keeps changing with the live
  // `streaming` prop would defeat Reasoning's own "was open by default"
  // check on every re-render.
  const [wasStreamingOnMount] = useState(() => Boolean(streaming));

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
      defaultOpen={wasStreamingOnMount}
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
}: {
  call: FunctionCallItem;
  output?: FunctionCallOutputItem | null;
  streaming?: boolean;
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

  return (
    <Tool>
      <ToolHeader title={call.name} state={state} />
      <ToolContent>
        <ToolInput input={tryPrettyJson(call.arguments || "{}")} />
        <ToolOutput output={outputText} />
      </ToolContent>
    </Tool>
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
