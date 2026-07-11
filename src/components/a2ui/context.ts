import { createContext, useContext } from "react";
import type { A2uiSurface } from "~/lib/a2ui";

/** Payload handed to the host when the user triggers an A2UI action. */
export interface A2uiActionPayload {
  /** Standard A2UI client -> server messages (versioned envelopes). */
  messages: Array<Record<string, unknown>>;
  /** Human/agent-readable text fallback describing the action. */
  summary: string;
}

export type A2uiActionHandler = (payload: A2uiActionPayload) => void;

export interface A2uiSurfaceContextValue {
  surface: A2uiSurface;
  /** Live data model (the surface's initial model plus local edits). */
  dataModel: unknown;
  /** Two-way binding write at an absolute JSON Pointer. */
  setValue: (pointer: string, value: unknown) => void;
  /** Dispatches a component's `action.event` back to the agent. */
  dispatchEvent: (
    event: Record<string, unknown>,
    sourceComponentId: string,
    base: string,
  ) => void;
  /** True while the conversation can't accept actions (e.g. streaming). */
  disabled: boolean;
}

export const A2uiSurfaceContext = createContext<A2uiSurfaceContextValue | null>(
  null,
);

export function useA2uiSurface(): A2uiSurfaceContextValue {
  const value = useContext(A2uiSurfaceContext);
  if (!value) {
    throw new Error("A2UI catalog components must render inside a surface.");
  }
  return value;
}
