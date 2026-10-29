/**
 * Bounded Surprise window over an already-ranked candidate list.
 *
 * Seed 0 keeps the stable head; a nonzero seed offsets a window into the
 * pool, so repeated Surprise requests surface different eligible dishes
 * rather than a reordered top 10. The window applies after SQL eligibility
 * and scoring, so hard constraints (published status, cuisine/region,
 * ingredient anti-joins) and allergy refusals are unaffected; there is no
 * ORDER BY random(), and nothing fetches the catalog into JavaScript.
 * Small pools degrade gracefully to the whole pool.
 *
 * Pure and dependency-free so the size matrix is unit-testable without a
 * database; the service owns fetching, scoring, and the seed-0/Muse policy.
 */
export const windowForSurprise = <T>(
  sorted: ReadonlyArray<T>,
  seed: number,
  limit: number,
): Array<T> => {
  if (sorted.length <= limit || seed === 0) {
    return sorted.slice(0, limit);
  }

  const offset = seed % sorted.length;
  const count = Math.min(limit, sorted.length);
  const windowed: Array<T> = [];

  for (let index = 0; index < count; index += 1) {
    const entry = sorted[(offset + index) % sorted.length];

    if (entry !== undefined) {
      windowed.push(entry);
    }
  }

  return windowed;
};
