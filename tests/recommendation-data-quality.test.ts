import { beforeAll, describe, expect, test } from "bun:test";

/**
 * Recommendation data-quality contracts, asserted at the SQL source level.
 *
 * Why text over fixtures: the data-quality invariants that matter here
 * (published-only enforcement, bounded counts, no random ordering, honest
 * geographic association) live in the Reylo query files, not in
 * JavaScript. These tests pin the query text so a future edit that drops
 * a status filter or swaps deterministic order for RANDOM() fails fast,
 * with no database, no DOM renderer, and no server imports.
 *
 * Live-row evidence (duplicate IDs, actual counts, media assignments) is
 * recorded in `.playwright/recommendation-remediation/evidence.md` from
 * SELECT-only probes against the disposable database; behavior with
 * fixtures stays in `tests/integration/recommendation.test.ts` and
 * `tests/integration/discovery-carousel.test.ts`. Nothing here duplicates
 * those suites.
 */

const SQL_DIR = new URL("../src/modules/food-discovery/server/repository/sql/", import.meta.url);

const stripSqlComments = (sql: string): string =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

const readSql = async (name: string): Promise<string> => Bun.file(new URL(name, SQL_DIR)).text();

const RECOMMENDATION_QUERIES = [
  "dish-recommendation-candidates.sql",
  "dish-recommendation-candidates-nearby.sql",
] as const;

const CAROUSEL_QUERIES = [
  "dish-carousel-country.sql",
  "dish-carousel-nearby.sql",
  "dish-carousel-worldwide.sql",
] as const;

const ALL_QUERIES = [...RECOMMENDATION_QUERIES, ...CAROUSEL_QUERIES] as const;

const sqlByName = new Map<string, string>();
const sqlCodeByName = new Map<string, string>();

beforeAll(async () => {
  const entries = await Promise.all(
    ALL_QUERIES.map(async (name) => [name, await readSql(name)] as const),
  );

  for (const [name, sql] of entries) {
    sqlByName.set(name, sql);
    sqlCodeByName.set(name, stripSqlComments(sql));
  }

  sqlByName.set(
    "dish-media-published-by-dish-ids.sql",
    await readSql("dish-media-published-by-dish-ids.sql"),
  );
});

const sqlOf = (name: string): string => {
  const sql = sqlByName.get(name);

  if (sql === undefined) {
    throw new Error(`SQL fixture not loaded: ${name}`);
  }

  return sql;
};

const sqlCodeOf = (name: string): string => {
  const sql = sqlCodeByName.get(name);

  if (sql === undefined) {
    throw new Error(`SQL fixture not loaded: ${name}`);
  }

  return sql;
};

describe("recommendation and carousel queries stay published-only", () => {
  for (const name of ALL_QUERIES) {
    test(`${name} filters to published dishes`, () => {
      expect(sqlOf(name)).toMatch(/d\.status\s*=\s*'published'/);
    });
  }

  test("published media projection requires published + ready rows", () => {
    const sql = sqlOf("dish-media-published-by-dish-ids.sql");

    expect(sql).toMatch(/m\.status\s*=\s*'published'/);
    expect(sql).toMatch(/m\.processing\s*=\s*'ready'/);
  });

  test("published media projection serves primary-first order", () => {
    expect(sqlOf("dish-media-published-by-dish-ids.sql")).toMatch(
      /ORDER BY m\.dish_id ASC, m\.sort_order ASC, m\.id ASC/,
    );
  });
});

describe("recommendation and carousel counts stay bounded and stable", () => {
  for (const name of ALL_QUERIES) {
    test(`${name} applies the caller limit instead of an open scan`, () => {
      expect(sqlOf(name)).toMatch(/LIMIT :limit::int/);
    });

    test(`${name} never orders randomly`, () => {
      const code = sqlCodeOf(name).toLowerCase();

      expect(code).not.toContain("random()");
      expect(code).not.toContain("order by random");
    });
  }
});

describe("geographic scope stays association-honest", () => {
  test("country filter matches any curated association, never origin-only", () => {
    const sql = sqlOf("dish-recommendation-candidates.sql");

    expect(sql).toContain("FROM feastjourney.dish_places AS dp");
    expect(sql).not.toMatch(/dp\.association/);
  });

  test("place filter values stay parameterized, never interpolated", () => {
    for (const name of RECOMMENDATION_QUERIES) {
      expect(sqlOf(name)).not.toMatch(/\$\{\s*country\s*\}/);
      expect(sqlOf(name)).not.toMatch(/\+\s*country/);
    }
  });
});
