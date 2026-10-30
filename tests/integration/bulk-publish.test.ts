// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./cleanup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Effect, Layer, ManagedRuntime } from "effect";

import { InvalidDishData } from "@/modules/food-discovery/server/domain/errors";
import { RepositoriesLive } from "@/modules/food-discovery/server/index";
import { AdminService } from "@/modules/food-discovery/server/operations/admin-service";
import {
  BulkPublishService,
  BulkPublishServiceLive,
  MAX_BULK_PUBLISH_IDS,
  MAX_BULK_REVIEW_CANDIDATES,
} from "@/modules/food-discovery/server/operations/bulk-publish-service";
import { CatalogImportService } from "@/modules/food-discovery/server/operations/catalog-import-service";
import { CurationServiceLive } from "@/modules/food-discovery/server/operations/curation-service";
import { DishService } from "@/modules/food-discovery/server/operations/dish-service";
import type { CurationRepository } from "@/modules/food-discovery/server/repository/curation-repository";
import { requirePermission } from "@/server/auth/session";
import { DatabaseLive, type Database } from "@/server/database/client";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./food-auth";

/**
 * Bulk editorial publish coverage for `BulkPublishService`.
 *
 * Imports land dishes in `review`; the public carousel stays
 * published-only. This suite pins the shipped batch contract:
 * per-batch editorial/license acks, bounded batches (<=50 ids),
 * partitioned per-dish outcomes (published / skipped / failed),
 * partial-batch retry, idempotent resume (already-published rows land in
 * `skipped`, never error), keyset-paginated review candidates, and
 * job-scoped import publishing. Authorization (`food:publish`) is enforced
 * at the server-function transport (not yet shipped — owned by the
 * coordinator), so the service layer is covered here plus the permission
 * boundary both sides must satisfy.
 *
 * Isolation: unique slug prefix per file run, no TRUNCATE, no seed-count
 * coupling. Fixture dishes are deleted in afterAll; applied-import dishes
 * are deletable too (import records null the dish link on delete).
 */

const stamp = Date.now().toString(36);
const PREFIX = `bp-${stamp}-`;
const ACTOR = `e2e:bulk-publish-${stamp}`;
const MANUAL_LICENSE = "manual:manual-entry";
const ACKS = { editorialAck: true, licenseAck: true } as const;

const foodAuth = createFoodAuth();

const CurationLive = Layer.provide(CurationServiceLive, RepositoriesLive);

const BulkLive = Layer.provide(
  BulkPublishServiceLive,
  Layer.mergeAll(RepositoriesLive, CurationLive),
);

type BulkEnv = BulkPublishService | Database | CurationRepository;

const bulkRuntime = ManagedRuntime.make(
  Layer.mergeAll(DatabaseLive, RepositoriesLive, CurationLive, BulkLive),
);

const runBulk = <A, E>(effect: Effect.Effect<A, E, BulkEnv>): Promise<A> =>
  bulkRuntime.runPromise(effect);

const runBulkFailure = <A, E>(effect: Effect.Effect<A, E, BulkEnv>): Promise<E> =>
  bulkRuntime.runPromise(Effect.flip(effect));

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

interface ReviewFixtureOptions {
  readonly withDescription?: boolean | undefined;
  readonly withCategory?: boolean | undefined;
}

/** Draft -> review dish; publishable only when description+category are present. */
const createReviewDish = async (
  tag: string,
  options: ReviewFixtureOptions = {},
): Promise<{ readonly id: string; readonly slug: string }> => {
  const slug = `${PREFIX}${tag}`;

  const created = await run(
    Effect.flatMap(AdminService, (service) =>
      service.createDish(ACTOR, {
        slug,
        status: "draft",
        names: [{ languageTag: "en", name: `Bulk Dish ${tag} ${stamp}`, nameKind: "localized" }],
      }),
    ),
  );

  if (options.withDescription !== false) {
    await run(
      Effect.flatMap(AdminService, (service) =>
        service.upsertDishDescription(
          ACTOR,
          created.id,
          "en",
          `Bulk publish fixture ${tag} ${stamp}.`,
          null,
        ),
      ),
    );
  }

  if (options.withCategory !== false) {
    await run(
      Effect.flatMap(AdminService, (service) =>
        service.linkDishCategory(ACTOR, created.id, "soup"),
      ),
    );
  }

  await run(
    Effect.flatMap(AdminService, (service) =>
      service.updateDish(ACTOR, created.id, { status: "review" }),
    ),
  );

  return created;
};

const dishStatus = async (id: string): Promise<string> => {
  const rows = await query(
    (sql) => sql<Array<{ status: string }>>`
      SELECT status FROM feastjourney.dishes WHERE id = ${id}::bigint`,
  );

  const status = rows[0]?.status;

  if (status === undefined) {
    throw new Error(`expected dish ${id} to exist`);
  }

  return status;
};

beforeAll(() => {
  expect(process.env.DATABASE_URL).toBeDefined();
  expect(MAX_BULK_PUBLISH_IDS).toBe(50);
  expect(MAX_BULK_REVIEW_CANDIDATES).toBe(100);
});

afterAll(async () => {
  await query((sql) => sql`DELETE FROM feastjourney.dishes WHERE slug LIKE ${`${PREFIX}%`}`);
  await bulkRuntime.dispose();
  await foodAuth.close();
});

describe("bulk publish authorization", () => {
  test("members without food:publish are denied at the permission boundary", async () => {
    const plain = await foodAuth.signupSignin("bulk-publish-plain");

    const denied = await runFailure(
      requirePermission(new Headers({ cookie: plain.cookies }), {
        resource: "food",
        actions: ["publish"],
      }),
    );

    expect(denied._tag).toBe("InsufficientPermissions");
  });

  test("members without food:import are denied the import path", async () => {
    const plain = await foodAuth.signupSignin("bulk-publish-noimport");

    const denied = await runFailure(
      requirePermission(new Headers({ cookie: plain.cookies }), {
        resource: "food",
        actions: ["import"],
      }),
    );

    expect(denied._tag).toBe("InsufficientPermissions");
  });

  test("owners hold both publish and import grants", async () => {
    const owner = await foodAuth.signupSignin("bulk-publish-owner");
    await foodAuth.grantRole(owner.userId, "owner");

    const publish = await run(
      requirePermission(new Headers({ cookie: owner.cookies }), {
        resource: "food",
        actions: ["publish"],
      }),
    );

    expect(publish.userId).toBe(owner.userId);

    const impor = await run(
      requirePermission(new Headers({ cookie: owner.cookies }), {
        resource: "food",
        actions: ["import"],
      }),
    );

    expect(impor.userId).toBe(owner.userId);
  });
});

describe("bulk publish request guards", () => {
  test("batch requires explicit editorial and license acks", async () => {
    const dish = await createReviewDish("acks-guard");

    const failures = await Promise.all(
      [
        { editorialAck: false, licenseAck: true },
        { editorialAck: true, licenseAck: false },
        { editorialAck: false, licenseAck: false },
      ].map((acks) =>
        runBulkFailure(
          Effect.flatMap(BulkPublishService, (service) =>
            service.publishBatch({ actor: ACTOR, ids: [dish.id], acks }),
          ),
        ),
      ),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(InvalidDishData);
    }

    expect(await dishStatus(dish.id)).toBe("review");
  });

  test("batch rejects empty and over-wide id lists without touching dishes", async () => {
    const dish = await createReviewDish("bounds-guard");

    const empty = await runBulkFailure(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({ actor: ACTOR, ids: [], acks: { ...ACKS } }),
      ),
    );

    expect(empty).toBeInstanceOf(InvalidDishData);

    const wide = await runBulkFailure(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({
          actor: ACTOR,
          ids: Array.from({ length: MAX_BULK_PUBLISH_IDS + 1 }, (_, index) => `${index + 1}`),
          acks: { ...ACKS },
        }),
      ),
    );

    expect(wide).toBeInstanceOf(InvalidDishData);

    expect(await dishStatus(dish.id)).toBe("review");
  });

  test("duplicate, malformed, and unknown ids land in skipped", async () => {
    const dish = await createReviewDish("skipped-guard");

    const report = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({
          actor: ACTOR,
          ids: [dish.id, dish.id, "not-a-number", "999999999999"],
          acks: { ...ACKS },
        }),
      ),
    );

    expect(report.published.map((entry) => entry.id)).toEqual([dish.id]);

    const skippedById = new Map(report.skipped.map((entry) => [entry.id, entry.reason]));

    expect(skippedById.get(dish.id)).toContain("duplicate");
    expect(skippedById.get("not-a-number")).toContain("decimal");
    expect(skippedById.get("999999999999")).toContain("not found");
    expect(report.failed).toEqual([]);
    expect(await dishStatus(dish.id)).toBe("published");
  });
});

describe("bulk publish workflow", () => {
  test("incomplete dishes fail with checklist reasons, never publish", async () => {
    const incomplete = await createReviewDish("incomplete", {
      withDescription: false,
      withCategory: false,
    });

    const report = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({ actor: ACTOR, ids: [incomplete.id], acks: { ...ACKS } }),
      ),
    );

    expect(report.published).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.id).toBe(incomplete.id);
    expect(report.failed[0]?.reasons.join(" ")).toContain("description or summary");
    expect(report.failed[0]?.reasons.join(" ")).toContain("at least one category");
    expect(await dishStatus(incomplete.id)).toBe("review");
  });

  test("partial batch partitions published/failed; retry completes after repair", async () => {
    const [first, second] = await Promise.all([
      createReviewDish("batch-ok-0"),
      createReviewDish("batch-ok-1"),
    ]);

    const broken = await createReviewDish("batch-broken", {
      withDescription: false,
      withCategory: false,
    });

    const attempt = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({
          actor: ACTOR,
          ids: [first.id, second.id, broken.id],
          acks: { ...ACKS },
        }),
      ),
    );

    expect(attempt.published.map((entry) => entry.id).toSorted()).toEqual(
      [first.id, second.id].toSorted(),
    );
    expect(attempt.failed.map((entry) => entry.id)).toEqual([broken.id]);
    expect(attempt.skipped).toEqual([]);

    const search = await run(
      Effect.flatMap(DishService, (service) =>
        service.searchDishes({ q: `Bulk Dish batch-ok-0 ${stamp}`, locale: "en", limit: 10 }),
      ),
    );

    expect(search.items.map((item) => item.slug)).toContain(`${PREFIX}batch-ok-0`);

    await run(
      Effect.flatMap(AdminService, (service) =>
        service.upsertDishDescription(
          ACTOR,
          broken.id,
          "en",
          `Repaired bulk fixture ${stamp}.`,
          null,
        ),
      ),
    );
    await run(
      Effect.flatMap(AdminService, (service) => service.linkDishCategory(ACTOR, broken.id, "soup")),
    );

    const retry = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({ actor: ACTOR, ids: [broken.id], acks: { ...ACKS } }),
      ),
    );

    expect(retry.published.map((entry) => entry.id)).toEqual([broken.id]);
    expect(retry.failed).toEqual([]);
    expect(retry.skipped).toEqual([]);
  });

  test("republishing is an idempotent resume: published rows land in skipped", async () => {
    const dish = await createReviewDish("idempotent");

    const first = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({ actor: ACTOR, ids: [dish.id], acks: { ...ACKS } }),
      ),
    );

    expect(first.published.map((entry) => entry.id)).toEqual([dish.id]);

    const second = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({ actor: ACTOR, ids: [dish.id, dish.id], acks: { ...ACKS } }),
      ),
    );

    expect(second.published).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(0);
    expect(await dishStatus(dish.id)).toBe("published");
  });

  test("non-review rows (draft, archived) are skipped, never force-published", async () => {
    const draft = await run(
      Effect.flatMap(AdminService, (service) =>
        service.createDish(ACTOR, {
          slug: `${PREFIX}stays-draft`,
          status: "draft",
          names: [{ languageTag: "en", name: `Stays Draft ${stamp}`, nameKind: "localized" }],
        }),
      ),
    );

    // Checklist-complete but still draft: the status guard (not the
    // checklist) is what skips it — an incomplete draft would land in
    // `failed` instead (covered by the incomplete-dish test).
    await run(
      Effect.flatMap(AdminService, (service) =>
        service.upsertDishDescription(ACTOR, draft.id, "en", `Stays draft ${stamp}.`, null),
      ),
    );
    await run(
      Effect.flatMap(AdminService, (service) => service.linkDishCategory(ACTOR, draft.id, "soup")),
    );

    const archived = await createReviewDish("stays-archived");

    await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({ actor: ACTOR, ids: [archived.id], acks: { ...ACKS } }),
      ),
    );
    await run(
      Effect.flatMap(AdminService, (service) =>
        service.updateDishStatus(ACTOR, archived.id, "archived"),
      ),
    );

    const report = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishBatch({ actor: ACTOR, ids: [draft.id, archived.id], acks: { ...ACKS } }),
      ),
    );

    expect(report.published).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.skipped.map((entry) => entry.id).toSorted()).toEqual(
      [draft.id, archived.id].toSorted(),
    );
    expect(await dishStatus(draft.id)).toBe("draft");
    expect(await dishStatus(archived.id)).toBe("archived");
  });
});

describe("bulk review candidates", () => {
  test("review dishes surface with metadata and provenance flags", async () => {
    const dish = await createReviewDish("candidate-flags");

    // Fixtures carry the highest ids in the table; page from just below
    // instead of assuming the global first page.
    const candidates = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.listReviewCandidates({
          cursor: BigInt(dish.id) - 1n,
          limit: 10,
          jobId: null,
        }),
      ),
    );

    const found = candidates.find((candidate) => candidate.id === dish.id);

    expect(found).toBeDefined();
    expect(found?.slug).toBe(`${PREFIX}candidate-flags`);
    expect(found?.status).toBe("review");
    expect(found?.hasEnglishName).toBe(true);
    expect(found?.hasDescription).toBe(true);
    expect(found?.categoryCount).toBeGreaterThanOrEqual(1);
    expect(found?.displayName).toContain(`candidate-flags ${stamp}`);
  });

  test("out-of-range limits resolve to empty, never an unbounded scan", async () => {
    const pages = await Promise.all(
      [0, -3, MAX_BULK_REVIEW_CANDIDATES + 1].map((limit) =>
        runBulk(
          Effect.flatMap(BulkPublishService, (service) =>
            service.listReviewCandidates({ cursor: 0n, limit, jobId: null }),
          ),
        ),
      ),
    );

    for (const candidates of pages) {
      expect(candidates).toEqual([]);
    }
  });

  test("cursor pages forward in id order", async () => {
    const older = await createReviewDish("cursor-older");
    const newer = await createReviewDish("cursor-newer");

    const page = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.listReviewCandidates({ cursor: BigInt(older.id) - 1n, limit: 100, jobId: null }),
      ),
    );

    const ids = page.map((candidate) => candidate.id);

    expect(ids).toContain(older.id);
    expect(ids).toContain(newer.id);

    const afterOlder = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.listReviewCandidates({ cursor: BigInt(older.id), limit: 100, jobId: null }),
      ),
    );

    expect(afterOlder.map((candidate) => candidate.id)).not.toContain(older.id);
  });
});

describe("bulk publish from an import job", () => {
  test("job-scoped batches publish with cursor pagination to done", async () => {
    const sourceName = `${PREFIX}job-source`;

    const report = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName,
          payload: {
            source_name: sourceName,
            records: [0, 1].map((index) => ({
              slug: `${PREFIX}job-dish-${index}`,
              names: [
                {
                  language_tag: "en",
                  name: `Job Dish ${index} ${stamp}`,
                  name_kind: "localized",
                },
              ],
              descriptions: [
                {
                  language_tag: "en",
                  description: `Job-scoped bulk fixture ${index} ${stamp}.`,
                  summary: null,
                },
              ],
              places: [{ iso: "VN", association: "origin" }],
              categories: ["soup"],
            })),
          },
          license: MANUAL_LICENSE,
        }),
      ),
    );

    expect(report.validRecords).toBe(2);

    const applied = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImport({
          jobId: report.jobId,
          approvals: { licenseAck: true, reviewAck: true, duplicateRefs: [] },
          actorUserId: ACTOR,
        }),
      ),
    );

    expect(applied.applied).toBe(2);

    const first = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishImportJobBatch({
          actor: ACTOR,
          jobId: report.jobId,
          cursor: 0n,
          limit: 1,
          acks: { ...ACKS },
        }),
      ),
    );

    expect(first.jobId).toBe(report.jobId);
    expect(first.report.published).toHaveLength(1);
    expect(first.report.failed).toEqual([]);
    expect(first.nextCursor).not.toBeNull();

    const second = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishImportJobBatch({
          actor: ACTOR,
          jobId: report.jobId,
          cursor: BigInt(first.nextCursor ?? "0"),
          limit: 1,
          acks: { ...ACKS },
        }),
      ),
    );

    expect(second.report.published).toHaveLength(1);

    // Full pages always carry a cursor: the client calls once more to
    // confirm done (empty page, null cursor).
    expect(second.nextCursor).not.toBeNull();

    const publishedIds = [...first.report.published, ...second.report.published].map(
      (entry) => entry.id,
    );

    expect(new Set(publishedIds).size).toBe(2);

    const statuses = await Promise.all(publishedIds.map((id) => dishStatus(id)));

    expect(statuses).toEqual(["published", "published"]);

    const done = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishImportJobBatch({
          actor: ACTOR,
          jobId: report.jobId,
          cursor: BigInt(second.nextCursor ?? "0"),
          limit: 50,
          acks: { ...ACKS },
        }),
      ),
    );

    expect(done.report.published).toEqual([]);
    expect(done.nextCursor).toBeNull();
  });

  test("job publish requires acks and a well-formed job id", async () => {
    const sourceName = `${PREFIX}acks-source`;

    const staged = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName,
          payload: {
            source_name: sourceName,
            records: [
              {
                slug: `${PREFIX}acks-dish`,
                names: [
                  {
                    language_tag: "en",
                    name: `Acks Dish ${stamp}`,
                    name_kind: "localized",
                  },
                ],
                descriptions: [
                  {
                    language_tag: "en",
                    description: `Acks fixture ${stamp}.`,
                    summary: null,
                  },
                ],
                categories: ["soup"],
              },
            ],
          },
          license: MANUAL_LICENSE,
        }),
      ),
    );

    await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.applyImport({
          jobId: staged.jobId,
          approvals: { licenseAck: true, reviewAck: true, duplicateRefs: [] },
          actorUserId: ACTOR,
        }),
      ),
    );

    const noAcks = await runBulkFailure(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishImportJobBatch({
          actor: ACTOR,
          jobId: staged.jobId,
          cursor: 0n,
          limit: 10,
          acks: { editorialAck: false, licenseAck: true },
        }),
      ),
    );

    expect(noAcks).toBeInstanceOf(InvalidDishData);

    const badJob = await runBulkFailure(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishImportJobBatch({
          actor: ACTOR,
          jobId: "not-a-number",
          cursor: 0n,
          limit: 10,
          acks: { ...ACKS },
        }),
      ),
    );

    expect(badJob).toBeInstanceOf(InvalidDishData);
  });

  test("empty job batches resolve empty without touching acks", async () => {
    // Pinned shipped behavior: candidate fetch precedes the ack gate, so a
    // job with nothing left to publish reports done even when acks are
    // missing. Flagged as a hardening gap in the report.
    const outcome = await runBulk(
      Effect.flatMap(BulkPublishService, (service) =>
        service.publishImportJobBatch({
          actor: ACTOR,
          jobId: "1",
          cursor: 0n,
          limit: 10,
          acks: { editorialAck: false, licenseAck: false },
        }),
      ),
    );

    expect(outcome.report.published).toEqual([]);
    expect(outcome.nextCursor).toBeNull();
  });
});
