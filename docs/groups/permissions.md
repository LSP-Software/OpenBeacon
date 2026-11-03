# Group permissions

| Action                                  | Owner                        | Admin | Member |
| --------------------------------------- | ---------------------------- | ----- | ------ |
| View group members and shared locations | Yes                          | Yes   | Yes    |
| Invite a member by email, link, or code | Yes                          | Yes   | No     |
| Invite an admin by email                | Yes                          | No    | No     |
| Rename the group or change its image    | Yes                          | Yes   | No     |
| Remove a member                         | Yes                          | Yes   | No     |
| Remove an admin                         | Yes                          | No    | No     |
| Remove another owner                    | Yes, if an owner remains     | No    | No     |
| Change roles                            | Yes, if an owner remains     | No    | No     |
| Delete the group                        | Yes                          | No    | No     |
| Leave the group                         | Yes, with an owner remaining | Yes   | Yes    |

The creator is an owner. Owners may promote members to owner; email invites can assign admin or member, while link and code invites always join as members. The last owner must transfer ownership before leaving a group with other members. Leaving as the last person deletes the group. Removing or leaving a group rotates its encryption key and deletes the departing person's group location history.
