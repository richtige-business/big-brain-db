---
type: query
status: active
priority: now
created: 2026-04-29
last_updated: 2026-04-29
tags:
  - query
  - maintenance
related:
  - "[[index]]"
  - "[[LINKING_GUIDE]]"
---

# Vault Quality

Pflegeansichten fuer isolierte, untypisierte oder schwach verlinkte Notizen.

## Untyped Notes

```dataview
TABLE file.folder, status, priority
FROM ""
WHERE !type AND !contains(file.path, "templates/")
SORT file.folder ASC, file.name ASC
```

## Seed Notes

```dataview
TABLE type, priority, sources, related
FROM ""
WHERE status = "seed" AND !contains(file.path, "templates/")
SORT priority DESC, last_updated DESC
```

## Notes Without Sources

```dataview
TABLE type, status, priority, related
FROM "concepts" OR "syntheses"
WHERE (!sources OR length(sources) = 0)
SORT last_updated DESC
```

## Notes Without Related Links

```dataview
TABLE type, status, priority, sources
FROM "concepts" OR "entities" OR "projects" OR "syntheses"
WHERE (!related OR length(related) = 0)
SORT file.folder ASC, file.name ASC
```
