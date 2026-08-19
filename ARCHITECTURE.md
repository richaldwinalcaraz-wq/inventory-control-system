# ARCHITECTURE.md — Project Continuity Notes

Not the client deliverable. That's `docs/architecture.md` (technical spec,
versioned, PDF-exported). This file is for future-Claude / future-you:
session-to-session decisions, gotchas, and open threads that aren't obvious
from reading the docs cold. Updated as a close-out step.

## 2026-08-19 — two gaps closed from the 2026-08-18 close-out, before Phase 4

Both real gaps flagged in the 2026-08-18 close-out (below) were fixed at the
start of this session, verified against the real dev DB, and committed:

- **G-09 blind spot, fixed at the source.** Added `computePostedDisposalQty`
  (`src/server/domain/disposal/disposalLock.ts`) — sums only POSTED
  certificate quantity, deliberately separate from
  `computeRemainingUndisposedQty` (which correctly counts DRAFT/FOR_DISPOSAL
  too, for its own over-allocation-blocking job). `finalize.ts`'s
  `markDamageReportDisposedIfComplete` now uses the POSTED-only sum to decide
  when a report is really done, so a report split across one POSTED and one
  abandoned-DRAFT certificate no longer prematurely reads `DISPOSED`.
  `adjustment/post.ts`'s ADJ_03 gate was simplified to call the same shared
  helper instead of its own duplicate inline query.
  **A second, related bug surfaced while verifying this fix**:
  `checkQuarantineDisposalAging`'s query additionally filtered out any
  `DamageReport` with *any* non-VOID certificate at all
  (`disposalCertificates: { none: ... } }`), which — independent of the
  status-flip bug — silently hid exactly the partial-DRAFT-certificate case
  the check exists to catch. Removed; the query now relies solely on
  `status`, which is trustworthy again after the fix above. Verified with a
  focused script: a report split one-POSTED/one-DRAFT stays open and is
  correctly surfaced by the aging check.
- **SCRAP_SALE quotes-on-file loophole closed** (user's explicit call,
  tightening beyond the original Phase 3 plan's as-designed behavior):
  `recordScrapSaleQuote` now requires at least one live-captured
  (`LIVE_CAMERA_STREAM`) evidence photo of the quote document(s) whenever
  the quotes-on-file path is used (no `scrapBuyerBenchmarkId`) — same
  hard-block discipline as DESTROY's evidence gate, stored as
  `TransactionEvidence(referenceType: "ScrapSaleRecord")`, and re-checked
  again at `postScrapSaleCertificate` time rather than only trusted from the
  earlier step. UI: `CertificateActionPanel.tsx`'s scrap-sale quote card now
  shows a `CameraCapture` block when "Two comparative quotes on file" is
  selected, and the submit button is disabled with zero photos.

`npx tsc --noEmit` and `npm run build` both clean after these fixes (the
build initially failed with a `TurbopackInternalError` — stale `.next`
cache, unrelated to the code changes; `rm -rf .next` before rebuilding
resolved it, worth remembering if that error recurs).

**This repo now has a second commit** covering all of Phase 3 plus these two
fixes plus the earlier, previously-uncommitted route-group rename — the
single-commit blocker flagged in both prior close-outs is resolved as of
this session.

## Where things stand (2026-08-18, close-out after Phase 3)

Phase 3 (Returns, Damage/Disposal, Discrepancy Investigation) is code-complete
against `C:\Users\user\.claude\plans\linear-stirring-rivest.md` — all 13
build-order steps done. `npx tsc --noEmit` clean (re-verified independently
by this close-out, not just trusted). Migrations applied and in sync with
`schema.prisma` (`npx prisma migrate status` — "Database schema is up to
date," 13 migrations). Shipped: `DiscrepancyCase` formalization (assign/
close, nullable-at-creation, non-empty-resolution-required close);
`ReturnQuantityLock` (deliberately NOT branch-scoped — the cross-branch
double-return race G-17 exists to close); full Returns pipeline (authorize →
receive → blind double-count → single/double-blind grading with R-2 SoD and
Branch-Manager disagreement resolution → post → void); Receiving QUARANTINE
exit path (`exitQuarantine`, quarantined lines get a real `StockBalance` via
`encodeReceivingReport`); `DamageReportDisposalLock` (third concurrency
fix, same class as `StockReservationLock`/`ReturnQuantityLock`); all four
disposal dispositions (DESTROY evidence-gated, SELL_AS_SECONDS via
`transferIntraBranch` unmodified, SCRAP_SALE benchmark/quotes-gated,
RETURN_TO_SUPPLIER built fresh); G-09 on-demand aging check + two live
reports; G-12 closure (`requestRetailSaleVoidWithoutReturn` → ADJ_01, never
a silent reversal); ADJ_03 retirement (requires a linked `DamageReport`
whose full quantity is covered by POSTED — not just non-VOID — disposal
certificates).

### Real bug found and fixed this session, and the part of it that's still open

`computeRemainingUndisposedQty` (`src/server/domain/disposal/disposalLock.ts`)
sums every non-VOID `DisposalCertificate` quantity against a `DamageReport`
— DRAFT and FOR_DISPOSAL included, not just POSTED. That's correct for its
original purpose (blocking a new certificate that would push the report's
total over capacity, including certificates still in flight). But
`markDamageReportDisposedIfComplete` (`finalize.ts`) reuses the exact same
function to decide when to flip `DamageReport.status` to `DISPOSED`, which
means a report can read DISPOSED while part of its quantity is still only
claimed by an unposted DRAFT certificate that never actually moved stock.

This was caught and fixed **for the ADJ_03 gate specifically**
(`src/server/application/adjustment/post.ts` now re-derives "fully disposed"
from POSTED certificates directly, never trusting `DamageReport.status`) —
verified against that exact edge case with a focused test script.

**It was not fixed at the source**, and the same flaw reaches a second,
more consequential place this close-out found: `checkQuarantineDisposalAging`
(G-09, `src/server/application/discrepancy/aging.ts`) excludes any
`DamageReport` with `status` DISPOSED from its 14-day-dwell query, and the
Quarantine & Disposal Aging report page applies the same exclusion. A report
that prematurely reads DISPOSED (per the bug above) permanently drops out of
both — and the DRAFT certificate itself is never separately checked, since
the certificate-level aging query only looks at `status: "FOR_DISPOSAL"`,
not DRAFT. Net effect: split a `DamageReport` across one certificate that
gets POSTED and a second that's left sitting in DRAFT (abandoned, forgotten,
or waiting on a buyer for weeks), and the undisposed remainder becomes
permanently invisible to G-09 — the exact fraud-audit finding this feature
exists to close. See the gap report from this close-out for the concrete
repro. Fix direction: either compute "fully disposed" using POSTED-only
quantity coverage (same logic already correct in `adjustment/post.ts`) as
the single source of truth `finalize.ts` also calls, or have the aging
check stop trusting `DamageReport.status` and independently sum POSTED
qty vs. report qty the way the ADJ_03 gate does.

### Known gap: SCRAP_SALE "quotes on file" path has zero verification

`recordScrapSaleQuote` (`src/server/application/disposal/scrapSale.ts`)
accepts `quotesOnFile: Array<{ buyerName, pricePerKg }>` as a plain
caller-supplied JSON array — two entries is sufficient to satisfy BPD's
"two comparative quotes on file" requirement and skip the benchmark
comparison entirely, with no attached evidence (no photo/document upload,
unlike DESTROY's hard evidence gate) and no server-side corroboration. Since
`belowBenchmark` is only computed when a `scrapBuyerBenchmarkId` match
exists (matches the plan's own stated design — "sales backed solely by two
quotes on file don't require it"), typing in two fabricated quotes is a
complete, self-service bypass of the one financial control this workflow
has (Owner approval for below-benchmark sales). This is as-designed per the
approved plan, not a deviation, but it's a real loophole worth flagging now
rather than after someone finds it live — see the gap report.

### Blocker, re-flagged (this is the same class of gap the 2026-08-12
close-out and the SOP's own cross-project lessons log both warn about —
re-verified via `git log`/`git status` directly, not trusted from a prior
note): **one commit total exists in this repo** (`fcd7118`, "Phase 1 +
Phase 2"). All of Phase 3 — every file listed above, five migrations, the
schema/seed changes, the entire Returns/Disposal/Discrepancy UI and API
surface — is uncommitted. On top of that, `git status` shows what looks
like an earlier, also-never-committed route-group rename (`src/app/
adjustments/...` etc. showing as deleted, `src/app/(dashboard)/adjustments/
...` etc. as untracked) sitting in the same working tree from a prior
session. There is currently no revert point between the single Phase 1+2
commit and the sum of two more sessions of work. Not fixed by this audit
(commits happen only when the user asks) — see the gap report for the full
call-out.

## Where things stand (2026-08-12, close-out after Phase 2)

Phase 1 (Foundation — ledger, identity, documents, receiving) and Phase 2
(Stock-Out: Retail, Wholesale, Adjustments) are both code-complete against
`C:\Users\user\.claude\plans\cheerful-marinating-pebble.md`. `npx tsc
--noEmit` and `npm run build` both clean as of the last Phase 2 commit
point. Phase 2 shipped: the negative-stock guard inside
`postLedgerEntryInTx`; `CountSlip` generalized to `referenceType`/
`referenceId` with a hard DB unique constraint; full Retail sale (list
price only, `COUNTER` zone, intra-branch transfer); full Adjustments
(G-21 rolling-7-day cumulative approval routing, `AdjustmentVelocityLock`);
full Wholesale release (reservation → pick → blind check → spot-recount →
gate check → release → post, with partial delivery).

**Blocker found in close-out, not fixed by this audit (audits report,
never fix): this repo has never been committed to git.** `git status`
shows branch `main` with "No commits yet" — every file, including all of
Phase 1 and Phase 2 (migrations, application code, HTTP routes, UI), is
still untracked. There is no revert point, no diff history, and nothing
survives a lost/corrupted working copy. This was flagged once before
(`ARCHITECTURE.md`'s prior entry, 2026-08-10, "git init was flagged to the
user today and deferred") and evidently `git init` eventually happened
(branch `main` exists) but nothing was ever staged or committed. Commit
before anything else touches this repo.

## Known gaps surfaced in the Phase 2 close-out audit (2026-08-12)

- **Negative-stock override path is unreachable.** `postLedgerEntryInTx`'s
  `allowNegativeStockOverride` param (`src/server/domain/ledger/
  postLedgerEntry.ts`) is fully implemented, but no caller anywhere in the
  app ever passes it — `grep` for `allowNegativeStockOverride` across
  `src/` only matches its own definition. The Phase 2 plan's verification
  item #1 ("a wholesale release with an approved override can legitimately
  go negative and is queryable via `reasonCode = NEGATIVE_STOCK_OVERRIDE`")
  is not actually exercisable through `wholesale/release.ts` or
  `wholesale/post.ts` as shipped — there is currently no Owner-facing way
  to invoke it. Safe direction (over-blocking, not under-blocking), so not
  a security hole, but the documented capability doesn't exist yet. Wire
  it into the wholesale release flow (or wherever the business actually
  needs the "dispatch must leave before formal posting" escape hatch)
  before claiming that verification item as passed.
- **Spot-recount SoD eligibility uses the wrong day boundary.**
  `src/server/domain/wholesale/spotRecount.ts`'s
  `assertEligibleSpotRecountWitness` computes `startOfDay` via raw
  `Date.UTC(...)` — UTC midnight, not Asia/Manila midnight. Manila is
  UTC+8, so anyone who picked/checked/authorized a sales order between
  Manila 00:00–08:00 has a `pickedAt`/`checkedAt`/`authorizedAt` that
  falls *before* the computed UTC `startOfDay`, so the `gte: startOfDay`
  filter misses it — that person would incorrectly pass eligibility to
  perform "independent" spot recounts on their own branch's work done
  earlier that same Manila business day, defeating G-10's SoD guarantee
  for exactly that 8-hour window. The codebase already has the correct
  pattern for this elsewhere — see `endOfDayManila()` in
  `src/server/domain/session/emergencyElevation.ts` (shifts by the fixed
  UTC+8 offset before computing the boundary, no DST to worry about).
  `spotRecount.ts` should reuse/mirror that helper instead of computing
  UTC midnight directly. (Note: `validatePostingDate.ts` and
  `exportDailyHash.ts` have the same raw-UTC-midnight pattern — those are
  pre-existing Phase 1 code, not introduced today, and weren't in scope
  for this audit, but the same fix likely applies there too.)
- **`storage/evidence/` is not gitignored.** 7 evidence photos (test
  captures from today's HTTP verification runs) currently sit in
  `storage/evidence/` and — combined with the git-never-committed blocker
  above — would get committed as binary blobs the first time `git add` is
  run broadly. Add `storage/evidence/` (or `storage/`) to `.gitignore`
  before the first commit, and separately decide whether real client
  evidence photos belong in git at all long-term (probably not — S3/MinIO
  per the plan's own stated production swap).
- **`EVIDENCE_STORAGE_LOCAL_DIR` env var is dead.** `.env`/`.env.example`
  declare it as `./.data/evidence`, but
  `src/server/http/saveEvidencePhoto.ts` hardcodes `storage/evidence` and
  never reads the env var at all. Pre-existing Phase 1 drift, surfaced
  while checking the evidence-photo storage path during this audit — pick
  one and delete the other so a future reader doesn't trust the env var.
- **`docs/architecture.md`** (the client-facing technical spec) is still
  dated Aug 10 — written before Phase 1 or Phase 2 existed as code. It
  reads as forward-looking design prose that happens to still be
  accurate in places, but it documents no actual Phase 2 schema
  (`SalesOrder`, `RetailSale`, `AdjustmentRequest`, `StockReservation`,
  `Customer`, the generalized `CountSlip`, the `COUNTER` zone). Needs a
  real update pass before it's handed to the client as "the" technical
  spec, not just left as pre-build prose that happens not to contradict
  what got built.
- **RLS/grants checklist item is N/A for this project** — confirmed, not
  skipped: this is a local/self-hosted Postgres reached directly via
  Prisma (`DATABASE_URL` in `.env`), not Supabase. There is no RLS layer;
  all authorization is enforced at the application layer via
  `assertPermission` (`src/server/domain/rbac/assertPermission.ts`),
  called from every Phase 2 mutating function — verified this session by
  grepping every new `src/server/application/{retail,adjustment,
  wholesale}/*.ts` file and cross-checking each `action` string against
  `prisma/seed.ts`'s `RolePermission` grants; all present, none missing.

## Where things stood (2026-08-10)

Design/planning phase only. **No application code, schema, or repo exists
yet.** Everything so far is markdown + PDF specs in `docs/`. That is normal
for a project at this stage — see close-out audit note below — but means
none of the usual code-level checks (auth, grants, secrets-in-diff) apply
yet. The audit trail for now is document-level: do the specs agree with
each other and with the decisions actually made.

## Document hierarchy (who wins when two docs disagree)

1. `docs/business-process-design.md` (BPD, v1.1) — governing process
   document. Authoritative for roles, workflows, business rules.
2. `docs/inventory-fraud-audit.md` — 35 findings against the BPD. Already
   merged into BPD v1.1 (verified: all 35 `G-xx` IDs present in the merged
   doc, revision history entry present). Audit wins where the pre-merge BPD
   and audit conflicted; post-merge that's now moot since BPD v1.1 already
   reflects the audit.
3. `docs/five-phase-build-plan.md` (v1.0, approved) — sequences the build
   around BPD v1.1 + the fraud audit. This is what gets handed to
   engineering.
4. `docs/architecture.md` (v0.2) — technical schema/ledger/stack spec.
   Defers to BPD for roles and workflow detail; scoped to schema and tech
   only as of v0.2.
5. `build-prompt.md` — the standing prompt for whoever (human or AI) picks
   up implementation. **Currently stale in two places — see below.**

## Known contradiction: `build-prompt.md` vs. BPD v1.1 / five-phase plan on branch transfers

`build-prompt.md` line 36 and line 163 still say branch transfers are
**explicitly out of scope** ("do not build them" / "No transfer
functionality"). This was true when the prompt was written. It was
reversed during today's planning session — branch transfers are now IN
scope for **Phase 4**, gated by fraud-audit finding G-35 (independent
transit evidence, Auditor-verified before a transfer closes) — and BPD
v1.1 §15 (Inter-branch transfer flow, BR-088/089/090) and
`five-phase-build-plan.md` Phase 4 both already reflect this.

`build-prompt.md` was never updated to match. Anyone (including a cold
Claude session) building strictly from `build-prompt.md` as written will
wrongly exclude branch transfers, contradicting the two documents that are
supposed to be authoritative. **Fix before this prompt is used to start
Phase 1 or Phase 4 work** — either update lines 36/163 to reflect the
reversal, or add an explicit note pointing to the five-phase plan as the
override.

## Known gap: retail discounting / G-13 deferral isn't written down anywhere

Confirmed via user decision today: retail sale in Phase 2 is **list-price
only, no discount field** — G-13's PIN-gated discount-authorization control
is deferred to a future POS module, not built now. `five-phase-build-plan.md`
Phase 2 says "Retail sale at list price," which is *consistent* with this,
but no document states the deferral explicitly or cross-references it to
BPD v1.1 §8.1, which still describes the G-13 discount PIN-gate as a "new
rule" for the retail-sale workflow with no scope annotation.

Net effect: BPD v1.1 read on its own reads as if discount-PIN-gating is an
active requirement of the retail-sale flow being built now. Nothing flags
it as future-POS-only. A cold session building from the BPD (which
`build-prompt.md` explicitly tells the builder is authoritative) could
reasonably build discount handling into Phase 2. Needs an explicit
scope note in either the BPD (a scope caveat on the G-13 rule) or the
five-phase plan (an explicit "deferred" line, matching how other
out-of-phase findings are presumably handled — though no such per-finding
mapping exists yet at all, see next item).

## Known gap: no per-finding phase mapping despite README claiming one

`README.md` describes `five-phase-build-plan.md` as mapping "all 35
fraud-audit findings to the phase that closes them." The actual document
only has a summary count table (12/8/7/8/0 findings per phase, percentages)
— there is no table listing which specific `G-xx` ID closes in which
phase. Worth producing before Phase 1 starts, both to make the README
claim true and because it's the natural place to record deferrals like
G-13's (above).

## Versioning without git

This project is not yet a git repository. Today's edits to
`docs/architecture.md` and `docs/business-process-design.md` are backed up
via sibling `.v0.1-prescanning-backup` / `.v1.0-backup` files, not commits.
This works as a single-edit safety net but does not scale — no diff
history across more than one prior version, no ability to see who changed
what when, and manually-named backup files are one typo away from being
silently overwritten or diffed against the wrong baseline. `git init` was
flagged to the user today and deferred. Given the volume of iterative doc
editing already happening (two major version bumps in one session) and how
much more is coming through Phase 1, doing this before the next editing
session is materially safer, not just tidier — recommend before the next
session touches these docs again.

## Verified today (spot-checked, not just trusted)

- All 35 fraud-audit `G-01`–`G-35` IDs are present in the merged
  `business-process-design.md` v1.1 (grepped and counted; matches the
  audit source's own 35).
- BPD revision history entry for v1.1 correctly describes the merge scope
  and states no BR/SOP/P/C identifiers were removed or renumbered.
- `docs/architecture.md` v0.2's remaining `barcode`/`scan` mentions are
  legitimate (optional fields, explicitly-deferred post-launch options,
  explanatory "no scanning" statements) — not leftover stale assumptions
  from the v0.1 scanning-first design.
- `docs/architecture.md` genuinely contains 5 Mermaid code blocks, so the
  README's stated reason for not regenerating
  `Inventory-Management-System-Architecture-Spec.pdf` is accurate, not a
  shortcut excuse.
- No secrets/credentials in any markdown doc (grepped for key/token/secret/
  password patterns — only process-document references, e.g. "shared
  passwords" as a named business risk, no actual values).
