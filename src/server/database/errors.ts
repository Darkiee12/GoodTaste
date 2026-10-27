import { Data } from "effect";

export class DatabaseUnavailable extends Data.TaggedError("DatabaseUnavailable")<{
  readonly operation: string;
}> {}

export class PersistenceConflict extends Data.TaggedError("PersistenceConflict")<{
  readonly operation: string;
  readonly constraint: string | undefined;
}> {}

export class PersistenceError extends Data.TaggedError("PersistenceError")<{
  readonly operation: string;
  readonly cause: string;
}> {}

export class TransactionFailed extends Data.TaggedError("TransactionFailed")<{
  readonly operation: string;
  readonly cause: string;
}> {}
