import { ArrowUp, Loader2, Paperclip, Square, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export interface PendingAttachment {
  localId: string;
  fileId: string | null;
  name: string;
  mimeType: string;
  isImage: boolean;
  uploading: boolean;
}

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

export function Composer({
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
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [resize]);

  const uploadsPending = attachments.some((a) => a.uploading);
  const canSend =
    !disabled &&
    !busy &&
    !uploadsPending &&
    (text.trim().length > 0 || attachments.some((a) => a.fileId));

  const handleSend = () => {
    if (!canSend) return;
    const fileIds = attachments.flatMap((a) => (a.fileId ? [a.fileId] : []));
    onSend(text, fileIds);
    setText("");
    setAttachments([]);
    requestAnimationFrame(() => {
      resize();
      textareaRef.current?.focus();
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files).slice(0, 10 - attachments.length)) {
      if (file.size > fileMaxMb * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds the ${fileMaxMb} MB limit.`);
        continue;
      }
      const localId = `${Date.now()}-${file.name}-${Math.random()}`;
      const isImage = file.type.startsWith("image/");
      setAttachments((prev) => [
        ...prev,
        {
          localId,
          fileId: null,
          name: file.name,
          mimeType: file.type,
          isImage,
          uploading: true,
        },
      ]);
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch("/api/files", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? "Upload failed.");
        }
        const uploaded = (await res.json()) as { id: string };
        setAttachments((prev) =>
          prev.map((a) =>
            a.localId === localId
              ? { ...a, fileId: uploaded.id, uploading: false }
              : a,
          ),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Upload failed.");
        setAttachments((prev) => prev.filter((a) => a.localId !== localId));
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="w-full">
      <div
        className={cn(
          "relative rounded-[26px] border bg-card shadow-xs transition-shadow",
          "focus-within:border-ring/60 focus-within:shadow-sm",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachments.map((attachment) => (
              <div
                key={attachment.localId}
                className="group/attachment relative flex items-center gap-2 rounded-xl border bg-muted/50 py-1.5 pr-8 pl-2 text-sm"
              >
                {attachment.uploading ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : attachment.isImage && attachment.fileId ? (
                  <img
                    src={`/api/files/${attachment.fileId}`}
                    alt={attachment.name}
                    className="size-8 rounded-md object-cover"
                  />
                ) : (
                  <span>📄</span>
                )}
                <span className="max-w-40 truncate">{attachment.name}</span>
                <button
                  type="button"
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() =>
                    setAttachments((prev) =>
                      prev.filter((a) => a.localId !== attachment.localId),
                    )
                  }
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5 p-2.5">
          {supportsAttachments && (
            <>
              <input
                ref={fileInputRef}
                id={inputId}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-full text-muted-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                aria-label="Attach files"
              >
                <Paperclip className="size-4.5" />
              </Button>
            </>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              resize();
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            // biome-ignore lint/a11y/noAutofocus: chat composer focus is expected UX
            autoFocus={autoFocus}
            className={cn(
              "max-h-[220px] min-h-9 flex-1 resize-none self-center bg-transparent px-1.5 py-1.5",
              "text-[15px] leading-6 outline-none placeholder:text-muted-foreground",
              "disabled:opacity-50 scrollbar-thin",
            )}
          />

          {busy ? (
            <Button
              type="button"
              size="icon"
              className="size-9 shrink-0 rounded-full"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <Square className="size-4 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="size-9 shrink-0 rounded-full"
              disabled={!canSend}
              onClick={handleSend}
              aria-label="Send message"
            >
              <ArrowUp className="size-5" />
            </Button>
          )}
        </div>
      </div>

      <p className="px-2 pt-2 pb-1 text-center text-muted-foreground text-xs">
        {disclaimer ??
          "Agents can make mistakes. Verify important information."}
      </p>
    </div>
  );
}
