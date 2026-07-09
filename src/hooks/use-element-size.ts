import { useEffect, useRef, useState } from "react";

/**
 * Tracks an element's rendered height via `ResizeObserver`, so layout
 * elsewhere on the page can react to size changes it doesn't control
 * (e.g. sizing scroll padding to clear a floating overlay whose height
 * changes with its contents, like a composer that grows with attachments
 * or a multi-line textarea).
 *
 * Returns `undefined` until the element has been measured (including
 * during SSR, where there's no DOM to measure) — callers should supply a
 * sensible fallback for that initial render.
 */
export function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // `getBoundingClientRect` (border-box, includes padding/border) is used
    // consistently for both the initial and observed measurements. Mixing
    // this with `entry.contentRect` (content-box only) would under-report
    // the height by the element's padding, which matters here since callers
    // rely on this to clear a floating overlay's full visual footprint.
    const measure = () => setHeight(node.getBoundingClientRect().height);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, height };
}
