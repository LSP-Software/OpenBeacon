# Account deletion

Account deletion is a cross-service operation. The API schedules deletion after seven days and revokes the user's sessions. Successful authentication cancels the request. The scheduled job uses the PostgreSQL clock to select due accounts and rechecks the deadline under the account lock. It records storage cleanup so it can be retried. Keep deadline and retry decisions on the database clock; the runner host clock may differ. A remaining group member's device rotates the group epoch after a departure.

## When adding data

For every new feature, identify all database rows, object-storage keys, caches, logs, third-party services, and backups that may contain information about an account. Document who owns each record and how it is removed. Add a user relationship with an appropriate deletion policy where possible; a copied name or email without a user reference cannot reliably be attributed later. Include records created for other users, such as notifications. Add deletion and failure-retry tests for the new data, including concurrent writes and the effect on other users.

Keep user-uploaded objects below `user/<userId>/` and ensure direct-upload URLs cannot recreate an object after cleanup. Changes to presigned URL lifetime must be reflected in the cleanup delay. Image cleanup must remove object versions and delete markers. Do not remove the cleanup record before successful storage deletion.

Do not delete a group epoch merely because its creator is deleted: remaining group members may still need it. Flag affected groups for rotation and continue to accept old-epoch uploads from remaining members, including while rotation is pending, for offline continuity. A former member who retained an old key may be able to read those uploads. A successful join, departure, or deferred rotation clears the pending flag through the same epoch persistence path. Remaining devices retry pending rotations automatically. Test multiple members rotating at once, offline queues, and a device with unavailable keys.

Review deployment-specific logs, caches, backups and external processors separately; database deletion does not erase copies retained by other people. Database constraints require new feedback, join alerts and shared invitations to have an account reference.

## Operations

Run the scheduled job runner with the same database and image bucket as the backend and permissions to list and delete object versions. Failed operations are retried. To delete an account immediately with the root `.env` locally, run `bun --env-file=../../.env run --cwd apps/scheduled-jobs delete-account <email>`. In a configured deployment, run `bun run --cwd apps/scheduled-jobs delete-account <email>`. The same sole-owner guard applies; groups with no other members are deleted. Image cleanup is performed by the runner after the presigned upload window. Verify job health and investigate failures without logging account identifiers or image URLs. Passwordless accounts need to request deletion from the server operator.
