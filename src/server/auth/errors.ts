import { Data } from "effect";

export class SignInRequired extends Data.TaggedError("SignInRequired")<{
  readonly required: "member";
}> {}

export class Forbidden extends Data.TaggedError("Forbidden")<{
  readonly reason: string;
}> {}

export class AdminRequired extends Data.TaggedError("AdminRequired")<{
  readonly reason: string;
}> {}

export class SessionExpired extends Data.TaggedError("SessionExpired")<{
  readonly reason: string;
}> {}

export class SessionRevoked extends Data.TaggedError("SessionRevoked")<{
  readonly reason: string;
}> {}

export class InsufficientPermissions extends Data.TaggedError("InsufficientPermissions")<{
  readonly reason: string;
}> {}

export class OwnershipDenied extends Data.TaggedError("OwnershipDenied")<{
  readonly reason: string;
}> {}

export class UserSuspended extends Data.TaggedError("UserSuspended")<{
  readonly reason: string;
}> {}

export class RecentAuthenticationRequired extends Data.TaggedError("RecentAuthenticationRequired")<{
  readonly reason: string;
}> {}

/**
 * Better Auth provider rejection at a server-function adapter boundary.
 * Authentication-provider calls (sign-in, resets, verification) reject for
 * expected reasons (wrong credentials, expired tokens, store outages) as
 * well as defects; both enter this typed failure channel instead of the
 * Effect defect channel. Callers surface it as a generic authentication
 * failure without leaking provider internals.
 */
export class AuthProviderError extends Data.TaggedError("AuthProviderError")<{
  readonly operation: string;
  readonly reason: string;
}> {}

export class RoleNotFound extends Data.TaggedError("RoleNotFound")<{
  readonly roleId: string;
}> {}

export class ProtectedRole extends Data.TaggedError("ProtectedRole")<{
  readonly roleId: string;
}> {}

export class RoleNotManageable extends Data.TaggedError("RoleNotManageable")<{
  readonly roleId: string;
  readonly reason: string;
}> {}

export class LastOwnerRemovalDenied extends Data.TaggedError("LastOwnerRemovalDenied")<{
  readonly reason: string;
}> {}

export class UnknownPermission extends Data.TaggedError("UnknownPermission")<{
  readonly permission: string;
}> {}

export class InvalidRoleAssignment extends Data.TaggedError("InvalidRoleAssignment")<{
  readonly reason: string;
}> {}
