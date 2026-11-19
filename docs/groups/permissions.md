# Group permissions

Every group has one owner: the account whose seats the group uses. The owner is always an Admin, so the Owner column lists what the owner can do on top of being an Admin.

| Action                                   | Owner                          | Admin                       | Editor | Member |
| ---------------------------------------- | ------------------------------ | --------------------------- | ------ | ------ |
| View group members and shared locations  | Yes                            | Yes                         | Yes    | Yes    |
| View history since their latest join     | Yes                            | Yes                         | Yes    | Yes    |
| Invite a member by email, link, or code  | Yes                            | Yes                         | Yes    | No     |
| Invite an Editor by email                | Yes                            | Yes                         | No     | No     |
| Rename the group or change its image     | Yes                            | Yes                         | Yes    | No     |
| Remove a member                          | Yes                            | Yes                         | Yes    | No     |
| Remove an Editor                         | Yes                            | Yes                         | No     | No     |
| Remove another Admin                     | Yes                            | No                          | No     | No     |
| Change roles between Editor and Member   | Yes                            | Yes                         | No     | No     |
| Make someone an Admin or demote an Admin | Yes                            | No                          | No     | No     |
| Add, edit or delete places               | Yes                            | Yes                         | Yes    | No     |
| Re-encrypt places for later joiners      | Yes                            | Yes                         | Yes    | Yes    |
| Turn off this phone's arrivals           | Yes                            | Yes                         | Yes    | Yes    |
| Mute place alerts for themselves         | Yes                            | Yes                         | Yes    | Yes    |
| Ask an Admin to become the owner         | Yes                            | No                          | No     | No     |
| Accept a request to become the owner     | No                             | Yes, when it's sent to them | No     | No     |
| Delete the group                         | Yes                            | No                          | No     | No     |
| Leave the group                          | No, deleting the group instead | Yes                         | Yes    | Yes    |

The creator is the owner. Nobody can remove the owner or change the owner's role. Only the owner manages Admins: other Admins can't make someone an Admin, change an Admin's role or remove an Admin. Email invites can make someone an Editor or a Member, while link and code invites always join as members.

To hand a group on, the owner asks an Admin to become the owner. The Admin sees the request on their own phone, with how many seats the group uses on the hosted service, and accepts or declines it there. Once they accept, they're the owner and the old owner stays an Admin. The owner can cancel the request until then, and it's cancelled if the Admin stops being an Admin or leaves.

When the owner leaves, the group is deleted for everyone, and deleting the owner's account deletes every group they own. Leaving as the last person also deletes the group. Removing or leaving a group rotates its encryption key and deletes the departing person's group location history. Places someone created stay in the group after they leave or are removed, and are deleted with their account.

See [Group history](history.md) for recorded activity, visibility and retention, and [Who can see me](who-can-see-me.md) for the account-level list of current and past viewers.
