import { useEffect, useRef } from "react";

/**
 * Static planet for SSR, reduced motion, and WebGL/chunk failures.
 *
 * Four-stage reveal:
 * A. Immediate blue sphere: pure-CSS ocean gradient matching earth-texture.ts
 *    hues, exact computeGlobeLayout geometry, no fake continents.
 * B. Accurate texture: after mount, globe-static-preview.ts lazily paints the
 *    real land mask (same data as the WebGL globe) onto the canvas below.
 *    SSR/first paint keep the Stage A sphere, so there is never an empty slot.
 * C. Reveal: GlobeScene keeps this mounted over WebGL and crossfades it out
 *    ~700ms after the first frame.
 * D. Failure/reduced-motion: this is the permanent planet when WebGL or the
 *    chunk fails, or when the user prefers reduced motion (no WebGL chunk is
 *    ever downloaded on that path).
 */
export function GlobeFallback({ label }: { label: string }) {
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    import("@/components/home/globe/globe-static-preview")
      .then(({ renderStaticPreview }) => {
        const canvas = previewRef.current;

        if (!cancelled && canvas) {
          try {
            renderStaticPreview(canvas);
          } catch {
            // 2D canvas unavailable: keep the Stage A blue sphere.
          }
        }
      })
      .catch(() => {
        // Preview chunk failed to load: keep the Stage A blue sphere.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <figure aria-label={label} className="fallback-frame absolute inset-0 m-0 overflow-hidden">
      <div aria-hidden="true" className="fallback-planet">
        <canvas ref={previewRef} width={512} height={512} className="fallback-preview" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent via-space-deep/40 to-space-deep/25"
      />
    </figure>
  );
}
