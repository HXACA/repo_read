"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Fix common LLM-generated Mermaid syntax errors.
 *
 * LLMs frequently output:
 *   - `flow TB/TD/LR/RL/BT` instead of `flowchart TB/TD/...` or `graph TB/...`
 *   - trailing whitespace/comments
 *   - lowercase keywords like `sequencediagram`
 */
function preprocessMermaid(raw: string): string {
  let code = raw.trim();

  // Fix "flow TB" / "flow TD" / etc. → "flowchart TB"
  code = code.replace(/^flow\s+(TB|TD|LR|RL|BT)\b/i, "flowchart $1");

  // Fix lowercase diagram types on first line
  const firstLine = code.split("\n")[0].toLowerCase().trim();
  const diagramFixes: Record<string, string> = {
    "sequencediagram": "sequenceDiagram",
    "classdiagram": "classDiagram",
    "statediagram": "stateDiagram",
    "erdiagram": "erDiagram",
    "gantt": "gantt",
  };
  for (const [lower, correct] of Object.entries(diagramFixes)) {
    if (firstLine.startsWith(lower) && !code.startsWith(correct)) {
      const firstNewline = code.indexOf("\n");
      code =
        correct +
        (firstNewline > 0 ? code.slice(firstNewline) : "");
      break;
    }
  }

  // If no recognized diagram type on first line, default to flowchart TD
  const firstLineTrimmed = code.split("\n")[0].trim();
  const knownTypes = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|sankey-beta|xychart-beta|block-beta)\b/;
  if (!knownTypes.test(firstLineTrimmed)) {
    code = "flowchart TD\n" + code;
  }

  return code;
}

export function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [collapsed, setCollapsed] = useState(false);
  const [showSource, setShowSource] = useState(false);

  // Pan (drag) state refs — refs avoid re-render churn during drag
  const panState = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origTx: number;
    origTy: number;
  }>({ dragging: false, startX: 0, startY: 0, origTx: 0, origTy: 0 });

  // Pinch (two-finger) state refs
  const pinchState = useRef<{
    active: boolean;
    startDist: number;
    startScale: number;
    centerX: number;
    centerY: number;
  }>({ active: false, startDist: 0, startScale: 1, centerX: 0, centerY: 0 });

  useEffect(() => {
    // Reset state when code changes (e.g. navigating pages)
    setSvg("");
    setError("");
    setScale(1);

    let cancelled = false;
    const processed = preprocessMermaid(code);

    import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "loose",
        suppressErrorRendering: true,
      });
      const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
      mermaid
        .render(id, processed)
        .then(({ svg: renderedSvg }) => {
          if (!cancelled) setSvg(renderedSvg);
        })
        .catch((err) => {
          if (!cancelled) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const zoomIn = useCallback(
    () => setScale((s) => Math.min(s + 0.25, 4)),
    [],
  );
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(s - 0.25, 0.25)),
    [],
  );
  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // === Wheel zoom (Ctrl/Cmd + wheel, or trackpad pinch = wheel with ctrlKey) ===
  useEffect(() => {
    const canvas = containerRef.current;
    if (!canvas || !svg) return;

    const onWheel = (e: WheelEvent) => {
      // Zoom: Ctrl/Cmd + wheel, or trackpad pinch (fires wheel with ctrlKey)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        // Cursor position relative to the content origin (accounting for current translate)
        const cx = e.clientX - rect.left - translate.x;
        const cy = e.clientY - rect.top - translate.y;
        setScale((prev) => {
          // Smaller step for pinch (which fires many small events)
          const step = Math.abs(e.deltaY) < 20 ? 0.02 : 0.15;
          const delta = e.deltaY < 0 ? 1 + step : 1 - step;
          const next = Math.min(4, Math.max(0.2, prev * delta));
          // Adjust translate so the point under cursor stays put
          const ratio = next / prev;
          setTranslate((t) => ({
            x: t.x - cx * (ratio - 1),
            y: t.y - cy * (ratio - 1),
          }));
          return next;
        });
      }
      // Regular wheel scrolls the canvas natively (no preventDefault)
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [svg, translate.x, translate.y]);

  // === Pointer drag to pan ===
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only left button / primary pointer
    if (e.button !== 0) return;
    panState.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origTx: translate.x,
      origTy: translate.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [translate.x, translate.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panState.current.dragging) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    setTranslate({
      x: panState.current.origTx + dx,
      y: panState.current.origTy + dy,
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    panState.current.dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  // === Touch pinch zoom (two-finger) ===
  useEffect(() => {
    const canvas = containerRef.current;
    if (!canvas || !svg) return;

    const getDist = (t1: Touch, t2: Touch) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.hypot(dx, dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const cx =
          (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy =
          (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        pinchState.current = {
          active: true,
          startDist: getDist(e.touches[0], e.touches[1]),
          startScale: scale,
          centerX: cx,
          centerY: cy,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchState.current.active) {
        e.preventDefault();
        const dist = getDist(e.touches[0], e.touches[1]);
        const ratio = dist / pinchState.current.startDist;
        const next = Math.min(
          4,
          Math.max(0.2, pinchState.current.startScale * ratio),
        );
        setScale(next);
      }
    };

    const onTouchEnd = () => {
      pinchState.current.active = false;
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [svg, scale]);

  if (error) {
    return (
      <div
        className="not-prose my-6 rounded-lg overflow-hidden"
        style={{
          background: "#FEF2F2",
          border: "1px solid #FCA5A5",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{
            background: "#FEE2E2",
            borderBottom: "1px solid #FCA5A5",
          }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "#991B1B" }}
          >
            Diagram error
          </span>
          <button
            onClick={() => setShowSource(!showSource)}
            className="text-xs underline"
            style={{ color: "#991B1B" }}
          >
            {showSource ? "hide source" : "show source"}
          </button>
        </div>
        <p
          className="px-4 py-2 text-xs leading-relaxed"
          style={{ color: "#991B1B" }}
        >
          {error}
        </p>
        {showSource && (
          <pre
            className="overflow-x-auto px-4 py-3 text-xs"
            style={{
              background: "#FFFFFF",
              color: "#991B1B",
              borderTop: "1px solid #FCA5A5",
            }}
          >
            <code>{code}</code>
          </pre>
        )}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="not-prose mermaid-block">
        <div className="mermaid-toolbar">
          <span className="mermaid-toolbar-label">Diagram</span>
        </div>
        <div className="mermaid-canvas">
          <div
            className="animate-pulse text-sm"
            style={{ color: "var(--rr-text-muted)" }}
          >
            Rendering diagram...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="not-prose mermaid-block">
      <div className="mermaid-toolbar">
        <span className="mermaid-toolbar-label">Diagram</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={zoomOut}
            className="mermaid-toolbar-btn"
            title="Zoom out"
          >
            &minus;
          </button>
          <button
            onClick={resetZoom}
            className="mermaid-toolbar-btn"
            title="Reset zoom"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onClick={zoomIn}
            className="mermaid-toolbar-btn"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="mermaid-toolbar-btn ml-2"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div
          ref={containerRef}
          className="mermaid-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            touchAction: "none",
            cursor: panState.current.dragging ? "grabbing" : "grab",
            userSelect: "none",
          }}
        >
          <div
            ref={innerRef}
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: "top left",
              transition: panState.current.dragging
                ? "none"
                : "transform 0.1s ease-out",
              willChange: "transform",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </div>
  );
}
