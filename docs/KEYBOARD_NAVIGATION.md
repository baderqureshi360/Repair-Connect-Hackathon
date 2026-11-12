# RepairConnect — Keyboard Navigation System

Final acceptance documentation for the centralized keyboard interaction layer.

## Architecture

| Module | Role |
|--------|------|
| `client/src/lib/keyboard/registry.ts` | Builtin shortcut definitions |
| `client/src/lib/keyboard/manager.ts` | Single capture-phase window listener + overlay stack |
| `client/src/lib/keyboard/commands.ts` | Role-scoped command palette items |
| `client/src/lib/keyboard/dom.ts` | Typing-target / reserved-chord / form helpers |
| `client/src/lib/keyboard/unsaved.ts` | `confirmIfDirty` helper for modal close |
| `client/src/lib/components/UnsavedChangesGuard.svelte` | `beforeNavigate` + `beforeunload` |
| `client/src/lib/components/CommandPalette.svelte` | Ctrl+K palette |
| `client/src/lib/components/ShortcutsHelp.svelte` | Ctrl+/ guide |
| `client/src/lib/navigation/portalNav.ts` | Shared nav + semantic Alt destinations |

## Final shortcut registry

| Shortcut | Action | Typing policy |
|----------|--------|---------------|
| Ctrl + K | Open command palette | allow |
| Ctrl + / | Open shortcuts help | allow |
| Alt + 1 | Dashboard | block |
| Alt + 0 | Dashboard | block |
| Alt + 2 | Repairs / Jobs (role semantic) | block |
| Alt + 3 | Appointments (when authorized) | block |
| Alt + 4 | Inventory / catalog (when authorized) | block |
| Alt + 5 | Reports (when authorized) | block |
| Escape | Close topmost dismissible overlay | allow |
| Ctrl + Enter | Submit form (`data-rc-submit` / active form) | forms-only |
| Ctrl + S | Save form (`data-rc-save`) | forms-only |
| / | Focus page/table search when safe | block |

**Never intercepted:** Ctrl+L, Ctrl+W, Ctrl+T, Ctrl+R, Ctrl+N, Ctrl+P, Ctrl+H, Ctrl+J, Ctrl+D, Ctrl+U, F5.

## Portal-specific Alt destinations

| Portal | Alt+1/0 | Alt+2 | Alt+3 | Alt+4 | Alt+5 |
|--------|---------|-------|-------|-------|-------|
| Customer | `/app/customer` | repairs | appointments | — | receipts |
| Mechanic | `/app/mechanic` | jobs | — | — | reports |
| Parts Coordinator | `/app/parts` | parts requests | — | inventory | reports |
| Shop Admin | `/app/admin` | repairs | appointments | inventory | reports |
| Supplier | `/app/supplier` | RFQs | — | catalog | performance |
| Platform Operator | `/app/platform` | shop applications | supplier applications | businesses | reports |

Unavailable shortcuts are listed in the help dialog as “Not available in this portal” and do nothing when pressed.

## Browser compatibility findings (Chrome on Windows)

Verified with **real** Playwright CDP keyboard (`page.keyboard.press`), not synthetic `window.dispatchEvent`.

| Chord | Finding |
|-------|---------|
| Ctrl + K | Works when the app document has focus. Chrome also binds Ctrl+K to the omnibox; if the page is unfocused, the browser may consume it. Fallback: header “Ctrl K” button / Shortcuts help. |
| Ctrl + / | Opens shortcuts help when the page has focus. |
| Alt + 0…5 | Works via CDP when focused. On some Windows/Chrome configurations Alt+digit can interact with menu bar access keys; prefer focusing `#main` first. |
| Escape | Closes top overlay (palette, help, modal, mobile nav, header search). |
| Ctrl + S | Saves forms marked `data-rc-save` while a field inside the form is focused. |
| Ctrl + Enter | Submits the active / marked form. |
| / | Focuses `[data-page-search]`, `#table-search`, or first `main input[type=search]`. Blocked while typing in inputs. |

**Recommendation:** Train users to focus the app content area before using Alt chords; keep the visible shortcut button as a discoverable Ctrl+K fallback.

## Unsaved-change protection coverage

| Area | Mechanism |
|------|-----------|
| Profile (all roles) | `UnsavedChangesGuard` + `data-rc-save` |
| Appearance / preferences | `UnsavedChangesGuard` + `data-rc-save` |
| Repair diagnosis / estimate / payment reversal modals | `confirmIfDirty` on close + page guard while open |
| Inventory create/edit/stock/adjust modals | `confirmIfDirty` + page guard |
| Supplier catalog product + stock forms | `UnsavedChangesGuard` + `data-rc-save` |
| Supplier profile | `UnsavedChangesGuard` |
| Supplier quotation editor | `UnsavedChangesGuard` |
| Shop admin supplier finance payment | `UnsavedChangesGuard` when amount/reference entered |
| Parts suppliers create form | `UnsavedChangesGuard` + `data-rc-save` |

Successful save clears dirty state so navigation is not blocked afterward. Browser back/forward is covered via SvelteKit `beforeNavigate`; tab close via `beforeunload`.

## DataTable navigation coverage

Only one production `DataTable` usage:

| Page | `getRowHref` | Keyboard open | Notes |
|------|--------------|---------------|-------|
| Parts → Suppliers | None (no supplier detail route) | Arrow/Home/End/Page focus; Enter no-ops without link | `getRowLabel` set for accessible row names; list is informational |

Most portal lists use custom `<table>` markup with in-cell `<a>` links (platform applications, RFQs, POs, repairs, etc.). Those links remain keyboard-reachable via Tab; DataTable row-model does not apply.

## Session / shop / role refresh

- Logout clears palette, help, search query/results, then session.
- `$user.id` / `$user.role` changes clear cached search + close palette.
- Shop switch clears search cache and closes palette, then invalidates the route.
- Command items are derived from the live `$user.role` and the authorized `/api/v1/search` endpoint (server-scoped).

## Tests (acceptance run)

| Suite | Result | Exit |
|-------|--------|------|
| `npm run check` | 0 errors / 0 warnings | **0** |
| `npm run build` | production build OK | **0** |
| Vitest `keyboard.test.ts` | **9 passed** | **0** |
| Playwright `keyboard-navigation.spec.ts` | **11 passed** | **0** |
| Playwright `keyboard-real-input.spec.ts` | **2 passed** | **0** |
| Playwright `a11y.spec.ts` | **2 passed** | **0** |
| Playwright `portals.a11y.spec.ts` | **6 passed** | **0** |
| Playwright `workflow.spec.ts` | **2 passed** | **0** |
| Playwright `marketing.spec.ts` | **4 passed** (1 transient timeout on shop registration API, passed on retry) | **0** on retry |

Skipped: **0** in the suites above.

## Remaining limitations

1. Chrome omnibox may still win Ctrl+K if the page is not focused.
2. Custom HTML tables are not auto-converted to DataTable row navigation.
3. Parts suppliers DataTable has no detail URL by product design.
4. Not every create form in the app is opted into `data-rc-save` / unsaved guards — coverage targets the high-risk editors listed above.
5. Playwright “dispatchChord” helpers remain in the manager suite for deterministic CI; real-input suite documents OS/browser behavior separately.
