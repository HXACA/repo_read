"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./mermaid-block";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const lang = match?.[1];
          const codeStr = String(children).replace(/\n$/, "");

          // Mermaid diagram
          if (lang === "mermaid") {
            return <MermaidBlock code={codeStr} />;
          }

          // Inline code (no language class, no block)
          if (!className) {
            return (
              <code
                className="rounded bg-gray-100 px-1.5 py-0.5 text-sm dark:bg-gray-800"
                {...props}
              >
                {children}
              </code>
            );
          }

          // Code block
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        // Tables
        table({ children }) {
          return (
            <div className="my-4 overflow-x-auto">
              <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">
                {children}
              </table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th className="border border-gray-200 bg-gray-50 px-4 py-2 text-left text-sm font-semibold dark:border-gray-700 dark:bg-gray-800">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">
              {children}
            </td>
          );
        },
        // Links
        a({ href, children }) {
          const isExternal = href?.startsWith("http");
          return (
            <a
              href={href}
              className="text-blue-600 hover:underline dark:text-blue-400"
              {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
