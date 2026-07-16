# Issue tracker: Linear

Issues and project plans for this repository live in Linear under the Open Beacon team (`OPE`). Use the Linear MCP tools for all operations.

## Conventions

- Create and update issues with `save_issue`, always using team `OPE`.
- Read issues with `get_issue`, including relations when dependencies matter.
- Search and filter work with `list_issues`.
- Add discussion or implementation results with `save_comment`.
- Use the team's standard workflow: `Backlog`, `Todo`, `In Progress`, `In Review`, and `Done`.
- Use `Canceled` and `Duplicate` only for their corresponding terminal outcomes.
- Preserve existing labels when updating an issue unless intentionally changing the complete label set.
- Use native `blockedBy`, `blocks`, `relatedTo`, and `parentId` relations instead of encoding relationships only in prose.

## Large multi-stage work

Use a Linear project when work spans multiple implementation stages.

Follow the structure demonstrated by the `Encrypted tracking & live map` project:

- Give the project a concise summary and a description covering goal, scope, success criteria, design sources, sequencing, and deferred work.
- Create one independently reviewable issue per implementation stage.
- Attach every implementation issue to the project.
- Record dependencies using Linear's native blocking relations.
- Use priorities to identify sequencing and urgency.
- Put locked decisions and source issues in each implementation ticket that depends on them.
- Stop and escalate when implementation requirements conflict with a locked decision.
- Work may begin when its blocker reaches `In Review` only when the project explicitly defines that policy.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team `OPE`. For a large multi-stage effort, create or use a Linear project and attach the issue to it.

## When a skill says "fetch the relevant ticket"

Retrieve the referenced `OPE-<number>` issue with relations and use its project, description, comments, and dependencies as context.

## Wayfinding operations

Used by `/wayfinder`.

- The map is a Linear issue labelled `wayfinder:map`.
- Research, prototype, grilling, and task tickets are child issues labelled with the corresponding `wayfinder:<type>` label.
- Use native blocking relations to represent decision dependencies.
- The frontier consists of open, unassigned child issues with no unresolved blockers, in map order.
- Claim work by assigning the issue and moving it to `In Progress`.
- Resolve work by adding the answer, moving the issue to `Done`, and recording the resulting decision or context pointer on the map.
- When wayfinding produces a substantial implementation effort, create a Linear project containing the implementation sequence and link its design source issues.
