"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const noopSubscribe = () => () => {};
const isField = (el: Element): el is Field => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;

/**
 * A plain GET form (works without JavaScript) progressively enhanced to apply changes immediately:
 * checkbox/select changes navigate at once, text inputs after a short pause. Repeated keys are
 * folded into comma lists and fields equal to their `data-default` are dropped, so URLs stay short.
 *
 * The URL is the single source of truth: after any navigation (including links such as filter
 * chips) uncontrolled fields are re-synced from the current search params, without stealing focus.
 */
export function AutoSubmitForm({
  action,
  children,
  className,
  id,
  debounceMs = 350,
  role,
  "aria-label": ariaLabel,
}: {
  action: string;
  children: ReactNode;
  className?: string;
  id?: string;
  debounceMs?: number;
  role?: string;
  "aria-label"?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const spKey = sp.toString();
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();
  // true once hydrated (false during SSR), without a setState-in-effect round trip
  const enhanced = useSyncExternalStore(noopSubscribe, () => true, () => false);

  useEffect(() => {
    const t = timer;
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, []);

  // URL -> fields
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const params = new URLSearchParams(spKey);
    const values = (k: string) =>
      params
        .getAll(k)
        .flatMap((v) => v.split(","))
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    for (const el of Array.from(form.elements)) {
      if (!isField(el) || !el.name || el.dataset.noSync !== undefined) continue;
      if (el instanceof HTMLInputElement) {
        if (el.type === "checkbox" || el.type === "radio") el.checked = values(el.name).includes(el.value.toLowerCase());
        else if ((el.type === "search" || el.type === "text") && document.activeElement !== el) el.value = params.get(el.name) ?? "";
      } else if (el instanceof HTMLSelectElement) {
        const v = params.get(el.name) ?? el.dataset.default ?? "";
        if (Array.from(el.options).some((o) => o.value === v)) el.value = v;
      }
    }
  }, [spKey]);

  // fields -> URL
  const submit = () => {
    const form = ref.current;
    if (!form) return;
    const grouped = new Map<string, string[]>();
    for (const el of Array.from(form.elements)) {
      if (!isField(el) || !el.name || el.disabled) continue;
      if (el instanceof HTMLInputElement) {
        if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
        if (el.type === "submit" || el.type === "button" || el.type === "reset") continue;
      }
      const v = el.value.trim();
      if (!v || (el.dataset.default !== undefined && v === el.dataset.default)) continue;
      grouped.set(el.name, [...(grouped.get(el.name) ?? []), v]);
    }
    const params = new URLSearchParams();
    for (const [k, vs] of grouped) params.set(k, [...new Set(vs)].join(","));
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${action}?${qs}` : action, { scroll: false }));
  };

  return (
    <form
      ref={ref}
      id={id}
      action={action}
      method="get"
      role={role}
      aria-label={ariaLabel}
      data-enhanced={enhanced || undefined}
      data-pending={pending || undefined}
      className={cn("group/form", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        submit();
      }}
      onChange={(e) => {
        const t = e.target as HTMLElement;
        if (!isField(t) || t.dataset.noAutosubmit !== undefined || !t.name) return;
        if (t instanceof HTMLInputElement && (t.type === "search" || t.type === "text")) {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(submit, debounceMs);
          return;
        }
        submit();
      }}
    >
      {children}
      <span className="sr-only" aria-live="polite" role="status">
        {pending ? "Updating results…" : ""}
      </span>
    </form>
  );
}
