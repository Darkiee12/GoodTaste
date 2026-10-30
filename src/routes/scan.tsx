import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { MenuScanPage } from "@/modules/restaurant-discovery/components/menu-scan-page";
import { localeSearchSchema } from "@/shared/i18n";

export const Route = createFileRoute("/scan")({
  validateSearch: localeSearchSchema.extend({ venueId: z.uuid().optional() }),
  component: ScanRoute,
});

function ScanRoute() {
  const search = Route.useSearch();

  const { session } = Route.useRouteContext();

  const userId = session.status === "signed-in" ? session.user.id : null;

  // Identity-keyed remount: private scan state (view, document, photos) must
  // never survive an account switch in an already-mounted page.
  return (
    <MenuScanPage
      key={userId ?? "guest"}
      locale={search.lang}
      userId={userId}
      venueId={search.venueId}
    />
  );
}
