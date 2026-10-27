/** Static cropped-planet illustration for SSR, reduced motion, and WebGL failures. */
export function GlobeFallback({ label }: { label: string }) {
  return (
    <figure aria-label={label} className="fallback-frame absolute inset-0 m-0 overflow-hidden">
      <div aria-hidden="true" className="fallback-planet">
        <span className="fallback-land fallback-land-a" />
        <span className="fallback-land fallback-land-b" />
        <span className="fallback-land fallback-land-c" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent via-space-deep/40 to-space-deep/25"
      />
    </figure>
  );
}
