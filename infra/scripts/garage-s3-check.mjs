// Disposable Garage S3 round-trip check (CI + operator).
// Uses ONLY disposable credentials/objects; never production buckets.
// Mirrors the DishMediaStorage S3Client construction (endpoint, region,
// credentials, forcePathStyle:true) so a pass proves adapter compatibility.
//
// Required env: S3_ENDPOINT, S3_REGION, S3_BUCKET,
//   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
// Optional: S3_TEST_PREFIX (default: garage-verify-<pid>)
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const req = (name) => {
  const value = process.env[name];

  if (!value) throw new Error(`missing ${name}`);

  return value;
};

const endpoint = req("S3_ENDPOINT");
const region = process.env["S3_REGION"] ?? "garage";
const bucket = req("S3_BUCKET");
const accessKeyId = req("S3_ACCESS_KEY_ID");
const secretAccessKey = req("S3_SECRET_ACCESS_KEY");
const prefix = process.env["S3_TEST_PREFIX"] ?? `garage-verify-${process.pid}`;
const key = `${prefix}/round-trip.bin`;
const payload = new TextEncoder().encode(`garage-verify ${new Date().toISOString()}`);

const authed = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

const anon = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
});

const bogus = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId: "GK00000000000000000000000000000000", secretAccessKey: "0".repeat(64) },
  forcePathStyle: true,
});

const mustFail = async (label, fn) => {
  try {
    await fn();
  } catch {
    console.log(`ok: ${label} denied as expected`);

    return;
  }

  throw new Error(`expected failure but succeeded: ${label}`);
};

await authed.send(
  new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload, ContentType: "image/webp" }),
);

console.log("ok: PUT");

await authed.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

console.log("ok: HEAD");

const got = await authed.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
const bytes = new Uint8Array(await got.Body.transformToByteArray());

if (Buffer.compare(Buffer.from(bytes), Buffer.from(payload)) !== 0) {
  throw new Error("GET bytes mismatch");
}

console.log("ok: GET bytes match");

await mustFail("anonymous PUT", () =>
  anon.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}/anon.bin`, Body: payload })),
);

await mustFail("anonymous GET", () => anon.send(new GetObjectCommand({ Bucket: bucket, Key: key })));

await mustFail("bogus-credential GET", () =>
  bogus.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
);

await authed.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

console.log("ok: DELETE");

await mustFail("GET after DELETE", () =>
  authed.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
);

console.log("garage S3 round-trip ok");
