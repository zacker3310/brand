/**
 * Token behavior used by the engine, delegated to the shared token library
 * (src/lib/tokens/{resolve,format,validate}.ts, owned by the token workstream). The engine imports
 * token behavior only from this module so the shared implementation is swapped in one place.
 */
import { formatTokenValue as formatShared } from "@/lib/tokens/format";
import {
  resolutionColumns,
  resolveTokenGraph as resolveShared,
  tokenAliasRows,
  type ResolutionColumns,
  type ResolvableToken,
  type ResolvedTokenInfo,
  type TokenAliasRow,
} from "@/lib/tokens/resolve";
import { validateTokenValue as validateShared } from "@/lib/tokens/validate";

export type GraphTokenInput = ResolvableToken;
export type TokenResolution = ResolvedTokenInfo;
export type { ResolutionColumns, TokenAliasRow };

/** Resolve aliases within one resolution scope (names must be unique; last occurrence wins otherwise). */
export function resolveTokenGraph(tokens: GraphTokenInput[]): Map<string, TokenResolution> {
  return resolveShared(tokens);
}

export { resolutionColumns, tokenAliasRows };

/** Display string of a (resolved) token value; null for null/undefined. */
export function formatTokenValue(value: unknown, type: string | null | undefined): string | null {
  return formatShared(value, type);
}

export interface TokenValueCheck {
  valid: boolean;
  code?: string;
  message?: string;
}

/**
 * Validate a literal token value against its declared DTCG $type. Only explicit types are checked
 * (never the heuristically inferred category); references and unknown types are accepted.
 */
export function validateTokenValue(value: unknown, type: string | null | undefined): TokenValueCheck {
  const r = validateShared(type ?? null, value);
  return { valid: r.ok, code: r.code, message: r.message };
}
