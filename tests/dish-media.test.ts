import { beforeAll, describe, expect, test } from "bun:test";

import { Cause, Effect, Exit, Layer, Option } from "effect";
import postgres from "postgres";
import sharp from "sharp";
import { z } from "zod";

import {
  DERIVATIVE_WIDTHS,
  DishMediaConflict,
  DishMediaLimitExceeded,
  DishMediaNotFound,
  DishMediaPublishBlocked,
  type DishMediaRepository,
  DishMediaRepositoryLive,
  DishMediaService,
  DishMediaServiceLive,
  DishMediaStorage,
  DishMediaStorageFailed,
  DishMediaValidationFailed,
  MAX_PHOTOS_PER_DISH,
  processDishPhotoImage,
} from "@/modules/food-discovery/server/operations/dish-media-service";
import { Authorization } from "@/modules/user/server/operations/authorization";
import type { RoleRepository } from "@/modules/user/server/repository/role-repository";
import { Actor } from "@/server/auth/actor";
import { withActor, type CurrentActor } from "@/server/auth/current-actor";
import { InsufficientPermissions } from "@/server/auth/errors";
import type { Permission, PermissionRequest } from "@/server/auth/permissions";
import type { Database } from "@/server/database/client";
import { appRuntime } from "@/server/runtime";

/**
 * Dish photography: image pipeline validation plus storage/publication
 * rules. The image pipeline is pure over bytes (no DB, no S3); the rule
 * suite runs the real DishMediaService against an in-memory repository and
 * object store with a stubbed Authorization, plus the real Database for the
 * dish-exists check. Live Garage round-trips are covered by the Playwright
 * evidence pass, not by this file.
 */

const photoBytes = async (
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp" = "jpeg",
): Promise<Uint8Array> => {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 40 } },
  });

  if (format === "jpeg") {
    return new Uint8Array(await base.jpeg().toBuffer());
  }

  if (format === "png") {
    return new Uint8Array(await base.png().toBuffer());
  }

  return new Uint8Array(await base.webp().toBuffer());
};

const isWebP = (bytes: Uint8Array): boolean =>
  bytes.length > 12 &&
  bytes[0] === 0x52 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x46 &&
  bytes[8] === 0x57 &&
  bytes[9] === 0x45 &&
  bytes[10] === 0x42 &&
  bytes[11] === 0x50;

const validationReason = async (task: Promise<unknown>): Promise<string> => {
  try {
    await task;
  } catch (error) {
    if (error instanceof DishMediaValidationFailed) {
      return error.reason;
    }

    throw error;
  }

  throw new Error("expected a validation failure");
};

const captureFailure = async <A, E>(
  world: FakeWorld,
  effect: Effect.Effect<
    A,
    E,
    | DishMediaService
    | DishMediaRepository
    | DishMediaStorage
    | CurrentActor
    | Authorization
    | RoleRepository
    | Database
  >,
) => {
  const deps = testLayers(world);

  const exit = await appRuntime.runPromiseExit(
    Effect.provide(
      withActor(Actor.Member({ userId: "test-member" }), effect),
      Layer.mergeAll(deps, Layer.provide(DishMediaServiceLive, deps)),
    ),
  );

  if (Exit.isSuccess(exit)) {
    throw new Error("expected a failure");
  }

  const failure = Cause.findErrorOption(exit.cause);

  if (Option.isNone(failure)) {
    throw new Error("expected a typed failure");
  }

  return failure.value;
};

describe("dish photo image pipeline", () => {
  test("accepts a valid JPEG and emits three WebP derivatives", async () => {
    const processed = await processDishPhotoImage(await photoBytes(1200, 800), "pho.jpg");

    expect(processed.format).toBe("jpeg");
    expect(processed.width).toBe(1200);
    expect(processed.height).toBe(800);
    expect(processed.variants).toHaveLength(DERIVATIVE_WIDTHS.length);
    expect(processed.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    for (const variant of processed.variants) {
      expect(isWebP(variant.bytes)).toBe(true);
    }

    const widths = processed.variants.map((variant) => variant.width);

    expect(widths).toEqual([400, 800, 1600]);
  });

  test("accepts PNG sources", async () => {
    const processed = await processDishPhotoImage(await photoBytes(900, 700, "png"), "dish.png");

    expect(processed.format).toBe("png");

    for (const variant of processed.variants) {
      expect(isWebP(variant.bytes)).toBe(true);
    }
  });

  test("accepts WebP sources", async () => {
    const processed = await processDishPhotoImage(await photoBytes(1000, 800, "webp"), "dish.webp");

    expect(processed.format).toBe("webp");
  });

  test("rejects SVG by extension even though the container parses", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"></svg>',
    );

    expect(await validationReason(processDishPhotoImage(svg, "dish.svg"))).toMatch(/not accepted/);
  });

  test("rejects GIF content", async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 59]);

    expect(await validationReason(processDishPhotoImage(gif, "dish.gif"))).toMatch(/not accepted/);
  });

  test("rejects HEIC filenames", async () => {
    const bytes = await photoBytes(800, 700);

    expect(await validationReason(processDishPhotoImage(bytes, "dish.heic"))).toMatch(
      /not accepted/,
    );
  });

  test("rejects PDF filenames", async () => {
    const bytes = await photoBytes(800, 700);

    expect(await validationReason(processDishPhotoImage(bytes, "menu.pdf"))).toMatch(
      /not accepted/,
    );
  });

  test("rejects corrupt bytes", async () => {
    const corrupt = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

    expect(await validationReason(processDishPhotoImage(corrupt, "dish.png"))).toMatch(
      /not.*readable/,
    );
  });

  test("rejects empty uploads", async () => {
    expect(await validationReason(processDishPhotoImage(new Uint8Array(0), "dish.jpg"))).toMatch(
      /empty file/,
    );
  });

  test("rejects payloads above 8 MiB without decoding", async () => {
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1);

    expect(await validationReason(processDishPhotoImage(oversized, "dish.jpg"))).toMatch(/8 MiB/);
  });

  test("rejects images whose shortest side is under 600px", async () => {
    expect(
      await validationReason(processDishPhotoImage(await photoBytes(1200, 400), "wide.jpg")),
    ).toMatch(/shortest side/);
  });

  test("rejects images above 24 megapixels", async () => {
    expect(
      await validationReason(processDishPhotoImage(await photoBytes(6000, 5000), "huge.jpg")),
    ).toMatch(/24 megapixels/);
  });

  test("never upscales small-but-valid sources", async () => {
    const processed = await processDishPhotoImage(await photoBytes(700, 650), "small.jpg");

    const widths = await Promise.all(
      processed.variants.map(async (variant) => {
        const metadata = await sharp(variant.bytes).metadata();

        return metadata.width;
      }),
    );

    for (const width of widths) {
      expect(width).toBeLessThanOrEqual(700);
    }
  });

  test("applies EXIF orientation to reported dimensions", async () => {
    const oriented = new Uint8Array(
      await sharp({
        create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 120, b: 200 } },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    );

    const processed = await processDishPhotoImage(oriented, "rotated.jpg");

    expect(processed.width).toBe(600);
    expect(processed.height).toBe(800);
  });

  test("checksums are stable for identical bytes", async () => {
    const bytes = await photoBytes(800, 700);
    const first = await processDishPhotoImage(bytes, "a.jpg");
    const second = await processDishPhotoImage(bytes, "b.jpg");

    expect(first.checksumSha256).toBe(second.checksumSha256);
  });

  test("sniffs content, not filenames", async () => {
    const processed = await processDishPhotoImage(await photoBytes(800, 700), "no-extension");

    expect(processed.format).toBe("jpeg");
  });
});

// ---------------------------------------------------------------------------
// Service rule suite (real repository + disposable database, in-memory
// object store, stubbed Authorization). Every staged photo runs through the
// real Sharp pipeline and the real staged finalize, so storage, review, and
// publication rules execute against production code paths.
// ---------------------------------------------------------------------------

interface FakeWorld {
  objects: Map<string, Uint8Array>;
  dishId: string;
  denyPublish: boolean;
  denyAll: boolean;
}

const seedRowSchema = z.array(z.object({ id: z.string() }));

const seedDishIds = async (count: number): Promise<ReadonlyArray<string>> => {
  const sql = postgres(process.env["DATABASE_URL"] ?? "", { max: 1 });

  try {
    const rows = seedRowSchema.parse(
      await sql`SELECT id::text AS id FROM feastjourney.dishes ORDER BY id LIMIT ${count}`,
    );

    if (rows.length < count) {
      throw new Error("not enough seed dishes for dish-media tests");
    }

    return rows.map((row) => row.id);
  } finally {
    await sql.end();
  }
};

let allocatedDishIds: ReadonlyArray<string> = [];
let allocatedDishIndex = 0;

const nextDishId = (): string => {
  const dishId = allocatedDishIds[allocatedDishIndex];

  allocatedDishIndex += 1;

  if (dishId === undefined) {
    throw new Error("out of seed dishes for dish-media tests");
  }

  return dishId;
};

const testLayers = (world: FakeWorld) => {
  const storage = Layer.succeed(DishMediaStorage, {
    putVariant: (key: string, bytes: Uint8Array) => {
      world.objects.set(key, bytes);

      return Effect.void;
    },
    getVariant: (key: string) => {
      const bytes = world.objects.get(key);

      if (bytes === undefined) {
        return Effect.fail(
          new DishMediaStorageFailed({ operation: "get", reason: "missing object" }),
        );
      }

      return Effect.succeed(bytes);
    },
    variantExists: (key: string) => Effect.succeed(world.objects.has(key)),
    deleteVariants: (keys: ReadonlyArray<string>) => {
      for (const key of keys) {
        world.objects.delete(key);
      }

      return Effect.void;
    },
  });

  const authorization = Layer.succeed(Authorization, {
    permissionsOf: () => Effect.succeed(new Set<Permission>()),
    has: () => Effect.succeed(true),
    require: (_actor: Actor, request: PermissionRequest) => {
      if (world.denyAll) {
        return Effect.fail(new InsufficientPermissions({ reason: "denied for test" }));
      }

      const actions: ReadonlyArray<string> = request.actions;

      if (world.denyPublish && actions.includes("publish")) {
        return Effect.fail(
          new InsufficientPermissions({ reason: "Missing permissions: food:publish." }),
        );
      }

      return Effect.void;
    },
    requireManageableRole: () =>
      Effect.fail(new InsufficientPermissions({ reason: "not manageable" })),
    requireDelegatable: () => Effect.void,
  });

  return Layer.mergeAll(DishMediaRepositoryLive, storage, authorization);
};

const runService = async <A, E>(
  world: FakeWorld,
  effect: Effect.Effect<
    A,
    E,
    | DishMediaService
    | DishMediaRepository
    | DishMediaStorage
    | CurrentActor
    | Authorization
    | RoleRepository
    | Database
  >,
): Promise<A> => {
  const deps = testLayers(world);

  return appRuntime.runPromise(
    Effect.provide(
      withActor(Actor.Member({ userId: "test-member" }), effect),
      Layer.mergeAll(deps, Layer.provide(DishMediaServiceLive, deps)),
    ),
  );
};

const stageValidPhoto = async (
  world: FakeWorld,
  overrides?: Partial<{
    altText: string | null;
    attribution: string | null;
    license: string | null;
  }>,
) => {
  const bytes = await photoBytes(1200, 800);

  const staged = await runService(
    world,
    Effect.flatMap(DishMediaService, (service) =>
      service.stagePhoto({
        dishId: world.dishId,
        bytes,
        filename: "pho.jpg",
        altText: overrides?.altText === undefined ? "A steaming bowl of pho" : overrides.altText,
        attribution: overrides?.attribution === undefined ? "Test Kitchen" : overrides.attribution,
        license: overrides?.license ?? "own-work",
        focalX: 0.5,
        focalY: 0.4,
        sourceUrl: null,
        makePrimary: false,
      }),
    ),
  );

  return staged.id;
};

describe("dish photo publication rules", () => {
  beforeAll(async () => {
    // The disposable database persists across runs; start each file run from
    // an empty photo library so per-dish caps and ordering stay deterministic.
    const sql = postgres(process.env["DATABASE_URL"] ?? "", { max: 1 });

    try {
      await sql`TRUNCATE feastjourney.dish_media`;
      allocatedDishIds = await seedDishIds(16);
      allocatedDishIndex = 0;
    } finally {
      await sql.end();
    }
  });

  test("review photos are unfetchable publicly but fetchable via authorized preview", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    expect(
      await captureFailure(
        world,
        Effect.flatMap(DishMediaService, (service) =>
          service.serveDerivative({ mediaId: photoId, version: 1, width: 800, preview: false }),
        ),
      ),
    ).toBeInstanceOf(DishMediaNotFound);

    const preview = await runService(
      world,
      Effect.flatMap(DishMediaService, (service) =>
        service.serveDerivative({ mediaId: photoId, version: 1, width: 800, preview: true }),
      ),
    );

    expect(preview.contentType).toBe("image/webp");
    expect(preview.byteSize).toBeGreaterThan(0);
  });

  test("published photos are publicly fetchable with stable ETags", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
    );
    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId)),
    );

    const first = await runService(
      world,
      Effect.flatMap(DishMediaService, (service) =>
        service.serveDerivative({ mediaId: photoId, version: 1, width: 1600, preview: false }),
      ),
    );

    const second = await runService(
      world,
      Effect.flatMap(DishMediaService, (service) =>
        service.serveDerivative({ mediaId: photoId, version: 1, width: 400, preview: false }),
      ),
    );

    expect(first.etag).toContain(photoId);
    expect(second.etag).toContain(photoId);
    expect(first.etag).not.toBe(second.etag);
  });

  test("stale versions never serve after rotation", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
    );
    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId)),
    );

    expect(
      await captureFailure(
        world,
        Effect.flatMap(DishMediaService, (service) =>
          service.serveDerivative({ mediaId: photoId, version: 2, width: 800, preview: false }),
        ),
      ),
    ).toBeInstanceOf(DishMediaNotFound);
  });

  test("publishing is blocked without a real license, attribution, and alt text", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world, {
      altText: null,
      attribution: null,
      license: "unknown",
    });

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
    );

    const failure = await runService(
      world,
      Effect.flip(Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId))),
    );

    expect(failure).toBeInstanceOf(DishMediaPublishBlocked);

    if (failure instanceof DishMediaPublishBlocked) {
      expect(failure.reasons.join(" ")).toMatch(/license/);
      expect(failure.reasons.join(" ")).toMatch(/attribution/);
      expect(failure.reasons.join(" ")).toMatch(/alt text/);
    }
  });

  test("publish requires food:publish even when the photo is ready", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: true,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
    );

    expect(
      await captureFailure(
        world,
        Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId)),
      ),
    ).toBeInstanceOf(InsufficientPermissions);
  });

  test("staging requires an authorized member", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: true,
    };

    expect(
      await captureFailure(
        world,
        Effect.flatMap(DishMediaService, (service) =>
          service.stagePhoto({
            dishId: world.dishId,
            bytes: new Uint8Array([1, 2, 3]),
            filename: "dish.jpg",
            altText: "alt",
            attribution: null,
            license: "unknown",
            focalX: null,
            focalY: null,
            sourceUrl: null,
            makePrimary: false,
          }),
        ),
      ),
    ).toBeInstanceOf(InsufficientPermissions);
  });

  test("deleting a photo withdraws it from public delivery and removes objects", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
    );
    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId)),
    );
    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.removePhoto(photoId)),
    );

    expect(
      await captureFailure(
        world,
        Effect.flatMap(DishMediaService, (service) =>
          service.serveDerivative({ mediaId: photoId, version: 1, width: 800, preview: false }),
        ),
      ),
    ).toBeInstanceOf(DishMediaNotFound);
    expect(world.objects.size).toBe(0);
  });

  test("primary is deterministic: lowest sort_order wins the public projection", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const first = await stageValidPhoto(world);
    const second = await stageValidPhoto(world);

    await Promise.all(
      [first, second].map(async (photoId) => {
        await runService(
          world,
          Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
        );
        await runService(
          world,
          Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId)),
        );
      }),
    );

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) =>
        service.reorderPhotos({ dishId: world.dishId, orderedIds: [second, first] }),
      ),
    );

    const grouped = await runService(
      world,
      Effect.flatMap(DishMediaService, (service) =>
        service.publishedImagesByDishIds([BigInt(world.dishId)]),
      ),
    );

    const images = grouped.get(world.dishId) ?? [];

    expect(images.map((image) => image.id)).toEqual([second, first]);
  });

  test("metadata edits never touch stored bytes", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);
    const beforeKeys = [...world.objects.keys()];

    const updated = await runService(
      world,
      Effect.flatMap(DishMediaService, (service) =>
        service.updateMetadata({
          mediaId: photoId,
          altText: "New description",
          attribution: "New attribution",
          license: "cc-by",
          focalX: 0.2,
          focalY: 0.8,
          sourceUrl: "https://example.com/photo",
        }),
      ),
    );

    expect(updated.altText).toBe("New description");
    expect(updated.license).toBe("cc-by");
    expect([...world.objects.keys()]).toEqual(beforeKeys);
  });

  test("returning a published photo to draft hides it publicly", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
    );
    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId)),
    );

    const draft = await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.returnToDraft(photoId)),
    );

    expect(draft.status).toBe("draft");
    expect(draft.publishedAt).toBeNull();

    expect(
      await captureFailure(
        world,
        Effect.flatMap(DishMediaService, (service) =>
          service.serveDerivative({ mediaId: photoId, version: 1, width: 800, preview: false }),
        ),
      ),
    ).toBeInstanceOf(DishMediaNotFound);
  });

  test("published photos never re-enter review directly", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
    );
    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId)),
    );

    expect(
      await captureFailure(
        world,
        Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
      ),
    ).toBeInstanceOf(DishMediaConflict);
  });

  test("publishing a photo on an unpublished dish still works: statuses stay independent", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.submitForReview(photoId)),
    );

    const published = await runService(
      world,
      Effect.flatMap(DishMediaService, (service) => service.publishPhoto(photoId)),
    );

    expect(published.status).toBe("published");
  });

  test("reorder rejects sets that drop or duplicate photos", async () => {
    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    const photoId = await stageValidPhoto(world);

    expect(
      await captureFailure(
        world,
        Effect.flatMap(DishMediaService, (service) =>
          service.reorderPhotos({ dishId: world.dishId, orderedIds: [photoId, photoId] }),
        ),
      ),
    ).toBeInstanceOf(DishMediaConflict);
  });

  test("per-dish photo cap is enforced", async () => {
    expect(MAX_PHOTOS_PER_DISH).toBe(5);

    const world: FakeWorld = {
      objects: new Map(),
      dishId: nextDishId(),
      denyPublish: false,
      denyAll: false,
    };

    for (let index = 0; index < MAX_PHOTOS_PER_DISH; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential staging keeps sort_order allocation deterministic
      await stageValidPhoto(world);
    }

    const extraBytes = await photoBytes(800, 700);

    const blocked = await captureFailure(
      world,
      Effect.flatMap(DishMediaService, (service) =>
        service.stagePhoto({
          dishId: world.dishId,
          bytes: extraBytes,
          filename: "extra.jpg",
          altText: "One too many",
          attribution: null,
          license: "unknown",
          focalX: null,
          focalY: null,
          sourceUrl: null,
          makePrimary: false,
        }),
      ),
    );

    expect(blocked).toBeInstanceOf(DishMediaLimitExceeded);
  });
});
