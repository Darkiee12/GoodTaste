// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./integration/cleanup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Effect } from "effect";

import {
  actorSummary,
  associationLabel,
  isKnownOperation,
  isVerifiedHttpsUrl,
  noteKindLabel,
  operationLabel,
  roleLabel,
} from "@/components/admin/dish/presentation";
import { AdminDashboardService } from "@/modules/food-discovery/server/operations/admin-dashboard-service";
import { AdminService } from "@/modules/food-discovery/server/operations/admin-service";
import { CatalogImportService } from "@/modules/food-discovery/server/operations/catalog-import-service";
import { CurationService } from "@/modules/food-discovery/server/operations/curation-service";
import { requirePermission } from "@/server/auth/session";
import { Database } from "@/server/database/client";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./integration/food-auth";

/**
 * Feast Lab dish-detail editor: revision history pagination, trustworthy
 * actor attribution, atomic revision writes, and authorization boundaries.
 *
 * Backend integration style: every invariant runs through the real services
 * against PostgreSQL, no mocks. Presentation labels are pure functions, so
 * they are asserted directly without rendering.
 */

const foodAuth = createFoodAuth();

afterAll(() => foodAuth.close());

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const run = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  appRuntime.runPromise(effect);

const runFailure = <A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>): Promise<E> =>
  appRuntime.runPromise(Effect.flip(effect));

const exec = (query: string, params: ReadonlyArray<string>): Promise<void> =>
  run(
    Effect.flatMap(Database, (db) =>
      Effect.tryPromise({
        try: () => db.sql.unsafe(query, [...params]).then(() => undefined),
        catch: (cause) => new Error(`test sql failed: ${String(cause)}`),
      }),
    ),
  );

const createdSlugs: Array<string> = [];

afterAll(async () => {
  if (createdSlugs.length === 0) {
    return;
  }

  await run(
    Effect.forEach(
      createdSlugs,
      (slug) =>
        Effect.flatMap(Database, (db) =>
          Effect.tryPromise({
            try: () => db.sql`DELETE FROM feastjourney.dishes WHERE slug = ${slug}`,
            catch: () => new Error("dish cleanup failed"),
          }),
        ),
      { concurrency: 4 },
    ),
  );
});

let curatorId = "";
let curatorName = "";

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBeTruthy();

  const curator = await foodAuth.signupSignin(`dish-detail-curator-${stamp}`);
  curatorId = curator.userId;
  curatorName = `Detail Curator ${stamp}`;

  await exec(
    `INSERT INTO feastjourney.user_profiles (user_id, display_name, locale)
    VALUES ($1, $2, 'en')
    ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [curatorId, curatorName],
  );
});

const createDish = async (
  name: string,
): Promise<{ readonly id: string; readonly slug: string }> => {
  const slug = `detail-${stamp}-${name}`;

  createdSlugs.push(slug);

  return run(
    Effect.flatMap(AdminService, (service) =>
      service.createDish(`member:${curatorId}`, {
        slug,
        status: "draft",
        names: [{ languageTag: "en", name: `Detail ${name} ${stamp}`, nameKind: "localized" }],
      }),
    ),
  );
};

const historyOf = (dishId: string, limit: number, cursor: string | null) =>
  run(
    Effect.flatMap(AdminDashboardService, (service) =>
      service.dishRevisionHistory(dishId, { limit, cursor }),
    ),
  );

describe("dish-detail revision pagination", () => {
  test("pages newest-first with a stable id tiebreak on equal timestamps", async () => {
    const dish = await createDish("paging");

    await run(
      Effect.forEach(
        [0, 1, 2, 3, 4],
        (index) =>
          Effect.flatMap(CurationService, (service) =>
            service.recordRevision(
              BigInt(dish.id),
              `member:${curatorId}`,
              "note_added",
              `note ${index}`,
            ),
          ),
        { concurrency: 1 },
      ),
    );

    const sqlDelete = `UPDATE feastjourney.catalog_revisions
      SET created_at = '2026-10-29T12:00:00Z'
      WHERE dish_id = $1`;

    await exec(sqlDelete, [dish.id]);

    const first = await historyOf(dish.id, 2, null);
    expect(first.revisions.length).toBe(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await historyOf(dish.id, 2, first.nextCursor);
    expect(second.revisions.length).toBe(2);
    expect(second.nextCursor).not.toBeNull();

    const third = await historyOf(dish.id, 2, second.nextCursor);
    expect(third.revisions.length).toBe(2);
    expect(third.nextCursor).toBeNull();

    const ids = [...first.revisions, ...second.revisions, ...third.revisions].map((entry) =>
      BigInt(entry.id),
    );

    expect(new Set(ids.map(String)).size).toBe(6);

    const sorted = ids.toSorted((a, b) => {
      if (a > b) {
        return -1;
      }

      if (a < b) {
        return 1;
      }

      return 0;
    });

    expect(ids.map(String)).toEqual(sorted.map(String));
  });

  test("rejects invalid cursors instead of leaking rows", async () => {
    const dish = await createDish("cursor");

    const garbage = await runFailure(
      Effect.flatMap(AdminDashboardService, (service) =>
        service.dishRevisionHistory(dish.id, { limit: 20, cursor: "!!not-a-cursor!!" }),
      ),
    );

    expect(garbage._tag).toBe("InvalidDishData");

    const wellFormed = Buffer.from("not-a-date|abc", "utf8").toString("base64url");

    const malformed = await runFailure(
      Effect.flatMap(AdminDashboardService, (service) =>
        service.dishRevisionHistory(dish.id, { limit: 20, cursor: wellFormed }),
      ),
    );

    expect(malformed._tag).toBe("InvalidDishData");
  });

  test("distinguishes empty history from a missing dish", async () => {
    const dish = await createDish("empty");

    await exec(`DELETE FROM feastjourney.catalog_revisions WHERE dish_id = $1`, [dish.id]);

    const empty = await historyOf(dish.id, 20, null);

    expect(empty.revisions).toEqual([]);
    expect(empty.nextCursor).toBeNull();

    const missing = await runFailure(
      Effect.flatMap(AdminDashboardService, (service) =>
        service.dishRevisionHistory("999999999", { limit: 20, cursor: null }),
      ),
    );

    expect(missing._tag).toBe("DishNotFound");
  });
});

describe("dish-detail actor attribution", () => {
  test("resolves member actors to display names and follows renames", async () => {
    const dish = await createDish("member");

    await run(
      Effect.flatMap(CurationService, (service) =>
        service.recordRevision(BigInt(dish.id), `member:${curatorId}`, "note_added", "member edit"),
      ),
    );

    const page = await historyOf(dish.id, 20, null);
    const memberEntry = page.revisions.find((entry) => entry.actor === `member:${curatorId}`);

    expect(memberEntry?.actorDisplayName).toBe(curatorName);
    expect(memberEntry?.actor).toBe(`member:${curatorId}`);

    const renamed = `Renamed Curator ${stamp}`;

    await exec(`UPDATE feastjourney.user_profiles SET display_name = $1 WHERE user_id = $2`, [
      renamed,
      curatorId,
    ]);

    const afterRename = await historyOf(dish.id, 20, null);

    const renamedEntry = afterRename.revisions.find(
      (entry) => entry.actor === `member:${curatorId}`,
    );

    expect(renamedEntry?.actorDisplayName).toBe(renamed);

    await exec(`UPDATE feastjourney.user_profiles SET display_name = $1 WHERE user_id = $2`, [
      curatorName,
      curatorId,
    ]);
  });

  test("falls back safely for deleted accounts and legacy imports", async () => {
    const transient = await foodAuth.signupSignin(`dish-detail-gone-${stamp}`);

    await exec(
      `INSERT INTO feastjourney.user_profiles (user_id, display_name, locale)
      VALUES ($1, 'Gone Curator', 'en')
      ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [transient.userId],
    );

    const dish = await createDish("gone");

    await run(
      Effect.flatMap(CurationService, (service) =>
        service.recordRevision(
          BigInt(dish.id),
          `member:${transient.userId}`,
          "note_added",
          "transient edit",
        ),
      ),
    );
    await run(
      Effect.flatMap(CurationService, (service) =>
        service.recordRevision(BigInt(dish.id), "import:999999999", "import_applied", "legacy"),
      ),
    );

    await exec(`DELETE FROM feastjourney.user_profiles WHERE user_id = $1`, [transient.userId]);

    const page = await historyOf(dish.id, 20, null);
    const deleted = page.revisions.find((entry) => entry.actor === `member:${transient.userId}`);
    const legacy = page.revisions.find((entry) => entry.actor === "import:999999999");

    expect(deleted?.actorDisplayName).toBeNull();
    expect(deleted?.actor).toBe(`member:${transient.userId}`);
    expect(legacy?.importJobId).toBeNull();
    expect(legacy?.actor).toBe("import:999999999");
  });

  test("resolves import jobs with the applying member", async () => {
    const report = await run(
      Effect.flatMap(CatalogImportService, (service) =>
        service.validateImport({
          sourceName: `detail-source-${stamp}`,
          payload: {
            source_name: `detail-source-${stamp}`,
            records: [
              {
                names: [{ language_tag: "en", name: `Job Dish ${stamp}`, name_kind: "localized" }],
              },
            ],
          },
          format: "json",
        }),
      ),
    );

    await exec(`UPDATE feastjourney.catalog_import_jobs SET approved_by = $1 WHERE id = $2`, [
      curatorId,
      report.jobId,
    ]);

    const dish = await createDish("job");

    await run(
      Effect.flatMap(CurationService, (service) =>
        service.recordRevision(
          BigInt(dish.id),
          `import:${report.jobId}`,
          "import_applied",
          "applied from job",
        ),
      ),
    );

    const page = await historyOf(dish.id, 20, null);
    const jobEntry = page.revisions.find((entry) => entry.actor === `import:${report.jobId}`);

    expect(jobEntry?.importJobId).toBe(report.jobId);
    expect(jobEntry?.appliedByDisplayName).toBe(curatorName);
  });
});

describe("dish-detail write safety", () => {
  test("keeps revision writes atomic with their mutations", async () => {
    const dish = await createDish("atomic");

    const before = await run(
      Effect.flatMap(CurationService, (service) => service.listRevisions(dish.id, 50)),
    );

    const failed = await runFailure(
      Effect.flatMap(AdminService, (service) =>
        service.linkDishCategory(`member:${curatorId}`, dish.id, "no-such-category"),
      ),
    );

    expect(failed._tag).toBe("InvalidSearchFilter");

    const after = await run(
      Effect.flatMap(CurationService, (service) => service.listRevisions(dish.id, 50)),
    );

    expect(after.length).toBe(before.length);
  });

  test("history reads require an authenticated food:read grant at the boundary", async () => {
    const anonymous = await runFailure(
      requirePermission(new Headers(), {
        resource: "food",
        actions: ["read"],
      }),
    );

    expect(anonymous._tag).toBe("SignInRequired");

    const plain = await foodAuth.signupSignin(`dish-detail-plain-${stamp}`);

    const denied = await runFailure(
      requirePermission(new Headers({ cookie: plain.cookies }), {
        resource: "food",
        actions: ["import"],
      }),
    );

    expect(denied._tag).toBe("InsufficientPermissions");
  });

  test("detail separates notes from history without eager revisions", async () => {
    const dish = await createDish("split");

    const detail = await run(
      Effect.flatMap(AdminDashboardService, (service) => service.dishDetail(dish.id, "en")),
    );

    expect(detail.dish.id).toBe(dish.id);
    expect(Array.isArray(detail.notes)).toBe(true);
    expect("revisions" in detail).toBe(false);
  });
});

describe("dish-detail presentation labels", () => {
  test("maps operations, roles, associations, and note kinds without raw enums", () => {
    expect(operationLabel("ingredient_linked", "en")).toBe("Ingredient added");
    expect(operationLabel("name_added", "en")).toBe("Name added");
    expect(operationLabel("status_changed", "en")).toBe("Status changed");
    expect(operationLabel("place_linked", "en")).toBe("Region associated");
    expect(operationLabel("ingredient_linked", "vi")).toBe("Thêm nguyên liệu");
    expect(roleLabel("common", "en")).toBe("Common ingredient");
    expect(associationLabel("associated", "en")).toBe("Associated with");
    expect(associationLabel("origin", "vi")).toBe("Xuất xứ");
    expect(noteKindLabel("review", "vi")).toBe("Đánh giá");
  });

  test("falls back safely for unknown operations with details available", () => {
    expect(isKnownOperation("ingredient_linked")).toBe(true);
    expect(isKnownOperation("mystery_op")).toBe(false);
    expect(operationLabel("mystery_op", "en")).toBe("Unknown activity");
    expect(operationLabel("mystery_op", "vi")).toBe("Hoạt động không rõ");
  });

  test("summarizes every actor shape without leaking raw identifiers", () => {
    expect(
      actorSummary(
        { actor: "system", actorDisplayName: null, importJobId: null, appliedByDisplayName: null },
        "en",
      ).primary,
    ).toBe("System");

    expect(
      actorSummary(
        {
          actor: `member:${curatorId}`,
          actorDisplayName: "Ada Curator",
          importJobId: null,
          appliedByDisplayName: null,
        },
        "en",
      ).primary,
    ).toBe("By Ada Curator");

    const imported = actorSummary(
      {
        actor: "import:12",
        actorDisplayName: null,
        importJobId: "12",
        appliedByDisplayName: "Ada Curator",
      },
      "en",
    );

    expect(imported.primary).toBe("Imported via Job #12");
    expect(imported.secondary).toBe("Applied by Ada Curator");

    const legacy = actorSummary(
      { actor: "import:1", actorDisplayName: null, importJobId: null, appliedByDisplayName: null },
      "en",
    );

    expect(legacy.primary).toBe("Historical import · Actor unavailable");
    expect(legacy.raw).toBe("import:1");
    expect(legacy.needsDetails).toBe(true);

    const deleted = actorSummary(
      {
        actor: "member:gone",
        actorDisplayName: null,
        importJobId: null,
        appliedByDisplayName: null,
      },
      "en",
    );

    expect(deleted.primary).toBe("Former member · Actor unavailable");
  });

  test("links only verified https provenance urls", () => {
    expect(isVerifiedHttpsUrl("https://example.com/menu")).toBe(true);
    expect(isVerifiedHttpsUrl("http://example.com/menu")).toBe(false);
    expect(isVerifiedHttpsUrl(null)).toBe(false);
  });
});
