"use client";

import { ChevronDownIcon } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useHydrated } from "./use-hydrated";

interface MatrixState {
  diffOnly: boolean;
  allProps: boolean;
  toggleDiff: () => void;
  toggleProps: () => void;
}

const MatrixContext = createContext<MatrixState | null>(null);

function setParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  // Keep commas readable in shared URLs.
  window.history.replaceState(window.history.state, "", url.pathname + url.search.replace(/%2C/gi, ",").replace(/%3A/gi, ":") + url.hash);
}

/**
 * Wraps the server-rendered matrix. Rows carry Tailwind group-data classes, so toggling only flips
 * data attributes here (instant, no refetch). Without JS the toggles are links that re-render the
 * page with ?diff=1 / ?props=all and the server sets the same attributes.
 */
export function MatrixRoot({
  initialDiffOnly,
  initialAllProps,
  rowCount,
  differingCount,
  children,
}: {
  initialDiffOnly: boolean;
  initialAllProps: boolean;
  rowCount: number;
  differingCount: number;
  children: React.ReactNode;
}) {
  const [diffOnly, setDiffOnly] = useState(initialDiffOnly);
  const [allProps, setAllProps] = useState(initialAllProps);
  const [announce, setAnnounce] = useState("");
  const toggleDiff = useCallback(() => {
    const next = !diffOnly;
    setDiffOnly(next);
    setParam("diff", next ? "1" : null);
    setAnnounce(next ? `Showing ${differingCount} of ${rowCount} rows that differ between systems.` : `Showing all ${rowCount} rows.`);
  }, [diffOnly, differingCount, rowCount]);
  const toggleProps = useCallback(() => {
    const next = !allProps;
    setAllProps(next);
    setParam("props", next ? "all" : null);
  }, [allProps]);
  const value = useMemo(() => ({ diffOnly, allProps, toggleDiff, toggleProps }), [diffOnly, allProps, toggleDiff, toggleProps]);
  return (
    <MatrixContext.Provider value={value}>
      <div className="group/matrix" data-diff={diffOnly ? "on" : "off"} data-props={allProps ? "all" : "collapsed"}>
        {children}
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
      </div>
    </MatrixContext.Provider>
  );
}

function useMatrix() {
  const ctx = useContext(MatrixContext);
  if (!ctx) throw new Error("MatrixRoot missing");
  return ctx;
}

const track = (on: boolean) =>
  cn(
    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors",
    on ? "bg-primary" : "bg-input dark:bg-input/80",
  );
const knob = (on: boolean) =>
  cn("pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform dark:bg-foreground", on ? "translate-x-4 dark:bg-primary-foreground" : "translate-x-0");

/** "Show differences only" switch. A link before hydration, a button[role=switch] after. */
export function DiffToggle({ hrefToggle, differingCount, rowCount }: { hrefToggle: string; differingCount: number; rowCount: number }) {
  const hydrated = useHydrated();
  const { diffOnly, toggleDiff } = useMatrix();
  const inner = (
    <>
      <span className={track(diffOnly)} aria-hidden>
        <span className={knob(diffOnly)} />
      </span>
      <span className="text-sm">Show differences only</span>
      <span className="tabular text-xs text-muted-foreground">
        {differingCount} of {rowCount} rows differ
      </span>
    </>
  );
  const cls = "inline-flex items-center gap-2.5 rounded-md py-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
  if (!hydrated) {
    return (
      <a href={hrefToggle} className={cls} role="switch" aria-checked={diffOnly}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" role="switch" aria-checked={diffOnly} onClick={toggleDiff} className={cls}>
      {inner}
    </button>
  );
}

/** Expands the long tail of aligned props. */
export function PropsToggle({ hiddenCount, hrefToggle, className }: { hiddenCount: number; hrefToggle: string; className?: string }) {
  const hydrated = useHydrated();
  const { allProps, toggleProps } = useMatrix();
  const label = allProps ? "Show fewer props" : `Show ${hiddenCount} more aligned prop${hiddenCount === 1 ? "" : "s"}`;
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    className,
  );
  const icon = <ChevronDownIcon className={cn("size-3.5 transition-transform", allProps && "rotate-180")} aria-hidden />;
  if (!hydrated)
    return (
      <a href={hrefToggle} className={cls}>
        {icon}
        {label}
      </a>
    );
  return (
    <button type="button" onClick={toggleProps} className={cls} aria-expanded={allProps}>
      {icon}
      {label}
    </button>
  );
}
