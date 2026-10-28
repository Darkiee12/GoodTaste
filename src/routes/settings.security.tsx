import { useMutation } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { changePasswordFn } from "@/modules/user/auth.functions";
import {
  getSessionFn,
  listSessionsFn,
  revokeAllSessionsFn,
  revokeOtherSessionsFn,
  revokeSessionFn,
} from "@/modules/user/session.functions";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/settings/security")({
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();

    if (session.user === null) {
      throw redirect({
        to: "/sign-in",
        search: { returnTo: "/settings/security", lang: search.lang },
      });
    }

    return {};
  },
  loader: async () => listSessionsFn(),
  component: SecuritySettings,
});

function SecuritySettings() {
  const { lang } = rootRoute.useSearch();
  const copy = messagesFor(lang);
  const initialSessions = Route.useLoaderData();
  const [sessions, setSessions] = useState(initialSessions);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const refreshSessions = useMutation({
    mutationFn: () => listSessionsFn(),
    onSuccess: (rows) => {
      setSessions(rows);
    },
  });

  const changePassword = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      changePasswordFn({ data: input }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
    },
  });

  const revokeOne = useMutation({
    mutationFn: (sessionId: string) => revokeSessionFn({ data: { session_id: sessionId } }),
    onSuccess: () => {
      refreshSessions.mutate();
    },
  });

  const submitPasswordChange = (event: React.FormEvent): void => {
    event.preventDefault();
    changePassword.mutate({ currentPassword, newPassword });
  };

  const revokeOthers = useMutation({
    mutationFn: () => revokeOtherSessionsFn(),
    onSuccess: () => {
      refreshSessions.mutate();
    },
  });

  const revokeAll = useMutation({
    mutationFn: () => revokeAllSessionsFn(),
    onSuccess: () => {
      window.location.assign("/sign-in");
    },
  });

  return (
    <div className="settings">
      <h1>{copy.authSecurity}</h1>
      <section>
        <h2>{copy.authChangePassword}</h2>
        <form
          onSubmit={(event) => {
            submitPasswordChange(event);
          }}
        >
          <label>
            {copy.authCurrentPassword}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            {copy.authNewPassword}
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          {changePassword.isError ? (
            <p role="alert" className="auth-error">
              {copy.authChangeFailed}
            </p>
          ) : null}
          <button type="submit" disabled={changePassword.isPending}>
            {copy.authChangePassword}
          </button>
          {changePassword.isSuccess ? <output>{copy.authPasswordChanged}</output> : null}
        </form>
      </section>
      <section>
        <h2>{copy.authSessions}</h2>
        <ul>
          {sessions.map((entry) => (
            <li key={entry.id}>
              {entry.userAgent ?? entry.id.slice(0, 8)}
              {entry.current ? ` (${copy.authCurrentSession})` : null}
              {entry.current ? null : (
                <button
                  type="button"
                  disabled={revokeOne.isPending}
                  onClick={() => {
                    revokeOne.mutate(entry.id);
                  }}
                >
                  {copy.authRevoke}
                </button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={revokeOthers.isPending}
          onClick={() => {
            revokeOthers.mutate();
          }}
        >
          {copy.authRevokeOthers}
        </button>
        <button
          type="button"
          disabled={revokeAll.isPending}
          onClick={() => {
            revokeAll.mutate();
          }}
        >
          {copy.authSignOut}
        </button>
      </section>
    </div>
  );
}
