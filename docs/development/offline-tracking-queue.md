# Offline tracking queue

Android encrypts each location fix once per group and stores the ciphertext in a local Room (SQLite) database until it uploads. The queue never holds plaintext locations.

## Storage limit

The queue is bounded to 10 MiB (10,485,760 bytes) of disk space:

- The main database may use up to 9 MiB of live pages, measured as `(page_count - freelist_count) * page_size`.
- The write-ahead log is checkpointed every 128 pages and truncated back to at most 1 MiB with `journal_size_limit`.
- The shared-memory file (`-shm`) adds roughly 32 KiB.

The limit is enforced in `RoomCiphertextQueue.insertAll`, in the same transaction as the insert. When live pages exceed the limit, the oldest pending points are deleted until usage is back under the limit. This applies across all groups and accounts, oldest first.

## Behaviour when the limit is reached

- The newest points are always kept, so the latest location still uploads when the device reconnects.
- Points that are currently uploading (`IN_FLIGHT`) are never evicted. Interrupted uploads return to `PENDING` after two minutes and become eligible again.
- The JS uploader only sends the points it actually claimed. A point evicted between listing and claiming is skipped, so the server never receives a point the user was told was removed.
- Each eviction is recorded per account and server (count, oldest and newest queue time, revision). The Map screen shows a dismissible banner with the affected time range. Dismissing acknowledges a specific revision, so evictions that happen afterwards show again.

## Measured capacity

The `RoomQueueInstrumentation` test (`bun run test:room` in `apps/mobile`) captures 12,000 fixes for two groups at the production limit and reports actual usage. On an x86_64 emulator it retained 16,813 group-points (about 561 bytes each) using 10,149,784 bytes on disk. That's about 1.9 days of continuous movement at one point every 10 seconds for one group, or half that with two groups.

## Limitations

- The database file keeps its peak size after evictions, because SQLite reuses free pages rather than shrinking the file.
- A long-running reader can delay a WAL checkpoint, so the WAL can briefly grow past 1 MiB.
- If every queued point is in flight, nothing is evicted until uploads finish or time out.
- Points queued before an account was assigned (legacy, ownerless rows) can be evicted, but their loss isn't reported because they don't belong to an account yet.
- Capacity depends on payload size, SQLite page allocation and how often Android delivers fixes. The figures above are measurements, not guarantees.
