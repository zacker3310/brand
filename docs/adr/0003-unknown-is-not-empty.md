# ADR 0003: Unknown is not empty (coverage states)

Status: accepted (2026-11-05)

Every component, pattern and accessibility record carries a per-field `coverage` map:

| State | Meaning |
|---|---|
| `documented` | Source documents it; values are stored. |
| `documented-none` | Source explicitly says it does not exist / is unsupported (**absent capability**). |
| `not-documented` | ATLAS checked; the source does not document it (**absent documentation**). |
| `not-extracted` | ATLAS has not parsed this field (unknown). |
| `inferred` | Derived heuristically by ATLAS. |

The UI renders each state distinctly (label + pattern, not color alone). Comparisons never score
`not-documented` or `not-extracted` as a missing capability. Classification into the ATLAS taxonomy is
`inferred` unless the source itself names the pattern.
