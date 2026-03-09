# Resolve PR Review Comments

Address open PR review comments interactively: fetch, validate, present for approval, then fix and resolve.

## Instructions

### Step 1 — Identify the PR

If a PR number was passed as an argument, use it. Otherwise, detect the current branch's open PR:

```bash
gh pr view --json number,title,url
```

If no open PR is found, inform the user and stop.

### Step 2 — Fetch all open review threads

Use the GitHub GraphQL API to get all unresolved review threads with their comments:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          diffSide
          comments(first: 10) {
            nodes {
              id
              databaseId
              body
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}' -f owner="{owner}" -f repo="{repo}" -F pr={PR_NUMBER}
```

Filter to only threads where `isResolved: false`. If there are no unresolved threads, tell the user "No open review comments found." and stop.

Get the owner and repo from:
```bash
gh repo view --json owner,name
```

### Step 3 — Read the relevant code for each comment

For each unresolved thread, use the Read tool to load the file at `path` and examine the lines around `line` (±20 lines for context). Also run:

```bash
gh pr diff
```

to understand what changed in this PR vs the base branch.

### Step 4 — Validate each comment

For each comment, reason carefully about whether it is valid given the **current state of the code**. Consider:

- Is the issue it describes actually present in the code right now?
- Could the comment be stale (the issue was already fixed in a later commit)?
- Is the reviewer's reasoning technically correct?
- Is it an opinion/style preference with no clear right answer?

Classify each comment as one of:
- **VALID** — the issue is real and should be fixed
- **STALE** — the issue was already addressed in the code
- **DISAGREE** — the suggestion appears technically incorrect or based on a misunderstanding
- **OPINION** — subjective style preference; neither clearly right nor wrong

### Step 5 — Present the summary to the user

Output a clear numbered list like this (do NOT make any changes yet):

---
**PR #[number]: [title]**

Found [N] open review comment(s):

**Comment 1** — `src/path/to/file.ts` line 42 · @reviewer
> [quote the comment body]
→ **VALID** — [one sentence explaining why this is a real issue]

**Comment 2** — `src/other/file.rs` line 17 · @reviewer  
> [quote the comment body]
→ **STALE** — [explanation, e.g. "this variable was renamed in commit abc1234"]

**Comment 3** — `src/lib.ts` line 88 · @reviewer
> [quote the comment body]
→ **DISAGREE** — [explanation of why the suggestion appears incorrect]

---

Which comments should I fix and resolve? You can say things like:
- "fix 1 and 3" 
- "fix all valid ones"
- "fix all except 3"
- "fix none, just resolve 2"
- "skip all"

### Step 6 — Wait for user confirmation

Do not proceed until the user responds. This is a hard stop.

### Step 7 — Process the selected comments

For each comment the user approved:

1. **Make the fix** using the Edit tool to modify the file as needed. Use good judgment — don't blindly apply suggestions if they need tweaking to work correctly.

2. **Commit the change**:
```bash
git add [file]
git commit -m "fix: address review comment - [brief description]

Resolves comment by @[author] on [file]:[line]"
```

3. **Reply to the comment thread** with the commit hash:
```bash
gh api \
  --method POST \
  repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  -f body="Fixed in $(git rev-parse --short HEAD). [One sentence describing what was changed.]"
```

4. **Resolve the thread** via GraphQL:
```bash
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { isResolved }
  }
}' -f threadId="{THREAD_NODE_ID}"
```

For comments the user wants to **resolve without fixing** (e.g. stale ones), skip steps 1–2, post a brief reply explaining why (e.g. "This was already addressed in the previous commit."), then resolve the thread.

For comments the user wants to **skip entirely**, do nothing.

### Step 8 — Push and summarise

After all selected comments are handled:

```bash
git push
```

Then output a final summary:

---
✅ Done! Here's what was handled:

- **Comment 1** — Fixed in `abc1234`, thread resolved
- **Comment 2** — Marked stale, thread resolved  
- **Comment 3** — Skipped (per your instruction)

[N] thread(s) resolved. Don't forget to re-request review if needed.