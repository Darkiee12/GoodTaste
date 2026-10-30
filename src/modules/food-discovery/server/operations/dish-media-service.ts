import { createHash, randomUUID } from "node:crypto";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Context, Data, Effect, Layer } from "effect";
import sharp, { type Metadata as SharpMetadata } from "sharp";

import { DishNotFound } from "@/modules/food-discovery/server/domain/errors";
import dishFindById from "@/modules/food-discovery/server/repository/sql/dish-find-by-id.sql";
import dishMediaAdminList from "@/modules/food-discovery/server/repository/sql/dish-media-admin-list.sql";
import dishMediaCountByDish from "@/modules/food-discovery/server/repository/sql/dish-media-count-by-dish.sql";
import dishMediaDelete from "@/modules/food-discovery/server/repository/sql/dish-media-delete.sql";
import dishMediaFinalize from "@/modules/food-discovery/server/repository/sql/dish-media-finalize.sql";
import dishMediaFindById from "@/modules/food-discovery/server/repository/sql/dish-media-find-by-id.sql";
import dishMediaInsert from "@/modules/food-discovery/server/repository/sql/dish-media-insert.sql";
import dishMediaMaxSortOrder from "@/modules/food-discovery/server/repository/sql/dish-media-max-sort-order.sql";
import dishMediaPublishedByDishIds from "@/modules/food-discovery/server/repository/sql/dish-media-published-by-dish-ids.sql";
import dishMediaSetSortOrder from "@/modules/food-discovery/server/repository/sql/dish-media-set-sort-order.sql";
import dishMediaUpdateMetadata from "@/modules/food-discovery/server/repository/sql/dish-media-update-metadata.sql";
import dishMediaUpdateStatus from "@/modules/food-discovery/server/repository/sql/dish-media-update-status.sql";
import { Authorization } from "@/modules/user/server/operations/authorization";
import type { RoleRepository } from "@/modules/user/server/repository/role-repository";
import { Actor } from "@/server/auth/actor";
import { CurrentActor } from "@/server/auth/current-actor";
import { InsufficientPermissions } from "@/server/auth/errors";
import type { Database } from "@/server/database/client";
import { withTransaction } from "@/server/database/client";
import type { TransactionFailed } from "@/server/database/errors";
import type { DatabaseError } from "@/server/database/query";
import { runQuery } from "@/server/database/query";

/** Largest accepted source upload: 8 MiB. Binaries never land in Postgres. */
export const MAX_DISH_PHOTO_BYTES = 8 * 1024 * 1024;

/** Shortest decoded edge must reach 600px; smaller sources are rejected. */
export const MIN_SHORT_SIDE_PX = 600;

/** Decoded pixel ceiling (24 MP) bounds Sharp memory per upload. */
export const MAX_DECODED_PIXELS = 24_000_000;

/** Editorial cap: at most five photos per dish. */
export const MAX_PHOTOS_PER_DISH = 5;

/** Stored WebP derivative widths. Resizes never upscale. */
export const DERIVATIVE_WIDTHS = [400, 800, 1600] as const;

export const DERIVATIVE_QUALITY = 80;

/**
 * Licenses the editor may attach. `unknown` is storable at draft stage but
 * never publishable; anything outside this list is rejected at the boundary.
 */
export const SUPPORTED_PHOTO_LICENSES = [
  "own-work",
  "cc0",
  "cc-by",
  "cc-by-sa",
  "licensed",
] as const;

export type PhotoLicense = (typeof SUPPORTED_PHOTO_LICENSES)[number];

export const PUBLISHABLE_PHOTO_LICENSES: ReadonlySet<string> = new Set(SUPPORTED_PHOTO_LICENSES);

const PHOTO_STATUS = ["draft", "review", "published"] as const;

export type DishPhotoStatus = (typeof PHOTO_STATUS)[number];

export class DishMediaNotFound extends Data.TaggedError("DishMediaNotFound")<{
  readonly mediaId: string;
}> {}

export class DishMediaValidationFailed extends Data.TaggedError("DishMediaValidationFailed")<{
  readonly reason: string;
}> {}

export class DishMediaLimitExceeded extends Data.TaggedError("DishMediaLimitExceeded")<{
  readonly dishId: string;
  readonly limit: number;
}> {}

export class DishMediaStorageFailed extends Data.TaggedError("DishMediaStorageFailed")<{
  readonly operation: string;
  readonly reason: string;
}> {}

export class DishMediaStorageMisconfigured extends Data.TaggedError(
  "DishMediaStorageMisconfigured",
)<{
  readonly reason: string;
}> {}

export class DishMediaPublishBlocked extends Data.TaggedError("DishMediaPublishBlocked")<{
  readonly mediaId: string;
  readonly reasons: ReadonlyArray<string>;
}> {}

export class DishMediaConflict extends Data.TaggedError("DishMediaConflict")<{
  readonly reason: string;
}> {}

export type DishMediaError =
  | DishMediaNotFound
  | DishMediaValidationFailed
  | DishMediaLimitExceeded
  | DishMediaStorageFailed
  | DishMediaStorageMisconfigured
  | DishMediaPublishBlocked
  | DishMediaConflict
  | DishNotFound
  | InsufficientPermissions
  | TransactionFailed
  | DatabaseError;

export type DishMediaRow = (typeof dishMediaFindById)["~reylo"]["element"];

export type DishMediaAdminRow = (typeof dishMediaAdminList)["~reylo"]["element"];

export type DishMediaPublishedRow = (typeof dishMediaPublishedByDishIds)["~reylo"]["element"];

export type DishMediaDeleteRow = (typeof dishMediaDelete)["~reylo"]["element"];

/** Opaque versioned object prefix; one stored derivative per width hangs below it. */
export const dishMediaKeyBase = (dishId: string, mediaId: string, version: number): string =>
  `dish-media/dishes/${dishId}/${mediaId}/${version}`;

export const dishMediaVariantKey = (base: string, width: number): string => `${base}/${width}.webp`;

/** Same-origin delivery URL for one stored derivative. Immutable per version. */
export const dishMediaUrl = (mediaId: string, version: number, width: number): string =>
  `/api/v1/dish-images/${mediaId}/${version}/${width}`;

export const dishMediaSrcSet = (mediaId: string, version: number): string =>
  DERIVATIVE_WIDTHS.map((width) => `${dishMediaUrl(mediaId, version, width)} ${width}w`).join(", ");

/** Authorized (session-gated) preview URL for drafts and review items. */
export const dishMediaPreviewUrl = (mediaId: string, version: number, width: number): string =>
  `${dishMediaUrl(mediaId, version, width)}?preview=1`;

const toIso = (value: string | Date | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
};

const toNumberOrNull = (value: number | bigint | string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

export interface DishPhotoAdminView {
  readonly id: string;
  readonly dishId: string;
  readonly status: string;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
  readonly altText: string | null;
  readonly attribution: string | null;
  readonly license: string;
  readonly focalX: number | null;
  readonly focalY: number | null;
  readonly originalWidth: number | null;
  readonly originalHeight: number | null;
  readonly format: string | null;
  readonly byteSize: number | null;
  readonly processing: string;
  readonly variantVersion: number;
  readonly uploadedBy: string | null;
  readonly reviewedAt: string | null;
  readonly publishedAt: string | null;
  readonly sourceUrl: string | null;
  /** Public delivery URL (1600w) — set only for published + ready rows. */
  readonly deliveryUrl: string | null;
  readonly srcSet: string | null;
  /** Session-gated preview URL for drafts/review rows with stored bytes. */
  readonly previewUrl: string | null;
  /** Legacy externally hosted file; kept working, never proxied. */
  readonly externalUrl: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

const toAdminView = (row: DishMediaAdminRow, index: number): DishPhotoAdminView => {
  const version = Number(row.variant_version);

  const publishable =
    row.status === "published" && row.processing === "ready" && row.object_key !== null;

  // Admin previews resolve only for processed rows; failed processing has
  // no bytes to show, and published rows use the public delivery URL.
  const previewable = row.object_key !== null && !publishable && row.processing === "ready";

  return {
    id: row.id,
    dishId: row.dish_id,
    status: row.status,
    sortOrder: Number(row.sort_order),
    isPrimary: index === 0,
    altText: row.alt_text,
    attribution: row.attribution,
    license: row.license,
    focalX: row.focal_x,
    focalY: row.focal_y,
    originalWidth: toNumberOrNull(row.original_width),
    originalHeight: toNumberOrNull(row.original_height),
    format: row.format,
    byteSize: toNumberOrNull(row.byte_size),
    processing: row.processing,
    variantVersion: version,
    uploadedBy: row.uploaded_by,
    reviewedAt: toIso(row.reviewed_at),
    publishedAt: toIso(row.published_at),
    sourceUrl: row.source_url,
    deliveryUrl: publishable ? dishMediaUrl(row.id, version, 1600) : null,
    srcSet: publishable ? dishMediaSrcSet(row.id, version) : null,
    previewUrl: previewable ? dishMediaPreviewUrl(row.id, version, 800) : null,
    externalUrl: row.public_url,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
};

/**
 * Public catalog shape for one published image. Deterministic delivery URLs
 * need no per-image query: the follow-up carousel wiring builds them from
 * these fields alone.
 */
export interface PublishedDishImage {
  readonly id: string;
  readonly dishId: string;
  /** Largest stored derivative, or the legacy external file URL. */
  readonly url: string;
  readonly srcSet: string | null;
  readonly alt: string | null;
  readonly attribution: string | null;
  readonly focalX: number | null;
  readonly focalY: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export const toPublishedImage = (row: DishMediaPublishedRow): PublishedDishImage | null => {
  if (row.object_key !== null) {
    const version = Number(row.variant_version);

    return {
      id: row.id,
      dishId: row.dish_id,
      url: dishMediaUrl(row.id, version, 1600),
      srcSet: dishMediaSrcSet(row.id, version),
      alt: row.alt_text,
      attribution: row.attribution,
      focalX: row.focal_x,
      focalY: row.focal_y,
      width: toNumberOrNull(row.original_width),
      height: toNumberOrNull(row.original_height),
    };
  }

  if (row.public_url !== null) {
    return {
      id: row.id,
      dishId: row.dish_id,
      url: row.public_url,
      srcSet: null,
      alt: row.alt_text,
      attribution: row.attribution,
      focalX: row.focal_x,
      focalY: row.focal_y,
      width: null,
      height: null,
    };
  }

  return null;
};

export interface ProcessedDishPhoto {
  readonly format: "jpeg" | "png" | "webp";
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly variants: ReadonlyArray<{ readonly width: number; readonly bytes: Uint8Array }>;
}

const failValidation = (reason: string): DishMediaValidationFailed =>
  new DishMediaValidationFailed({ reason });

/**
 * Sharp validation + derivative pipeline. Pure over bytes: EXIF-oriented,
 * metadata-stripped, aspect-preserving resizes that never upscale, encoded
 * to WebP ~q80. Rejects anything that is not a jpeg/png/webp photograph.
 */
export const processDishPhotoImage = async (
  bytes: Uint8Array,
  filename: string,
): Promise<ProcessedDishPhoto> => {
  if (bytes.byteLength === 0) {
    throw failValidation("empty file: choose a photo to upload");
  }

  if (bytes.byteLength > MAX_DISH_PHOTO_BYTES) {
    throw failValidation(
      `file is ${(bytes.byteLength / 1048576).toFixed(1)} MiB; photos must be 8 MiB or smaller`,
    );
  }

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";

  if (["svg", "gif", "heic", "heif", "pdf", "avif", "tiff"].includes(extension)) {
    throw failValidation(
      `".${extension}" files are not accepted; upload a JPEG, PNG, or WebP photo`,
    );
  }

  let metadata: SharpMetadata;

  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw failValidation("file is not a readable image; upload a JPEG, PNG, or WebP photo");
  }

  const detected =
    metadata.format === "jpeg" || metadata.format === "png" || metadata.format === "webp"
      ? metadata.format
      : null;

  if (detected === null) {
    throw failValidation(
      "detected an unsupported image; only JPEG, PNG, and WebP photos are accepted",
    );
  }

  const width = metadata.width;
  const height = metadata.height;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw failValidation("image has no decodable dimensions");
  }

  // EXIF orientation ≥ 5 swaps the axes; report the displayed dimensions so
  // metadata, aspect reservation, and rendered bytes agree.
  const orientation = metadata.orientation ?? 1;
  const orientedWidth = orientation >= 5 ? height : width;
  const orientedHeight = orientation >= 5 ? width : height;

  if (Math.min(orientedWidth, orientedHeight) < MIN_SHORT_SIDE_PX) {
    throw failValidation(
      `image is ${orientedWidth}x${orientedHeight}px; the shortest side must be at least 600px`,
    );
  }

  if (orientedWidth * orientedHeight > MAX_DECODED_PIXELS) {
    throw failValidation(
      `image is ${orientedWidth}x${orientedHeight}px; photos above 24 megapixels are not accepted`,
    );
  }

  // Sequential resizes bound Sharp concurrency per upload: no worker pool,
  // no background jobs, one photo at a time.
  const variants: Array<{ readonly width: number; readonly bytes: Uint8Array }> = [];

  for (const targetWidth of DERIVATIVE_WIDTHS) {
    // eslint-disable-next-line no-await-in-loop -- sequential resizes bound Sharp memory per upload
    const rendered = await sharp(bytes)
      .rotate()
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: DERIVATIVE_QUALITY })
      .toBuffer();

    variants.push({ width: targetWidth, bytes: new Uint8Array(rendered) });
  }

  return {
    format: detected,
    width: orientedWidth,
    height: orientedHeight,
    byteSize: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    variants,
  };
};

interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const resolveStorageConfig = (): StorageConfig => {
  const endpoint = process.env["S3_ENDPOINT_INTERNAL"];
  const accessKeyId = process.env["S3_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"];

  if (endpoint === undefined || endpoint.length === 0) {
    throw new DishMediaStorageMisconfigured({
      reason: "S3_ENDPOINT_INTERNAL is not configured",
    });
  }

  if (accessKeyId === undefined || secretAccessKey === undefined) {
    throw new DishMediaStorageMisconfigured({ reason: "S3 credentials are not configured" });
  }

  return {
    endpoint,
    region: process.env["S3_REGION"] ?? "garage",
    bucket:
      process.env["S3_BUCKET_MEDIA"] ?? process.env["S3_BUCKET_PRIVATE"] ?? "feastjourney-private",
    accessKeyId,
    secretAccessKey,
  };
};

const storageClient = (config: StorageConfig): S3Client =>
  new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });

export class DishMediaStorage extends Context.Service<
  DishMediaStorage,
  {
    readonly putVariant: (
      key: string,
      bytes: Uint8Array,
    ) => Effect.Effect<void, DishMediaStorageFailed | DishMediaStorageMisconfigured>;
    readonly getVariant: (
      key: string,
    ) => Effect.Effect<Uint8Array, DishMediaStorageFailed | DishMediaStorageMisconfigured>;
    readonly variantExists: (key: string) => Effect.Effect<boolean, DishMediaStorageMisconfigured>;
    readonly deleteVariants: (
      keys: ReadonlyArray<string>,
    ) => Effect.Effect<void, DishMediaStorageMisconfigured>;
  }
>()("feastjourney/food-discovery/DishMediaStorage") {}

export const DishMediaStorageLive = Layer.succeed(DishMediaStorage, {
  putVariant: (key, bytes) =>
    Effect.tryPromise({
      try: async () => {
        const config = resolveStorageConfig();

        await storageClient(config).send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: "image/webp",
          }),
        );
      },
      catch: (cause) =>
        cause instanceof DishMediaStorageMisconfigured
          ? cause
          : new DishMediaStorageFailed({
              operation: "put",
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
    }),
  getVariant: (key) =>
    Effect.tryPromise({
      try: async () => {
        const config = resolveStorageConfig();

        const response = await storageClient(config).send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        );

        if (response.Body === undefined) {
          throw new DishMediaStorageFailed({ operation: "get", reason: "empty object body" });
        }

        return new Uint8Array(await response.Body.transformToByteArray());
      },
      catch: (cause) =>
        cause instanceof DishMediaStorageMisconfigured || cause instanceof DishMediaStorageFailed
          ? cause
          : new DishMediaStorageFailed({
              operation: "get",
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
    }),
  variantExists: (key) =>
    Effect.tryPromise({
      try: async () => {
        const config = resolveStorageConfig();

        try {
          await storageClient(config).send(
            new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
          );

          return true;
        } catch {
          return false;
        }
      },
      catch: (cause) =>
        cause instanceof DishMediaStorageMisconfigured
          ? cause
          : new DishMediaStorageMisconfigured({ reason: String(cause) }),
    }),
  deleteVariants: (keys) =>
    Effect.tryPromise({
      try: async () => {
        if (keys.length === 0) {
          return;
        }

        const config = resolveStorageConfig();

        // Best-effort withdrawal: object removal must never fail the DB
        // delete that already revoked public visibility.
        try {
          await storageClient(config).send(
            new DeleteObjectsCommand({
              Bucket: config.bucket,
              Delete: { Objects: keys.map((Key) => ({ Key })) },
            }),
          );
        } catch {
          return;
        }
      },
      catch: (cause) =>
        cause instanceof DishMediaStorageMisconfigured
          ? cause
          : new DishMediaStorageMisconfigured({ reason: String(cause) }),
    }),
});

export class DishMediaRepository extends Context.Service<
  DishMediaRepository,
  {
    readonly listByDish: (
      dishId: bigint,
    ) => Effect.Effect<ReadonlyArray<DishMediaAdminRow>, DatabaseError, Database>;
    readonly findById: (
      id: bigint,
    ) => Effect.Effect<DishMediaAdminRow | null, DatabaseError, Database>;
    readonly publishedByDishIds: (
      ids: ReadonlyArray<bigint>,
    ) => Effect.Effect<ReadonlyArray<DishMediaPublishedRow>, DatabaseError, Database>;
    readonly countByDish: (dishId: bigint) => Effect.Effect<number, DatabaseError, Database>;
    readonly maxSortOrder: (dishId: bigint) => Effect.Effect<number, DatabaseError, Database>;
    readonly insertStaged: (input: {
      readonly dishId: bigint;
      readonly objectKey: string;
      readonly attribution: string | null;
      readonly license: string;
      readonly sortOrder: number;
      readonly altText: string | null;
      readonly focalX: number | null;
      readonly focalY: number | null;
      readonly originalWidth: number;
      readonly originalHeight: number;
      readonly format: "jpeg" | "png" | "webp";
      readonly byteSize: number;
      readonly checksumSha256: string;
      readonly uploadedBy: string;
      readonly processing: "processing" | "ready" | "failed";
      readonly sourceUrl: string | null;
    }) => Effect.Effect<DishMediaAdminRow, DatabaseError, Database>;
    readonly finalize: (input: {
      readonly id: bigint;
      readonly objectKey: string;
      readonly processing: "ready" | "failed";
    }) => Effect.Effect<DishMediaAdminRow | null, DatabaseError, Database>;
    readonly updateMetadata: (input: {
      readonly id: bigint;
      readonly altText: string | null;
      readonly attribution: string | null;
      readonly license: string;
      readonly focalX: number | null;
      readonly focalY: number | null;
      readonly sourceUrl: string | null;
    }) => Effect.Effect<DishMediaAdminRow | null, DatabaseError, Database>;
    readonly updateStatus: (input: {
      readonly id: bigint;
      readonly status: DishPhotoStatus;
      readonly reviewedAt: string | null;
      readonly publishedAt: string | null;
    }) => Effect.Effect<DishMediaAdminRow | null, DatabaseError, Database>;
    readonly setSortOrder: (
      id: bigint,
      sortOrder: number,
    ) => Effect.Effect<void, DatabaseError, Database>;
    readonly remove: (
      id: bigint,
    ) => Effect.Effect<DishMediaDeleteRow | null, DatabaseError, Database>;
  }
>()("feastjourney/food-discovery/DishMediaRepository") {}

export const DishMediaRepositoryLive = Layer.succeed(DishMediaRepository, {
  listByDish: (dishId) =>
    runQuery("dish-media/list", (sql) => dishMediaAdminList.run(sql, { dish_id: dishId })),
  findById: (id) => runQuery("dish-media/find", (sql) => dishMediaFindById.run(sql, { id })),
  publishedByDishIds: (ids) =>
    runQuery("dish-media/published", (sql) =>
      dishMediaPublishedByDishIds.run(sql, { ids: [...ids] }),
    ),
  countByDish: (dishId) =>
    Effect.map(
      runQuery("dish-media/count", (sql) => dishMediaCountByDish.run(sql, { dish_id: dishId })),
      (row) => Number(row.count),
    ),
  maxSortOrder: (dishId) =>
    Effect.map(
      runQuery("dish-media/max-sort", (sql) => dishMediaMaxSortOrder.run(sql, { dish_id: dishId })),
      (row) => Number(row.max_sort_order),
    ),
  insertStaged: (input) =>
    runQuery("dish-media/insert", (sql) =>
      dishMediaInsert.run(sql, {
        dish_id: input.dishId,
        object_key: input.objectKey,
        attribution: input.attribution,
        license: input.license,
        sort_order: input.sortOrder,
        alt_text: input.altText,
        focal_x: input.focalX,
        focal_y: input.focalY,
        original_width: input.originalWidth,
        original_height: input.originalHeight,
        format: input.format,
        byte_size: input.byteSize,
        checksum_sha256: input.checksumSha256,
        uploaded_by: input.uploadedBy,
        processing: input.processing,
        source_url: input.sourceUrl,
      }),
    ),
  finalize: (input) =>
    runQuery("dish-media/finalize", (sql) =>
      dishMediaFinalize.run(sql, {
        id: input.id,
        object_key: input.objectKey,
        processing: input.processing,
      }),
    ),
  updateMetadata: (input) =>
    runQuery("dish-media/update-metadata", (sql) =>
      dishMediaUpdateMetadata.run(sql, {
        id: input.id,
        alt_text: input.altText,
        attribution: input.attribution,
        license: input.license,
        focal_x: input.focalX,
        focal_y: input.focalY,
        source_url: input.sourceUrl,
      }),
    ),
  updateStatus: (input) =>
    runQuery("dish-media/update-status", (sql) =>
      dishMediaUpdateStatus.run(sql, {
        id: input.id,
        status: input.status,
        reviewed_at: input.reviewedAt,
        published_at: input.publishedAt,
      }),
    ),
  setSortOrder: (id, sortOrder) =>
    Effect.asVoid(
      runQuery("dish-media/sort", (sql) =>
        dishMediaSetSortOrder.run(sql, { id, sort_order: sortOrder }),
      ),
    ),
  remove: (id) => runQuery("dish-media/delete", (sql) => dishMediaDelete.run(sql, { id })),
});

export interface StagePhotoInput {
  readonly dishId: string;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly altText: string | null;
  readonly attribution: string | null;
  readonly license: string;
  readonly focalX: number | null;
  readonly focalY: number | null;
  readonly sourceUrl: string | null;
  readonly makePrimary: boolean;
}

export interface UpdatePhotoMetadataInput {
  readonly mediaId: string;
  readonly altText: string | null;
  readonly attribution: string | null;
  readonly license: string;
  readonly focalX: number | null;
  readonly focalY: number | null;
  readonly sourceUrl: string | null;
}

export interface ServeDerivativeInput {
  readonly mediaId: string;
  readonly version: number;
  readonly width: number;
  readonly preview: boolean;
}

export interface ServedDerivative {
  readonly bytes: Uint8Array;
  readonly contentType: "image/webp";
  readonly etag: string;
  readonly byteSize: number;
}

const parseDishId = (dishId: string): bigint | null => {
  if (!/^[0-9]{1,19}$/.test(dishId)) {
    return null;
  }

  try {
    return BigInt(dishId);
  } catch {
    return null;
  }
};

const memberUserId = (actor: Actor): Effect.Effect<string, InsufficientPermissions> =>
  Actor.$match(actor, {
    Guest: () =>
      Effect.fail(
        new InsufficientPermissions({ reason: "dish photos require a signed-in member" }),
      ),
    Member: ({ userId }) => Effect.succeed(userId),
  });

const validateMetadataFields = (
  input: Omit<UpdatePhotoMetadataInput, "mediaId">,
): Effect.Effect<void, DishMediaValidationFailed> => {
  if (input.license !== "unknown" && !PUBLISHABLE_PHOTO_LICENSES.has(input.license)) {
    return Effect.fail(
      failValidation(
        `license "${input.license}" is not supported; choose ${[...SUPPORTED_PHOTO_LICENSES].join(", ")}, or unknown`,
      ),
    );
  }

  for (const [label, value] of [
    ["focal_x", input.focalX],
    ["focal_y", input.focalY],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
      return Effect.fail(failValidation(`${label} must be between 0 and 1`));
    }
  }

  if (input.sourceUrl !== null && !input.sourceUrl.startsWith("https://")) {
    return Effect.fail(failValidation("source_url must be an https URL"));
  }

  if (input.altText !== null && input.altText.length > 500) {
    return Effect.fail(failValidation("alt text must be 500 characters or fewer"));
  }

  if (input.attribution !== null && input.attribution.length > 500) {
    return Effect.fail(failValidation("attribution must be 500 characters or fewer"));
  }

  return Effect.void;
};

export interface DishMediaServiceApi {
  readonly listForAdmin: (
    dishId: string,
  ) => Effect.Effect<
    ReadonlyArray<DishPhotoAdminView>,
    DishMediaError,
    Database | DishMediaRepository | CurrentActor | Authorization | RoleRepository
  >;
  readonly stagePhoto: (
    input: StagePhotoInput,
  ) => Effect.Effect<
    DishPhotoAdminView,
    DishMediaError,
    | Database
    | DishMediaRepository
    | DishMediaStorage
    | CurrentActor
    | Authorization
    | RoleRepository
  >;
  readonly updateMetadata: (
    input: UpdatePhotoMetadataInput,
  ) => Effect.Effect<
    DishPhotoAdminView,
    DishMediaError,
    Database | DishMediaRepository | CurrentActor | Authorization | RoleRepository
  >;
  readonly reorderPhotos: (input: {
    readonly dishId: string;
    readonly orderedIds: ReadonlyArray<string>;
  }) => Effect.Effect<
    ReadonlyArray<DishPhotoAdminView>,
    DishMediaError,
    Database | DishMediaRepository | CurrentActor | Authorization | RoleRepository
  >;
  readonly submitForReview: (
    mediaId: string,
  ) => Effect.Effect<
    DishPhotoAdminView,
    DishMediaError,
    Database | DishMediaRepository | CurrentActor | Authorization | RoleRepository
  >;
  readonly publishPhoto: (
    mediaId: string,
  ) => Effect.Effect<
    DishPhotoAdminView,
    DishMediaError,
    | Database
    | DishMediaRepository
    | DishMediaStorage
    | CurrentActor
    | Authorization
    | RoleRepository
  >;
  readonly returnToDraft: (
    mediaId: string,
  ) => Effect.Effect<
    DishPhotoAdminView,
    DishMediaError,
    Database | DishMediaRepository | CurrentActor | Authorization | RoleRepository
  >;
  readonly removePhoto: (
    mediaId: string,
  ) => Effect.Effect<
    { readonly id: string; readonly dishId: string },
    DishMediaError,
    | Database
    | DishMediaRepository
    | DishMediaStorage
    | CurrentActor
    | Authorization
    | RoleRepository
  >;
  readonly serveDerivative: (
    input: ServeDerivativeInput,
  ) => Effect.Effect<
    ServedDerivative,
    DishMediaError,
    | Database
    | DishMediaRepository
    | DishMediaStorage
    | CurrentActor
    | Authorization
    | RoleRepository
  >;
  readonly publishedImagesByDishIds: (
    ids: ReadonlyArray<bigint>,
  ) => Effect.Effect<
    ReadonlyMap<string, ReadonlyArray<PublishedDishImage>>,
    DatabaseError,
    Database | DishMediaRepository
  >;
}

export class DishMediaService extends Context.Service<DishMediaService, DishMediaServiceApi>()(
  "feastjourney/food-discovery/DishMediaService",
) {}

const requireDish = (dishId: bigint): Effect.Effect<void, DishNotFound | DatabaseError, Database> =>
  Effect.flatMap(
    runQuery("dish/find", (sql) => dishFindById.run(sql, { id: dishId })),
    (row) =>
      row === null ? Effect.fail(new DishNotFound({ dishId: String(dishId) })) : Effect.void,
  );

const loadPhoto = (
  mediaId: string,
): Effect.Effect<DishMediaAdminRow, DishMediaError, Database | DishMediaRepository> => {
  const id = parseDishId(mediaId);

  if (id === null) {
    return Effect.fail(new DishMediaNotFound({ mediaId }));
  }

  return Effect.flatMap(DishMediaRepository, (repository) =>
    Effect.flatMap(repository.findById(id), (row) =>
      row === null ? Effect.fail(new DishMediaNotFound({ mediaId })) : Effect.succeed(row),
    ),
  );
};

export const DishMediaServiceLive = Layer.effect(
  DishMediaService,
  Effect.gen(function* () {
    const repository = yield* DishMediaRepository;
    const storage = yield* DishMediaStorage;

    const listViews = (
      dishId: bigint,
    ): Effect.Effect<ReadonlyArray<DishPhotoAdminView>, DatabaseError, Database> =>
      Effect.map(repository.listByDish(dishId), (rows) =>
        rows.map((row, index) => toAdminView(row, index)),
      );

    return DishMediaService.of({
      listForAdmin: (dishId) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const authorization = yield* Authorization;

          yield* authorization.require(actor, { resource: "food", actions: ["read"] });

          const parsed = parseDishId(dishId);

          if (parsed === null) {
            return yield* new DishNotFound({ dishId });
          }

          yield* requireDish(parsed);

          return yield* listViews(parsed);
        }),
      stagePhoto: (input) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const authorization = yield* Authorization;
          const userId = yield* memberUserId(actor);

          yield* authorization.require(actor, { resource: "food", actions: ["import"] });
          yield* validateMetadataFields(input);

          const dishId = parseDishId(input.dishId);

          if (dishId === null) {
            return yield* new DishNotFound({ dishId: input.dishId });
          }

          yield* requireDish(dishId);

          const existing = yield* repository.countByDish(dishId);

          if (existing >= MAX_PHOTOS_PER_DISH) {
            return yield* new DishMediaLimitExceeded({
              dishId: input.dishId,
              limit: MAX_PHOTOS_PER_DISH,
            });
          }

          const processed = yield* Effect.tryPromise({
            try: () => processDishPhotoImage(input.bytes, input.filename),
            catch: (cause) =>
              cause instanceof DishMediaValidationFailed
                ? cause
                : failValidation(
                    cause instanceof Error ? cause.message : "could not process image",
                  ),
          });

          const stagedKey = `dish-media/dishes/${input.dishId}/staged-${randomUUID()}`;
          const maxSortOrder = yield* repository.maxSortOrder(dishId);

          const staged = yield* repository.insertStaged({
            dishId,
            objectKey: stagedKey,
            attribution: input.attribution,
            license: input.license,
            sortOrder: maxSortOrder + 1,
            altText: input.altText,
            focalX: input.focalX,
            focalY: input.focalY,
            originalWidth: processed.width,
            originalHeight: processed.height,
            format: processed.format,
            byteSize: processed.byteSize,
            checksumSha256: processed.checksumSha256,
            uploadedBy: userId,
            processing: "processing",
            sourceUrl: input.sourceUrl,
          });

          const mediaId = BigInt(staged.id);
          const finalBase = dishMediaKeyBase(input.dishId, staged.id, 1);

          const uploads = processed.variants.map((variant) => ({
            key: dishMediaVariantKey(finalBase, variant.width),
            bytes: variant.bytes,
          }));

          const variantKeys = uploads.map((upload) => upload.key);

          const uploaded = yield* Effect.forEach(uploads, (upload) =>
            storage.putVariant(upload.key, upload.bytes),
          ).pipe(
            Effect.as(true),
            Effect.catch((cause) => Effect.succeed(cause)),
          );

          if (uploaded !== true) {
            const failure =
              uploaded instanceof DishMediaStorageFailed ||
              uploaded instanceof DishMediaStorageMisconfigured
                ? uploaded
                : new DishMediaStorageFailed({ operation: "put", reason: "unknown" });

            yield* repository.finalize({
              id: mediaId,
              objectKey: stagedKey,
              processing: "failed",
            });
            yield* storage.deleteVariants(variantKeys);

            return yield* failure;
          }

          const finalized = yield* repository.finalize({
            id: mediaId,
            objectKey: finalBase,
            processing: "ready",
          });

          if (finalized === null) {
            yield* storage.deleteVariants(variantKeys);

            return yield* new DishMediaStorageFailed({
              operation: "finalize",
              reason: "staged row disappeared before finalize",
            });
          }

          if (input.makePrimary) {
            const rows = yield* repository.listByDish(dishId);
            const rest = rows.map((row) => row.id).filter((id) => id !== staged.id);

            yield* withTransaction(
              "dish-media/reorder",
              Effect.forEach([staged.id, ...rest], (id, index) =>
                repository.setSortOrder(BigInt(id), index),
              ),
            );
          }

          const views = yield* listViews(dishId);
          const created = views.find((view) => view.id === staged.id);

          if (created === undefined) {
            return yield* new DishMediaStorageFailed({
              operation: "finalize",
              reason: "staged row missing after finalize",
            });
          }

          return created;
        }),
      updateMetadata: (input) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const authorization = yield* Authorization;

          yield* authorization.require(actor, { resource: "food", actions: ["import"] });
          yield* validateMetadataFields(input);

          const row = yield* loadPhoto(input.mediaId);

          const updated = yield* repository.updateMetadata({
            id: BigInt(row.id),
            altText: input.altText,
            attribution: input.attribution,
            license: input.license,
            focalX: input.focalX,
            focalY: input.focalY,
            sourceUrl: input.sourceUrl,
          });

          if (updated === null) {
            return yield* new DishMediaNotFound({ mediaId: input.mediaId });
          }

          const views = yield* listViews(BigInt(updated.dish_id));
          const view = views.find((entry) => entry.id === updated.id);

          if (view === undefined) {
            return yield* new DishMediaNotFound({ mediaId: input.mediaId });
          }

          return view;
        }),
      reorderPhotos: (input) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const authorization = yield* Authorization;

          yield* authorization.require(actor, { resource: "food", actions: ["import"] });

          const dishId = parseDishId(input.dishId);

          if (dishId === null) {
            return yield* new DishNotFound({ dishId: input.dishId });
          }

          yield* requireDish(dishId);

          const rows = yield* repository.listByDish(dishId);
          const current = new Set(rows.map((row) => row.id));
          const proposed = new Set(input.orderedIds);

          if (
            input.orderedIds.length !== current.size ||
            current.size !== proposed.size ||
            [...current].some((id) => !proposed.has(id))
          ) {
            return yield* new DishMediaConflict({
              reason: "reorder must include every photo of the dish exactly once",
            });
          }

          yield* withTransaction(
            "dish-media/reorder",
            Effect.forEach(input.orderedIds, (id, index) =>
              repository.setSortOrder(BigInt(id), index),
            ),
          );

          return yield* listViews(dishId);
        }),
      submitForReview: (mediaId) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const authorization = yield* Authorization;

          yield* authorization.require(actor, { resource: "food", actions: ["import"] });

          const row = yield* loadPhoto(mediaId);

          if (row.processing !== "ready") {
            return yield* new DishMediaConflict({
              reason: `photo is ${row.processing}; only processed photos can enter review`,
            });
          }

          if (row.status === "published") {
            return yield* new DishMediaConflict({
              reason: "published photos return to draft first; they never re-enter review directly",
            });
          }

          if (row.status === "review") {
            const views = yield* listViews(BigInt(row.dish_id));
            const view = views.find((entry) => entry.id === row.id);

            if (view === undefined) {
              return yield* new DishMediaNotFound({ mediaId });
            }

            return view;
          }

          const updated = yield* repository.updateStatus({
            id: BigInt(row.id),
            status: "review",
            reviewedAt: new Date().toISOString(),
            publishedAt: null,
          });

          if (updated === null) {
            return yield* new DishMediaNotFound({ mediaId });
          }

          const views = yield* listViews(BigInt(updated.dish_id));
          const view = views.find((entry) => entry.id === updated.id);

          if (view === undefined) {
            return yield* new DishMediaNotFound({ mediaId });
          }

          return view;
        }),
      publishPhoto: (mediaId) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const authorization = yield* Authorization;

          yield* authorization.require(actor, { resource: "food", actions: ["publish"] });

          const row = yield* loadPhoto(mediaId);
          const reasons: Array<string> = [];

          if (row.processing !== "ready") {
            reasons.push(`photo is ${row.processing}; finalize processing before publishing`);
          }

          if (row.object_key === null) {
            reasons.push("photo has no stored image");
          }

          if (row.license === "unknown" || !PUBLISHABLE_PHOTO_LICENSES.has(row.license)) {
            reasons.push(
              `license "${row.license}" cannot publish; attach ${[...SUPPORTED_PHOTO_LICENSES].join(", ")}`,
            );
          }

          if (row.attribution === null || row.attribution.trim().length === 0) {
            reasons.push("attribution is required to publish");
          }

          if (row.alt_text === null || row.alt_text.trim().length === 0) {
            reasons.push("alt text is required to publish");
          }

          if (row.status === "published") {
            const views = yield* listViews(BigInt(row.dish_id));
            const view = views.find((entry) => entry.id === row.id);

            if (view === undefined) {
              return yield* new DishMediaNotFound({ mediaId });
            }

            return view;
          }

          // Review is mandatory: drafts carry unvetted metadata and must
          // pass submitForReview before they can go public. reviewed_at
          // records submission-for-review time; approval time is
          // published_at, set below.
          if (row.status !== "review") {
            return yield* new DishMediaConflict({
              reason: `photo is ${row.status}; submit it for review before publishing`,
            });
          }

          if (reasons.length > 0) {
            return yield* new DishMediaPublishBlocked({ mediaId, reasons });
          }

          const base = dishMediaKeyBase(row.dish_id, row.id, Number(row.variant_version));
          const missing: Array<number> = [];

          for (const width of DERIVATIVE_WIDTHS) {
            const exists = yield* storage.variantExists(dishMediaVariantKey(base, width));

            if (!exists) {
              missing.push(width);
            }
          }

          if (missing.length > 0) {
            return yield* new DishMediaPublishBlocked({
              mediaId,
              reasons: [`stored derivatives missing for widths: ${missing.join(", ")}`],
            });
          }

          const updated = yield* repository.updateStatus({
            id: BigInt(row.id),
            status: "published",
            reviewedAt: row.reviewed_at ?? new Date().toISOString(),
            publishedAt: new Date().toISOString(),
          });

          if (updated === null) {
            return yield* new DishMediaNotFound({ mediaId });
          }

          const views = yield* listViews(BigInt(updated.dish_id));
          const view = views.find((entry) => entry.id === updated.id);

          if (view === undefined) {
            return yield* new DishMediaNotFound({ mediaId });
          }

          return view;
        }),
      returnToDraft: (mediaId) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const authorization = yield* Authorization;

          yield* authorization.require(actor, { resource: "food", actions: ["import"] });

          const row = yield* loadPhoto(mediaId);

          // Withdrawing a published photo revokes a public delivery URL:
          // same bar as publishing, not plain import.
          if (row.status === "published") {
            yield* authorization.require(actor, { resource: "food", actions: ["publish"] });
          }

          if (row.status === "draft") {
            const views = yield* listViews(BigInt(row.dish_id));
            const view = views.find((entry) => entry.id === row.id);

            if (view === undefined) {
              return yield* new DishMediaNotFound({ mediaId });
            }

            return view;
          }

          const updated = yield* repository.updateStatus({
            id: BigInt(row.id),
            status: "draft",
            reviewedAt: row.reviewed_at,
            publishedAt: null,
          });

          if (updated === null) {
            return yield* new DishMediaNotFound({ mediaId });
          }

          const views = yield* listViews(BigInt(updated.dish_id));
          const view = views.find((entry) => entry.id === updated.id);

          if (view === undefined) {
            return yield* new DishMediaNotFound({ mediaId });
          }

          return view;
        }),
      removePhoto: (mediaId) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const authorization = yield* Authorization;

          yield* authorization.require(actor, { resource: "food", actions: ["import"] });

          // loadPhoto first: deleting a published photo revokes a public
          // delivery URL, so it needs the publish bar, not plain import.
          // The row must exist to decide; missing rows still 404 below.
          const existing = yield* loadPhoto(mediaId);

          if (existing.status === "published") {
            yield* authorization.require(actor, { resource: "food", actions: ["publish"] });
          }

          const id = parseDishId(mediaId);

          if (id === null) {
            return yield* new DishMediaNotFound({ mediaId });
          }

          const deleted = yield* repository.remove(id);

          if (deleted === null) {
            return yield* new DishMediaNotFound({ mediaId });
          }

          // Withdrawal first: the row is already gone, so nothing public can
          // resolve. Object removal is best-effort and never fails the delete.
          if (deleted.object_key !== null) {
            const versionMatch = /\/(\d+)$/.exec(deleted.object_key);
            const version = versionMatch?.[1] ?? "1";
            const base = dishMediaKeyBase(deleted.dish_id, deleted.id, Number(version));

            yield* storage.deleteVariants(
              DERIVATIVE_WIDTHS.map((width) => dishMediaVariantKey(base, width)),
            );
          }

          return { id: deleted.id, dishId: deleted.dish_id };
        }),
      serveDerivative: (input) =>
        Effect.gen(function* () {
          if (
            !Number.isInteger(input.version) ||
            input.version < 1 ||
            !DERIVATIVE_WIDTHS.some((allowed) => allowed === input.width)
          ) {
            return yield* new DishMediaValidationFailed({
              reason: `unknown derivative version=${input.version} width=${input.width}`,
            });
          }

          const row = yield* loadPhoto(input.mediaId);

          if (row.object_key === null) {
            return yield* new DishMediaNotFound({ mediaId: input.mediaId });
          }

          if (Number(row.variant_version) !== input.version) {
            // Immutable versioned URLs: a rotated version never serves stale bytes.
            return yield* new DishMediaNotFound({ mediaId: input.mediaId });
          }

          if (!input.preview) {
            // Public origin serves published + ready derivatives only.
            // Drafts, review items, and failed processing stay unfetchable.
            if (row.status !== "published" || row.processing !== "ready") {
              return yield* new DishMediaNotFound({ mediaId: input.mediaId });
            }
          } else {
            const actor = yield* CurrentActor;
            const authorization = yield* Authorization;

            // Member-only preview: Guest fails here, so only signed-in
            // members holding food:read reach stored bytes.
            yield* memberUserId(actor);
            yield* authorization.require(actor, { resource: "food", actions: ["read"] });

            if (row.processing !== "ready") {
              return yield* new DishMediaNotFound({ mediaId: input.mediaId });
            }
          }

          const base = dishMediaKeyBase(row.dish_id, row.id, Number(row.variant_version));
          const bytes = yield* storage.getVariant(dishMediaVariantKey(base, input.width));

          return {
            bytes,
            contentType: "image/webp" as const,
            etag: `"dm-${row.id}-v${row.variant_version}-${input.width}"`,
            byteSize: bytes.byteLength,
          };
        }),
      publishedImagesByDishIds: (ids) =>
        Effect.gen(function* () {
          if (ids.length === 0) {
            return new Map<string, ReadonlyArray<PublishedDishImage>>();
          }

          const rows = yield* repository.publishedByDishIds(ids);
          const grouped = new Map<string, ReadonlyArray<PublishedDishImage>>();

          for (const row of rows) {
            const image = toPublishedImage(row);

            if (image === null) {
              continue;
            }

            grouped.set(row.dish_id, [...(grouped.get(row.dish_id) ?? []), image]);
          }

          return grouped;
        }),
    });
  }),
);

export const DishMediaLayersLive = Layer.provide(
  DishMediaServiceLive,
  Layer.mergeAll(DishMediaRepositoryLive, DishMediaStorageLive),
);

export const DishMediaFullLive = Layer.mergeAll(
  DishMediaRepositoryLive,
  DishMediaStorageLive,
  DishMediaLayersLive,
);
