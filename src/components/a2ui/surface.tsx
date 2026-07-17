/**
 * A2UI surface rendering: turns the typed `application/a2ui+json` resources
 * found in tool results into live, locally-stateful UI (Level 1 of
 * docs/generative-ui.md).
 *
 * Each surface owns a local data model: input components read from and
 * write to it immediately (two-way binding, no network traffic). State
 * reaches the agent only when the user triggers an action, which the host
 * routes back as a user turn via `onAction`. Surfaces are conversation-wide
 * state — a later tool result may update this surface's components or data
 * model in place (see `reduceA2uiOutputs`), which lands here as new
 * `surface.dataOps` / `surface.components` props.
 */

import { LayoutDashboard, Pin } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { CatalogNode } from "~/components/a2ui/catalog";
import {
  type A2uiActionHandler,
  A2uiSurfaceContext,
  type A2uiSurfaceContextValue,
  useA2uiHost,
} from "~/components/a2ui/context";
import { Markdown } from "~/components/chat/markdown";
import {
  type A2uiCallSurfaces,
  type A2uiSurface,
  applyA2uiDataOps,
  buildA2uiClientMessages,
  pointerSet,
  resolveDynamic,
  summarizeA2uiAction,
  toDisplayString,
} from "~/lib/a2ui";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Session-scoped backing store for surface local state, keyed by
 * `${stateScope}:${surfaceId}`. Placement is host policy — the same
 * surface may move between containers (inline in the thread <-> pinned to
 * the side canvas), which unmounts one view instance and mounts another.
 * The mounting instance seeds from here and every update writes through,
 * so the move is lossless for local edits (typed text, slider positions).
 */
interface SurfaceLocalState {
  dataModel: unknown;
  appliedOps: number;
  appliedOpsKey: string;
  generation: string;
  stateKey: string;
}
const surfaceStateStore = new Map<string, SurfaceLocalState>();

const opsKey = (surface: A2uiSurface, count = surface.dataOps.length) =>
  JSON.stringify(surface.dataOps.slice(0, count));

export function reconcileSurfaceLocalState(
  current: SurfaceLocalState,
  surface: A2uiSurface,
  stateKey: string = current.stateKey,
  stored?: SurfaceLocalState,
): SurfaceLocalState | null {
  if (stateKey !== current.stateKey) {
    return stored?.generation === surface.generation
      ? stored
      : {
          dataModel: surface.dataModel,
          appliedOps: surface.dataOps.length,
          appliedOpsKey: opsKey(surface),
          generation: surface.generation,
          stateKey,
        };
  }
  if (surface.generation !== current.generation) {
    return {
      dataModel: surface.dataModel,
      appliedOps: surface.dataOps.length,
      appliedOpsKey: opsKey(surface),
      generation: surface.generation,
      stateKey,
    };
  }
  const prefixUnchanged =
    opsKey(surface, current.appliedOps) === current.appliedOpsKey;
  if (surface.dataOps.length === current.appliedOps && prefixUnchanged) {
    return null;
  }
  return {
    dataModel:
      !prefixUnchanged || surface.dataOps.length < current.appliedOps
        ? surface.dataModel
        : applyA2uiDataOps(
            current.dataModel,
            surface.dataOps.slice(current.appliedOps),
          ),
    appliedOps: surface.dataOps.length,
    appliedOpsKey: opsKey(surface),
    generation: surface.generation,
    stateKey,
  };
}

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
  const host = useA2uiHost();
  const stateKey = `${host?.stateScope ?? ""}:${surface.surfaceId}`;
  const stored = surfaceStateStore.get(stateKey);
  const storedForGeneration =
    stored?.generation === surface.generation ? stored : undefined;
  const [dataModel, setDataModel] = useState<unknown>(
    () => storedForGeneration?.dataModel ?? surface.dataModel,
  );
  /* Merge server data-model updates that arrive after mount (a later tool
   * result patching this surface) into local state without clobbering the
   * user's edits: apply only the ops not yet applied. Render-phase state
   * adjustment, so the same commit that swaps components sees the new data.
   * If history was rewritten (ops shrank — e.g. an edited turn), reseed
   * from the server model and drop local edits. */
  const [appliedOps, setAppliedOps] = useState(
    () => storedForGeneration?.appliedOps ?? surface.dataOps.length,
  );
  const [appliedOpsKey, setAppliedOpsKey] = useState(
    () => storedForGeneration?.appliedOpsKey ?? opsKey(surface),
  );
  const [generation, setGeneration] = useState(surface.generation);
  const [localStateKey, setLocalStateKey] = useState(stateKey);
  const reconciled = reconcileSurfaceLocalState(
    {
      dataModel,
      appliedOps,
      appliedOpsKey,
      generation,
      stateKey: localStateKey,
    },
    surface,
    stateKey,
    stored,
  );
  if (reconciled) {
    surfaceStateStore.set(stateKey, reconciled);
    setDataModel(reconciled.dataModel);
    setAppliedOps(reconciled.appliedOps);
    setAppliedOpsKey(reconciled.appliedOpsKey);
    setGeneration(reconciled.generation);
    setLocalStateKey(reconciled.stateKey);
  }
  /* Mirrors for reads inside event handlers (dispatch resolves bindings at
   * interaction time, against the latest local edits). */
  const modelRef = useRef(dataModel);
  modelRef.current = dataModel;
  const appliedRef = useRef(appliedOps);
  appliedRef.current = appliedOps;

  const setValue = useCallback(
    (pointer: string, value: unknown) => {
      setDataModel((previous: unknown) => {
        const next = pointerSet(previous, pointer, value);
        modelRef.current = next;
        surfaceStateStore.set(stateKey, {
          dataModel: next,
          appliedOps: appliedRef.current,
          appliedOpsKey,
          generation: surface.generation,
          stateKey,
        });
        return next;
      });
    },
    [stateKey, surface.generation, appliedOpsKey],
  );

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

  const pinned = host?.pinnedSurfaceIds.has(surface.surfaceId) ?? false;

  return (
    <A2uiSurfaceContext.Provider value={contextValue}>
      <div
        className="group/surface relative w-full max-w-2xl"
        data-a2ui-surface={surface.surfaceId}
      >
        {/* Pin affordance only: a pinned surface renders in the canvas,
         * whose item header already has an always-visible unpin button. */}
        {host?.togglePin && !pinned && (
          <button
            type="button"
            onClick={() => host.togglePin?.(surface.surfaceId)}
            title="Pin to canvas"
            className="absolute -top-2 -right-2 z-10 rounded-full border bg-card p-1.5 text-muted-foreground opacity-0 shadow-xs transition-opacity focus-visible:opacity-100 group-hover/surface:opacity-100 hover:text-foreground"
          >
            <Pin className="size-3.5" />
          </button>
        )}
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
    <div className="w-full max-w-2xl rounded-xl border border-dashed bg-card/50 px-4 py-3">
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

/** Inline stand-in for a surface currently pinned to the side canvas. */
function PinnedPlaceholder({ onUnpin }: { onUnpin?: () => void }) {
  return (
    <button
      type="button"
      onClick={onUnpin}
      title="Unpin to show inline"
      className="inline-flex w-fit items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent/50"
    >
      <Pin className="size-3 shrink-0" />
      Pinned to canvas
    </button>
  );
}

/**
 * Renders the A2UI surfaces anchored at one tool call (see
 * `reduceA2uiOutputs`: surfaces render where they were created, and may
 * have been updated in place by later tool results). Surfaces the user
 * pinned render in the host's side canvas instead; their anchor shows a
 * small placeholder chip. Returns null when there is nothing to show, so
 * callers can use it unconditionally.
 */
export const A2uiToolSurfaces = memo(function A2uiToolSurfaces({
  group,
  onAction,
  disabled,
}: {
  group: A2uiCallSurfaces;
  onAction?: A2uiActionHandler;
  disabled?: boolean;
}) {
  const host = useA2uiHost();

  if (group.surfaces.length === 0) {
    if (!group.showFallback) return null;
    /* Resources were tagged as A2UI but applied to nothing renderable. */
    return (
      <UnsupportedSurface
        surface={{
          surfaceId: "",
          generation: "unsupported",
          catalogId: "",
          theme: null,
          components: {},
          dataModel: {},
          dataOps: [],
          supported: false,
        }}
        fallbackText={group.fallbackText}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {group.surfaces.map((surface) => {
        if (!surface.supported) {
          return (
            <UnsupportedSurface
              key={surface.surfaceId}
              surface={surface}
              fallbackText={group.fallbackText}
            />
          );
        }
        if (host?.pinnedSurfaceIds.has(surface.surfaceId)) {
          return (
            <PinnedPlaceholder
              key={surface.surfaceId}
              onUnpin={
                host.togglePin
                  ? () => host.togglePin?.(surface.surfaceId)
                  : undefined
              }
            />
          );
        }
        return (
          <A2uiSurfaceView
            key={surface.surfaceId}
            surface={surface}
            onAction={onAction}
            disabled={disabled}
          />
        );
      })}
    </div>
  );
});
