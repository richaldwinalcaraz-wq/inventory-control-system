# Inventory Subsystem — Build Prompt

## 0. Role

You are the engineer, ERP architect, database designer, and internal-controls reviewer for this build. Hold all four views at once: what the warehouse staff can actually operate, what the schema can guarantee, and how each could be gamed.

This is not a CRUD inventory app. It is an **inventory control system**: its job is to make stock movement accurate, traceable, fast to record, and hard to manipulate.

---

## 1. Current state — read this before anything else

This project is **past the blank-page stage**. Design work already exists in `docs/`:

| Document | Status | Authority |
|---|---|---|
| `business-process-design.md` | **v1.0, superseded in parts** | The governing document — roles, lifecycles, states, workflows, SOPs, controls |
| `inventory-fraud-audit.md` | Current | 35 findings (14 critical) against the BPD, each with an attack scenario and a system-enforced fix |
| `executive-summary.html` | v2.0, current | Client-facing; already reflects the hardened post-audit design |
| `architecture.md` | Partly stale | Schema, ledger design, roles, integration hooks. **Sections 7 and 12 still assume barcode scanning, which is ruled out** |
| `inventory-control-plan.md` | Superseded | Kept for reference only |

Two known inconsistencies you must resolve rather than inherit:

1. **The fraud audit's 35 findings are not merged into the BPD.** Building from `business-process-design.md` as written means implementing a design the audit already broke. Treat *BPD + audit amendments* as the specification; where they conflict, the audit wins.
2. **The warehouse is fully manual** — no scanners, no RFID, no automated equipment. Any control in `architecture.md` that depends on scanning needs a manual equivalent (pre-numbered controlled forms, blind double counts, physical bin cards, gate-pass control).

Your first job is to reconcile these three sources into one buildable specification, not to re-derive the design from this prompt.

---

## 2. Scope

**In scope now:** the Inventory subsystem only.

**Explicitly out of scope:** Orders, Delivery, Store/POS, Accounts Receivable. Design so these can integrate later; do not build them.

**Branch transfers ARE in scope, minimally, in Phase 4.** *(Updated after the 5-phase build plan — see `docs/five-phase-build-plan.md`.)* Five branches are planned; leaving no way for stock to move between them was an unresolved gap in an earlier draft of this document. Phase 4 builds a minimal Stock Transfer Request/Note workflow per `business-process-design.md` §8.3/§15, including the fraud audit's evidence control (fraud-audit finding G-35: a third-party waybill or timestamped/geotagged load/unload photo above a materiality threshold, confirmed by the Auditor before a transfer closes). This is deliberately minimal — no cross-branch allocation optimization, no automated replenishment — just a controlled, evidenced way for stock to change branch ownership.

**Resolving the apparent contradiction:** Stock Out types include "Retail Sale" and "Wholesale Sale" even though POS and Orders are out of scope. These are *inventory releases* that carry an opaque external reference (order no., DR no.) typed or selected by the user. Inventory records that stock left and why. It does not manage the sale, the customer, the price, or the receivable. When the Orders/POS modules arrive, they populate that reference automatically through the inventory service — the transaction shape does not change.

---

## 3. Non-negotiable invariants

Every design decision defers to these. If a feature request conflicts with one, the invariant wins and you say so.

1. **Inventory never changes without a posted transaction.** There is no "edit quantity" control anywhere in the system, for any role, including Owner.
2. **The ledger is append-only and is the source of truth.** Any `inventory_balance` row is a derived cache, rebuildable from the ledger, and reconciled by a scheduled check that alarms on drift.
3. **Posted transactions are immutable.** Corrections happen by reversal + re-entry, both visible.
4. **Every ledger row names a user, a timestamp, a transaction type, and a source document.**
5. **Quantity and money move together or not at all** — one database transaction, atomic, no partial state.

The philosophy in one line: **record what happened; never simply change the number.**

---

## 4. Decisions required before schema work

These materially change the data model. **Do not silently invent answers.** Where the client must decide, mark it and propose a default; where it is an engineering call, make it and justify it in `docs/architecture.md` as an ADR.

**Client decisions (blocking):**

- **"CV Report"** — the client asked for a downloadable "CV report." The meaning is unconfirmed. Ask. Build the report engine so the template is swappable without touching inventory logic, so this cannot block the build.
- **Costing method** — weighted average, FIFO, or standard cost? This drives inventory valuation, write-off value, and margin later. Default recommendation: **moving weighted average**, simplest to explain to a non-technical owner and stable under partial deliveries.
- **Negative stock** — permitted with override and approval, or hard-blocked? Default: **hard-blocked**, with a logged, approval-gated override for the receiving-lag case.
- **Backdating window** — can a transaction be posted with an earlier date, and how far back? Default: **same day only**, with supervisor approval for up to 3 days, nothing beyond a closed period.
- **Segregation-of-duties floor** — how many warehouse staff actually exist per branch? If a branch has two people, rigid maker–checker on every transaction will be defeated by shared logins, which is worse than a logged single-person override. Needs a real headcount answer.

**Engineering decisions (make them, record them):**

- Timezone is **Asia/Manila**, fixed. Every "Today" KPI, daily summary, and period boundary uses it. Store UTC, render Manila.
- Currency **PHP**; money as integer minor units or `NUMERIC`, never float.
- Base-unit quantities: integers or fixed decimal? Plastic sold per piece suggests integers — confirm no product is sold by weight or length before committing.
- **Period close.** Without a lock, a backdated posting silently rewrites last month's closing stock and every report already given to the owner. Implement a monthly close that freezes the period; post-close corrections go to the current period with a reference to the original.
- **Opening balances.** Day one, the warehouse holds stock that has no transaction history. This needs a dedicated, one-time-per-product **Opening Balance** transaction type — approval-gated, locked after the go-live cutoff, and permanently distinguishable in the ledger from an adjustment. Without it, staff will demand an "edit quantity" button and the whole control model collapses on the first day. This is missing from the current design documents.

---

## 5. Domain model

Base unit is the control unit. Variations are selling/receiving units.

- Unlimited variations per product; no hard-coded list. Each carries name, conversion factor to base unit, selling price, optional cost, optional barcode, optional SKU, status.
- Inventory is tracked **only** in base units. Never maintain independent per-variation stock.
- Receiving 5 sacks at 500 pcs/sack increases inventory by 2,500 pieces, and the transaction line stores **both** the entered quantity/unit and the computed base quantity.

**Conversion factors must be versioned and snapshotted onto every transaction line.** If someone edits "Sack = 500 pcs" to "Sack = 400 pcs" after transactions exist, every historical quantity and valuation silently changes and no audit record shows it. This is the largest untreated shrinkage vector in the current spec. A conversion factor change creates a new version with an effective date; posted lines keep the factor they were posted with; changing a factor is an audited master-data event requiring approval.

Entities to consider: users, roles, branches, categories, products, product variations, units, conversion versions, inventory balances, stock ledger, stock-in documents, stock-out documents, returns, adjustments, cycle counts, reconciliations, approvals, audit log, suppliers, attachments, discrepancy cases, number sequences. Add more only with justification; do not over-engineer.

---

## 6. Workflows

**Stock In** — supplier delivery, customer return, positive adjustment.
**Stock Out** — retail release, wholesale release, damage disposal, negative adjustment.

Document lifecycle: `Draft → Pending Verification → Pending Approval → Approved → Posted`, plus `Rejected` and `Cancelled`. Status is never directly editable; it advances only through the action that causes it.

**Inventory moves only at Posted.** Never on Draft, never on Approved.

**Supplier delivery** captures supplier, delivery reference, invoice no., date, lines (product, variation, quantity, unit, computed base quantity, cost), remarks, optional photo, and the named receiver, verifier, and approver.

**Customer returns** are inspected and classified before anything is restocked. Returned goods go to a quarantine state first; only an approved *restock* decision increases sellable inventory. Damaged returns never become sellable — they land in a separate damaged bucket with its own valuation and disposal path.

**Controlled stock-out uses picker + checker**, ideally different people, and records requested / picked / verified / released quantities as distinct numbers. Divergence between them is the signal that catches most warehouse error.

**Adjustments** are never a direct edit. Request → reason (Lost, Damaged, Wrong Count, Encoding Error, Found Stock, Other) → quantity → written explanation → submit → manager approval → post. Every adjustment records user, timestamp, reason, quantity, previous balance, new balance, approver, and remarks. **Nobody approves their own.**

**Reconciliation** compares system quantity against a physical count and never auto-corrects. A difference opens an investigation, which produces an adjustment request, which requires approval. Counts should be **blind** — the counter does not see the system quantity before entering theirs, otherwise the count is just a transcription of the number it was meant to verify.

**Cycle counting** schedules recurring partial counts by category or location, tracking count date, counter, system qty, physical qty, difference, reason, resolution, approval.

---

## 7. Controls and loss prevention

Beyond the workflow gates above, the build must address these — several are absent from the current documents:

- **Idempotency.** Every posting endpoint takes an idempotency key. A double-tapped button or a retried request on a flaky connection must not post twice. The current design names double-submission as a risk but provisions nothing for it.
- **Concurrency.** Two simultaneous releases of the last 100 pieces must not both succeed. Row-level lock on the balance row or equivalent — specify the mechanism, don't just assert "atomic."
- **Authentication hygiene.** Shared logins are the most common real-world control failure and defeat every named-user control in this spec at once. Per-user PIN on shared warehouse terminals, short session timeouts, and no generic "warehouse" account.
- **Sequential gapless numbering** — `SI-2026-000001`, `SO-`, `RT-`, `ADJ-`, `CNT-`. Never reused, never reissued. A gap is itself a finding worth surfacing.
- **Loss monitoring view** — adjustments, damages, returns, reconciliation variances, and negative adjustments over time, with anomaly flags for products that need repeated correction and users who file disproportionate adjustments. Flag for investigation; never accuse.
- **Audit log** — user, role, timestamp, action, transaction, previous value, new value, device/IP, approval chain. Not editable by any normal role, never hard-deleted.
- **Attachments** — retention policy, storage location, and whether a photo is required or optional per transaction type.

Error prevention at the UI layer: block stock-out above available, block invalid quantities, block duplicate references, block deleting posted records, and warn before anything destructive.

---

## 8. Application surface

A dashboard-style business application. Professional ERP feel, operable by someone who is not comfortable with computers.

**Navigation:** Overview, Inventory, Stock In, Stock Out, Products, Returns, Adjustments, Counts, Analytics, Reports, Audit Trail, Settings. Reorganize if you have a clearly better structure; do not add modules.

**Overview** answers "what is happening with my inventory right now?" — KPI row (products, variations, total base-unit quantity, inventory value, low stock, out of stock, stock in/out today, returns today, adjustments today), movement chart over 7/30/90 days, low-stock list, fast-moving products, then recent transactions, alerts, and pending approvals. Use progressive disclosure; do not crowd it.

**Inventory page** is the main working screen: product, variation, SKU, category, base unit, on-hand, available, reserved, minimum, status, cost, value, last movement, branch. Status shown plainly — In Stock / Low Stock / Out of Stock / Exception. Search by name, SKU, variation, barcode, category. Filter by category, status, product, variation, date range, movement type, branch.

**Product detail** shows information, variations, stock, value, minimum, recent transactions, movement history, returns, adjustments, timeline.

**Stock card** per product/variation — date, reference, transaction, in, out, running balance, user. This is the feature that answers "why did this go from 1,000 to 700?" Treat it as central, not as a report.

**UX rules:** large buttons and numbers, plain wording ("Add Stock," not "Create Inventory Mutation"), icons with labels, dropdowns over free text, auto-calculated conversions, auto-generated references, default dates, confirmation on destructive actions, explicit loading/empty/error states, and clear success and failure messages. Tablet-friendly where practical.

**Alerts** are role-filtered and priority-tiered (Critical / Warning / Information). Do not bombard.

---

## 9. Reporting

Inventory, stock movement, stock in, stock out, adjustments, returns, damaged stock, low stock, valuation, stock card, reconciliation.

Every report downloads as CSV, Excel, and PDF, and carries company, branch, title, date range, generated timestamp, generated by, filters applied, data, totals, and summary. These are business documents, not table dumps — format them accordingly.

**Summary page** gives opening stock, stock in, stock out, returns, adjustments, and closing stock across daily, weekly, and monthly ranges, with period-over-period comparison. Opening and closing must tie out exactly against the ledger; a summary that doesn't reconcile is a bug, not a rounding difference.

---

## 10. Non-functional

- **Multi-branch from day one** in the schema — five branches planned. Every inventory record belongs to a branch; users see only authorized branches; owners and managers may span them. A minimal, evidence-backed transfer workflow ships in Phase 4 (see §2) — no cross-branch allocation optimization or automated replenishment, just a controlled way for stock to change branch ownership.
- **Role-based access control:** Owner, Manager, Receiver, Picker, Checker, Encoder, Auditor, and a placeholder Cashier for future POS. Least privilege; nobody gets everything.
- **Performance** must hold as history grows: pagination, indexed search, server-side filtering and aggregation, no loading full history into the browser.
- **Backups**: daily, with a *tested* restore. State plainly what is implemented now versus deferred; do not build elaborate DR for a five-branch supplier.
- **Connectivity.** Decide and document what happens during an internet or power outage. If the app is unusable, staff revert to paper and batch-enter later, which destroys timestamp integrity and every control that depends on it. This is a real risk in Iloilo and the current documents do not address it.
- **Integration hooks** for Orders, Delivery, POS, and AR: future modules call a controlled inventory service that creates transactions. No module ever writes a quantity directly. Inventory remains the sole source of truth for stock.

---

## 11. Your first deliverable — do not write application code yet

Produce a written plan, in this order:

1. **Reconciliation of the three source documents** into one specification, listing every conflict found and how you resolved it.
2. **Gap analysis** — what this prompt and the existing docs require that is not yet designed.
3. **Loss-loophole review** — walk the design asking "how could stock disappear without management noticing?" Cover unauthorized or self-approved adjustments, duplicate and double-submitted transactions, deleted or edited posted records, conversion-factor tampering, negative stock, return and damage manipulation, receiving and release manipulation, duplicate products or variations, race conditions, approval and permission bypass, direct database access, missing audit coverage, and failed-transaction handling. For each: the problem, how it causes loss, severity, the fix.
4. **Database integrity, security, usability, and reporting risks**, separately.
5. **Open questions for the client**, marked blocking or non-blocking, each with your recommended default so the build is not stalled waiting.
6. **Prioritized implementation plan** — CRITICAL / HIGH / MEDIUM / LOW, phased, with what ships in the first usable release.

Then stop and present it. Implement after the plan is agreed.

---

## 12. Acceptance criteria

Phrase these as tests you can actually run, not claims. The system is not complete until each passes:

- No role, including Owner, can change a quantity except through a posted transaction — verified by attempting it through the UI **and** through every API endpoint.
- A posted transaction cannot be edited or deleted; correction produces a visible reversal pair.
- An adjustment cannot be approved by the user who created it.
- An unapproved adjustment leaves inventory unchanged.
- Posting the same transaction twice with the same idempotency key moves stock once.
- Two concurrent releases of the last available units cannot both succeed.
- Editing a variation's conversion factor does not alter any historical quantity or valuation.
- Rebuilding balances from the ledger reproduces the current balance table exactly, for every product and branch.
- A stock card explains every change in balance between any two dates, with no unexplained delta.
- Summary opening + in − out ± adjustments = closing, exactly, for every period.
- Damaged stock never appears in sellable availability.
- Stock cannot go negative except through the defined, approved override path, and every such override is visible on the dashboard.
- A user restricted to one branch cannot read or write another branch's data through any endpoint.
- Every report downloads in all three formats with correct totals.

---

## 13. Standing instructions

Priority order when things conflict: **accuracy > control > simplicity > usability > reporting > features.**

Think, don't transcribe. If you see a way to reduce loss, error, or complexity that this document doesn't describe, propose it. Equally: do not add features because ERP systems usually have them. Every feature needs a business reason someone in Iloilo would recognize.

Where a business rule is ambiguous and the answer would affect inventory accuracy, **flag it — never invent it quietly.**
