"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface NavSection {
  id: string;
  label: string;
  count?: number | null;
}

/**
 * Sticky in-page navigation with scroll-spy. Plain anchor links (works without JS); the active
 * section is tracked with IntersectionObserver and exposed as aria-current="location".
 * Desktop: vertical rail. Small screens: horizontally scrolling bar under the site header.
 */
export function SectionNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  const barRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        if (visible.size) {
          // the section whose top is highest among those intersecting the reading band
          const [id] = [...visible.entries()].sort((a, b) => a[1] - b[1])[0]!;
          setActive(id);
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [sections]);

  // keep the active pill in view on the horizontal (mobile) bar
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !active || bar.scrollWidth <= bar.clientWidth) return;
    const link = bar.querySelector<HTMLAnchorElement>(`a[href="#${CSS.escape(active)}"]`);
    if (!link) return;
    const left = link.offsetLeft - bar.clientWidth / 2 + link.clientWidth / 2;
    bar.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [active]);

  return (
    <nav aria-label="On this page" className="text-[13px]">
      <p className="type-eyebrow mb-3 hidden lg:block">On this page</p>
      <ul
        ref={barRef}
        className="-mx-4 flex gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:py-0 [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((s) => {
          const isActive = s.id === active;
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                aria-current={isActive ? "location" : undefined}
                onClick={() => setActive(s.id)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md px-2.5 py-1 whitespace-nowrap transition-colors lg:border-l-2 lg:rounded-none lg:rounded-r-md lg:px-3 lg:py-1.5",
                  isActive
                    ? "bg-accent text-foreground lg:border-primary lg:bg-transparent"
                    : "text-muted-foreground hover:text-foreground lg:border-transparent",
                )}
              >
                <span>{s.label}</span>
                {s.count !== undefined && s.count !== null && <span className="tabular text-[11px] text-subtle-foreground">{s.count.toLocaleString("en-US")}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
