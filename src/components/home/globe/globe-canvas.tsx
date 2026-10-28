import { ClientOnly } from "@tanstack/react-router";
import { Component, lazy, Suspense, useRef, type ReactNode, type RefObject } from "react";

import type { GlobeOverlayBridge } from "@/components/home/globe/geo-utils";
import { GlobeFallback } from "@/components/home/globe/globe-fallback";
import { usePrefersReducedMotion } from "@/components/home/globe/use-prefers-reduced-motion";
import type { Locale, Messages } from "@/shared/i18n";

const LazyGlobeScene = lazy(() =>
  import("@/components/home/globe/globe-scene").then((module) => ({ default: module.GlobeScene })),
);

type GlobeErrorState = {
  failed: boolean;
};

class GlobeErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  GlobeErrorState
> {
  override state: GlobeErrorState = { failed: false };

  static getDerivedStateFromError(): GlobeErrorState {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Client-only branch: the static planet for reduced motion (without ever
 * downloading the WebGL chunk), WebGL with a static-planet loading slot and
 * an error fallback otherwise. Runs inside ClientOnly so the first client
 * render matches the server HTML.
 */
function GlobeContent({
  copy,
  lang,
  bridgeRef,
}: {
  copy: Messages;
  lang: Locale;
  bridgeRef: RefObject<GlobeOverlayBridge>;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const fallback = <GlobeFallback label={copy.globeStaticLabel} />;

  if (reducedMotion) {
    return fallback;
  }

  return (
    <GlobeErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LazyGlobeScene copy={copy} lang={lang} bridgeRef={bridgeRef} />
      </Suspense>
    </GlobeErrorBoundary>
  );
}

/**
 * SSR-safe globe slot: an empty slot on the server, the static planet while
 * three.js loads, WebGL on the client. WebGL failures fall back to the same
 * static planet.
 */
export function GlobeCanvas({ copy, lang }: { copy: Messages; lang: Locale }) {
  const bridgeRef = useRef<GlobeOverlayBridge>({
    activeId: null,
    x: 0,
    y: 0,
    anchored: false,
    paused: false,
    node: null,
  });

  return (
    <div className="hero-globe pointer-events-none absolute inset-0">
      <ClientOnly fallback={null}>
        <GlobeContent copy={copy} lang={lang} bridgeRef={bridgeRef} />
      </ClientOnly>
    </div>
  );
}
