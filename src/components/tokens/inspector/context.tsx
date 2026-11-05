"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, useRef, useState } from "react";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InspectorCtx {
  selectedId: string | null;
  /** Select a token: updates ?token= with history.pushState (no server round trip). */
  select: (id: string) => void;
  clear: () => void;
  /** Element that opened the inspector (focus returns here on close). */
  lastTrigger: React.RefObject<HTMLElement | null>;
}

const Ctx = createContext<InspectorCtx | null>(null);

export function useInspector() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useInspector must be used inside <InspectorProvider>");
  return c;
}

/**
 * Token selection lives in the URL (?token=<id>) so every inspected token is shareable and works without
 * JavaScript (items are plain links). With JS, clicks on [data-inspect] links are intercepted and the URL is
 * updated in place; the inspector fetches the token's detail on its own.
 */
export function InspectorProvider({ children, className, defaultId = null }: { children: React.ReactNode; className?: string; defaultId?: string | null }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const raw = sp.get("token");
  const [dismissed, setDismissed] = useState(false);
  const selectedId = raw && UUID.test(raw) ? raw.toLowerCase() : dismissed ? null : defaultId;
  const lastTrigger = useRef<HTMLElement | null>(null);

  const hrefWith = (id: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (id) next.set("token", id);
    else next.delete("token");
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  const select = (id: string) => window.history.pushState(null, "", hrefWith(id));
  const clear = () => {
    setDismissed(true);
    window.history.pushState(null, "", hrefWith(null));
    const t = lastTrigger.current;
    if (t && document.contains(t)) requestAnimationFrame(() => t.focus());
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-inspect]");
    const id = a?.dataset.inspect;
    if (!a || !id || !UUID.test(id)) return;
    e.preventDefault();
    lastTrigger.current = a;
    select(id.toLowerCase());
  };

  const value = { selectedId, select, clear, lastTrigger };
  return (
    <Ctx.Provider value={value}>
      <div onClickCapture={onClickCapture} className={className} data-inspecting={selectedId ? "true" : "false"}>
        {children}
      </div>
      {selectedId && (
        <style>{`[data-inspect="${selectedId}"]{outline:2px solid var(--ring);outline-offset:2px;border-radius:6px;position:relative;z-index:1}`}</style>
      )}
    </Ctx.Provider>
  );
}
