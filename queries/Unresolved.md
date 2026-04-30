---
type: query
status: active
priority: now
created: 2026-04-29
last_updated: 2026-04-29
tags:
  - query
  - unresolved
related:
  - "[[GRAPH_VIEW]]"
  - "[[LINKING_GUIDE]]"
---

# Unresolved

Offene, unreife oder blockierte Notizen.

```dataview
TABLE type, status, priority, blocked_by, open_questions, sources, related
FROM "concepts" OR "projects" OR "syntheses"
WHERE status = "seed" OR (blocked_by AND length(blocked_by) > 0) OR (open_questions AND length(open_questions) > 0)
SORT priority DESC, last_updated DESC
```

## Concepts Without Sources

```dataview
TABLE status, priority, related
FROM "concepts"
WHERE type = "concept" AND (!sources OR length(sources) = 0)
SORT last_updated DESC
```

## Graph Filter

```text
path:concepts OR path:projects OR path:syntheses
```
