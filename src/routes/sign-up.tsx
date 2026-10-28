import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { z } from "zod";

import { AuthForm, authFormCopy } from "@/modules/user/components/auth-form";
import { safeReturnTo } from "@/routes/sign-in";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const signUpSearch = localeSearchSchema.extend({
  returnTo: z.string().default("/"),
});

export const Route = createFileRoute("/sign-up")({
  validateSearch: signUpSearch,
  component: SignUp,
});

function SignUp() {
  const { lang } = rootRoute.useSearch();
  const { returnTo } = Route.useSearch();
  const copy = authFormCopy(messagesFor(lang), "sign-up", safeReturnTo(returnTo));

  return <AuthForm mode="sign-up" copy={copy} returnTo={safeReturnTo(returnTo)} />;
}
