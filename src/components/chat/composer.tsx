import { ArrowUp, Loader2, Paperclip, Square, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  PromptInput,
  type PromptInputAttachment,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
  useProviderAttachments,
} from "~/components/ui/prompt-input";
import { cn } from "~/lib/utils";

export interface ComposerProps {
  onSend: (text: string, fileIds: string[]) => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  supportsAttachments?: boolean;
  disclaimer?: string | null;
  autoFocus?: boolean;
  /** Max upload size (MB), for client-side validation. */
  fileMaxMb?: number;
}

/**
 * Uses our own `~/components/ui/prompt-input` (an AI Elements PromptInput
 * adaptation) for the fiddly input mechanics — drag/drop, paste-to-attach,
 * IME-safe Enter-to-send, auto-resize — via `PromptInputProvider`'s lifted
 * state, so this component can drive its own upload-on-attach flow (this
 * app uploads files to /api/files immediately and sends server file ids,
 * rather than the data-URL-at-submit-time model PromptInput ships with).
 */
export function Composer(props: ComposerProps) {
  return (
    <PromptInputProvider>
      <ComposerInner {...props} />
    </PromptInputProvider>
  );
}

function ComposerInner({
  onSend,
  onStop,
  busy,
  disabled,
  placeholder = "Message your agent…",
  supportsAttachments = true,
  disclaimer,
  autoFocus,
  fileMaxMb = 10,
}: ComposerProps) {
  const attachments = useProviderAttachments();
  const controller = usePromptInputController();
  const inputId = useId();

  const seenRef = useRef(new Set<string>());
  const fileIdMapRef = useRef(new Map<string, string>());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const text = controller.textInput.value;

  /* Upload each attachment to /api/files as soon as it's added. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: attachments.remove is stable
  useEffect(() => {
    for (const file of attachments.files) {
      if (seenRef.current.has(file.id)) continue;
      seenRef.current.add(file.id);
      setUploadingIds((prev) => new Set(prev).add(file.id));
      uploadAttachment(file);
    }

    async function uploadAttachment(file: PromptInputAttachment) {
      try {
        const blob = await fetch(file.url).then((r) => r.blob());
        const form = new FormData();
        form.append("file", blob, file.filename);
        const res = await fetch("/api/files", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? "Upload failed.");
        }
        const uploaded = (await res.json()) as { id: string };
        fileIdMapRef.current.set(file.id, uploaded.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Upload failed.");
        attachments.remove(file.id);
      } finally {
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(file.id);
          return next;
        });
      }
    }
  }, [attachments.files]);

  const uploadsPending = uploadingIds.size > 0;
  const hasUploadedFile = attachments.files.some((f) =>
    fileIdMapRef.current.has(f.id),
  );
  const canSend =
    !disabled &&
    !busy &&
    !uploadsPending &&
    (text.trim().length > 0 || hasUploadedFile);

  const handleSubmit = (message: PromptInputMessage) => {
    // Throwing (rather than returning) tells PromptInput not to clear the
    // text/attachments — Enter can still reach here while busy/disabled, and
    // a silent no-op-but-clear would wipe out what the user typed.
    if (!canSend) throw new Error("Composer is not ready to send.");
    const fileIds = message.files.flatMap((f) => {
      const id = fileIdMapRef.current.get(f.id);
      return id ? [id] : [];
    });
    onSend(message.text, fileIds);
  };

  const status = busy ? "streaming" : "ready";

  return (
    <div className="w-full">
      <PromptInput
        onSubmit={handleSubmit}
        multiple
        maxFiles={10}
        maxFileSize={fileMaxMb * 1024 * 1024}
        onError={(err) => {
          toast.error(
            err.code === "max_file_size"
              ? `Files must be under ${fileMaxMb} MB.`
              : err.message,
          );
        }}
        className={cn(
          "relative rounded-[26px] border bg-card shadow-xs transition-shadow",
          "focus-within:border-ring/60 focus-within:shadow-sm",
        )}
      >
        {attachments.files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachments.files.map((attachment) => {
              const uploading = uploadingIds.has(attachment.id);
              const isImage = attachment.mediaType.startsWith("image/");
              return (
                <div
                  key={attachment.id}
                  className="group/attachment relative flex items-center gap-2 rounded-xl border bg-muted/50 py-1.5 pr-8 pl-2 text-sm"
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : isImage ? (
                    <img
                      src={attachment.url}
                      alt={attachment.filename}
                      className="size-8 rounded-md object-cover"
                    />
                  ) : (
                    <span>📄</span>
                  )}
                  <span className="max-w-40 truncate">
                    {attachment.filename}
                  </span>
                  <button
                    type="button"
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => attachments.remove(attachment.id)}
                    aria-label={`Remove ${attachment.filename}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-1.5 p-2.5">
          {supportsAttachments && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-full text-muted-foreground"
              onClick={attachments.openFileDialog}
              disabled={disabled}
              aria-label="Attach files"
            >
              <Paperclip className="size-4.5" />
            </Button>
          )}

          <PromptInputTextarea
            id={inputId}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            className="self-center"
          />

          <PromptInputSubmit
            status={status}
            onStop={onStop}
            disabled={!busy && !canSend}
          >
            {busy ? (
              <Square className="size-4 fill-current" />
            ) : (
              <ArrowUp className="size-5" />
            )}
          </PromptInputSubmit>
        </div>
      </PromptInput>

      <p className="px-2 pt-2 pb-1 text-center text-muted-foreground text-xs">
        {disclaimer ??
          "Agents can make mistakes. Verify important information."}
      </p>
    </div>
  );
}
