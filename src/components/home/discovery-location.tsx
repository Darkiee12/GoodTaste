import {
  CheckIcon,
  ChevronDownIcon,
  Globe2Icon,
  LocateFixedIcon,
  MapPinIcon,
  Undo2Icon,
} from "lucide-react";

import { formatTemplate } from "@/components/home/recommend/quiz-model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Locale } from "@/shared/i18n";

/**
 * Single location control for the homepage discovery section: one compact
 * indicator ("Vietnam · Change location") that opens one focused selector.
 * The lead integrator mounts this and wires the four explicit callbacks;
 * geolocation fires only when the visitor taps "Use my location", and a
 * denial keeps the existing carousel content with a quiet inline note.
 *
 * Loading, error, and empty carousel states belong to the section shell
 * (Agent C), not to this control: this file owns only the locating spinner
 * text and the denial note next to the trigger.
 */

/** One destination entry in the "Choose a destination" submenu. */
export interface DiscoveryCountryOption {
  readonly code: string;
  readonly label: string;
}

/** Which lane the section is currently serving from. */
export type DiscoverySelection = "regional" | "nearby" | "worldwide";

/** Honest label for what the carousel actually served (never the ask). */
export type DiscoveryServedScope = "nearby" | "regional" | "worldwide";

export interface DiscoveryLocationProps {
  readonly lang: Locale;
  /** Compact indicator text, e.g. "Vietnam" or "Around the world". */
  readonly currentLabel: string;
  readonly selection: DiscoverySelection;
  /** ISO code of the served country, if any; marks the submenu radio. */
  readonly selectedCountry: string | null;
  readonly locating: boolean;
  /** Geolocation was denied or failed: content stays, note explains. */
  readonly preciseDenied: boolean;
  /** True when the browser cannot geolocate (unsupported/insecure). */
  readonly preciseDisabled: boolean;
  /** True while a precise location is being served: offers the way back. */
  readonly showBackToRegion: boolean;
  readonly countries: ReadonlyArray<DiscoveryCountryOption>;
  readonly countriesLoading: boolean;
  readonly disabled: boolean;
  readonly onUsePrecise: () => void;
  readonly onChooseCountry: (country: string) => void;
  readonly onExploreWorldwide: () => void;
  readonly onBackToRegion: () => void;
}

/** Every user-visible string in this control. Coordinator promotes to i18n. */
export interface DiscoveryLocationCopy {
  readonly changeLocation: string;
  readonly menuLabel: string;
  readonly usePrecise: string;
  readonly locatingNote: string;
  readonly preciseUnavailable: string;
  readonly chooseDestination: string;
  readonly destinationsLoading: string;
  readonly destinationsEmpty: string;
  readonly exploreWorldwide: string;
  readonly backToRegion: string;
  /** Named way back, e.g. "Show dishes from Vietnam". */
  readonly backToRegionNamed: string;
  readonly deniedNote: string;
  readonly headingNearby: string;
  readonly headingRegional: string;
  readonly headingRegionalNamed: string;
  readonly headingWorldwide: string;
  /** Subtitle under the heading: dishes tied to places in the visitor's area. */
  readonly subNearby: string;
  /** Subtitle fallback when the served country has no display name. */
  readonly subRegional: string;
  /** Subtitle for country results, e.g. "Explore Vietnam favorites…". */
  readonly subRegionalNamed: string;
  /** Subtitle for nearby results topped up with country dishes. */
  readonly subSupplementedNamed: string;
  /** Subtitle for the worldwide fallback. */
  readonly subWorldwide: string;
}

const englishCopy: DiscoveryLocationCopy = {
  backToRegion: "Show regional dishes",
  backToRegionNamed: "Show dishes from {name}",
  changeLocation: "Change location",
  chooseDestination: "Choose a destination",
  deniedNote: "Couldn't get your location — keeping regional dishes.",
  destinationsEmpty: "No destinations listed yet.",
  destinationsLoading: "Loading countries…",
  exploreWorldwide: "Explore worldwide",
  headingNearby: "Dishes near you",
  headingRegional: "Discover dishes from this region",
  headingRegionalNamed: "Discover dishes from {name}",
  headingWorldwide: "A taste from around the world",
  locatingNote: "Finding your area…",
  menuLabel: "Choose where to explore",
  preciseUnavailable: "Location isn't available in this browser.",
  subNearby: "Dishes associated with places in your area.",
  subRegional: "Explore regional favorites and specialties.",
  subRegionalNamed: "Explore {name} favorites and regional specialties.",
  subSupplementedNamed: "Local discoveries and regional favorites from across {name}.",
  subWorldwide:
    "Our catalog doesn't have dishes from this region yet. Here are some discoveries from elsewhere.",
  usePrecise: "Use my location",
};

const vietnameseCopy: DiscoveryLocationCopy = {
  backToRegion: "Xem món theo vùng",
  backToRegionNamed: "Xem món từ {name}",
  changeLocation: "Đổi vị trí",
  chooseDestination: "Chọn điểm đến",
  deniedNote: "Không lấy được vị trí — vẫn hiện món theo vùng.",
  destinationsEmpty: "Chưa có điểm đến nào.",
  destinationsLoading: "Đang tải danh sách quốc gia…",
  exploreWorldwide: "Khám phá khắp thế giới",
  headingNearby: "Món ngon gần bạn",
  headingRegional: "Khám phá món ngon vùng này",
  headingRegionalNamed: "Khám phá món ngon tại {name}",
  headingWorldwide: "Hương vị khắp thế giới",
  locatingNote: "Đang xác định khu vực của bạn…",
  menuLabel: "Chọn nơi khám phá",
  preciseUnavailable: "Trình duyệt này không dùng được vị trí.",
  subNearby: "Những món gắn với các địa điểm quanh bạn.",
  subRegional: "Khám phá đặc sản và món yêu thích của vùng này.",
  subRegionalNamed: "Khám phá món yêu thích và đặc sản của {name}.",
  subSupplementedNamed: "Món ngon quanh bạn và đặc sản khắp {name}.",
  subWorldwide: "Danh mục chưa có món của vùng này. Đây là một vài khám phá từ nơi khác.",
  usePrecise: "Dùng vị trí của tôi",
};

export const discoveryLocationCopyFor = (lang: Locale): DiscoveryLocationCopy =>
  lang === "vi" ? vietnameseCopy : englishCopy;

/**
 * Honest scope from what the server actually served. A precise request that
 * fell back to country dishes is labeled regional, never nearby: "nearby"
 * requires both a served nearby scope and an active precise location. A
 * supplemented nearby pool (sparse locality dishes topped up with country
 * dishes) is also regional: the heading names the country, never a city
 * the query did not actually run. Null while
 * the carousel has not served yet, so the lead keeps the previous heading.
 */
export const discoveryServedScopeFor = (input: {
  readonly preciseActive: boolean;
  readonly servedScope: "nearby" | "country" | "worldwide" | null;
  readonly supplemented?: boolean | undefined;
}): DiscoveryServedScope | null => {
  if (input.servedScope === null) {
    return null;
  }

  if (input.servedScope === "worldwide") {
    return "worldwide";
  }

  if (input.supplemented === true) {
    return "regional";
  }

  if (input.servedScope === "nearby" && input.preciseActive) {
    return "nearby";
  }

  return "regional";
};

/** Section heading keyed off the served scope, never the requested one. */
export const discoveryHeadingFor = (input: {
  readonly scope: DiscoveryServedScope;
  readonly regionName: string | null;
  readonly lang: Locale;
}): string => {
  const copy = discoveryLocationCopyFor(input.lang);

  if (input.scope === "nearby") {
    return copy.headingNearby;
  }

  if (input.scope === "worldwide") {
    return copy.headingWorldwide;
  }

  if (input.regionName !== null && input.regionName !== "") {
    return formatTemplate(copy.headingRegionalNamed, input.regionName);
  }

  return copy.headingRegional;
};

/**
 * Subtitle keyed off the served scope, never the requested one. Country
 * and supplemented results name the served country; worldwide owns the
 * catalog-gap explanation so the heading and subtitle never contradict
 * ("around the world" above "local favorites" is the exact mismatch this
 * prevents). Supplemented (nearby dishes topped up with country dishes)
 * reads as regional with the country named.
 */
export const discoverySubtitleFor = (input: {
  readonly scope: DiscoveryServedScope;
  readonly regionName: string | null;
  readonly supplemented: boolean;
  readonly lang: Locale;
}): string => {
  const copy = discoveryLocationCopyFor(input.lang);

  if (input.scope === "nearby") {
    return copy.subNearby;
  }

  if (input.scope === "worldwide") {
    return copy.subWorldwide;
  }

  if (input.supplemented && input.regionName !== null && input.regionName !== "") {
    return formatTemplate(copy.subSupplementedNamed, input.regionName);
  }

  if (input.regionName !== null && input.regionName !== "") {
    return formatTemplate(copy.subRegionalNamed, input.regionName);
  }

  return copy.subRegional;
};

/**
 * Human-readable way back: name the served country when known instead of
 * pointing at an implementation ("region", "network area"). Falls back to
 * the generic regional line when the country code is unknown or unnamed.
 */
export const discoveryBackLabelFor = (input: {
  readonly countries: ReadonlyArray<DiscoveryCountryOption>;
  readonly selectedCountry: string | null;
  readonly lang: Locale;
}): string => {
  const copy = discoveryLocationCopyFor(input.lang);

  const name =
    input.selectedCountry === null
      ? null
      : (input.countries.find((country) => country.code === input.selectedCountry)?.label ?? null);

  if (name === null) {
    return copy.backToRegion;
  }

  return formatTemplate(copy.backToRegionNamed, name);
};

export function DiscoveryLocation(props: DiscoveryLocationProps) {
  const copy = discoveryLocationCopyFor(props.lang);
  const busy = props.disabled || props.locating;
  const destinationsReady = !props.countriesLoading && props.countries.length > 0;

  const backLabel = discoveryBackLabelFor({
    countries: props.countries,
    lang: props.lang,
    selectedCountry: props.selectedCountry,
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Non-modal: opening the menu must not lock scroll or shift the page. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={props.disabled}
            aria-label={`${props.currentLabel} · ${copy.changeLocation}`}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-ink bg-white px-5 text-sm font-bold whitespace-nowrap text-ink transition hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MapPinIcon aria-hidden="true" className="size-4 flex-none" />
            <span className="inline-block max-w-24 min-w-0 truncate min-[480px]:max-w-44">
              {props.currentLabel}
            </span>
            <span aria-hidden="true" className="opacity-60">
              ·
            </span>
            <span>{copy.changeLocation}</span>
            <ChevronDownIcon aria-hidden="true" className="size-4 flex-none" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label={copy.menuLabel}>
          <DropdownMenuGroup>
            {props.showBackToRegion ? (
              <DropdownMenuItem disabled={busy} onSelect={props.onBackToRegion}>
                <Undo2Icon aria-hidden="true" />
                <span>{backLabel}</span>
                {props.selection === "regional" ? (
                  <CheckIcon aria-hidden="true" className="ml-auto" />
                ) : null}
              </DropdownMenuItem>
            ) : null}
            {props.showBackToRegion ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              disabled={busy || props.preciseDisabled}
              onSelect={props.onUsePrecise}
            >
              <LocateFixedIcon aria-hidden="true" />
              <span>{copy.usePrecise}</span>
              {props.selection === "nearby" ? (
                <CheckIcon aria-hidden="true" className="ml-auto" />
              ) : null}
            </DropdownMenuItem>
            {props.preciseDisabled ? (
              <DropdownMenuLabel className="max-w-56 text-xs font-normal text-muted">
                {copy.preciseUnavailable}
              </DropdownMenuLabel>
            ) : null}
            {props.countriesLoading ? (
              <DropdownMenuItem disabled>
                <MapPinIcon aria-hidden="true" />
                <span>{copy.destinationsLoading}</span>
              </DropdownMenuItem>
            ) : null}
            {!props.countriesLoading && props.countries.length === 0 ? (
              <DropdownMenuItem disabled>
                <MapPinIcon aria-hidden="true" />
                <span>{copy.destinationsEmpty}</span>
              </DropdownMenuItem>
            ) : null}
            {destinationsReady ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={busy}>
                  <MapPinIcon aria-hidden="true" />
                  <span>{copy.chooseDestination}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={props.selectedCountry ?? ""}
                    onValueChange={props.onChooseCountry}
                  >
                    {props.countries.map((country) => (
                      <DropdownMenuRadioItem
                        key={country.code}
                        disabled={busy}
                        value={country.code}
                      >
                        {country.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuItem disabled={busy} onSelect={props.onExploreWorldwide}>
              <Globe2Icon aria-hidden="true" />
              <span>{copy.exploreWorldwide}</span>
              {props.selection === "worldwide" ? (
                <CheckIcon aria-hidden="true" className="ml-auto" />
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {props.locating ? (
        <output className="text-sm font-bold text-muted">{copy.locatingNote}</output>
      ) : null}
      {!props.locating && props.preciseDenied ? (
        <output className="block text-sm text-muted">{copy.deniedNote}</output>
      ) : null}
    </div>
  );
}
