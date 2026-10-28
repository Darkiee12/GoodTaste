import { Link, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

export function DiscoveryError({ error }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <div className="discovery-empty" role="alert">
      <h1 className="font-display text-3xl">Discovery is unavailable</h1>
      <p>{error instanceof Error ? error.message : "Discovery could not load. Please retry."}</p>
      <button type="button" onClick={() => void router.invalidate()}>
        Try again
      </button>
      <Link to="/" search={{ lang: "en" }}>
        Return home
      </Link>
    </div>
  );
}
