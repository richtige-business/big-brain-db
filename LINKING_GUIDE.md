---
type: guide
status: active
priority: now
created: 2026-04-29
last_updated: 2026-04-29
tags:
  - graph
  - linking
related:
  - "[[index]]"
  - "[[queries/Vault Quality]]"
---

# Linking Guide

Der Graph wird nuetzlich, wenn Links Beziehungen beschreiben. Tags gruppieren Themen, aber wiki links bilden die eigentliche Wissensstruktur.

## Grundregeln

- Jede `source` verlinkt die zentralen `concepts` und `entities`, die darin vorkommen.
- Jedes `concept` verlinkt mindestens eine belastbare Quelle oder Synthese.
- Jede `synthesis` verbindet mehrere Quellen und die Concepts, die daraus entstehen.
- Jede `entity` verlinkt relevante Projekte, Quellen oder Concepts.
- Jede `project`-Notiz verlinkt Stakeholder, Concepts, Quellen und Entscheidungen.
- Pro Notiz sind wenige starke Links besser als viele dekorative Links.

## Beziehungstypen

Nutze Properties fuer explizite Beziehungen:

- `sources`: Woher stammt die Information?
- `related`: Was ist lose verwandt?
- `extends`: Worauf baut dieses Concept auf?
- `supersedes`: Was ersetzt oder verbessert es?
- `contradicts`: Wozu steht es im Widerspruch?
- `implemented_by`: Wo wird es konkret umgesetzt?
- `blocked_by`: Was verhindert Fortschritt?

## Praktische Regel

Wenn ein Link nicht erklaerbar ist, gehoert er nicht in die Notiz. Wenn eine Beziehung wichtig ist, sollte sie entweder im Text kurz begruendet oder als Property sichtbar sein.
