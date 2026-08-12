# Inventory Control System — 5-Phase Build Plan

**Status:** Approved · **Version:** 1.0 · **Date:** 2026-08-10

---

## Purpose

This document lays out how the Inventory Control System gets built, in five phases. It is sequenced around a single priority: **the highest-leverage anti-fraud and loss-prevention controls come first**, not as a "hardening" step tacked on at the end.

It builds directly on three documents already produced for this project:

- **`business-process-design.md`** — the governing process document: roles, workflows, and every numbered business rule.
- **`inventory-fraud-audit.md`** — an adversarial audit of that process, producing 35 findings (14 Critical, 12 High, 7 Medium, 2 Low), each with an attack scenario and a specific system-enforced fix.
- **`architecture.md`** — the technical schema and ledger design.

The single most important design decision underneath all five phases: **inventory is never a number that gets directly edited.** It is always the sum of a permanent, append-only transaction history. Every phase below either builds a workflow that adds to that history, or builds a control that protects its integrity.

---

## Why this order

Stock only ever enters through **Receiving** and leaves through **Stock-Out** — these are the two biggest loss surfaces, and they come first, in the order goods actually flow. Returns and Damage/Disposal depend on Stock-Out already existing (a return references an original sale). Cycle counts, reconciliation, and multi-branch reporting are the *backstop* — they only mean something once there is real transaction history to check against. Final hardening, user testing, and a parallel paper-and-system run come last, because that is where the finished system gets proven against the real world before it holds live stock.

This ordering front-loads loss-prevention: **57% of all 35 fraud-audit findings are fully addressed by the end of Phase 2** — well before anything resembling a "hardening" phase.

---

## Before Phase 1: six decisions needed from the client

Six decisions materially change how the schema is built and cannot be guessed at. They are detailed with recommended defaults in a companion document (`client-decisions-needed.md`), summarized here:

1. **Who is the Auditor?** — independence here is what makes every other control real rather than decorative.
2. **Approval peso thresholds** — at what value does an adjustment need Branch Manager vs. Owner sign-off?
3. **One stock pool or two?** — do retail and wholesale share inventory, or is it ring-fenced per channel?
4. **Delivery dispute window** — how long can a customer dispute a delivered quantity?
5. **Cycle-count tiers** — which products get counted weekly vs. monthly?
6. **Branch count and timing** — how many branches, and roughly when does each open?

These do not block starting the build — the ledger, login system, and product catalog begin immediately. They block *finalizing* the approval and reservation logic that depends on the answers.

---

## Phase 1 — Foundation: Ledger, Identity, Documents, Receiving

**Goal:** build the load-bearing spine of the whole system, then fully harden the single highest-loss workflow — Receiving — because nothing downstream can be trusted if the ledger or receiving isn't solid.

**What gets built:**

- The permanent, tamper-evident stock ledger — every unit movement is a permanent record, cross-checked daily so any attempt to alter history after the fact is detectable.
- Staff accounts and role-based permissions — no shared logins, automatic session lock on idle terminals, and a controlled process for any temporary staffing-shortage exception.
- Controlled, sequentially-numbered documents for every transaction type, with a central registry so paper forms can't be sourced or reused outside the system.
- Product catalog with unlimited unit variations (piece / bundle / sack / etc.), where changing a conversion rate (e.g. "1 sack = 500 pieces") requires a witnessed physical recount before it takes effect — closing a way stock has quietly gone missing in similar systems before.
- The **Opening Balance** feature — a one-time, Owner-signed way to record day-one stock, built now but kept switched off until go-live.
- The full Receiving workflow: two independent counts (the second done blind, without seeing the first), a photo of the signed delivery paperwork attached at the moment it's recorded, and supervisor sign-off before stock counts as available.

**Proven by:** posting a full delivery end-to-end and confirming the system total matches the ledger exactly; confirming a tampered historical record is automatically detected; confirming the same delivery can't accidentally be posted twice; confirming no one can approve their own delivery.

---

## Phase 2 — Stock-Out: Retail, Wholesale, Gate Control, Adjustments

**Goal:** harden the release side of the ledger — the point where colluding staff or a customer could most directly walk goods off the property.

**What gets built:**

- Retail sale at list price, with a hard block on selling more than is on hand.
- Wholesale release with an independent, unscheduled spot-recount on a sample of releases, a gate check that verifies load weight and a tamper-evident seal (not just a box count), and separate internal and customer-facing clocks for resolving delivery disputes.
- The full adjustment workflow: mandatory investigation before any correction can even be requested, fixed reason codes, and a rule that blocks someone from quietly avoiding approval by splitting one large correction into several smaller ones across a week.
- A real-time, no-exceptions block on inventory ever going negative, with an Owner-approval path for the rare legitimate timing case.

**Proven by:** confirming a sale that would take stock negative is blocked outright; confirming a split-adjustment attempt is caught and re-routed to the correct approval level; confirming two staff can't jointly release more stock than the system records without triggering a flag.

---

## Phase 3 — Returns, Damage/Disposal, and Discrepancy Investigation

**Goal:** close the two remaining major ways goods can walk out the door disguised as a legitimate business event — fraudulent returns and faked disposal — and give every "something doesn't add up" moment a proper home.

**What gets built:**

- Customer returns that require the original receipt or verified customer identity (never a phoned-in invoice number), with a hard, real-time limit on how much of any one sale can be returned.
- Damage and disposal that requires photo or video proof of the goods actually being destroyed before it counts as a loss, plus a no-blame reporting culture backed by a system check that catches products with suspiciously few damage reports relative to their eventual count shortfalls.
- Automatic aging alerts on anything sitting in quarantine or awaiting disposal too long.
- A formal **Discrepancy Case** — any time expected and actual quantities don't match, it opens a tracked investigation with an assigned owner and a required resolution, rather than becoming a quiet one-line correction.

**Proven by:** confirming a return without proof of purchase is flagged for review rather than processed automatically; confirming a disposal can't be recorded without destruction evidence; confirming a lost-inventory event opens a full investigation case automatically.

---

## Phase 4 — Cycle Counts, Reconciliation, Multi-Branch, Reporting

**Goal:** turn physical counting and daily reconciliation — the backstop against everything upstream — into something the system actively monitors, rather than a calendar reminder that can quietly stop happening.

**What gets built:**

- A scheduled counting program that counts high-value products more often, locks other warehouse activity during an active count so it can't be worked around, and escalates automatically if scheduled counts are missed.
- Independent daily reconciliation — checked by someone who wasn't involved in that day's transactions — and a daily exception report sent to ownership through more than one channel, so a branch can't quietly suppress it.
- Full multi-branch support, including a minimal, evidence-backed transfer process for moving stock between branches (photo or waybill proof required, verified by the Auditor).
- The full reporting and dashboard suite: shrinkage rate, open investigations, cycle-count compliance, and every downloadable report (CSV, Excel, PDF).
- Documented procedure for operating during an internet or power outage, and a genuinely tested (not assumed) daily backup.

**Proven by:** confirming warehouse activity is blocked during a declared count window; confirming two missed counts in a row trigger escalation; confirming a branch cannot suppress its own exception report; confirming a restored backup matches production exactly.

---

## Phase 5 — Hardening, Staff Training, Parallel Run, Go-Live

**Goal:** prove the whole system works together — not just each phase in isolation — then execute the rollout already promised to the client: four weeks running paper and system side by side, an Owner-signed physical stock count, and go-live.

**What happens:**

- Every one of the 35 fraud-audit attack scenarios is re-run against the finished system as a formal test, not a one-time check.
- Full staff training on every procedure, including the physical-form and blind-count discipline the controls depend on.
- Four weeks of the paper process and the system running side by side, with daily reconciliation between the two and a weekly review, against agreed pass/fail criteria.
- A complete physical stock count, signed by the Owner, becomes the system's starting balance — after which that one-time feature is permanently switched off.
- Go-live, with closer-than-normal review for the first two weeks.

**Proven by:** a signed-off checklist confirming every control from Phases 1–4 still holds under adversarial testing, and a parallel-run discrepancy rate at or below the agreed threshold for the full four weeks before cutover.

---

## Where the 35 fraud-audit findings land

| Phase | Findings closed | Share of total |
|---|---|---|
| Phase 1 — Foundation & Receiving | 12 findings | 34% |
| Phase 2 — Stock-Out & Adjustments | 8 findings | 23% |
| Phase 3 — Returns & Disposal | 7 findings | 20% |
| Phase 4 — Counts, Reconciliation, Multi-Branch | 8 findings | 23% |
| Phase 5 — Hardening & Go-Live | 0 new — all 35 re-tested | — |

By the end of **Phase 2**, 20 of 35 findings — including 7 of the audit's own top-10 highest-leverage fixes — are already live.

### Appendix — every finding, by phase

Each finding from `inventory-fraud-audit.md` (G-01–G-35), one line each, grouped by the phase that closes it.

**Phase 1**

| ID | Severity | Weakness | Fix |
|---|---|---|---|
| G-01 | Critical | An Encoder can silently mistype paper figures into the system with no independent check. | Live photo of the signed source document captured at the moment of encoding. |
| G-02 | Critical | The "blind" second count at receiving has no physical enforcement — counters can simply talk. | Two counts recorded on separate, independently numbered slips, submitted straight to the Supervisor. |
| G-03 | Critical | The Supervisor's tie-break count is final, unwitnessed, and unmonitored. | Witnessed tie-break, plus tracking of any one Supervisor's resolution bias over time. |
| G-04 | High | No independent confirmation that a delivery is genuine before it posts. | Office call-back to the supplier on file for no-PO or above-threshold deliveries. |
| G-05 | Critical | Voiding a receiving record after goods were actually handled can hide an off-book receipt. | A post-handling void requires a matching, gate-logged return of the goods. |
| G-06 | High | Pre-numbered paper form booklets have no control over their own supply chain. | Central Owner/Auditor registry; any number outside a registered range is rejected. |
| G-27 | Critical | The ledger has no tamper-evidence below the application layer — a direct database edit isn't detectable. | Hash-chained ledger with a daily terminal hash published externally to Owner and Auditor. |
| G-29 | High | A staff member can self-declare an "emergency" role-collapse that bypasses segregation of duties. | Only the Owner can grant a time-boxed emergency elevation, in real time; it auto-expires and flags everything done under it. |
| G-30 | High | An unattended, unlocked terminal lets anyone act under someone else's login. | Idle-timeout auto-lock and forced re-authentication before every posting, not just at login. |
| G-32 | Critical | A wrong unit-conversion rate, once used, is permanently locked in with only a single person's say-so at creation. | Witnessed physical verification count by two people independent of the proposer, before any rate activates. |
| G-33 | High | No idempotency check — a retried or double-tapped submission can post the same movement twice. | Every posting is keyed so a duplicate submission is a no-op, not a second entry. |
| G-34 | Medium | Document-number uniqueness is only checked by the interface, not guaranteed by the database itself. | Hard database-level constraint — no code path, including a future API, can bypass it. |

**Phase 2**

| ID | Severity | Weakness | Fix |
|---|---|---|---|
| G-10 | Critical | The Picker, Checker, and Supervisor together could jointly under-state what actually leaves. | Random, unscheduled independent recount on a sample of releases, weighted toward high value. |
| G-11 | Critical | The gate check only counts packages, never verifies contents or weight. | Expected weight-range check plus tamper-evident numbered seals on loaded goods. |
| G-12 | Critical | A voided retail sale after goods left the counter doesn't force the goods to physically come back. | Post-handover voids are processed as a full Return, or require Branch Manager approval as a logged shortage. |
| G-13 | Low | Discounting has no real-time secondary control. | Manager PIN required above a threshold — mechanism built, but held dormant until the future POS module owns discount policy (see build-scope note above). |
| G-14 | Medium | A customer's delivery-dispute window can be gamed by delaying the paperwork. | A separate, fixed internal deadline for returning proof-of-delivery, independent of the customer's own dispute clock. |
| G-21 | Critical | One large loss can be split into several smaller adjustments across different products to dodge an approval threshold. | Approval routing based on a requester's rolling 7-day cumulative value, not each transaction alone. |
| G-22 | Critical | A negative-stock override can become a rubber-stamped after-the-fact approval instead of a real-time check. | Hard block before posting; only a real-time, pre-transaction Owner approval can clear it — no retroactive path. |
| G-23 | Medium | A written approval signature alone can be forged or rubber-stamped with no system-verified action behind it. | Both a physical signature and a distinct, individually-authenticated system approval action are required. |

**Phase 3**

| ID | Severity | Weakness | Fix |
|---|---|---|---|
| G-09 | High | Goods sitting in quarantine or awaiting disposal have no maximum dwell time — they become a parking lot. | Automatic aging clocks that force re-inspection and priority counting once a limit is exceeded. |
| G-15 | Critical | A return authorization can be issued on a recited invoice number alone, with no identity or document check. | Physical original receipt or verified identity required; anything less is auto-flagged high risk. |
| G-16 | High | Return condition grading relies on one inspector's judgment, unlike receiving's double count. | Independent double-grading, blind to the first result, required above a value threshold. |
| G-17 | Medium | The rule that returns can't exceed what was sold isn't enforced in real time — a double-return is possible. | A real-time, hard-blocked counter of remaining returnable quantity, checked across branches. |
| G-18 | High | Disposal "witnessing" is signature-only, with no evidence the goods were actually destroyed. | A timestamped photo or video of the actual destruction is required before it can post. |
| G-19 | Low | Scrap or seconds resale value isn't independently verified, which is a known way to skim value. | Two comparative quotes, or sale only through an Owner-approved buyer list with benchmarked rates. |
| G-20 | High | Unreported damage has no way to be detected except an eventual physical count. | No-fault damage reporting, paired with escalation for locations that report suspiciously little damage. |

**Phase 4**

| ID | Severity | Weakness | Fix |
|---|---|---|---|
| G-07 | Medium | Physical bin cards are loose, replaceable paper — easy to quietly rewrite. | Bound, numbered ledger books per zone, with a daily photographic record kept outside warehouse-staff access. |
| G-08 | High | Nothing stops other warehouse activity from continuing while a cycle count is in progress. | The system locks new picking and receiving branch-wide for the duration of a declared count. |
| G-24 | High | Count sheets can be informally compared or coached before being submitted as "blind." | Sheets are collected the instant counting finishes, by someone uninvolved, with no window to compare notes. |
| G-25 | Critical | Whether cycle counts are actually happening on schedule is itself unmonitored. | Missed counts are logged as compliance failures and escalate automatically; tracked as a dashboard KPI. |
| G-26 | High | Daily reconciliation is done by the same two people who created the day's records. | Reconciliation is checked by, or delegated remotely to, someone not involved in that day's transactions. |
| G-28 | Medium | The daily exception report to ownership has a single, branch-influenceable delivery channel. | Centrally controlled generation, sent through at least two independent channels. |
| G-31 | Medium | A departing employee's unfinished approvals and cases don't automatically get reassigned. | Deactivating an account auto-escalates every open item tied to it within 24 hours. |
| G-35 | Critical | Transfers between branches rely solely on both branches' own paperwork, with no independent proof. | Third-party waybill or geotagged photo evidence, verified by the Auditor, before a transfer can close. |

**Phase 5:** no new findings — every one of the 35 above is re-tested as a formal adversarial regression suite against the finished system before go-live.

---

## What "near-zero inventory loss" means in this plan

Every phase closes with a concrete test, not a description of intent. The system is not considered done until:

- No one — including the Owner — can change a stock quantity except through a recorded, traceable transaction.
- A finalized transaction can never be silently edited or deleted, only corrected with a visible reversal.
- No one can approve their own correction.
- The recorded total always exactly matches the sum of every transaction, provably, at any time.
- Every report the Owner reads ties out exactly against that same ledger.

This is the standard the project is being held to across all five phases.
