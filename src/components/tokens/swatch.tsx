import { cn } from "@/lib/utils";
import { isTranslucent, swatchColor } from "./lib/values";

/**
 * A color swatch. Translucent colors sit on a checkerboard; values that are not statically known
 * (unresolved, external, theme-dependent without a theme) render hatched, never as a guessed color.
 */
export function Swatch({ value, className, title }: { value: unknown; className?: string; title?: string }) {
  const color = swatchColor(value);
  return (
    <span
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-[5px] ring-1 ring-black/10 ring-inset dark:ring-white/12", className)}
      title={title}
      aria-hidden
    >
      {color ? (
        <>
          {isTranslucent(value) && <span className="checker absolute inset-0" />}
          <span className="absolute inset-0" style={{ background: color }} />
          <span className="absolute inset-0 rounded-[5px] ring-1 ring-black/10 ring-inset dark:ring-white/12" />
        </>
      ) : (
        <span className="hatch absolute inset-0 bg-surface-1" />
      )}
    </span>
  );
}

/** Horizontal split swatch: one segment per themed value. */
export function SplitSwatch({ values, className }: { values: { key: string; value: unknown }[]; className?: string }) {
  return (
    <span className={cn("relative flex shrink-0 overflow-hidden rounded-[5px] ring-1 ring-black/10 ring-inset dark:ring-white/12", className)} aria-hidden>
      {values.map((v) => {
        const color = swatchColor(v.value);
        return (
          <span key={v.key} className="relative h-full flex-1">
            {color ? (
              <>
                {isTranslucent(v.value) && <span className="checker absolute inset-0" />}
                <span className="absolute inset-0" style={{ background: color }} />
              </>
            ) : (
              <span className="hatch absolute inset-0" />
            )}
          </span>
        );
      })}
    </span>
  );
}
