// oxlint-disable-next-line import/no-unassigned-import -- side-effectful test environment setup, runs before server modules initialize.
import "./integration/cleanup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Effect } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { isDishStatusValue, isPublishBlocked } from "@/components/admin/dish/DishStatusEditor";
import { AdminSelect, AdminSelectField } from "@/components/admin/select";
import { AdminDashboardService } from "@/modules/food-discovery/server/operations/admin-dashboard-service";
import { AdminService } from "@/modules/food-discovery/server/operations/admin-service";
import { Database } from "@/server/database/client";
import type { AppServices } from "@/server/layers";
import { appRuntime } from "@/server/runtime";

import { createFoodAuth } from "./integration/food-auth";

/**
 * Feast Lab canonical select: SSR markup contract for the Radix trigger
 * (state-driven chevron, ARIA wiring, sizes, disabled) plus the pure
 * status guards and the service-level status-change/blocked/failure
 * invariants the dish editor relies on. Interaction (open, Escape, keyboard
 * cycle, viewport containment) is covered by Playwright, not bun:test —
 * no DOM renderer is installed in this repo.
 */

const OPTIONS = [
  { label: "Draft", value: "draft" },
  { label: "In review", value: "review" },
  { label: "Published", value: "published", disabled: true },
  { label: "Archived", value: "archived" },
] as const;

const options = [...OPTIONS];

describe("AdminSelect closed trigger", () => {
  test("reports closed state with a state-driven chevron and placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(AdminSelect, {
        ariaLabel: "Status",
        value: undefined,
        onValueChange: () => undefined,
        options,
        placeholder: "Status",
      }),
    );

    expect(html).toContain('data-state="closed"');
    expect(html).toContain("group-data-[state=open]:rotate-180");
    expect(html).toContain("Status");
    // One chevron, driven by Radix state — never a focus/blur heuristic pair.
    expect(html.match(/lucide-chevron-down/g)?.length ?? 0).toBeLessThanOrEqual(2);
  });

  test("regular and compact sizes share visuals with distinct heights", () => {
    const regular = renderToStaticMarkup(
      createElement(AdminSelect, {
        ariaLabel: "Status",
        value: "draft",
        onValueChange: () => undefined,
        options,
      }),
    );

    const compact = renderToStaticMarkup(
      createElement(AdminSelect, {
        ariaLabel: "Status",
        value: "draft",
        onValueChange: () => undefined,
        options,
        size: "compact",
      }),
    );

    for (const html of [regular, compact]) {
      expect(html).toContain("rounded-lg");
      expect(html).toContain("border-border-soft");
      expect(html).toContain("bg-white");
    }

    expect(regular).toContain("min-h-11");
    expect(compact).toContain("min-h-9");
    expect(compact).not.toContain("min-h-11");
  });

  test("disabled field disables the trigger", () => {
    const html = renderToStaticMarkup(
      createElement(AdminSelect, {
        ariaLabel: "Status",
        value: "draft",
        onValueChange: () => undefined,
        options,
        disabled: true,
      }),
    );

    expect(html).toContain("disabled");
    expect(html).toContain("disabled:cursor-not-allowed");
  });

  test("invalid state is exposed to assistive technology", () => {
    const html = renderToStaticMarkup(
      createElement(AdminSelect, {
        ariaLabel: "Status",
        value: undefined,
        onValueChange: () => undefined,
        options,
        invalid: true,
        describedBy: "admin-dish-status-error",
      }),
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="admin-dish-status-error"');
  });
});

describe("AdminSelectField ARIA wiring", () => {
  test("label targets the trigger and description joins error announcements", () => {
    const html = renderToStaticMarkup(
      createElement(AdminSelectField, {
        id: "role-grant",
        label: "Assign role",
        description: "Privileged grants need confirmation.",
        error: "Selection required.",
        value: undefined,
        onValueChange: () => undefined,
        options: [
          { label: "Curator", value: "curator" },
          { label: "Admin", value: "admin" },
        ],
      }),
    );

    expect(html).toContain('for="role-grant"');
    expect(html).toContain('id="role-grant"');
    expect(html).toContain('id="role-grant-description"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="role-grant-description role-grant-error"');
    expect(html).toContain('aria-invalid="true"');
  });

  test("clean field exposes no error nodes and no describedby", () => {
    const html = renderToStaticMarkup(
      createElement(AdminSelectField, {
        id: "clean-field",
        label: "Assign role",
        value: "curator",
        onValueChange: () => undefined,
        options: [{ label: "Curator", value: "curator" }],
      }),
    );

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain('aria-invalid="true"');
  });

  test("required field marks the label and the trigger", () => {
    const html = renderToStaticMarkup(
      createElement(AdminSelectField, {
        id: "required-field",
        label: "Assign role",
        required: true,
        value: undefined,
        onValueChange: () => undefined,
        options: [{ label: "Curator", value: "curator" }],
      }),
    );

    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("dish status guards", () => {
  test("accepts exactly the canonical domain statuses", () => {
    for (const status of ["draft", "review", "published", "archived"]) {
      expect(isDishStatusValue(status)).toBe(true);
    }
  });

  test("rejects unknown, empty, and padded values instead of defaulting", () => {
    for (const status of ["", "DRAFT", "published ", "deleted", "null"]) {
      expect(isDishStatusValue(status)).toBe(false);
    }
  });

  test("publish is blocked only for published selections failing the checklist", () => {
    expect(isPublishBlocked("published", false)).toBe(true);
    expect(isPublishBlocked("published", true)).toBe(false);
    expect(isPublishBlocked("published", null)).toBe(false);
    expect(isPublishBlocked("draft", false)).toBe(false);
    expect(isPublishBlocked("review", null)).toBe(false);
  });
});

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

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBeTruthy();

  const curator = await foodAuth.signupSignin(`select-status-curator-${stamp}`);
  curatorId = curator.userId;

  await exec(
    `INSERT INTO feastjourney.user_profiles (user_id, display_name, locale)
    VALUES ($1, $2, 'en')
    ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [curatorId, `Select Curator ${stamp}`],
  );
});

const createDish = async (
  name: string,
  languageTag: string,
): Promise<{ readonly id: string; readonly slug: string }> => {
  const slug = `select-${stamp}-${name}`;

  createdSlugs.push(slug);

  return run(
    Effect.flatMap(AdminService, (service) =>
      service.createDish(`member:${curatorId}`, {
        slug,
        status: "draft",
        names: [{ languageTag, name: `Select ${name} ${stamp}`, nameKind: "localized" }],
      }),
    ),
  );
};

describe("dish status change, blocked publish, and failure", () => {
  test("draft to review persists and round-trips the confirmed status", async () => {
    const dish = await createDish("review-flow", "en");

    const updated = await run(
      Effect.flatMap(AdminService, (service) =>
        service.updateDishStatus(`member:${curatorId}`, dish.id, "review"),
      ),
    );

    expect(updated.id).toBe(dish.id);
    expect(updated.status).toBe("review");
  });

  test("publishing a dish without a preferred English name stays blocked", async () => {
    const dish = await createDish("blocked-flow", "vi");

    const check = await run(
      Effect.flatMap(AdminDashboardService, (service) => service.publicationCheck(dish.id)),
    );

    expect(check.publishable).toBe(false);
    expect(check.reasons.length).toBeGreaterThan(0);

    const failure = await runFailure(
      Effect.flatMap(AdminDashboardService, (service) =>
        service.publishDish(curatorId, dish.id, "published"),
      ),
    );

    expect(failure._tag).toBe("InvalidDishData");
  });

  test("unknown dish ids fail instead of inventing a status", async () => {
    const missing = await runFailure(
      Effect.flatMap(AdminService, (service) =>
        service.updateDishStatus(`member:${curatorId}`, "999999999", "review"),
      ),
    );

    expect(missing._tag).toBe("DishNotFound");

    const malformed = await runFailure(
      Effect.flatMap(AdminDashboardService, (service) => service.publicationCheck("not-an-id")),
    );

    expect(malformed._tag).toBe("DishNotFound");
  });
});
