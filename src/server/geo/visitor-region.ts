/**
 * Coarse visitor region from the hosting CDN's request headers. All fields
 * are nullable: local development has no CDN headers, and privacy-conscious
 * visitors may arrive without them. Nothing here identifies a person — the
 * country code only ever filters the public dish catalog.
 */
export type VisitorRegion = {
  readonly country: string | null;
  readonly region: string | null;
  readonly regionCode: string | null;
  readonly city: string | null;
};

const headerValue = (headers: Headers, name: string): string | null => {
  const raw = headers.get(name)?.trim();

  if (raw === undefined || raw === "" || raw.toUpperCase() === "XX") {
    return null;
  }

  return raw;
};

/** Read the visitor region from Cloudflare's `cf-*` request headers. */
export function getVisitorRegionFromHeaders(headers: Headers): VisitorRegion {
  const rawCountry = headerValue(headers, "cf-ipcountry");

  const country =
    rawCountry !== null && /^[A-Z]{2}$/.test(rawCountry.toUpperCase())
      ? rawCountry.toUpperCase()
      : null;

  return {
    city: headerValue(headers, "cf-ipcity"),
    country,
    region: headerValue(headers, "cf-region"),
    regionCode: headerValue(headers, "cf-region-code"),
  };
}

/** Read the visitor region from an incoming request's headers. */
export function getVisitorRegion(request: Request): VisitorRegion {
  return getVisitorRegionFromHeaders(request.headers);
}
