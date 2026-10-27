import { Config, Option } from "effect";

export interface AppConfig {
  readonly databaseUrl: string;
  readonly databaseDirectUrl: string | undefined;
  readonly poolMax: number;
  readonly adminApiKey: string | undefined;
  readonly corsOrigins: ReadonlyArray<string>;
  readonly trustedProxies: ReadonlyArray<string>;
  readonly publicRateLimit: number;
  readonly publicRateWindowSeconds: number;
  readonly searchRateLimit: number;
  readonly searchRateWindowSeconds: number;
  readonly adminRateLimit: number;
  readonly adminRateWindowSeconds: number;
  readonly requestTimeoutMs: number;
}

const csv = (raw: string): ReadonlyArray<string> =>
  raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

export const appConfig: Config.Config<AppConfig> = Config.unwrap({
  databaseUrl: Config.String("DATABASE_URL"),
  databaseDirectUrl: Config.option(Config.String("DATABASE_DIRECT_URL")).pipe(
    Config.map(Option.getOrUndefined),
  ),
  poolMax: Config.Int("DATABASE_POOL_MAX").pipe(Config.withDefault(10)),
  adminApiKey: Config.option(Config.String("ADMIN_API_KEY")).pipe(
    Config.map(Option.getOrUndefined),
  ),
  corsOrigins: Config.String("CORS_ORIGINS").pipe(Config.map(csv), Config.withDefault([])),
  trustedProxies: Config.String("TRUSTED_PROXIES").pipe(Config.map(csv), Config.withDefault([])),
  publicRateLimit: Config.Int("RATE_LIMIT_PUBLIC").pipe(Config.withDefault(60)),
  publicRateWindowSeconds: Config.Int("RATE_LIMIT_PUBLIC_WINDOW_S").pipe(Config.withDefault(60)),
  searchRateLimit: Config.Int("RATE_LIMIT_SEARCH").pipe(Config.withDefault(20)),
  searchRateWindowSeconds: Config.Int("RATE_LIMIT_SEARCH_WINDOW_S").pipe(Config.withDefault(60)),
  adminRateLimit: Config.Int("RATE_LIMIT_ADMIN").pipe(Config.withDefault(10)),
  adminRateWindowSeconds: Config.Int("RATE_LIMIT_ADMIN_WINDOW_S").pipe(Config.withDefault(60)),
  wikidataUserAgent: Config.String("WIKIDATA_USER_AGENT").pipe(
    Config.withDefault(
      "FeastJourney/1.0 (culinary-discovery; contact: admin@feastjourney.example)",
    ),
  ),
  requestTimeoutMs: Config.Int("REQUEST_TIMEOUT_MS").pipe(Config.withDefault(15000)),
});
