import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import {
  DishMediaFullLive,
  DishMediaService,
} from "@/modules/food-discovery/server/operations/dish-media-service";
import { Actor } from "@/server/auth/actor";
import { withActor } from "@/server/auth/current-actor";
import { resolveSession } from "@/server/auth/session";
import { appRuntime } from "@/server/runtime";

export const Route = createFileRoute("/api/v1/dish-images/$mediaId/$version/$width")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleDishImage(request, params, false),
      HEAD: ({ request, params }) => handleDishImage(request, params, true),
    },
  },
});

interface DishImageParams {
  readonly mediaId: string;
  readonly version: string;
  readonly width: string;
}

const IMAGE_VERSION_PATTERN = /^[0-9]{1,19}$/;

/**
 * Same-origin delivery for approved dish-photo derivatives.
 *
 * Default: published + ready derivatives only (drafts, review items, and
 * failed processing resolve to 404 without distinguishing them, so private
 * state cannot be probed). `?preview=1` serves any ready row to a signed-in
 * member holding `food:read` for admin previews; it is never linked from
 * public responses and carries `private, no-store`.
 *
 * Public responses are immutable per (mediaId, version, width) and carry
 * year-long cache headers for Cloudflare edge caching. No per-request
 * re-encoding, no per-pixel database work: one indexed primary-key lookup,
 * then a single object fetch on cache miss. ETags are deterministic, so a
 * matching If-None-Match short-circuits before any storage call.
 */
const handleDishImage = async (
  request: Request,
  params: DishImageParams,
  headOnly: boolean,
): Promise<Response> => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const mediaId = params.mediaId;
  const version = Number(params.version);
  const width = Number(params.width);
  const preview = new URL(request.url).searchParams.get("preview") === "1";

  if (
    !IMAGE_VERSION_PATTERN.test(mediaId) ||
    !Number.isInteger(version) ||
    !Number.isInteger(width)
  ) {
    return imageError(404, requestId);
  }

  let actor: Actor = Actor.Guest();

  if (preview) {
    try {
      const trusted = await appRuntime.runPromise(resolveSession(request.headers));

      actor = Actor.Member({ userId: trusted.userId });
    } catch {
      return imageError(401, requestId);
    }
  }

  const expectedEtag = `"dm-${mediaId}-v${version}-${width}"`;

  if (!preview && request.headers.get("if-none-match") === expectedEtag) {
    return new Response(null, {
      status: 304,
      headers: imageHeaders(expectedEtag, 0, requestId, false),
    });
  }

  const program = Effect.flatMap(DishMediaService, (service) =>
    service.serveDerivative({ mediaId, version, width, preview }),
  ).pipe(
    Effect.map((derivative) => imageResponse(derivative, requestId, headOnly, preview)),
    Effect.provide(DishMediaFullLive),
    (effect) => withActor(actor, effect),
    Effect.catchTags({
      DishMediaNotFound: () => Effect.succeed(imageError(404, requestId)),
      DishMediaValidationFailed: () => Effect.succeed(imageError(404, requestId)),
      DishMediaStorageFailed: () => Effect.succeed(imageError(404, requestId)),
      DishMediaStorageMisconfigured: () => Effect.succeed(imageError(404, requestId)),
      InsufficientPermissions: () => Effect.succeed(imageError(403, requestId)),
    }),
    Effect.catch(() => Effect.succeed(imageError(500, requestId))),
  );

  return appRuntime.runPromise(program);
};

const imageHeaders = (
  etag: string,
  byteSize: number,
  requestId: string,
  preview: boolean,
): Headers => {
  const headers = new Headers();

  headers.set("Content-Type", "image/webp");
  headers.set("Content-Length", String(byteSize));
  headers.set("ETag", etag);
  headers.set("X-Request-Id", requestId);
  headers.set(
    "Cache-Control",
    preview ? "private, no-store" : "public, max-age=31536000, immutable",
  );

  return headers;
};

const imageResponse = (
  derivative: { readonly bytes: Uint8Array; readonly etag: string; readonly byteSize: number },
  requestId: string,
  headOnly: boolean,
  preview: boolean,
): Response => {
  const headers = imageHeaders(derivative.etag, derivative.byteSize, requestId, preview);

  if (headOnly) {
    return new Response(null, { status: 200, headers });
  }

  const body = new Uint8Array(derivative.byteSize);

  body.set(derivative.bytes);

  return new Response(body, { status: 200, headers });
};

const imageError = (status: number, requestId: string): Response =>
  Response.json(
    { error: status === 401 ? "sign-in required" : "not found", requestId },
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    },
  );
