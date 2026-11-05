"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Arrow-key navigation over search results (links marked data-result-link). ArrowDown from the
 * page's search input enters the list; ArrowUp from the first result returns to the input;
 * Home/End jump to the ends. Tab order is untouched, so this is purely additive.
 */
export function ResultKeys({ children, inputId, className }: { children: ReactNode; inputId?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const links = () => Array.from(root.querySelectorAll<HTMLAnchorElement>("a[data-result-link]"));
    const input = inputId ? (document.getElementById(inputId) as HTMLInputElement | null) : null;

    const onInputKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        const first = links()[0];
        if (first) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onListKey = (e: KeyboardEvent) => {
      const all = links();
      const i = all.indexOf(document.activeElement as HTMLAnchorElement);
      if (i < 0) return;
      let next: HTMLAnchorElement | undefined;
      if (e.key === "ArrowDown") next = all[i + 1];
      else if (e.key === "ArrowUp") {
        if (i === 0 && input) {
          e.preventDefault();
          input.focus();
          return;
        }
        next = all[i - 1];
      } else if (e.key === "Home") next = all[0];
      else if (e.key === "End") next = all[all.length - 1];
      else return;
      if (next) {
        e.preventDefault();
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      }
    };
    input?.addEventListener("keydown", onInputKey);
    root.addEventListener("keydown", onListKey);
    return () => {
      input?.removeEventListener("keydown", onInputKey);
      root.removeEventListener("keydown", onListKey);
    };
  }, [inputId]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
