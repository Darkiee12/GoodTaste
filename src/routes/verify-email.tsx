import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import { resendVerificationFn } from "@/modules/user/auth.functions";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmail,
});

function VerifyEmail() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const [email, setEmail] = useState("");

  const resend = useMutation({
    mutationFn: (input: { email: string }) =>
      resendVerificationFn({ data: { ...input, callbackURL: "/" } }),
  });

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    resend.mutate({ email });
  };

  return (
    <div className="auth-form">
      <h1>{copy.authVerifyHeading}</h1>
      <p>{copy.authVerifyBody}</p>
      {resend.isSuccess ? (
        <output>{copy.authResent}</output>
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
          <button type="submit" disabled={resend.isPending}>
            {copy.authResend}
          </button>
        </form>
      )}
    </div>
  );
}
