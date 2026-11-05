"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A plain GET form (works without JavaScript) that, when JS is available, submits on change
 * (debounced for text), drops empty params, navigates client-side without scrolling, and keeps
 * form controls in sync with the URL on back/forward. The URL stays the single source of truth.
 */
export function FilterForm({
  action,
  children,
  className,
  label,
}: {
  action: string;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = useCallback(() => {
    const form = ref.current;
    if (!form) return;
    const qs = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v === "string" && v.trim() !== "") qs.append(k, v.trim());
    }
    const url = qs.size ? `${action}?${qs.toString()}` : action;
    startTransition(() => router.push(url, { scroll: false }));
  }, [action, router]);

  // Back/forward: reflect the URL in uncontrolled controls (never overwrite the field being typed in).
  const spKey = searchParams.toString();
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const sp = new URLSearchParams(spKey);
    for (const el of Array.from(form.elements)) {
      if (el instanceof HTMLInputElement && el.name) {
        if (el.type === "checkbox" || el.type === "radio") {
          const values = sp.getAll(el.name);
          el.checked = el.type === "radio" && el.value === "" ? values.length === 0 : values.includes(el.value);
        } else if ((el.type === "search" || el.type === "text") && el !== document.activeElement) {
          el.value = sp.get(el.name) ?? "";
        }
      } else if (el instanceof HTMLSelectElement && el.name) {
        const v = sp.get(el.name);
        const fallback = el.dataset.default ?? el.options[0]?.value ?? "";
        el.value = v ?? fallback;
      }
    }
  }, [spKey]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <form
      ref={ref}
      method="get"
      action={action}
      role="search"
      aria-label={label}
      data-pending={pending ? "" : undefined}
      aria-busy={pending || undefined}
      className={cn("group/catalog", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        submit();
      }}
      onChange={(e) => {
        const t = e.target;
        if (timer.current) clearTimeout(timer.current);
        if (t instanceof HTMLInputElement && (t.type === "search" || t.type === "text")) {
          timer.current = setTimeout(submit, 320);
        } else {
          submit();
        }
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-14 z-30 h-0.5 origin-left scale-x-0 bg-primary/70 opacity-0 transition-[transform,opacity] duration-700 ease-out group-data-[pending]/catalog:scale-x-75 group-data-[pending]/catalog:opacity-100"
      />
      {children}
    </form>
  );
}

/** Collapses the facet panel on small screens (native <details>, so it also works without JS). */
export function ResponsiveFilters({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      if (mq.matches) el.open = true;
    };
    if (!mq.matches) el.open = false;
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return (
    <details ref={ref} open className={cn("group/filters", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm font-medium lg:hidden [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="mt-3 lg:mt-0">{children}</div>
    </details>
  );
}
