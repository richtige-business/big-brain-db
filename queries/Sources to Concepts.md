---
type: query
status: active
priority: now
created: 2026-04-29
last_updated: 2026-04-29
tags:
  - query
  - sources
related:
  - "[[GRAPH_VIEW]]"
  - "[[LINKING_GUIDE]]"
---

# Sources to Concepts

Quellen und die Concepts, Claims oder Synthesen, die daraus entstehen.

```dataview
TABLE source_kind, author, published, claims, mentions, related
FROM "sources"
WHERE type = "source"
SORT last_updated DESC
```

## Sources Without Links

```dataview
TABLE source_kind, author, published
FROM "sources"
WHERE type = "source" AND (!related OR length(related) = 0) AND (!mentions OR length(mentions) = 0)
SORT last_updated DESC
```

## Graph Filter

```text
path:sources OR path:concepts OR path:syntheses
```
