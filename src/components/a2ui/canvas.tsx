/**
 * The side canvas: a persistent pane for A2UI surfaces the user pinned out
 * of the transcript flow (e.g. something interactive they want to keep
 * using while the conversation continues). Placement is purely host
 * policy — pinned surfaces are the same conversation-wide state as their
 * inline counterparts, so agent-driven updates keep landing on them here,
 * and actions route back exactly as they do inline.
 */

import { Pin, PinOff } from "lucide-react";
import { memo } from "react";
import type { A2uiActionHandler } from "~/components/a2ui/context";
import { A2uiSurfaceView } from "~/components/a2ui/surface";
import type { A2uiSurface } from "~/lib/a2ui";

export interface A2uiCanvasItem {
  surface: A2uiSurface;
  /** Anchor tool call name, shown as the item's caption. */
  title: string;
}

export const A2uiCanvas = memo(function A2uiCanvas({
  items,
  onAction,
  onUnpin,
  disabled,
}: {
  items: A2uiCanvasItem[];
  onAction?: A2uiActionHandler;
  onUnpin: (surfaceId: string) => void;
  disabled?: boolean;
}) {
  return (
    <aside className="flex h-full w-104 shrink-0 flex-col border-l bg-background">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b px-4">
        <Pin className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-sm">Pinned</span>
        <span className="text-muted-foreground text-xs">{items.length}</span>
      </header>
      <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto p-4">
        {items.map(({ surface, title }) => (
          <section key={surface.surfaceId} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-muted-foreground text-xs">
                {title}
              </span>
              <button
                type="button"
                onClick={() => onUnpin(surface.surfaceId)}
                title="Unpin"
                className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <PinOff className="size-3.5" />
              </button>
            </div>
            <A2uiSurfaceView
              surface={surface}
              onAction={onAction}
              disabled={disabled}
            />
          </section>
        ))}
      </div>
    </aside>
  );
});
