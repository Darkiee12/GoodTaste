import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { CircleUserRound, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutFn } from "@/modules/user/auth.functions";
import { clearFavoriteCaches } from "@/modules/user/components/save-dish-button";
import { messagesFor } from "@/shared/i18n";

const rootRoute = getRouteApi("__root__");

/**
 * Single account entry point in the site header. Guests find sign-in and
 * account creation here; members see their name plus saved dishes, settings,
 * admin access (when server-verified), and sign-out. Language lives in the
 * standalone globe menu beside this button.
 */
export function AccountMenu() {
  const { lang } = rootRoute.useSearch();
  const { session, isAdmin } = rootRoute.useRouteContext();
  const copy = messagesFor(lang);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const signedIn = session.status === "signed-in";

  const signOut = (): void => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    setSignOutFailed(false);

    void signOutFn().then(
      () => {
        clearFavoriteCaches(queryClient);
        void navigate({ to: "/", search: { lang } });
      },
      () => {
        setSigningOut(false);
        setSignOutFailed(true);
      },
    );
  };

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          setSignOutFailed(false);
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={signedIn ? undefined : copy.accountMenu}
          title={signedIn ? undefined : copy.accountMenu}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-transparent px-3 text-sm font-semibold text-muted-on-dark hover:border-white/25 hover:text-white aria-expanded:bg-white/10 aria-expanded:text-white"
        >
          <CircleUserRound aria-hidden="true" className="size-5" />
          {signedIn ? <span className="max-w-28 truncate">{session.user.name}</span> : null}
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {signedIn ? (
          <>
            <DropdownMenuLabel>
              <span className="block max-w-56 truncate font-bold">{session.user.name}</span>
              <span className="block max-w-56 truncate text-xs font-normal text-muted-foreground">
                {session.user.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/saved" search={{ lang }}>
                  {copy.savedTitle}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings/account" search={{ lang }}>
                  {copy.authAccount}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings/security" search={{ lang }}>
                  {copy.authSecurity}
                </Link>
              </DropdownMenuItem>
              {isAdmin ? (
                <DropdownMenuItem asChild>
                  <Link to="/admin" search={{ lang }} className="text-mango">
                    {copy.adminWorkspace}
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  signOut();
                }}
                disabled={signingOut}
              >
                {signingOut ? copy.settingsSigningOut : copy.authSignOut}
              </DropdownMenuItem>
              {signOutFailed && !signingOut ? (
                <DropdownMenuItem disabled>
                  <span role="alert" className="text-xs font-semibold text-danger">
                    {copy.settingsSignOutFailed} {copy.commonRetry}
                  </span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : (
          <>
            {session.status === "unavailable" ? (
              <>
                <DropdownMenuLabel>
                  <span role="note" className="text-xs font-semibold">
                    {copy.saveDishPaused}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to="/sign-in" search={{ lang, returnTo: "/" }}>
                  {copy.authSignIn}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/sign-up" search={{ lang, returnTo: "/" }}>
                  {copy.authSignUp}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
