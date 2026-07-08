import { Check, Copy } from "lucide-react";
import { memo, useDeferredValue, useEffect, useState } from "react";
import { cn } from "~/lib/utils";

type Highlighter = (code: string, lang: string) => Promise<string>;

let highlighterPromise: Promise<Highlighter> | null = null;

const BUNDLED_LANGS = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "shell",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
];

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(async (shiki) => {
      const highlighter = await shiki.createHighlighter({
        themes: ["github-light-default", "github-dark-default"],
        langs: BUNDLED_LANGS,
      });
      return async (code: string, lang: string) => {
        const language = highlighter.getLoadedLanguages().includes(lang)
          ? lang
          : "text";
        return highlighter.codeToHtml(code, {
          lang: language,
          themes: {
            light: "github-light-default",
            dark: "github-dark-default",
          },
          defaultColor: "light-dark()",
        });
      };
    });
  }
  return highlighterPromise;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label="Copy code"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language: string;
  className?: string;
}) {
  const deferredCode = useDeferredValue(code);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getHighlighter()
      .then((highlight) => highlight(deferredCode, language))
      .then((result) => {
        if (alive) setHtml(result);
      })
      .catch(() => {
        if (alive) setHtml(null);
      });
    return () => {
      alive = false;
    };
  }, [deferredCode, language]);

  return (
    <div
      className={cn(
        "group/code my-3 overflow-hidden rounded-xl border bg-card text-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b bg-muted/50 py-1 pr-1.5 pl-4">
        <span className="font-mono text-muted-foreground text-xs">
          {language || "text"}
        </span>
        <CopyButton text={code} />
      </div>
      {html ? (
        <div
          className="overflow-x-auto p-4 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:m-0 [&_pre]:whitespace-pre scrollbar-thin"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is sanitized highlighting
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed scrollbar-thin">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});
