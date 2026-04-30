---
type: guide
status: active
priority: now
created: 2026-04-29
last_updated: 2026-04-29
tags:
  - graph
  - navigation
related:
  - "[[LINKING_GUIDE]]"
  - "[[queries/Knowledge Core]]"
  - "[[queries/Vault Quality]]"
---

# Graph View

Die globale Graph-Ansicht ist gut fuer Orientierung, wird aber schnell unuebersichtlich. Nutze gespeicherte Filter oder lokale Graphen fuer konkrete Fragen.

## Presets

### Knowledge Core

Zweck: stabile Konzepte und eigene Synthesen sichtbar machen.

Filter-Idee:

```text
path:concepts OR path:syntheses
```

### Sources to Concepts

Zweck: sehen, welche Quellen welche Konzepte stuetzen.

Filter-Idee:

```text
path:sources OR path:concepts OR path:syntheses
```

### People and Organizations

Zweck: Personen, Firmen, Tools und Projekte als Beziehungsnetz betrachten.

Filter-Idee:

```text
path:entities OR path:projects OR path:sources
```

### Active Work

Zweck: aktuelle Arbeitskontexte und Prioritaeten sichtbar machen.

Filter-Idee:

```text
path:projects OR path:concepts OR path:syntheses
```

Kombiniere diesen Filter mit Dataview in [[queries/Active Work]], um `priority: now` und `status: active` gezielt zu finden.

### Unresolved

Zweck: offene Begriffe, Luecken und blockierte Arbeit finden.

Filter-Idee:

```text
path:concepts OR path:projects OR path:syntheses
```

Kombiniere diesen Filter mit [[queries/Unresolved]], um `status: seed`, `blocked_by` und `open_questions` zu kontrollieren.
