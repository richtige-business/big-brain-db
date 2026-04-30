---
type: query
status: active
priority: next
created: 2026-04-29
last_updated: 2026-04-29
tags:
  - query
  - entities
related:
  - "[[GRAPH_VIEW]]"
---

# People and Organizations

Entitaeten mit Rollen, Quellen und Verbindungen zu Projekten oder Concepts.

```dataview
TABLE entity_kind, role, aliases, sources, related
FROM "entities"
WHERE type = "entity"
SORT entity_kind ASC, file.name ASC
```

## Entities Without Sources

```dataview
TABLE entity_kind, role, related
FROM "entities"
WHERE type = "entity" AND (!sources OR length(sources) = 0)
SORT file.name ASC
```

## Graph Filter

```text
path:entities OR path:projects OR path:sources
```
