# Group history

Open a Group's History tab to see its last 14 days of activity, starting at your most recent join. Owners, admins and members have the same history access. Leaving or being removed ends access; rejoining does not restore entries from before that join.

History includes Group creation, member joins, departures, removals and account deletions, role changes, Group renames and picture changes, Place additions, edits and deletions, and devices arriving at or leaving Places. Filters separate arrivals and departures, members, roles, Group changes and Place changes. Entries are newest first, grouped by day; Show older loads another page.

## Names and privacy

Group events are plaintext server records. They include the action, time, account references and, where relevant, the role, old and new Group or Place names, and Place emoji. They do not contain encrypted locations, Place geometry, nicknames or Group colours. The full disclosure is in the [Beta 1 privacy draft](../security/beta-1-privacy-draft.md).

The phone uses your nickname for current members when available. Former members appear under their current account name. Deleting an account clears its references from events, so those entries no longer identify it by name. Group and Place names stored in events remain until those events expire. Arrival and departure entries use the Place's current name, rather than its name when the transition happened. Place Transitions are deleted with their Place or device record; Group events remain until expiry or Group deletion.

## New activity

A dot on the Groups tab, Group row and History tab means another member has changed something in the Group. Your own actions and Place arrivals and departures do not create dots. The app checks for new Group events every minute while the tab layout is focused and the app is in the foreground. Opening History marks the latest known Group event as seen. Read state is stored on that phone separately for each account and Group; it does not sync between phones.

## API and deployment

`groupHistory.list` merges `GroupEvent` and `PlaceTransition` records, with a maximum of 100 entries per page and a timestamp-and-ID cursor. Both sources are limited to the last 14 days and the caller's latest membership. `groupHistory.latest` returns the latest qualifying Group event time for each of the caller's Groups. Group events and new membership timestamps use the database clock.

The `add_group_events` migration creates `GroupEvent` and drops `GroupJoinAlert`, including any existing join alerts. It does not backfill Group events, so Group changes appear only after deployment. Existing Place Transitions can still appear within the visibility window. Deploy the migration with the updated server and scheduled jobs before clients that require API compatibility level 7. Older supported clients can still call `groupInvites.joinAlerts`, which returns an empty list, and `groupInvites.dismissJoinAlert`, which does nothing. See [API compatibility](../development/api-compatibility.md).

The hourly `group-history-cleanup` job deletes expired Group events and Place Transitions in bounded batches. Reads exclude expired records even if cleanup is behind. Backup retention can outlast database deletion. See the [scheduled jobs reference](../../apps/scheduled-jobs/README.md).
