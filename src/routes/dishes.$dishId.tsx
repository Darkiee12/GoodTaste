import { createFileRoute, getRouteApi, Link, notFound, useRouter } from "@tanstack/react-router";
import { z } from "zod";

import { getDishFn } from "@/modules/food-discovery/food.functions";
import type { DishProfile } from "@/modules/food-discovery/server/domain/dish";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const dishIdParamsSchema = z.object({
  dishId: z.string().min(1).max(120),
});

/** Server DishNotFound failures serialize without an Error message; match the tag. */
const dishNotFoundSchema = z.object({ _tag: z.literal("DishNotFound") });

export const Route = createFileRoute("/dishes/$dishId")({
  validateSearch: localeSearchSchema,
  loaderDeps: ({ search }) => ({ locale: search.lang }),
  loader: async ({ params, deps }): Promise<DishProfile> => {
    const parsed = dishIdParamsSchema.safeParse(params);

    if (!parsed.success) {
      throw notFound();
    }

    try {
      return await getDishFn({ data: { id: parsed.data.dishId, locale: deps.locale } });
    } catch (error) {
      const missing =
        (error instanceof Error && /not.?found/i.test(error.message)) ||
        dishNotFoundSchema.safeParse(error).success;

      if (missing) {
        throw notFound();
      }

      throw error;
    }
  },
  pendingComponent: DishPending,
  errorComponent: DishError,
  notFoundComponent: DishMissing,
  component: DishDetail,
});

function DishShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className="mx-auto w-full max-w-2xl px-5 pt-10"
      style={{ paddingBottom: "max(4rem, env(safe-area-inset-bottom))" }}
    >
      {children}
    </div>
  );
}

function BackLink() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);

  return (
    <p className="mb-4 text-sm font-semibold">
      <Link
        to="/recommend"
        search={{ lang }}
        className="inline-flex min-h-11 items-center text-brand-blue-hover underline underline-offset-4"
      >
        ← {copy.dishBack}
      </Link>
    </p>
  );
}

function DishPending() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);

  return (
    <DishShell>
      <BackLink />
      <output className="block font-display text-3xl tracking-wide">{copy.dishLoading}</output>
      <div
        aria-hidden="true"
        className="mt-4 h-28 animate-pulse rounded-2xl border border-border-soft bg-white motion-reduce:animate-none"
      />
    </DishShell>
  );
}

function DishError({ reset }: { readonly reset: () => void }) {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const router = useRouter();

  const retry = (): void => {
    reset();
    void router.invalidate();
  };

  return (
    <DishShell>
      <BackLink />
      <p
        role="alert"
        className="rounded-xl border-2 border-danger bg-white px-4 py-3 text-sm font-bold text-danger"
      >
        {copy.dishError}
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink px-6 text-sm font-bold text-white transition hover:opacity-90"
      >
        {copy.recRetry}
      </button>
    </DishShell>
  );
}

function DishMissing() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);

  return (
    <DishShell>
      <BackLink />
      <output className="block rounded-xl border-2 border-border-soft bg-white px-4 py-3 text-sm font-bold text-ink">
        {copy.dishNotFound}
      </output>
    </DishShell>
  );
}

function DishDetail() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const dish = Route.useLoaderData();

  const title = dish.name ?? dish.englishName ?? dish.slug;

  const showEnglish =
    dish.name !== undefined && dish.englishName !== undefined && dish.name !== dish.englishName;

  const nativeNames = dish.nativeNames.filter((entry) => entry.name !== title);

  return (
    <DishShell>
      <BackLink />
      <h1 className="font-display text-[clamp(2.25rem,7vw,3.5rem)] leading-none tracking-wide text-balance">
        {title}
      </h1>
      {showEnglish ? (
        <p className="mt-2 text-lg font-semibold text-food-orange-strong">{dish.englishName}</p>
      ) : null}
      {nativeNames.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {nativeNames.map((entry) => (
            <li
              key={`${entry.languageTag}:${entry.name}`}
              className="rounded-full border border-border-soft bg-cream px-3 py-1 text-xs font-bold text-muted"
            >
              {entry.name}
            </li>
          ))}
        </ul>
      ) : null}

      {dish.description !== null ? (
        <section aria-labelledby="dish-about" className="mt-6">
          <h2 id="dish-about" className="font-display text-2xl tracking-wide">
            {copy.dishAbout}
          </h2>
          <p className="mt-2 max-w-[60ch] text-base leading-relaxed text-ink">{dish.description}</p>
        </section>
      ) : null}

      {dish.cuisines.length > 0 || dish.categories.length > 0 ? (
        <section aria-labelledby="dish-taxonomy" className="mt-6">
          <h2 id="dish-taxonomy" className="sr-only">
            {copy.dishCuisines} · {copy.dishCategories}
          </h2>
          {dish.cuisines.length > 0 ? (
            <div className="mt-2">
              <h3 className="text-sm font-bold text-ink">{copy.dishCuisines}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {dish.cuisines.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-full border border-border-soft bg-cream px-3 py-1 text-xs font-bold text-muted"
                  >
                    {entry.name ?? entry.slug}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {dish.categories.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-ink">{copy.dishCategories}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {dish.categories.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-full border border-border-soft bg-cream px-3 py-1 text-xs font-bold text-muted"
                  >
                    {entry.name ?? entry.slug}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {dish.places.length > 0 ? (
        <section aria-labelledby="dish-places" className="mt-6">
          <h2 id="dish-places" className="font-display text-2xl tracking-wide">
            {copy.dishPlaces}
          </h2>
          <ul className="mt-3 grid gap-3">
            {dish.places.map((entry) => (
              <li
                key={entry.id}
                className="rounded-2xl border border-border-soft bg-white px-4 py-3 text-sm"
              >
                <p className="font-bold text-ink">{entry.name ?? entry.iso3166 ?? entry.id}</p>
                {entry.iso3166 !== null && entry.name !== undefined ? (
                  <p className="mt-1 text-muted">{entry.iso3166}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </DishShell>
  );
}
