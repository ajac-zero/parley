import { useSyncExternalStore } from "react";
import { type ActiveTurn, chatStore } from "~/lib/chat-store";

const noopSnapshot = () => undefined;

/** Subscribes to the in-flight turn (if any) for a conversation key. */
export function useActiveTurn(key: string): ActiveTurn | undefined {
  return useSyncExternalStore(
    chatStore.subscribe,
    () => chatStore.get(key),
    noopSnapshot,
  );
}
