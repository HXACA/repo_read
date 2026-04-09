"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

type ReviewConclusion = {
  verdict: "pass" | "revise";
  blockers: string[];
  factual_risks: string[];
  missing_evidence: string[];
  scope_violations: string[];
  suggested_revisions: string[];
};

type Props = {
  reviewStatus?: string;
  reviewDigest?: string;
  locale: "zh" | "en";
};

function parseConclusion(digest?: string): ReviewConclusion | null {
  if (!digest) return null;
  try {
    return JSON.parse(digest) as ReviewConclusion;
  } catch {
    return null;
  }
}

export function ReviewButton({ reviewStatus, reviewDigest, locale }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(t) &&
        popoverRef.current &&
        !popoverRef.current.contains(t)
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

  const conclusion = parseConclusion(reviewDigest);
  if (!reviewStatus) return null;

  const zh = locale === "zh";
  const isPass = reviewStatus === "accepted";

  const handleClick = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 16;
    const idealWidth = 480;
    const width = Math.min(idealWidth, vw - margin * 2);

    let left = rect.left;
    if (left + width > vw - margin) left = vw - width - margin;
    if (left < margin) left = margin;

    const spaceBelow = vh - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const minHeight = 200;
    const maxHeight =
      spaceBelow >= minHeight || spaceBelow >= spaceAbove
        ? Math.min(500, spaceBelow - 6)
        : Math.min(500, spaceAbove - 6);
    const top =
      spaceBelow >= minHeight || spaceBelow >= spaceAbove
        ? rect.bottom + window.scrollY + 6
        : rect.top + window.scrollY - maxHeight - 6;

    setPosition({
      top,
      left: left + window.scrollX,
      width,
      maxHeight,
    });
    setOpen((v) => !v);
  };

  const totalIssues = conclusion
    ? conclusion.blockers.length +
      conclusion.factual_risks.length +
      conclusion.missing_evidence.length +
      conclusion.scope_violations.length
    : 0;

  const popover =
    open && position ? (
      <div
        ref={popoverRef}
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
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.625rem 0.875rem",
            background: "var(--rr-bg-surface)",
            borderBottom: "1px solid var(--rr-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--rr-text)",
                fontFamily: "var(--font-display), Georgia, serif",
              }}
            >
              {zh ? "审阅意见" : "Review"}
            </span>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
              style={
                isPass
                  ? { background: "#DCFCE7", color: "#166534" }
                  : { background: "#FEF3C7", color: "#92400E" }
              }
            >
              {isPass
                ? zh
                  ? "通过"
                  : "Pass"
                : zh
                  ? "可改进"
                  : "Revise"}
            </span>
            {totalIssues > 0 && (
              <span
                className="text-[10px]"
                style={{ color: "var(--rr-text-muted)" }}
              >
                {totalIssues} {zh ? "项备注" : "notes"}
              </span>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            style={{
              color: "var(--rr-text-muted)",
              fontSize: "1rem",
              lineHeight: 1,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 0.25rem",
            }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            padding: "0.75rem 0.875rem",
            fontSize: "0.75rem",
            lineHeight: 1.6,
            color: "var(--rr-text-secondary)",
          }}
        >
          {!conclusion && (
            <p style={{ color: "var(--rr-text-muted)" }}>
              {zh ? "无详细审阅内容。" : "No detailed review available."}
            </p>
          )}
          {conclusion && totalIssues === 0 && conclusion.suggested_revisions.length === 0 && (
            <p style={{ color: "var(--rr-text-muted)" }}>
              {zh
                ? "审阅通过，没有备注。"
                : "Review passed with no notes."}
            </p>
          )}
          {conclusion && (
            <div className="space-y-3">
              <Section
                title={zh ? "阻塞问题" : "Blockers"}
                items={conclusion.blockers}
                accent="#DC2626"
              />
              <Section
                title={zh ? "事实风险" : "Factual risks"}
                items={conclusion.factual_risks}
                accent="#D97706"
              />
              <Section
                title={zh ? "证据缺失" : "Missing evidence"}
                items={conclusion.missing_evidence}
                accent="#6366F1"
              />
              <Section
                title={zh ? "范围越界" : "Scope violations"}
                items={conclusion.scope_violations}
                accent="#9333EA"
              />
              <Section
                title={zh ? "修改建议" : "Suggested revisions"}
                items={conclusion.suggested_revisions}
                accent="#059669"
              />
            </div>
          )}
        </div>
      </div>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors hover:brightness-95"
        style={
          isPass
            ? {
                background: "#DCFCE7",
                color: "#166534",
                border: "1px solid #BBF7D0",
              }
            : {
                background: "#FEF3C7",
                color: "#92400E",
                border: "1px solid #FDE68A",
              }
        }
        title={zh ? "查看审阅意见" : "View review notes"}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          {isPass ? (
            <path
              d="M3 7l3 3 5-6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <>
              <circle cx="7" cy="7" r="5.5" />
              <path d="M7 4v3.5M7 9.5v.1" strokeLinecap="round" />
            </>
          )}
        </svg>
        {zh
          ? isPass
            ? "审阅通过"
            : "审阅可改进"
          : isPass
            ? "Review: Pass"
            : "Review: Notes"}
        {totalIssues > 0 && (
          <span
            className="rounded-full px-1.5 text-[9px] font-bold"
            style={{
              background: "rgba(0,0,0,0.1)",
              minWidth: "1rem",
              textAlign: "center",
            }}
          >
            {totalIssues}
          </span>
        )}
      </button>
      {mounted && popover && createPortal(popover, document.body)}
    </>
  );
}

function Section({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div
        className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: accent }}
      >
        {title}
        <span
          style={{
            marginLeft: "0.375rem",
            color: "var(--rr-text-muted)",
            fontWeight: 500,
          }}
        >
          {items.length}
        </span>
      </div>
      <ul className="space-y-1 pl-3">
        {items.map((item, i) => (
          <li
            key={i}
            style={{
              color: "var(--rr-text)",
              listStyleType: "disc",
              lineHeight: 1.6,
            }}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
