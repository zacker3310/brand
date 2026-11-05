"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const EVENT = "atlas:motion";

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

/**
 * A dot travelling along a track with the token's real duration and easing (Web Animations API, so the
 * global reduced-motion CSS override does not distort the timing). Loops by default; starts paused when
 * the user prefers reduced motion. Every preview can be paused (WCAG 2.2.2).
 */
export function MotionPreview({ durationMs, easing, label }: { durationMs: number; easing: string; label: string }) {
  const dot = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation | null>(null);
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = dot.current;
    if (!el || typeof el.animate !== "function") return;
    const d = Math.max(1, Math.min(durationMs, 10_000));
    try {
      anim.current = el.animate([{ left: "0%" }, { left: "100%" }], { duration: d, easing, iterations: Infinity, direction: "alternate", endDelay: 350, fill: "both" });
    } catch {
      anim.current = el.animate([{ left: "0%" }, { left: "100%" }], { duration: d, easing: "linear", iterations: Infinity, direction: "alternate", endDelay: 350, fill: "both" });
    }
    anim.current.pause();
    anim.current.currentTime = 0;
    const play = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (play) anim.current.play();
    setPlaying(play);
    const onAll = (e: Event) => {
      const want = (e as CustomEvent<boolean>).detail;
      if (want) anim.current?.play();
      else anim.current?.pause();
      setPlaying(want);
    };
    window.addEventListener(EVENT, onAll);
    return () => {
      window.removeEventListener(EVENT, onAll);
      anim.current?.cancel();
    };
  }, [durationMs, easing]);

  const toggle = () => {
    const a = anim.current;
    if (!a) return;
    if (playing) a.pause();
    else a.play();
    setPlaying(!playing);
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        className="grid size-7 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`${playing ? "Pause" : "Play"} ${label}`}
        aria-pressed={playing}
      >
        {playing ? <PauseIcon className="size-3.5" aria-hidden /> : <PlayIcon className="size-3.5" aria-hidden />}
      </button>
      <span className="relative h-5 min-w-24 flex-1" aria-hidden>
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        <span className="absolute inset-y-0 right-1.5 left-1.5">
          <span ref={dot} className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-sm", reduced && !playing && "opacity-70")} style={{ left: "0%" }} />
        </span>
      </span>
    </div>
  );
}

/** Pause or play every motion preview on the page. */
export function MotionAllToggle() {
  const reduced = useReducedMotion();
  const [on, setOn] = useState<boolean | null>(null);
  const state = on ?? !reduced;
  return (
    <button
      type="button"
      onClick={() => {
        const next = !state;
        setOn(next);
        window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
      }}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {state ? <PauseIcon className="size-3.5" aria-hidden /> : <PlayIcon className="size-3.5" aria-hidden />}
      {state ? "Pause all" : "Play all"}
      {reduced && <span className="text-muted-foreground">(reduced motion)</span>}
    </button>
  );
}

/** Static cubic-bezier curve plot. */
export function EasingCurve({ points, className }: { points: [number, number, number, number]; className?: string }) {
  const [x1, y1, x2, y2] = points;
  const pad = 4;
  const S = 40;
  const ys = [0, 1, y1, y2];
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const X = (x: number) => pad + x * S;
  const Y = (y: number) => pad + S - ((y - min) / span) * S;
  return (
    <svg viewBox={`0 0 ${S + pad * 2} ${S + pad * 2}`} className={cn("size-12 shrink-0 rounded-md border bg-surface-1", className)} aria-hidden>
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} className="stroke-border" strokeDasharray="2 2" />
      <line x1={X(0)} y1={Y(0)} x2={X(x1)} y2={Y(y1)} className="stroke-muted-foreground/50" />
      <line x1={X(1)} y1={Y(1)} x2={X(x2)} y2={Y(y2)} className="stroke-muted-foreground/50" />
      <path d={`M ${X(0)} ${Y(0)} C ${X(x1)} ${Y(y1)}, ${X(x2)} ${Y(y2)}, ${X(1)} ${Y(1)}`} className="fill-none stroke-primary" strokeWidth={1.75} />
    </svg>
  );
}
