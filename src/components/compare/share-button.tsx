"use client";

import { CheckIcon, CopyIcon, Link2Icon, LoaderCircleIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useHydrated } from "./use-hydrated";

export interface SharePayload {
  type: string | null;
  systems: string[];
  criteria?: string[];
  picks?: Record<string, string>;
}

/**
 * "Save & share": POST /api/comparisons -> short link /compare/s/<slug>.
 * Without JS it is a plain form POST that the route handler answers with a 303 to the new link.
 */
export function ShareButton({ payload, defaultTitle }: { payload: SharePayload; defaultTitle: string }) {
  const hydrated = useHydrated();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [state, setState] = useState<{ status: "idle" | "saving" | "saved" | "error"; url?: string; message?: string }>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hidden = (
    <>
      {payload.type && <input type="hidden" name="type" value={payload.type} />}
      <input type="hidden" name="systems" value={payload.systems.join(",")} />
      {(payload.criteria ?? []).map((c) => (
        <input key={c} type="hidden" name="criteria" value={c} />
      ))}
      {Object.entries(payload.picks ?? {}).map(([s, c]) => (
        <input key={s} type="hidden" name="pick" value={`${s}:${c}`} />
      ))}
    </>
  );

  if (!hydrated) {
    return (
      <form action="/api/comparisons" method="post">
        {hidden}
        <input type="hidden" name="title" value={defaultTitle} />
        <Button type="submit" variant="outline" size="sm">
          <Link2Icon aria-hidden />
          Save &amp; share
        </Button>
      </form>
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ status: "saving" });
    try {
      const res = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...payload, title: title.trim() || defaultTitle }),
      });
      const body = (await res.json().catch(() => null)) as { data?: { url: string }; error?: { message: string } } | null;
      if (!res.ok || !body?.data) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      const url = new URL(body.data.url, window.location.origin).toString();
      setState({ status: "saved", url });
      toast.success("Comparison saved", { description: "Anyone with the link can open it." });
      requestAnimationFrame(() => inputRef.current?.select());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      setState({ status: "error", message });
      toast.error("Could not save the comparison", { description: message });
    }
  };

  const copy = async () => {
    if (!state.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      inputRef.current?.select();
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && state.status !== "saving") setState({ status: "idle" });
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2Icon aria-hidden />
          Save &amp; share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        {state.status !== "saved" ? (
          <form onSubmit={save} className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Save a shareable link</p>
              <p className="text-xs text-muted-foreground">Saves the selection, not a snapshot: the link always shows current ATLAS data.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-title`} className="text-xs font-medium">
                Title
              </label>
              <input
                id={`${uid}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={140}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
            {state.status === "error" && (
              <p role="alert" className="text-xs text-destructive">
                {state.message}
              </p>
            )}
            <Button type="submit" size="sm" className="w-full" disabled={state.status === "saving"}>
              {state.status === "saving" ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <Link2Icon aria-hidden />}
              {state.status === "saving" ? "Saving…" : "Create link"}
            </Button>
          </form>
        ) : (
          <div className="space-y-3" role="status" aria-live="polite">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CheckIcon className="size-4 text-verified" aria-hidden /> Link created
            </p>
            <div className="flex gap-1.5">
              <label htmlFor={`${uid}-url`} className="sr-only">
                Shareable link
              </label>
              <input
                ref={inputRef}
                id={`${uid}-url`}
                readOnly
                value={state.url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-surface-1 px-2 font-mono text-xs"
              />
              <Button type="button" size="sm" variant="secondary" onClick={copy} aria-label="Copy link">
                {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
