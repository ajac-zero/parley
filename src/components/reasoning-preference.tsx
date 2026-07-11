import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface ShowReasoningContextValue {
  /**
   * The default open/closed state for reasoning blocks. When true (the
   * default), blocks start expanded so the user can watch the model
   * think, at whatever pace they read. When false, blocks start
   * collapsed — the user can still click one open to read it — for
   * people who just want to focus on the final response.
   */
  showReasoning: boolean;
  setShowReasoning: (value: boolean) => void;
}

const ShowReasoningContext = createContext<ShowReasoningContextValue>({
  showReasoning: true,
  setShowReasoning: () => {},
});

const STORAGE_KEY = "parley-show-reasoning";

function readPreference(): boolean {
  if (typeof window === "undefined") return true;
  // Only ever explicitly stored as "0" to opt out; anything else (including
  // never having been set) preserves today's default of showing reasoning.
  return window.localStorage.getItem(STORAGE_KEY) !== "0";
}

export function ShowReasoningProvider({ children }: { children: ReactNode }) {
  const [showReasoning, setShowReasoningState] = useState(true);

  // Sync from storage after hydration. There's no flash-of-wrong-content
  // concern here (unlike theme): this only affects a chat message
  // component's default open/closed state on mount, which is already
  // inherently client-driven.
  useEffect(() => {
    setShowReasoningState(readPreference());
  }, []);

  const setShowReasoning = useCallback((value: boolean) => {
    setShowReasoningState(value);
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  }, []);

  const value = useMemo(
    () => ({ showReasoning, setShowReasoning }),
    [showReasoning, setShowReasoning],
  );

  return (
    <ShowReasoningContext.Provider value={value}>
      {children}
    </ShowReasoningContext.Provider>
  );
}

export const useShowReasoning = () => useContext(ShowReasoningContext);
