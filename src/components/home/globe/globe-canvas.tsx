import { ClientOnly } from "@tanstack/react-router";
import { Component, lazy, Suspense, useRef, type ReactNode } from "react";

import type { GlobeOverlayBridge } from "@/components/home/globe/geo-utils";
import { GlobeFallback } from "@/components/home/globe/globe-fallback";
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
 * SSR-safe globe slot: an empty slot on the server and while three.js loads
 * (the hero sky shows through honestly), WebGL on the client. The static
 * planet only appears when WebGL fails; reduced motion is handled in-scene.
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

  const fallback = <GlobeFallback label={copy.globeStaticLabel} />;

  return (
    <div className="hero-globe pointer-events-none absolute inset-0">
      <ClientOnly fallback={null}>
        <GlobeErrorBoundary fallback={fallback}>
          <Suspense fallback={null}>
            <LazyGlobeScene copy={copy} lang={lang} bridgeRef={bridgeRef} />
          </Suspense>
        </GlobeErrorBoundary>
      </ClientOnly>
    </div>
  );
}
