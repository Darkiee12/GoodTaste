import { Link } from "@tanstack/react-router";

import { SURPRISE_DISH_EVENT } from "@/components/home/globe/food-locations";
import { GlobeCanvas } from "@/components/home/globe/globe-canvas";
import type { Locale, Messages } from "@/shared/i18n";

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5 flex-none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z" fill="currentColor" />
    </svg>
  );
}

function UtensilsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="h-5 w-5 flex-none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 2v20" />
      <path d="M4 2v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V2" />
      <path d="M17 2c-2 0-3 2.5-3 6 0 2.5 1 4 3 4v10" />
      <path d="M17 2v20" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5 flex-none">
      <path
        d="M12 3l1.9 5.4L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.6z"
        fill="currentColor"
      />
      <path d="M19 15.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="currentColor" />
    </svg>
  );
}

function surprise() {
  const globeLive = document.querySelector(".hero-globe canvas") !== null;

  if (!globeLive) {
    document.getElementById("discover")?.scrollIntoView();

    return;
  }

  window.dispatchEvent(new CustomEvent(SURPRISE_DISH_EVENT));
}

export function HomeHero({ copy, lang }: { copy: Messages; lang: Locale }) {
  return (
    <section
      aria-label={copy.globeLabel}
      className="hero relative isolate flex min-h-[max(36rem,calc(100dvh-4rem))] flex-col overflow-hidden"
    >
      <div aria-hidden="true" className="hero-stars" />

      <div className="relative z-[2] mx-auto w-full max-w-3xl px-5 pt-[clamp(2rem,7vh,4rem)] text-center">
        <h1 className="font-display mb-4 text-[clamp(2.9rem,9vw,5.25rem)] leading-[1.02] tracking-[0.015em] text-balance text-white text-shadow-hero">
          {copy.heroHeading}
        </h1>

        <p className="mb-2 text-[clamp(1.1rem,2.6vw,1.35rem)] font-semibold text-balance text-white">
          {copy.heroSub}
        </p>

        <p className="mb-6 text-[clamp(0.95rem,2.2vw,1.05rem)] text-balance text-muted-on-dark">
          {copy.heroSubExtra}
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            search={{ lang }}
            hash="discover"
            resetScroll={false}
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-food-orange-strong px-6 text-base font-bold text-white no-underline shadow-[0_10px_28px_rgba(194,65,12,0.45)] transition hover:-translate-y-px hover:bg-food-orange-dark active:translate-y-0 sm:min-h-13 sm:px-8 sm:text-lg"
          >
            <CompassIcon />
            {copy.ctaExplore}
          </Link>

          <button
            id="surprise-dish-button"
            type="button"
            onClick={surprise}
            className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border-2 border-white/40 bg-transparent px-6 text-base font-bold text-white transition hover:border-white/65 hover:bg-white/10 sm:min-h-13 sm:px-8 sm:text-lg"
          >
            <SparkleIcon />
            {copy.ctaSurprise}
          </button>

          <Link
            to="/recommend"
            search={{ lang }}
            className="inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-mango bg-transparent px-6 text-base font-bold text-mango transition hover:bg-mango/10 sm:min-h-13 sm:px-8 sm:text-lg"
          >
            <UtensilsIcon />
            {copy.ctaRecommend}
          </Link>
        </div>
      </div>

      <GlobeCanvas copy={copy} lang={lang} />
    </section>
  );
}
