"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type Props = {
  kind: string;
  target: string;
  locator?: string;
  slug: string;
  versionId: string;
  children: React.ReactNode;
};

type FileSnippet = {
  path: string;
  from: number;
  to: number;
  totalLines: number;
  language: string;
  content: string;
};

/**
 * Inline citation chip that opens a popover with source content when clicked.
 * The popover is rendered via React Portal to escape inline containers (<p>).
 */
export function CitationPopover({
  kind,
  target,
  locator,
  slug,
  versionId,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [snippet, setSnippet] = useState<FileSnippet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: "above" | "below";
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on outside click + ESC
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // For page kind — link directly, but only if target looks like a valid slug
  if (kind === "page") {
    // Valid slug: lowercase letters, digits, hyphens; NOT pure line numbers like "14-19"
    const isValidSlug =
      /^[a-z0-9]+(-[a-z0-9]+)*$/i.test(target) && !/^\d+(-\d+)?$/.test(target);
    if (isValidSlug) {
      return (
        <Link
          href={`/projects/${slug}/versions/${versionId}/pages/${target}`}
          className="cite-chip cite-chip-page"
        >
          <span className="cite-icon">&#9635;</span>
          {children}
        </Link>
      );
    }
    // Malformed page target — render as static chip (no link)
    return (
      <span className="cite-chip cite-chip-page" title="Invalid page reference">
        <span className="cite-icon">&#9635;</span>
        {children}
      </span>
    );
  }

  // For commit kind — simple display, no popover
  if (kind === "commit") {
    return (
      <span className="cite-chip cite-chip-commit">
        <span className="cite-icon">&#8599;</span>
        {children}
      </span>
    );
  }

  // File kind — clickable with popover
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Compute popover position with smart placement (flip + clamp)
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 16;
      const gap = 6;

      // Width: 520px ideal, but clamp to viewport with margins
      const idealWidth = 520;
      const width = Math.min(idealWidth, vw - margin * 2);

      // Horizontal position: align to button's left, clamp to viewport
      let left = rect.left;
      if (left + width > vw - margin) {
        left = vw - width - margin;
      }
      if (left < margin) left = margin;

      // Vertical: flip above if not enough space below
      const spaceBelow = vh - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const minHeight = 120;

      let placement: "above" | "below";
      let top: number;
      let maxHeight: number;

      if (spaceBelow >= minHeight || spaceBelow >= spaceAbove) {
        // Open below
        placement = "below";
        top = rect.bottom + window.scrollY + gap;
        maxHeight = Math.min(420, spaceBelow - gap);
      } else {
        // Open above
        placement = "above";
        maxHeight = Math.min(420, spaceAbove - gap);
        top = rect.top + window.scrollY - maxHeight - gap;
      }

      setPosition({
        top,
        left: left + window.scrollX,
        width,
        maxHeight,
        placement,
      });
    }

    if (!open && !snippet) {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ path: target });
        if (locator) {
          const match = locator.match(/^(\d+)(?:-(\d+))?/);
          if (match) {
            params.set("from", match[1]);
            if (match[2]) params.set("to", match[2]);
            else params.set("to", String(parseInt(match[1], 10) + 20));
          }
        }
        const res = await fetch(`/api/projects/${slug}/file?${params}`);
        if (!res.ok) {
          const data = await res
            .json()
            .catch(() => ({ error: "Failed to load" }));
          setError(data.error ?? "Failed to load");
        } else {
          const data = (await res.json()) as FileSnippet;
          setSnippet(data);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    setOpen(!open);
  };

  const popoverContent =
    open && position ? (
      <div
        ref={popoverRef}
        className="citation-popover"
        style={{
          position: "absolute",
          top: `${position.top}px`,
          left: `${position.left}px`,
          width: `${position.width}px`,
          maxHeight: `${position.maxHeight}px`,
          display: "flex",
          flexDirection: "column",
          zIndex: 9999,
          background: "var(--rr-bg-elevated)",
          border: "1px solid var(--rr-border)",
          borderRadius: "var(--rr-radius)",
          boxShadow: "var(--rr-shadow-lg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.5rem 0.75rem",
            background: "var(--rr-bg-surface)",
            borderBottom: "1px solid var(--rr-border)",
            color: "var(--rr-text-secondary)",
            fontSize: "0.75rem",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono), monospace" }}>
            {target}
            {locator && (
              <span style={{ color: "var(--rr-accent)" }}>:{locator}</span>
            )}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            style={{
              color: "var(--rr-text-muted)",
              marginLeft: "0.5rem",
              fontSize: "1rem",
              lineHeight: 1,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            &times;
          </button>
        </div>
        {loading && (
          <div
            style={{
              padding: "1rem 0.75rem",
              fontSize: "0.75rem",
              color: "var(--rr-text-muted)",
            }}
          >
            <span className="animate-pulse">Loading...</span>
          </div>
        )}
        {error && (
          <div
            style={{
              padding: "0.75rem",
              fontSize: "0.75rem",
              color: "#DC2626",
            }}
          >
            {error}
          </div>
        )}
        {snippet && (
          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              overflowX: "auto",
            }}
          >
            <pre
              style={{
                margin: 0,
                padding: "0.625rem 0.75rem",
                fontSize: "0.6875rem",
                lineHeight: 1.55,
                background: "var(--rr-code-bg)",
                color: "var(--rr-text)",
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              {snippet.content.split("\n").map((line, i) => (
                <div key={i} style={{ display: "flex" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "2.25rem",
                      textAlign: "right",
                      marginRight: "0.625rem",
                      color: "var(--rr-text-muted)",
                      userSelect: "none",
                      flexShrink: 0,
                    }}
                  >
                    {snippet.from + i}
                  </span>
                  <span style={{ whiteSpace: "pre" }}>{line || " "}</span>
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        className="cite-chip cite-chip-file cursor-pointer hover:brightness-95"
      >
        <span className="cite-icon">&#9776;</span>
        {children}
      </button>
      {mounted && popoverContent && createPortal(popoverContent, document.body)}
    </>
  );
}
