---
type: query
status: active
priority: now
created: 2026-04-29
last_updated: 2026-04-29
tags:
  - query
  - graph
related:
  - "[[GRAPH_VIEW]]"
---

# Knowledge Core

Stabile Concepts und Synthesen, sortiert nach Prioritaet und Aktualitaet.

```dataview
TABLE type, status, priority, sources, related
FROM "concepts" OR "syntheses"
WHERE type = "concept" OR type = "synthesis"
SORT priority DESC, last_updated DESC
```

## Graph Filter

```text
path:concepts OR path:syntheses
```
