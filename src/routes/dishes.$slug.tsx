import { Link, createFileRoute } from "@tanstack/react-router";

import { getDishFn } from "@/modules/food-discovery/food.functions";
import { DiscoveryError } from "@/modules/restaurant-discovery/components/discovery-error";

export const Route = createFileRoute("/dishes/$slug")({
  loaderDeps: ({ search }) => ({ locale: search.lang }),
  loader: ({ params, deps }) => getDishFn({ data: { id: params.slug, locale: deps.locale } }),
  errorComponent: DiscoveryError,
  component: DishDetail,
});

function DishDetail() {
  const dish = Route.useLoaderData();
  const { lang } = Route.useSearch();

  return (
    <article className="discovery-page">
      <nav aria-label="Discover">
        <Link to="/dishes" search={{ lang }}>
          Explore dishes
        </Link>
        <Link to="/restaurants" search={{ lang }}>
          Find restaurants
        </Link>
      </nav>
      <header>
        <p className="discovery-eyebrow">Meet your next meal</p>
        <h1>{dish.name ?? dish.englishName ?? dish.slug}</h1>
        <p>
          {dish.nativeNames.map((name) => (
            <span key={`${name.languageTag}:${name.name}`} lang={name.languageTag} className="mr-4">
              {name.name}
            </span>
          ))}
        </p>
        <Link className="discovery-action" to="/restaurants" search={{ lang, dish: dish.id }}>
          Find restaurants serving this
        </Link>
      </header>
      {dish.description !== null && (
        <p className="max-w-prose whitespace-pre-line" lang={dish.descriptionLanguage ?? lang}>
          {dish.description}
        </p>
      )}
      <section>
        <h2>Ingredients in the catalog</h2>
        <p className="text-sm text-muted">
          Recipes and restaurant preparations vary. Confirm dietary requirements directly with the
          venue.
        </p>
        <ul>
          {dish.ingredients.map((ingredient) => (
            <li key={ingredient.id}>
              {ingredient.name ?? ingredient.id} · {ingredient.role}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Places and connections</h2>
        <ul>
          {dish.places.map((place) => (
            <li key={`${place.id}:${place.association}`}>
              {place.name ?? place.iso3166} · {place.association}
              {place.isDisputed && " (disputed)"}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
