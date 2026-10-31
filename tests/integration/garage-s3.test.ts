import { describe, expect, test } from "bun:test";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Effect } from "effect";

import {
  DishMediaStorage,
  DishMediaStorageLive,
} from "@/modules/food-discovery/server/operations/dish-media-service";
import { appRuntime } from "@/server/runtime";

/**
 * Garage S3 integration: disposable round-trip against a real Garage.
 *
 * Runs ONLY when S3 env is present (CI garage job exports S3_ENDPOINT_* +
 * disposable credentials). Without env it passes as a documented skip so
 * `bun test tests/` stays green for developers with no local Garage S3 keys.
 *
 * Never touches production buckets or real photographs: every object lives
 * under a unique `garage-test-<ts>-<rand>/` prefix and is deleted after.
 */

interface S3TestConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const s3TestConfig = (): S3TestConfig | null => {
  const endpoint = process.env["S3_ENDPOINT_INTERNAL"] ?? process.env["S3_ENDPOINT"];
  const accessKeyId = process.env["S3_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"];

  if (endpoint === undefined || accessKeyId === undefined || secretAccessKey === undefined) {
    return null;
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

const testPrefix = `garage-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const authedClient = (config: S3TestConfig): S3Client =>
  new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  });

describe("garage S3 integration (disposable)", () => {
  test("PUT/HEAD/GET/DELETE round-trip with path-style addressing", async () => {
    const config = s3TestConfig();

    if (config === null) {
      console.log("skip: no S3 env (CI garage job provides disposable credentials)");

      return;
    }

    const client = authedClient(config);
    const key = `${testPrefix}/round-trip.bin`;
    const payload = new TextEncoder().encode("garage-integration");

    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: payload }));

    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));

    const got = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));

    if (got.Body === undefined) {
      throw new Error("GET returned no body");
    }

    const bytes = new Uint8Array(await got.Body.transformToByteArray());

    expect(Buffer.from(bytes).toString()).toBe("garage-integration");

    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));

    let deleted = false;

    try {
      await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    } catch {
      deleted = true;
    }

    expect(deleted).toBe(true);
  });

  test("anonymous S3 access is denied", async () => {
    const config = s3TestConfig();

    if (config === null) {
      return;
    }

    // Explicit invalid credentials (not an empty chain): the AWS SDK default
    // chain would otherwise resolve the valid env credentials or stall on
    // IMDS, so an unsigned client cannot be constructed this way. An invalid
    // key exercises the same server denial path as an anonymous request.
    const anon = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: "GK00000000000000000000000000000000",
        secretAccessKey: "0".repeat(64),
      },
      forcePathStyle: true,
    });

    const key = `${testPrefix}/anon.bin`;
    let denied = false;

    try {
      await anon.send(
        new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: new Uint8Array([1, 2, 3]) }),
      );
    } catch {
      denied = true;
    }

    expect(denied).toBe(true);
  });

  test("DishMediaStorage adapter persists variants against real Garage", async () => {
    const config = s3TestConfig();

    if (config === null) {
      return;
    }

    const key = `${testPrefix}/dish-media/1/1/800.webp`;
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

    await appRuntime.runPromise(
      Effect.provide(
        Effect.flatMap(DishMediaStorage, (storage) =>
          Effect.gen(function* () {
            yield* storage.putVariant(key, bytes);

            const exists = yield* storage.variantExists(key);

            expect(exists).toBe(true);

            const fetched = yield* storage.getVariant(key);

            expect(Buffer.from(fetched).equals(Buffer.from(bytes))).toBe(true);

            yield* storage.deleteVariants([key]);

            const gone = yield* storage.variantExists(key);

            expect(gone).toBe(false);
          }),
        ),
        DishMediaStorageLive,
      ),
    );

    expect(config.bucket.length).toBeGreaterThan(0);
  }, 30000);
});
