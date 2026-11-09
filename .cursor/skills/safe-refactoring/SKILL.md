---
name: safe-refactoring
description: Refactors code while preserving functionality. Use when cleaning up structure, readability, duplication, maintainability, or safe performance improvements without changing behavior.
---

# Safe Refactoring

Preserve existing functionality.

Do NOT:
- change database schema
- change API contracts
- change authentication
- remove features
- change business logic
- break existing tests

Only improve:
- structure
- readability
- duplication
- maintainability
- performance where safe

## Workflow

1. Identify the refactor scope and existing tests covering it.
2. Prefer mechanical changes (extract, rename, dedupe) that keep behavior identical.
3. Run existing tests after each meaningful step.
4. If a change would touch schema, APIs, auth, or business rules, stop and treat it as a feature/change request instead.
5. Pair with `code-simplification` for clarity-focused edits.
