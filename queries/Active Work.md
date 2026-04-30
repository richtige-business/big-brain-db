---
type: query
status: active
priority: now
created: 2026-04-29
last_updated: 2026-04-29
tags:
  - query
  - active-work
related:
  - "[[GRAPH_VIEW]]"
---

# Active Work

Aktive oder priorisierte Notizen aus Projekten, Concepts und Synthesen.

```dataview
TABLE type, status, priority, outcome, decision_status, sources, related
FROM "projects" OR "concepts" OR "syntheses"
WHERE status = "active" OR priority = "now"
SORT priority DESC, last_updated DESC
```

## Current Projects

```dataview
TABLE status, priority, decision_status, stakeholders, depends_on
FROM "projects"
WHERE type = "project" AND status != "archived"
SORT priority DESC, last_updated DESC
```

## Graph Filter

```text
path:projects OR path:concepts OR path:syntheses
```
