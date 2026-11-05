/** ATLAS wordmark glyph: an original meridian/compass mark (no third-party assets). */
export function AtlasMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" opacity="0.9" />
      <ellipse cx="12" cy="12" rx="4.2" ry="9.25" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <path d="M2.9 12h18.2" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <path d="M12 5.2 14.6 12 12 18.8 9.4 12Z" fill="currentColor" />
    </svg>
  );
}
