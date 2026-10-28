import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import { forgetPasswordFn } from "@/modules/user/user.functions";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const [email, setEmail] = useState("");

  const request = useMutation({
    mutationFn: (input: { email: string }) =>
      forgetPasswordFn({ data: { ...input, redirectTo: "/reset-password" } }),
  });

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    request.mutate({ email });
  };

  return (
    <div className="auth-form">
      <h1>{copy.authForgotHeading}</h1>
      {request.isSuccess ? (
        // Always show the confirmation: never reveal whether the email exists.
        <output>{copy.authForgotSent}</output>
      ) : (
        <form
          onSubmit={(event) => {
            submit(event);
          }}
        >
          <label>
            {copy.authEmail}
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button type="submit" disabled={request.isPending}>
            {copy.authSendLink}
          </button>
        </form>
      )}
    </div>
  );
}
