import { createFileRoute } from "@tanstack/react-router";

import { MenuScanPage } from "@/modules/restaurant-discovery/components/menu-scan-page";
import { localeSearchSchema } from "@/shared/i18n";

export const Route = createFileRoute("/scan")({
  validateSearch: localeSearchSchema,
  component: ScanRoute,
});

function ScanRoute() {
  const search = Route.useSearch();

  const { session } = Route.useRouteContext();

  const userId = session.status === "signed-in" ? session.user.id : null;

  return <MenuScanPage locale={search.lang} userId={userId} />;
}
