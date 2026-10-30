import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { z } from "zod";

import { AuthForm, authFormCopy } from "@/modules/user/components/auth-form";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const signInSearch = localeSearchSchema.extend({
  returnTo: z.string().default("/"),
});

/** Post-login redirects must stay on this site. */
export const safeReturnTo = (value: string): string =>
  value.startsWith("/") && !value.startsWith("//") ? value : "/";

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearch,
  component: SignIn,
});

function SignIn() {
  const { lang } = rootRoute.useSearch();
  const { returnTo } = Route.useSearch();
  const copy = authFormCopy(messagesFor(lang), "sign-in", safeReturnTo(returnTo));

  return <AuthForm mode="sign-in" copy={copy} returnTo={safeReturnTo(returnTo)} />;
}
