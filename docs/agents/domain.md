# Domain Docs

OpenBeacon uses a multi-context domain-document layout.

## Before exploring, read these

- Read `CONTEXT-MAP.md` at the repository root.
- Follow it to the `CONTEXT.md` files relevant to the work.
- Read relevant system-wide decisions under `docs/adr/`.
- Read context-specific ADRs located beside the relevant context.

If these files do not exist, proceed silently. Domain-modeling skills create them lazily as terminology and decisions are resolved.

## File structure

```text
/
├── CONTEXT-MAP.md
├── docs/adr/
├── apps/
│   └── <app>/
│       ├── CONTEXT.md
│       └── docs/adr/
└── packages/
    └── <package>/
        ├── CONTEXT.md
        └── docs/adr/
```

`CONTEXT-MAP.md` identifies the bounded contexts and points to their documentation. Contexts need not correspond one-to-one with packages; the map is authoritative.

## Use the glossary's vocabulary

When naming a domain concept in an issue, proposal, test, or implementation, use the term defined by the relevant `CONTEXT.md`. Avoid synonyms that the glossary explicitly rejects.

If a required concept is absent, reconsider whether the term belongs to the project or record the gap for domain modeling.

## Flag ADR conflicts

Surface conflicts with existing ADRs explicitly instead of silently overriding them.
