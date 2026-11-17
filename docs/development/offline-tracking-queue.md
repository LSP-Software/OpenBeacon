# Offline tracking queue

Android runs each location fix through a history filter for each group and encrypts the rows it keeps: history points, stay updates and live-only rows for the map. It stores the ciphertext in a local Room (SQLite) database until it uploads. The queue never holds plaintext locations. A new stay update replaces the pending copy of that stay, and a new live-only row replaces the pending live-only row for the same group, epoch and device, so neither piles up while offline. When an upload fails, an older stay or live-only copy is dropped instead of requeued if a newer copy is already queued. Updating to queue version 4 deletes rows queued by older app versions, because no level 10 server accepts them.

An upload starts only when the current fix was queued as a live-only row or a history point, or when a row other than a stay update is still waiting. A stay update waits for the next upload, which comes within 5 minutes while the phone is still, so a still phone uploads as often as before history filtering.

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

## Tests

`OfflineTrackingQueueTest` covers account separation, duplicate client points, ciphertext-only storage, the version 1 migration and eviction. It runs the real Room database under Robolectric, so it needs the Android SDK but no emulator. `src/test/resources/robolectric.properties` pins the Robolectric SDK to 35, the newest one that runs on Java 17, so a toolchain change can't silently move the tests to another SDK. `bun run --cwd apps/mobile test:native` runs it with the JVM tests, and so do `bun run test` and `bun run ci`. Without an Android SDK it is skipped locally with a warning and fails on CI. The first run prebuilds `apps/mobile/android` if it doesn't exist.

## Measured capacity

The `OfflineQueueStorageBenchmark` instrumentation (`bun run benchmark:offline-queue-storage`) runs on a connected device or boots the first emulator AVD. It captures 12,000 fixes for two groups at the production limit and reports actual usage. CI doesn't run it. On an x86_64 emulator it retained 16,813 group-points (about 561 bytes each) using 10,149,784 bytes on disk. That's about 1.9 days of continuous movement at one point every 10 seconds for one group, or half that with two groups. That run predates the 23-byte point format and the history filter: rows are now smaller and far fewer fixes are queued, so capacity is higher, but it hasn't been measured again.

## Limitations

- The database file keeps its peak size after evictions, because SQLite reuses free pages rather than shrinking the file.
- A long-running reader can delay a WAL checkpoint, so the WAL can briefly grow past 1 MiB.
- If every queued point is in flight, nothing is evicted until uploads finish or time out.
- Points queued before an account was assigned (legacy, ownerless rows) can be evicted, but their loss isn't reported because they don't belong to an account yet.
- The history filter keeps its state in memory. If Android stops the tracking service, an open stay keeps its last sent end time (up to 5 minutes early) and the route restarts with the next fix.
- When a group's key rotates, an open stay is closed under the old key and continues as a new stay under the new key, and the route carries on. Route fixes from before the rotation that weren't kept yet are dropped, so a member who joins at that moment never receives a point from before they joined.
- When a stay or live-only row leaves the queue after its upload, older copies of it go too, even ones still marked as uploading, so an interrupted older copy can't be recovered and sent later. The server still doesn't check whether a stay or live-only upload is older than what it has, so an older request that was already on its way and arrives after the newer one overwrites it. An older live-only row then moves the live map back until the next live-only row, and an older stay copy replaces the stay's stored point, including its end time, until the stay's next update, or for good if the stay has ended. A point under an older group key never replaces a live-map point under a newer one.
- Capacity depends on payload size, SQLite page allocation and how often Android delivers fixes. The figures above are measurements, not guarantees.
