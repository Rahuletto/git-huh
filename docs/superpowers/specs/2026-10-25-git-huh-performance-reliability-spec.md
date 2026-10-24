# git-huh reliability and performance improvement specification

## Goal

Finish the reliability work in PR #1, then reduce startup, stale-data exposure, render work, retained RAM, disk growth, and native-widget work using measured changes that preserve app behavior.

## Source reports and branch context

- Baseline source audit: `/var/folders/v2/7l8j4cqj6y10yf9f_754166h0000gn/T/opencode/performance-audit-2026-10-24.md` (50 findings against `d2cc354`). It is a local temp file, so the durable decisions and disposition are summarized here.
- Architecture candidate report: `/var/folders/v2/7l8j4cqj6y10yf9f_754166h0000gn/T/architecture-review-20261024.html`.
- Current deep review: `/tmp/architecture-review-20261025-git-huh.html`.
- Branch under review: `perf/audit-fixes` in `jaikhuranna/git-huh` PR #1, based on `origin/main`.
- Repo is Expo SDK `~57.0.23`, React `19.2.3`, React Native `0.86.3`, Hermes enabled, npm/`package-lock.json` is package-manager authority.
- No `CONTEXT.md` or ADRs were present in the scanned repo paths. Use existing app vocabulary and keep Office-like terms out of this project.

## Report quality and decisions

The 24 Oct architecture report is useful as an early candidate map, but stale against this branch: PR section reads, lazy overlay declarations, rolling-calendar loading, Today virtualization, bounded history, shared reads, and session action/data contexts now exist in some form. Do not reimplement these from the old diagrams. Its “one conversation read replaces all searches” suggestion is rejected as written because inbox, history, mention, review-request, and open-PR queries have different semantics; share entities only where query membership and completeness remain correct.

The 25 Oct deep-review HTML is readable as a text report and its findings were source-checked. The HTML was designed for the T3 injected theme; opened as `file://`, its `var(--foreground)`/`var(--card)` variables have no local fallback. The older HTML loads Tailwind and Mermaid from CDNs, and the Mermaid ES module may be blocked by file-origin CORS. T3 preview tools returned `Authentication required`; neither report received a successful rendered-browser verification. The durable plans below are plain Markdown and do not depend on those diagrams.

## Disposition of the 50 audit findings

“Done in branch” means the code path was added, not that device behavior was verified. Every done/partial item still requires its specified regression or performance validation.

| Audit items | Disposition on this branch |
|---|---|
| 01 editor snapshot, 02 theme remount, 04 host identity, 05 composed cache keys, 06 avoid persisted aggregate, 08 empty files, 10 rolling calendar first, 11 local sections independent, 12 PR sections, 14 pull body separation, 15 viewer-id filtering, 16 bounded secondary-account loading, 18 deadline/budget primitives, 20 REST validators, 21 shared resource registry, 22 shared current value, 25 coalesced ordered persistence, 26 LRU disk index, 29 virtual Today, 30 bounded history, 31 cancellable history, 33 seen only while inbox visible, 36 bounded log tail, 38 debounced file search, 40 bounded patch scan, 41 memoized derivations, 42 reduced/offscreen animation, 43 batched branch-name lookup, 45 guarded checks actions, 47 widget redraw coalescing, 48 byte-budgeted widget cache | Implemented or substantially implemented. Preserve and add regression/device evidence; do not redo blindly. Residual details are in plans. |
| 03 uncertain mutation outcomes | Partial: REST transport distinguishes outcomes; GraphQL mutation call sites do not pass mutation intent. |
| 07 failed slices vs valid zeros | Partial: slice statuses exist, but audit each caller/hydration path and assert no failed slice becomes a persisted zero. |
| 09 clock-derived state | Partial: local day rollover exists; verify snooze, timezone/DST, foreground, widget, and saved model behavior together. |
| 13 eventual-consistency retry scope | Open: ordinary PR/thread reads still use retry behavior; restrict retries to create-then-open flows. |
| 17 overlapping queries | Open by design: preserve differing query semantics; reuse normalized entities only where safe. |
| 19 rate-limit scheduling | Partial: classification/cooldown exist; production reads default to interactive priority. |
| 23 stale/focus policy | Partial: shared keys exist, but no production caller supplies `staleAfterMs`; define resource freshness and foreground refresh. |
| 24 cached inner-schema validation | Partial: the store validates envelope and supports optional validators; audit and test every durable cache shape/version. |
| 27 mutation invalidation | Partial: targeted invalidation exists, but its flight handling is broken and some parent lists need explicit effects. |
| 28 stale authorization/failure messaging | Partial: offline/stale states exist; permission and revoked-token policies need cross-screen verification. |
| 32 nested/list completeness | Open: retain explicit caps/cursors and truthful “more/truncated” behavior for inbox, conversations, repository pickers. |
| 34 selector-level session subscriptions | Partial: action/data split exists, but all data is one broad context. Profile then narrow high-churn subscriptions. |
| 35 bounded overlay retention | Partial: only a few pushed routes stay mounted; prove draft, scroll, focus, and local state recovery for evicted screens. |
| 37 size-aware file transfer | Partial: patch reads are bounded, but inspect large file/base64/text/line allocations and metadata reuse. |
| 39 file-list geometry | Not measured; instrument viewport, mounted rows, scroll-to-index, and memory on devices before changing layout. |
| 44 resumable proposal writes | Partial: successful steps persist, but uncertain dispatched steps are not reconciled safely. |
| 46 host client reuse | Partial/unverified: retain visibility and in-flight poll gates; measure client creation, persistence, and failure backoff. Do not add a server delta protocol without hostd support and evidence. |
| 49 lifecycle/integration tests | Open: current reported unit count does not prove hooks, disk, UI, or native lifecycle behavior. |
| 50 release measurements and bundle loading | Open: no device baselines. Dynamic-import behavior must be measured by platform/build type. |

## Required outcomes

1. Resource reads publish observable immutable snapshots; invalidation/cancellation/generation races cannot strand or overwrite data.
2. Every write has a truthful outcome and a recoverable operation identity. Unknown non-idempotent outcomes are reconciled before retry; no automatic replay.
3. Read deadlines include response-body consumption. Body bytes, lines, pages, history, cache, and native bitmaps stay within explicit limits.
4. Resource freshness and refresh policy are explicit per domain, including foreground return. Stale age and failure state remain truthful.
5. Existing screen work is profiled before further context splitting, list tuning, chart caching, host ring buffers, or granular component lazy loading.
6. Decompose the proposal write workflow out of the 1,055-line `src/lib/writes.ts` before that module grows further.
7. Keep the current five native sections and already-working PR split, rolling calendar, feed window, cache isolation, and mutation preconditions.
8. Add no dependencies or state-library migration unless a benchmark proves the smaller existing architecture cannot meet the target.
9. Establish cold/warm/offline startup, PR-section latency, request/byte counts, render/frame time, retained JS/native memory, disk writes, and widget redraws before setting numerical targets.
10. Android/iOS claims require release-device evidence. A passing TypeScript/unit suite is not a memory/FPS result.

## Workstreams

- Read registry and freshness: `2026-10-25-git-huh-read-registry.md`
- Mutation safety and proposal recovery: `2026-10-25-git-huh-write-safety.md`
- UI subscriptions, feed, and load policy: `2026-10-25-git-huh-ui-dataflow.md`
- Disk, file/log bounds, host, and widget memory: `2026-10-25-git-huh-memory-native.md`
- Loading strategy, integration gates, and release measurement: `2026-10-25-git-huh-release-measurement.md`

## Global constraints

- Preserve the existing five-section navigation and feature behavior.
- Keep `package-lock.json` tracked; ignore `bun.lock`; do not change package manager.
- Never retry a write with unknown outcome until remote state is reconciled.
- Preserve file SHA/revision preconditions and captured draft context.
- Cache keys must isolate account, host, credential generation, representation, and resource identity.
- User-authored drafts/settings are not LRU cache entries and must not be silently dropped.
- Keep response/list/history/cache/bitmap budgets explicit and test their limits.
- Do not claim a performance gain without baseline and post-change measurements on release builds.
- Dynamic imports may be used for web bundle splitting; native production bundle splitting is not supported by current Expo Router guidance. Measure native module-evaluation behavior before retaining added complexity.
