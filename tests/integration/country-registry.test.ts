// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect } from "effect";
import { z } from "zod";

import {
  InvalidLocale,
  InvalidSearchFilter,
  PlaceNotFound,
} from "@/modules/food-discovery/server/domain/errors";
import { AdminService } from "@/modules/food-discovery/server/operations/admin-service";
import { CatalogService } from "@/modules/food-discovery/server/operations/catalog-service";
import { DishService } from "@/modules/food-discovery/server/operations/dish-service";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

/**
 * Country-registry coverage: the chooser behind the recommendation region
 * step and the carousel country scope.
 *
 * Targets the SHIPPED contracts in `CatalogService.listCountries`
 * (kind-filtered at the database level, verified ISO identity, bounded
 * limit) plus the country-scoped public surfaces (`searchDishes`,
 * `getLocalCarousel`) for well-formed-but-unknown and malformed codes.
 *
 * Isolation: unique marker per file run for inserted countries, unique slug
 * prefix for linked dishes, no TRUNCATE, no seed-count coupling (seed ISOs
 * are asserted present, never counted exactly — other suites may add
 * countries to the same disposable database).
 */

const stamp = Date.now().toString(36);
const PREFIX = `cr-${stamp}-`;
const ACTOR = `e2e:country-registry-${stamp}`;
const MARKER = `e2e-country-registry-${stamp}`;

const idRowSchema = z.array(z.object({ id: z.string() }));

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const query = async <T>(statement: (sql: SQL) => Promise<T>): Promise<T> => {
  const sql = new SQL(process.env.DATABASE_URL ?? "");

  try {
    return await statement(sql);
  } finally {
    await sql.end();
  }
};

const listIsos = async (limit?: number): Promise<Array<string>> => {
  const countries = await run(
    Effect.flatMap(CatalogService, (service) => service.listCountries("en", limit)),
  );

  return countries.map((country) => country.iso3166 ?? "");
};

/** Reuse any existing row for the ISO (seed or registry migration), else insert a marker-owned one. */
const ensureCountry = async (iso: string, name: string): Promise<string> => {
  const existing = idRowSchema.parse(
    await query(
      (sql) => sql<Array<{ id: string }>>`
        SELECT id::text AS id FROM feastjourney.places WHERE iso3166 = ${iso} LIMIT 1`,
    ),
  );

  const found = existing[0];

  if (found !== undefined) {
    await query(
      (sql) => sql`
        INSERT INTO feastjourney.place_names (place_id, language_tag, name, is_preferred, search_key)
        SELECT ${found.id}::bigint, 'en', ${name}, TRUE, lower(${name})
        WHERE NOT EXISTS (
          SELECT 1 FROM feastjourney.place_names
          WHERE place_id = ${found.id}::bigint AND language_tag = 'en'
        )`,
    );

    return found.id;
  }

  const created = idRowSchema.parse(
    await query(
      (sql) => sql<Array<{ id: string }>>`
        INSERT INTO feastjourney.places (kind, iso3166, display_latitude, display_longitude, display_note)
        VALUES ('country', ${iso}, 38.0, -97.0, ${MARKER})
        RETURNING id::text AS id`,
    ),
  );

  const placeId = created[0]?.id;

  if (placeId === undefined) {
    throw new Error(`fixture country insert returned no id for ${iso}`);
  }

  await query(
    (sql) => sql`
      INSERT INTO feastjourney.place_names (place_id, language_tag, name, is_preferred, search_key)
      VALUES (${placeId}::bigint, 'en', ${name}, TRUE, lower(${name}))`,
  );

  return placeId;
};

const SEED_ISOS = ["VN", "JP", "KR", "IT", "ES", "MX", "NG", "ET", "IN"] as const;

let usPlaceId = "";
let frPlaceId = "";
let brPlaceId = "";
let usDishSlug = "";

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBeDefined();

  usPlaceId = await ensureCountry("US", "United States");
  frPlaceId = await ensureCountry("FR", "France");
  brPlaceId = await ensureCountry("BR", "Brazil");

  expect(usPlaceId).toMatch(/^[0-9]+$/);
  expect(frPlaceId).toMatch(/^[0-9]+$/);
  expect(brPlaceId).toMatch(/^[0-9]+$/);

  // One published dish linked only to the US fixture: proves per-country
  // selection without depending on any other suite's fixtures.
  const slug = `${PREFIX}us-burger`;
  usDishSlug = slug;

  const created = await run(
    Effect.flatMap(AdminService, (service) =>
      service.createDish(ACTOR, {
        slug,
        status: "draft",
        names: [{ languageTag: "en", name: `Registry Burger ${stamp}`, nameKind: "localized" }],
      }),
    ),
  );

  await run(
    Effect.flatMap(AdminService, (service) =>
      service.upsertDishDescription(ACTOR, created.id, "en", `Registry burger ${stamp}.`, null),
    ),
  );
  await run(
    Effect.flatMap(AdminService, (service) => service.linkDishCategory(ACTOR, created.id, "main")),
  );
  await run(
    Effect.flatMap(AdminService, (service) =>
      service.linkDishPlace(ACTOR, created.id, usPlaceId, "origin", false),
    ),
  );
  await run(
    Effect.flatMap(AdminService, (service) =>
      service.updateDishStatus(ACTOR, created.id, "published"),
    ),
  );
});

afterAll(async () => {
  await query((sql) => sql`DELETE FROM feastjourney.dishes WHERE slug LIKE ${`${PREFIX}%`}`);
  await query((sql) => sql`DELETE FROM feastjourney.places WHERE display_note = ${MARKER}`);
});

describe("country registry", () => {
  test("seed countries resolve with verified ISO identity", async () => {
    const isos = await listIsos();

    for (const iso of SEED_ISOS) {
      expect(isos).toContain(iso);
    }
  });

  test("countries beyond the original nine are listed (US/FR/BR)", async () => {
    const countries = await run(
      Effect.flatMap(CatalogService, (service) => service.listCountries("en", 250)),
    );

    const byIso = new Map(countries.map((country) => [country.iso3166, country]));

    for (const [iso, name] of [
      ["US", "United States"],
      ["FR", "France"],
      ["BR", "Brazil"],
    ] as const) {
      const entry = byIso.get(iso);

      expect(entry).toBeDefined();
      expect(entry?.displayName).toBe(name);
      expect(entry?.kind).toBe("country");
    }
  });

  test("every listed entry is kind-filtered to country with a real ISO", async () => {
    const countries = await run(
      Effect.flatMap(CatalogService, (service) => service.listCountries("en", 250)),
    );

    expect(countries.length).toBeGreaterThan(9);

    for (const country of countries) {
      expect(country.kind).toBe("country");
      expect(country.iso3166).toMatch(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/);
    }
  });

  test("country-scoped search selects only associated dishes", async () => {
    const us = await run(
      Effect.flatMap(DishService, (service) =>
        service.searchDishes({ locale: "en", country: "US", limit: 50 }),
      ),
    );

    expect(us.items.map((item) => item.slug)).toContain(usDishSlug);

    const fr = await run(
      Effect.flatMap(DishService, (service) =>
        service.searchDishes({ locale: "en", country: "FR", limit: 50 }),
      ),
    );

    expect(fr.items.map((item) => item.slug)).not.toContain(usDishSlug);
  });

  test("unknown well-formed codes resolve to null / typed PlaceNotFound", async () => {
    const rows = idRowSchema.parse(
      await query(
        (sql) => sql<Array<{ id: string }>>`
          SELECT id::text AS id FROM feastjourney.places WHERE iso3166 = 'ZZ' LIMIT 1`,
      ),
    );

    expect(rows).toEqual([]);

    const carousel = await runFailure(
      Effect.flatMap(DishService, (service) =>
        service.getLocalCarousel({ locale: "en", country: "ZZ", limit: 5 }),
      ),
    );

    expect(carousel).toBeInstanceOf(PlaceNotFound);

    const search = await runFailure(
      Effect.flatMap(DishService, (service) =>
        service.searchDishes({ locale: "en", country: "ZZ", limit: 5 }),
      ),
    );

    expect(search).toBeInstanceOf(PlaceNotFound);
  });

  test("malformed codes fail closed at every country-scoped surface", async () => {
    const outcomes = await Promise.all(
      ["usa", "U", "XX-TOOLONG", "12"].map(async (country) => ({
        carousel: await runFailure(
          Effect.flatMap(DishService, (service) =>
            service.getLocalCarousel({ locale: "en", country, limit: 5 }),
          ),
        ),
        search: await runFailure(
          Effect.flatMap(DishService, (service) =>
            service.searchDishes({ locale: "en", country, limit: 5 }),
          ),
        ),
      })),
    );

    for (const outcome of outcomes) {
      expect(outcome.carousel).toBeInstanceOf(InvalidSearchFilter);
      expect(outcome.search).toBeInstanceOf(InvalidSearchFilter);
    }
  });

  test("limit is bounded and listing order is deterministic", async () => {
    const capped = await listIsos(500);

    expect(capped.length).toBeLessThanOrEqual(300);

    const first = await listIsos();
    const second = await listIsos();

    expect(second).toEqual(first);
  });

  test("invalid locales are rejected at the registry boundary", async () => {
    const failure = await runFailure(
      Effect.flatMap(CatalogService, (service) => service.listCountries("xx-invalid!", 50)),
    );

    expect(failure).toBeInstanceOf(InvalidLocale);
  });
});
