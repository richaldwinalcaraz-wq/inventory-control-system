# Decisions Needed From the Client — Before Phase 1 Schema Lock

`executive-summary.html` already told the client six decisions are needed before build. This is the working version of that list: each one names exactly what it drives in the system, and a recommended default so a "no strong opinion" answer doesn't stall the build.

None of these block starting the build — the ledger, RBAC, and product schema (Phase 1) proceed in parallel. They block **finalizing** the approval-routing, reservation, and multi-branch schema, which is why they need answers early rather than "whenever."

---

## 1. Who is the Auditor?

**The most important one.** The maker–checker control model — the core defense against inventory loss — only works if the Auditor role is genuinely independent from whoever operates the warehouse day to day. If the Auditor is, say, the Branch Manager's spouse or a warehouse staff member wearing two hats, every control that assumes independent review becomes decorative.

**Drives:** RBAC role assignment; SoD-4 (Operations ≠ Audit) enforcement target; who receives the daily hash-chain export (Phase 1) and the daily exception report (Phase 4).

**Recommended default:** none — this genuinely needs the client's answer. If no one independent is available yet, the fallback is the Owner personally filling the role until someone is hired, never a branch-level staff member.

## 2. Approval peso thresholds

At what value does an adjustment, write-off, or negative-stock override require Branch Manager approval vs. Owner approval? `business-process-design.md` Appendix B has placeholder thresholds pending this answer.

**Drives:** the approval-routing config table Phase 2's adjustment and return workflows consume directly.

**Recommended default:** ≤₱1,000 Branch Manager alone; ₱1,001–₱10,000 Branch Manager + Auditor notified; >₱10,000 Owner required. Adjust once real transaction-value data exists after a few weeks live.

## 3. One stock pool or two (retail vs. wholesale)?

Are retail-store and wholesale orders fulfilled from the same warehouse stock, or is stock ring-fenced per channel so one channel can't sell out the other's committed inventory?

**Drives:** the reservation/allocation model in the Phase 1 domain schema — this is expensive to change later since it affects every stock-out transaction.

**Recommended default:** one shared pool with soft reservation at order confirmation (first-confirmed-first-served), unless the client already treats wholesale customers as having guaranteed allocations — in which case ring-fenced.

## 4. Delivery dispute window

How long does a wholesale customer have to dispute a delivered quantity before the delivery record locks?

**Drives:** a field on the document schema; the logic lands in Phase 2. Kept structurally separate from the *internal* 24-hour POD-return paperwork SLA (fraud-audit finding G-14), which is a different clock for a different purpose.

**Recommended default:** 48 hours, adjustable per customer/contract later if needed.

## 5. Cycle-count tiers (which products count weekly vs. monthly)

Which products are "Class A" (highest value/fastest-moving, counted most often) vs. Class B/C?

**Drives:** `product.cycle_count_class`, set in Phase 1; the counting engine itself builds in Phase 4.

**Recommended default:** ABC by revenue contribution — top ~20% of SKUs by sales value = Class A (weekly), next ~30% = Class B (monthly), remainder = Class C (quarterly). Can be revisited once real sales data exists.

## 6. Branch count and timing

How many branches, and roughly when does each open?

**Drives:** `branch` cardinality and every `branch_id` foreign key across the Phase 1 schema — this is the most architecturally expensive one to get wrong retroactively.

**Recommended default:** build for 5 (per the client's stated plan), even if only 1–2 are opening in the near term — the schema cost of supporting 5 from day one is close to zero; retrofitting it later is not.

---

## Also needed, lower urgency (from `business-process-design.md` Appendix E)

These don't block Phase 1 schema decisions but should be resolved before the Phase they affect:

- **Lot/batch tracking scope** — is it needed for all products, or only specific categories (e.g. anything with an expiry date)? Affects Phase 1 product master data.
- **Offline/downtime tolerance** — how long can the warehouse run on paper before it's a real problem, and what's the maximum acceptable backlog to re-encode? Affects Phase 4's offline-handling design.
- **Notification channel(s)** for the daily exception report — SMS, email, both, something else? Affects Phase 4.
- **Key/custody policy** for physical form booklets, storage areas, and count-slip collection boxes — who holds keys, and is that role itself independent of warehouse operations? Affects the Phase 1 booklet-registry control (G-06) and Phase 4's blind-count-slip collection control (G-24).
