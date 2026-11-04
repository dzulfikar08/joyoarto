// Cloudflare D1 refuses statements with more than 100 bound parameters; local SQLite allows far more, so any query
// sized by the caller has to be cut into chunks or it passes tests and fails in production.

export const D1_MAX_PARAMS = 100;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Rows per INSERT so that rows * columns stays within the D1 limit. */
export function rowsPerInsert(columns: number): number {
  return Math.max(1, Math.floor(D1_MAX_PARAMS / columns));
}
