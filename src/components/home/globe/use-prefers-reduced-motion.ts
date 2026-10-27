import { useEffect, useState } from "react";

/**
 * Live `prefers-reduced-motion` flag. SSR-safe (defaults to motion on the
 * server); the change listener keeps it current on the client.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");

    const onChange = () => {
      setReduced(query.matches);
    };

    query.addEventListener("change", onChange);

    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  return reduced;
}
