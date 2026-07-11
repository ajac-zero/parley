/**
 * A2UI surface rendering: turns the typed `application/a2ui+json` resources
 * found in a tool result into live, locally-stateful UI (Level 1 of
 * docs/generative-ui.md).
 *
 * Each surface owns a local data model: input components read from and
 * write to it immediately (two-way binding, no network traffic). State
 * reaches the agent only when the user triggers an action, which the host
 * routes back as a user turn via `onAction`.
 */

import { LayoutDashboard } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { CatalogNode } from "~/components/a2ui/catalog";
import {
  type A2uiActionHandler,
  A2uiSurfaceContext,
  type A2uiSurfaceContextValue,
} from "~/components/a2ui/context";
import { Markdown } from "~/components/chat/markdown";
import {
  type A2uiExtraction,
  type A2uiSurface,
  buildA2uiClientMessages,
  pointerSet,
  reduceA2uiMessages,
  resolveDynamic,
  summarizeA2uiAction,
  toDisplayString,
} from "~/lib/a2ui";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Renders one supported surface with live local state. */
export const A2uiSurfaceView = memo(function A2uiSurfaceView({
  surface,
  onAction,
  disabled,
}: {
  surface: A2uiSurface;
  onAction?: A2uiActionHandler;
  disabled?: boolean;
}) {
  const [dataModel, setDataModel] = useState<unknown>(() => surface.dataModel);
  /* Mirror for reads inside event handlers (dispatch resolves bindings at
   * interaction time, against the latest local edits). */
  const modelRef = useRef(dataModel);
  modelRef.current = dataModel;

  const setValue = useCallback((pointer: string, value: unknown) => {
    setDataModel((previous: unknown) => {
      const next = pointerSet(previous, pointer, value);
      modelRef.current = next;
      return next;
    });
  }, []);

  const dispatchEvent = useCallback(
    (
      event: Record<string, unknown>,
      sourceComponentId: string,
      base: string,
    ) => {
      const name = toDisplayString(event.name);
      if (!name || !onAction) return;
      const contextSpec = asRecord(event.context) ?? {};
      const context: Record<string, unknown> = {};
      for (const [key, spec] of Object.entries(contextSpec)) {
        context[key] = resolveDynamic(spec, modelRef.current, base);
      }
      const action = {
        name,
        surfaceId: surface.surfaceId,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context,
      };
      onAction({
        messages: buildA2uiClientMessages(action),
        summary: summarizeA2uiAction(action),
      });
    },
    [onAction, surface.surfaceId],
  );

  const contextValue = useMemo<A2uiSurfaceContextValue>(
    () => ({
      surface,
      dataModel,
      setValue,
      dispatchEvent,
      disabled: disabled ?? false,
    }),
    [surface, dataModel, setValue, dispatchEvent, disabled],
  );

  /* Progressive rendering: nothing paints until "root" exists. */
  if (!surface.components.root) return null;

  return (
    <A2uiSurfaceContext.Provider value={contextValue}>
      <div className="w-full max-w-lg" data-a2ui-surface={surface.surfaceId}>
        <CatalogNode id="root" base="" />
      </div>
    </A2uiSurfaceContext.Provider>
  );
});

/** Graceful degradation for catalogs/versions Parley doesn't support. */
function UnsupportedSurface({
  surface,
  fallbackText,
}: {
  surface: A2uiSurface;
  fallbackText: string | null;
}) {
  return (
    <div className="w-full max-w-lg rounded-xl border border-dashed bg-card/50 px-4 py-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <LayoutDashboard className="size-3.5" />
        This tool returned an interactive UI
        {surface.catalogId ? (
          <span className="truncate font-mono">({surface.catalogId})</span>
        ) : null}
        that this app can't render.
      </div>
      {fallbackText && (
        <div className="mt-2">
          <Markdown text={fallbackText} />
        </div>
      )}
    </div>
  );
}

/**
 * Renders every A2UI surface found in one tool output. Returns null when
 * the extraction has no resources, so callers can use it unconditionally.
 */
export const A2uiToolSurfaces = memo(function A2uiToolSurfaces({
  extraction,
  onAction,
  disabled,
}: {
  extraction: A2uiExtraction;
  onAction?: A2uiActionHandler;
  disabled?: boolean;
}) {
  const surfaces = useMemo(
    () =>
      reduceA2uiMessages(
        extraction.resources.flatMap((resource) => resource.messages),
      ),
    [extraction],
  );

  if (surfaces.length === 0) {
    if (extraction.resources.length === 0) return null;
    /* Resources were tagged as A2UI but reduced to nothing renderable. */
    return (
      <UnsupportedSurface
        surface={{
          surfaceId: "",
          catalogId: "",
          theme: null,
          components: {},
          dataModel: {},
          supported: false,
        }}
        fallbackText={extraction.fallbackText}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {surfaces.map((surface) =>
        surface.supported ? (
          <A2uiSurfaceView
            key={surface.surfaceId}
            surface={surface}
            onAction={onAction}
            disabled={disabled}
          />
        ) : (
          <UnsupportedSurface
            key={surface.surfaceId}
            surface={surface}
            fallbackText={extraction.fallbackText}
          />
        ),
      )}
    </div>
  );
});
