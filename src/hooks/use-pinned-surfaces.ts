import { useCallback, useEffect, useState } from "react";

const storageKey = (conversationId: string) =>
  `parley:a2ui-pins:${conversationId}`;

function readPins(conversationId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(conversationId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Which A2UI surfaces the user pinned to the side canvas, per conversation.
 * Persisted in localStorage (placement is a client-side host preference —
 * it is not part of the conversation itself). Starts empty and loads after
 * hydration so SSR markup and the first client render agree.
 */
export function usePinnedSurfaces(conversationId: string) {
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => setPinned(readPins(conversationId)), [conversationId]);

  const togglePin = useCallback(
    (surfaceId: string) => {
      setPinned((previous) => {
        const next = previous.includes(surfaceId)
          ? previous.filter((id) => id !== surfaceId)
          : [...previous, surfaceId];
        try {
          window.localStorage.setItem(
            storageKey(conversationId),
            JSON.stringify(next),
          );
        } catch {
          /* Storage unavailable: pinning still works for this session. */
        }
        return next;
      });
    },
    [conversationId],
  );

  return { pinned, togglePin };
}
