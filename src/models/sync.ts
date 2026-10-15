/** Sync / Incremental's modes - the matching `TransferMode` values the
 * Phase 7 engine runs (see `src/models/transfer.ts`). */
export type SyncMode = "mirror" | "incremental" | "update-newer" | "two-way";
