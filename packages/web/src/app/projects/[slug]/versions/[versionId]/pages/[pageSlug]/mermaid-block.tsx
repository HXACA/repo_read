"use client";

import { useEffect, useRef, useState } from "react";

export function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "loose",
      });
      const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
      mermaid
        .render(id, code)
        .then(({ svg: renderedSvg }) => {
          if (!cancelled) setSvg(renderedSvg);
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        <code>{code}</code>
        <p className="mt-2 text-xs">{error}</p>
      </pre>
    );
  }

  if (!svg) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-800">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-4 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
