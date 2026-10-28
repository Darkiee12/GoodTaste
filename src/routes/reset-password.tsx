import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { resetPasswordFn } from "@/modules/user/user.functions";
import { localeSearchSchema, messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

const resetSearch = localeSearchSchema.extend({
  token: z.string().default(""),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: resetSearch,
  component: ResetPassword,
});

function ResetPassword() {
  const { lang } = rootRoute.useSearch();
  const { token } = Route.useSearch();
  const copy = messagesFor(lang);
  const [password, setPassword] = useState("");

  const reset = useMutation({
    mutationFn: (newPassword: string) => resetPasswordFn({ data: { newPassword, token } }),
    onSuccess: () => {
      window.location.assign("/sign-in");
    },
  });

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    reset.mutate(password);
  };

  return (
    <div className="auth-form">
      <h1>{copy.authResetHeading}</h1>
      <form
        onSubmit={(event) => {
          submit(event);
        }}
      >
        <label>
          {copy.authNewPassword}
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {reset.isError ? (
          <p role="alert" className="auth-error">
            reset failed
          </p>
        ) : null}
        <button type="submit" disabled={reset.isPending || token.length === 0}>
          {copy.authResetSubmit}
        </button>
      </form>
    </div>
  );
}
