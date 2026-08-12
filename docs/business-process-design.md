# Inventory Subsystem — Business Process Design Document

**Client:** Plastic supplier (wholesale & retail), Iloilo City, Philippines
**Subsystem:** Inventory (1 of 5 — Inventory · Orders · Delivery · Store/POS · Debit/AR)
**Document type:** Business Process Design (BPD) — operational blueprint, not a technical specification
**Version:** 1.1 · **Date:** 2026-08-10 · **Status:** For client review and sign-off

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-05 | Initial governing document. |
| 1.1 | 2026-08-10 | Merged all 35 findings from `inventory-fraud-audit.md` (14 Critical, 12 High, 7 Medium, 2 Low) directly into the affected principles, business rules, SOPs, controls, and workflow narratives. Added a dedicated Opening Balance rule (BR-064) and conversion-factor versioning/effective-dating requirements (BR-068), identified separately from the audit. No existing BR/SOP/P/C identifiers were removed or renumbered; only amended rules and the workflow steps they govern were changed. See amended clauses throughout for detail; each carries no special marker beyond reading as the corrected process. |

---

## Document Purpose & Standing

This document defines **how the business must operate**. The software is built afterwards to enforce what is written here. Where the software and this document disagree, this document is the authority until formally amended.

**Scope:** the Inventory subsystem only. Orders, Delivery, Store/POS, and Debit/AR are referenced solely at their integration boundaries (Section 16).

**Explicitly out of scope for this document:** database schemas, APIs, screen designs, source code, and technology selection.

**Supersession notice.** Two earlier documents exist in this project — `docs/inventory-control-plan.md` and `docs/architecture.md`. Both assume barcode scan-to-confirm at every touchpoint as the primary loss-prevention control. **The client has confirmed the warehouse remains manual: no barcode scanners, no RFID, no automated equipment.** Where those documents rely on scanning, the controls in Sections 11 and 12 of this document replace them. The ledger principle from `architecture.md` (stock is a derived sum of immutable movements, never an editable number) survives unchanged and is restated here as Principle P-01.

**Operating assumption on the warehouse:** paper is the *capture instrument* at the point of physical action; the system is the *system of record*. The design below is built to survive that gap — the delay between "the item physically moved" and "the movement was typed in" is where manual-warehouse losses hide, and Sections 11, 12, and 14 exist primarily to close it.

---

# 1. Business Overview

## 1.1 What the business does

The company purchases plastic products in bulk — cellophane, sando bags, trash bags, plastic sheeting, containers, straws, cups, and similar goods — from manufacturers and importers (typically Manila and Cebu), stores them in a warehouse in Iloilo, and resells them through two channels:

| Channel | Customer | Typical order | Payment | Fulfilment |
|---|---|---|---|---|
| **Retail** | Walk-in public, small households, small eateries | Pieces, bundles, reams | Cash, on the spot | Customer carries out from the store |
| **Wholesale** | Public-market vendors, sari-sari stores, carinderias, bakeries, resellers, other towns | Sacks, boxes, cartons, multiple sacks | Cash, partial, or credit ("utang"/suki terms) | Delivered by truck, multicab, or picked up |

Inventory is the company's **largest asset and largest loss exposure**. Unlike a service business, every peso of profit is locked inside physical goods sitting in a warehouse that many people walk through every day. The business currently runs entirely on handwritten logs, which means inventory truth exists only in someone's memory and in stacks of paper that cannot be cross-checked quickly.

## 1.2 Why inventory management exists here

Inventory management exists to answer **five questions, at any moment, without a physical count**:

1. **What do we have?** — exact quantity on hand, by product, by location.
2. **What is it worth?** — capital tied up, and cost basis for pricing decisions.
3. **Where did it come from?** — which supplier, which delivery, at what cost.
4. **Where did it go?** — which sale, which customer, which employee handled it.
5. **What is missing, and when did it go missing?** — variance isolated to a date, a product, a location, and a person.

Question 5 is the reason this project exists. A paper system can eventually answer questions 1–4 with enough effort. It can almost never answer question 5, because by the time a shortage is discovered during a physical count, the trail is months cold.

## 1.3 Responsibilities of the inventory function

| Responsibility | Description |
|---|---|
| **Custody** | Physical safekeeping of goods from receipt to release. The warehouse is *accountable* for stock in its possession, like a cashier is accountable for a cash drawer. |
| **Accuracy** | Keeping recorded stock equal to physical stock at all times, within a defined tolerance. |
| **Traceability** | Ensuring every unit that moves leaves a document trail naming a person, a time, a reason, and a counterparty. |
| **Availability** | Ensuring fast-moving goods are in stock and sellable; escalating reorder needs to Purchasing/Owner. |
| **Condition** | Protecting goods from damage, sun degradation (plastics yellow and become brittle), moisture, pests, and crushing. |
| **Segregation** | Keeping sellable, quarantined, damaged, and customer-owned goods physically apart so they can never be mixed or mis-sold. |
| **Disclosure** | Reporting discrepancies immediately and honestly, rather than absorbing them quietly. |

**Governing custody principle:** stock is never "the company's" in the abstract. At every moment, **one named person is accountable for it**. Custody transfers only by signed document. This is what converts a vague "inventory shortage" into a specific, answerable question.

## 1.4 How Inventory connects to the rest of the ERP

```
                    ┌──────────────┐
                    │   ORDERS     │  reserves stock, cannot dispatch without it
                    └──────┬───────┘
                           │ reservation / release request
                           ▼
┌───────────┐      ┌──────────────┐      ┌──────────────┐
│  STORE /  │─────►│  INVENTORY   │◄─────│   DELIVERY   │
│    POS    │ sale │  (base-unit  │ POD  │ (dispatch &  │
└───────────┘      │   ledger)    │      │  confirmation)│
                   └──────┬───────┘      └──────────────┘
                          │ cost of goods, released quantities
                          ▼
                   ┌──────────────┐
                   │  DEBIT / AR  │  invoices only what Inventory confirms released
                   └──────────────┘
```

| Module | What Inventory gives it | What Inventory requires from it |
|---|---|---|
| **Orders** | Real-time available-to-promise quantity; reservation confirmation | A confirmed, approved order document before any stock is reserved or picked |
| **Delivery** | Picked and staged goods, with a release document listing exact quantities | Proof of delivery, or a documented return-to-warehouse of undelivered goods |
| **Store / POS** | Live sellable quantity per variation; block on selling what is not there | A completed sale transaction to trigger the stock-out movement |
| **Debit / AR** | Confirmed released quantities and cost basis | Nothing — but AR must never invoice a quantity Inventory did not release |
| **Purchasing (future)** | Reorder alerts, supplier short-shipment history, consumption rates | Approved purchase orders to receive against |
| **Accounting (future)** | Inventory valuation, cost of goods sold, write-off values | Approved write-off authority above threshold |

**Boundary rule:** Inventory is the *only* subsystem permitted to change stock quantities. Every other module **requests** a movement; Inventory decides whether it is allowed, and records it. No module writes to stock directly.

---

# 2. Business Goals

## 2.1 Operational goals

| # | Goal | Target |
|---|---|---|
| O-1 | Every physical movement is recorded the same day it happens | 100% of movements encoded before end-of-day closing |
| O-2 | Receiving completed without holding the supplier's truck excessively | ≤ 45 minutes per standard delivery |
| O-3 | Wholesale order picked and staged within the promised window | ≥ 95% same-day for orders received before 2:00 PM |
| O-4 | Retail counter sale completed without warehouse delay | ≤ 3 minutes for in-stock items |
| O-5 | Physical count of a product completable without stopping operations | Rolling cycle counts, no full shutdown except for the annual count |
| O-6 | Every scheduled cycle count actually happens on schedule — a missed count is treated as a control failure, not a scheduling slip | Cycle Count Compliance ≥ 98%, tracked on the Owner's dashboard; two consecutive missed counts on the same product/location auto-escalate to the Owner (Section 12.1) |

## 2.2 Business goals

| # | Goal | Target |
|---|---|---|
| B-1 | Eliminate unexplained inventory loss | Shrinkage ≤ 0.5% of cost of goods sold per year; **zero** unexplained variances above the investigation threshold |
| B-2 | Know true stock value at any time | Inventory valuation available on demand, no month-end wait |
| B-3 | Stop capital sitting in dead stock | Dead stock (no movement 180 days) < 5% of inventory value |
| B-4 | Stop losing sales to stockouts of fast movers | Stockout rate on top 20 products < 2% of selling days |
| B-5 | Separate supplier short-shipment from internal loss | 100% of receiving variances attributed to a named root cause |

## 2.3 Control goals

| # | Goal |
|---|---|
| C-1 | No stock quantity can change without a business transaction and a named person |
| C-2 | No single person can both create and approve a stock adjustment |
| C-3 | Nothing physically leaves the premises without a document that has been checked at the exit |
| C-4 | Every pre-numbered document issued is accounted for — used, voided, or unused — every day |
| C-5 | Two independent records of stock exist (system ledger and physical bin card) and are reconciled on a schedule |
| C-6 | Every discrepancy above tolerance opens a formal, closeable investigation — never a silent correction |
| C-7 | Recorded stock can never be negative |

## 2.4 Security goals

| # | Goal |
|---|---|
| S-1 | Access is by named individual account only — no shared logins, ever |
| S-2 | Each role can perform only what its duties require (least privilege) |
| S-3 | No user, including the Owner and the system administrator, can delete or silently edit a posted transaction |
| S-4 | Cost, margin, and supplier pricing are visible only to roles that need them |
| S-5 | Every login, approval, override, export, and master-data change is logged with user and timestamp |
| S-6 | Data survives fire, flood, typhoon, and theft of the office computer (off-site backup) |

## 2.5 Scalability goals

| # | Goal |
|---|---|
| SC-1 | Adding a second and third branch requires configuration, not redesign |
| SC-2 | Product variations are unlimited and created by staff without developer involvement |
| SC-3 | Volume growth of 10× does not change the process, only the staffing of it |
| SC-4 | The other four subsystems attach to Inventory without altering its rules |
| SC-5 | Historical data is never purged; reporting stays fast as history grows |

## 2.6 User experience goals

The single hardest constraint: **staff may be senior citizens, may have never used a computer, and may be more comfortable in Hiligaynon than English.** If the system is harder than the paper it replaces, staff will quietly keep using paper and the whole control structure collapses.

| # | Goal | Standard |
|---|---|---|
| U-1 | A task is completed in as few steps as possible | Receiving one delivery line: ≤ 4 taps + 1 number |
| U-2 | Typing is minimized | Products, suppliers, customers, reasons: **selected from a list, never typed** |
| U-3 | Staff enter quantities in the unit they physically handle | "5 sacks", not "2,500 pieces" — the system converts and shows both |
| U-4 | Every irreversible action is confirmed in plain language | "You are receiving **5 SACKS** of **Tiny Plastic** = **2,500 pieces**. Correct?" |
| U-5 | Mistakes are caught before posting, not after | Blind second entry and confirmation screens on all stock-affecting actions |
| U-6 | Errors are stated in plain language with the fix | "Not enough stock. On hand: 40 pieces. Ask supervisor." — never a code |
| U-7 | The interface is legible to older eyes | Large text, large touch targets, high contrast, product photos |
| U-8 | Language is the staff's own | Bilingual labels (English / Hiligaynon) where terms are operational |
| U-9 | Training time is short | A new warehouse staff member is productive on receiving within one shift |

---

# 3. Inventory Principles

These are non-negotiable. Every process, rule, and future software decision must comply.

| # | Principle | Why it exists |
|---|---|---|
| **P-01** | **Stock is never a number that people edit. It is the running total of recorded movements.** | Removes the possibility of stock being changed without a reason attached. There is no "set quantity to X" function anywhere in the business. |
| **P-02** | **No movement without a transaction.** Every change in quantity is caused by a named business event: receipt, sale, return, transfer, damage, or approved adjustment. | Eliminates the category of change that cannot be explained. |
| **P-03** | **No transaction without a source document.** Every recorded movement points to a pre-numbered paper document bearing signatures. | In a manual warehouse the paper *is* the evidence. The system without the paper is only a claim. |
| **P-04** | **Every transaction has one accountable owner.** A named person performed it; a named person approved it where required. | Converts "inventory is short" into "this person handled it on this date." |
| **P-05** | **Custody transfers only by signature.** Goods move between people only when both sign. | Establishes an unbroken chain of responsibility from supplier's truck to customer's hands. |
| **P-06** | **Nothing is ever deleted.** Corrections are new, opposite entries that reference the original. The original mistake stays visible forever. | A deletable record is not a record. The pattern of a person's mistakes is often the actual finding. |
| **P-07** | **Closed periods and posted documents are frozen.** Once posted, a document cannot be edited — only reversed by a new document. | Prevents retroactive rewriting of history to match a count. |
| **P-08** | **Stock can never go negative.** A movement that would drive a balance below zero is blocked and escalated. | Negative stock is how real shortages hide for months. Blocking it forces the problem into daylight immediately. |
| **P-09** | **Segregation of duties.** The person who counts is not the person who approves; the person who requests an adjustment is not the person who approves it; the person who holds the goods is not the sole person who records them. | One person with end-to-end control of both goods and records is the single largest fraud risk in any warehouse. |
| **P-10** | **Stock is held in ONE base unit only.** Every variation is a conversion of the base unit, never a separate stock pool. | Prevents the classic failure where "sacks" and "pieces" disagree and require manual reconciliation. |
| **P-11** | **Sequential, gapless, accounted-for document numbers.** Every controlled form is pre-numbered; every number is accounted for daily. | Skipped or reused numbers are the standard method of concealing a removal. |
| **P-12** | **Stock is only sellable after inspection and approval.** Goods physically present are not available stock until approved. | Stops unverified, damaged, or short deliveries from being promised to customers. |
| **P-13** | **Two independent records.** A physical bin card at the stack and the system ledger are maintained by different people and reconciled on a schedule. *(Amended — G-07)* The physical stock record is maintained on numbered, bound pages traceable to a registered ledger book per storage zone, never on loose or replaceable cards, and a photographic record of each day's closing bin card entries is captured and stored outside warehouse-staff access as part of the daily close (SOP-08 step 7). | This is the manual warehouse's substitute for barcode verification: two records that must agree, kept by two people who cannot both be wrong in the same direction by accident. A loose, replaceable card is not an independent record — it can be quietly rewritten to match whatever the system shows. |
| **P-14** | **Blind verification.** The second counter never sees the first count before recording their own. | A confirming count that shows the expected number is not verification — it is agreement. |
| **P-15** | **Exceptions escalate, they never absorb.** A discrepancy is escalated within the shift; it is never quietly corrected on the next document. | Absorbed discrepancies are how a shortage becomes untraceable. |
| **P-16** | **Same-day recording.** Movements are encoded before end-of-day closing, on the day they occurred. | Every hour between the physical event and the record is an hour in which the record can drift from truth. |
| **P-17** | **Physical reality wins, but only through a controlled process.** When the count and the system disagree, the system is corrected by an approved Adjustment — never by an unrecorded edit — and the difference is investigated, not just fixed. | The correction is trivial; the investigation is the point. |
| **P-18** | **Cost and margin are restricted information.** Warehouse operations run on quantities. Costs are visible only to Owner, Branch Manager, and Auditor. | Reduces both leakage of commercial information and the incentive to target high-value stock. |

---

# 4. Business Roles

## 4.1 Role definitions

| Role | Reports to | Core responsibility | Key restriction |
|---|---|---|---|
| **Owner / General Manager** | — | Ultimate accountability. Approves high-value adjustments, write-offs, new branches, master-data policy. Reviews daily exception report. | Cannot delete records; Owner actions are logged and reviewed by the Auditor. |
| **Branch Manager** | Owner | Runs one branch end to end. Approves adjustments and write-offs within threshold, transfers out, price/discount exceptions. Owns branch inventory accuracy. | Cannot approve an adjustment they requested. |
| **Warehouse Supervisor** | Branch Manager | Owns physical custody of the warehouse. Verifies receipts, authorizes releases, resolves count discrepancies, supervises cycle counts, controls the form booklets. | Cannot post adjustments; cannot both count and approve the same count. |
| **Warehouse Receiver** | Warehouse Supervisor | Receives supplier deliveries: counts, inspects, records on the Receiving Report. | Cannot approve their own receipt; cannot release stock. |
| **Warehouse Picker** | Warehouse Supervisor | Pulls goods from storage against an approved Picking List; stages them in the Release Area. | Cannot check their own pick; cannot hand goods to the customer or driver. |
| **Warehouse Checker** | Warehouse Supervisor | Independently re-counts what the Picker staged, against the source document, before release. Also performs the blind second count at receiving. | Must never be the same person as the Picker/Receiver for the same document. |
| **Encoder / Inventory Clerk** | Branch Manager | Converts signed source documents into system transactions, same day. Maintains master data drafts. Prepares daily reconciliation. | **Cannot originate a transaction.** Encodes only what is signed. Cannot approve anything. Never touches goods. |
| **Cashier** | Branch Manager | Handles retail counter transactions and payment collection. Triggers retail stock-out via the sale. | Cannot pick, release, adjust, or receive goods. |
| **Salesperson / Sales Rep** | Branch Manager | Takes wholesale orders from customers; quotes availability. | Cannot reserve stock outside the order process, cannot pick, release, or adjust. |
| **Auditor / Internal Control** | Owner | Independent verification. Runs surprise counts, reviews adjustments and exceptions, investigates discrepancy cases, audits form accountability. | **Read-only in the system.** Cannot perform or approve any operational transaction — this is what preserves independence. |
| **Security Guard / Gate Control** | Branch Manager | Verifies that every item leaving the premises is covered by a valid, signed Gate Pass; logs vehicle in/out. | No system access beyond the gate log; cannot authorize a release. |
| **System Administrator** | Owner | User accounts, roles, branch setup. | **Cannot post or approve stock transactions; cannot delete records.** All admin actions are logged and reviewed. |

## 4.2 Permission matrix

Legend: **C** = create/record · **A** = approve · **V** = view · **–** = no access

| Function | Owner | Br. Mgr | WH Supv | Receiver | Picker | Checker | Encoder | Cashier | Sales | Auditor | Guard |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Create product / variation | A | C+A¹ | – | – | – | – | C | – | – | V | – |
| Change conversion rate | A | – | – | – | – | – | – | – | – | V | – |
| Change selling price | A | C¹ | – | – | – | – | – | – | – | V | – |
| View cost / margin | V | V | – | – | – | – | – | – | – | V | – |
| Record supplier receipt | V | V | C+A | C | – | C² | C³ | – | – | V | – |
| Approve receipt / post to stock | A | A | A | – | – | – | – | – | – | V | – |
| Create picking list | V | C | C | – | – | – | C³ | C⁴ | – | V | – |
| Pick goods | – | – | – | – | C | – | – | – | – | V | – |
| Check / verify pick | – | – | A | – | – | C | – | – | – | V | – |
| Authorize release / gate pass | A | A | A | – | – | – | – | – | – | V | V |
| Record retail sale | V | V | – | – | – | – | – | C | – | V | – |
| Record wholesale release | V | A | C | – | – | – | C³ | – | – | V | – |
| Request adjustment | C | C | C | – | – | – | C³ | – | – | – | – |
| **Approve adjustment** | **A** | **A⁵** | – | – | – | – | – | – | – | – | – |
| Request damage write-off | C | C | C | C | – | C | – | – | – | – | – |
| **Approve damage write-off** | **A** | **A⁵** | – | – | – | – | – | – | – | – | – |
| Approve customer return | V | A | A⁵ | – | – | – | – | – | – | V | – |
| Perform cycle count | – | – | C | C | C | C | – | – | – | C | – |
| Approve count variance | A | A | – | – | – | – | – | – | – | – | – |
| Initiate branch transfer | A | C | C | – | – | – | C³ | – | – | V | – |
| View full stock ledger | V | V | V⁶ | – | – | – | V | – | – | V | – |
| Export reports | V | V | – | – | – | – | V⁶ | – | – | V | – |
| Manage users / roles | A | – | – | – | – | – | – | – | – | V | – |

¹ Within policy limits set by Owner. ² As blind second counter. ³ Encodes from a signed source document only — never originates. ⁴ Retail counter release for immediate carry-out. ⁵ Up to threshold (Appendix B). ⁶ Quantities only, no cost.

**Session security (new rule — G-30).** All terminals and applications used for stock-affecting transactions enforce an idle-timeout auto-lock of no more than 3 minutes, and require the individual's own re-authentication (PIN or biometric, not simply resuming an open session) immediately before any transaction is posted or approved — every time, regardless of how recently that person last logged in. A permission granted to a named account (Section 4.2) is only as real as the session security behind it; an unattended, unlocked terminal lets anyone act under someone else's name.

## 4.3 Segregation of duties — the irreducible separations

These four separations must **never** be collapsed, regardless of staffing:

| # | Separation | The risk it prevents |
|---|---|---|
| **SoD-1** | **Custody ≠ Recording.** The person holding goods is not the sole person recording them. | The custodian can otherwise cover a removal by adjusting the record. |
| **SoD-2** | **Requesting ≠ Approving.** Whoever asks for an adjustment, write-off, or return never approves it. | Unilateral power to make stock "disappear" legitimately. |
| **SoD-3** | **Picking ≠ Checking.** Whoever pulls the goods is never the one who verifies the pull. | Deliberate over-picking, with the surplus diverted. |
| **SoD-4** | **Operations ≠ Audit.** The Auditor performs no operational transactions. | An auditor who operates cannot audit their own work. |

## 4.4 When there are not enough people (small-branch reality)

A small Iloilo branch may run with 4–6 staff. One person will wear several hats. The rule:

**Allowed combinations:** Receiver + Picker · Checker + Encoder · Cashier + Salesperson · Branch Manager + Warehouse Supervisor (small branch only).

**Forbidden combinations, without exception:**
- Picker + Checker on the same document
- Requester + Approver on the same adjustment
- Encoder + Approver
- Any operational role + Auditor
- Cashier + Warehouse custody of the same stock

**Compensating controls where staff are thin:**
1. The **Owner personally approves** every adjustment and write-off, of any value, at branches that cannot separate requester from approver at manager level.
2. **Daily exception report** goes to the Owner's phone, every day, without being requested.
3. **Cycle count frequency doubles** at understaffed branches.
4. The **Checker role is filled by whoever is available and is not the Picker** — including the Cashier or the Branch Manager. The role matters, not the job title. The system must record *who* acted as Checker on each document.

**Emergency role-collapse elevation (new rule — G-29).** Any role-collapse beyond the pre-approved small-branch combinations listed above requires a **real-time, Owner-granted, time-boxed elevated-permission event** — it can never be self-declared by the requesting employee ("the Encoder is out sick, I'll encode today" is not, by itself, authorization). The Owner grants the elevation in the system in real time; it automatically expires at end of day and is not renewable without a fresh Owner grant. Every transaction performed under an emergency elevation is automatically flagged for priority Auditor review regardless of its value. Frequency of emergency elevations per branch/role is tracked monthly — a branch invoking "emergency" more than a handful of times a month has, in practice, redefined its normal operating model without the Owner's awareness, and that pattern is itself escalated to the Owner.

---

# 5. Inventory Life Cycle

## 5.1 Full lifecycle — inbound to outbound

```
 [ DEMAND ]
     │  Reorder alert / owner decision / customer order
     ▼
 PURCHASE ORDER  ──────────────────────► (Purchasing / Owner)
     │
     ▼
 SUPPLIER DISPATCH ────────────────────► goods in transit, not our stock yet
     │
     ▼
 ARRIVAL AT GATE ──────────────────────► guard logs vehicle, verifies documents exist
     │
     ▼
 UNLOADING → RECEIVING AREA ───────────► state: INCOMING
     │
     ▼
 DOCUMENT VERIFICATION ────────────────► DR/invoice vs. PO
     │                                    │ mismatch ─► EXCEPTION E-4 (Sec. 13)
     ▼
 PHYSICAL COUNT (1st, by Receiver) ────► counted quantity recorded
     │
     ▼
 BLIND SECOND COUNT (by Checker) ──────► independent count, no sight of the first
     │        │ counts differ ─► third count by Supervisor ─► EXCEPTION E-1
     ▼
 QUALITY INSPECTION ───────────────────► state: PENDING INSPECTION
     │        │ defective ─► QUARANTINE ─► supplier claim / return-to-supplier
     ▼
 RECEIVING REPORT (RR) SIGNED ─────────► Receiver + Checker + Supervisor
     │
     ▼
 SUPERVISOR VERIFICATION & APPROVAL ───► state: APPROVED
     │
     ▼
 ENCODING (same day, by Encoder) ──────► ledger movement STOCK IN posted
     │
     ▼
 PUTAWAY TO STORAGE ───────────────────► bin card updated by hand · state: AVAILABLE
     │
     ├──────────────────────────────────────────────┐
     ▼                                              ▼
 CUSTOMER ORDER (Orders module)              RETAIL COUNTER SALE
     │                                              │
     ▼                                              ▼
 STOCK RESERVED ──────────► state: RESERVED    PAYMENT RECEIVED
     │                                              │
     ▼                                              ▼
 PICKING LIST ISSUED                          COUNTER RELEASE
     │                                              │
     ▼                                              ▼
 PICKED & STAGED ─────────► state: STAGED      LEDGER: STOCK OUT
     │                                              │
     ▼                                              ▼
 CHECKER RE-COUNT (blind)                      CUSTOMER
     │  │ mismatch ─► re-pick, EXCEPTION E-2
     ▼
 RELEASE AUTHORIZED (Supervisor)
     │
     ▼
 GATE PASS ISSUED & CHECKED AT EXIT ───► state: RELEASED
     │
     ▼
 LEDGER: STOCK OUT posted (same day)
     │
     ▼
 DELIVERY (Delivery module) ───────────► state: IN TRANSIT
     │
     ├─── delivered & accepted ─────────► state: DELIVERED ─► AR invoicing
     │
     ├─── refused / undelivered ────────► RETURN TO WAREHOUSE ─► re-receive
     │
     └─── customer return later ────────► RETURN PROCESS (Sec. 9)
                                              │
                                     ┌────────┴────────┐
                                     ▼                 ▼
                              INSPECTION          INSPECTION
                                 (good)            (damaged)
                                     │                 │
                                     ▼                 ▼
                              AVAILABLE          DAMAGED ─► DISPOSAL (Sec. 8.4)
                                                                │
                                                                ▼
                                                            DISPOSED
```

## 5.2 Lifecycle control points

The lifecycle has **eight control points** where the process may stop. Everything else is movement between control points.

| CP | Control point | Gate condition | Who holds the gate |
|---|---|---|---|
| CP-1 | Gate entry | Vehicle logged, delivery documents present | Guard |
| CP-2 | Count agreement | Two independent counts match | Checker |
| CP-3 | Quality acceptance | Goods pass inspection | Receiver + Supervisor |
| CP-4 | Receipt approval | RR complete and signed → stock becomes available | Warehouse Supervisor |
| CP-5 | Release authorization | Approved order + stock available + pick verified | Warehouse Supervisor |
| CP-6 | Gate exit | Valid Gate Pass matching physical load | Guard |
| CP-7 | Adjustment approval | Requester ≠ approver, reason valid, evidence attached | Br. Manager / Owner |
| CP-8 | Daily close | All documents encoded, all forms accounted for, reconciliation signed | Branch Manager |

## 5.3 Idempotency (new rule — G-33)

Every stock ledger insert is idempotent on **(document type + document number + branch code)**. A resubmission carrying an already-used key — whether from a UI double-tap, a network retry, or a direct API call — is treated as a no-op: the system returns the original result and does **not** create a second ledger entry. This matters because a duplicate STOCK IN silently inflates available stock with phantom units, and a duplicate STOCK OUT wrongly debits real stock twice for one physical release — either one eventually surfaces as a false discrepancy that muddies a genuine shrinkage investigation. Rejected-duplicate attempts are themselves logged, not silently dropped; a spike in duplicate-submission attempts from a specific terminal or user is reviewed the same way as a probing attempt, not dismissed as a technical glitch.

---

# 6. Inventory States

## 6.1 State catalogue

| State | Meaning | Counts as on-hand? | Sellable? | Valued in inventory? |
|---|---|---|---|---|
| **INCOMING** | On a supplier's truck or unloaded but not yet counted | No | No | No — supplier still owns it |
| **PENDING INSPECTION** | Counted, awaiting quality inspection and approval | No | No | No |
| **QUARANTINE** | Held: failed inspection, disputed, awaiting supplier decision, or awaiting return-to-supplier | Yes (physically ours if accepted) | **No** | Yes, if title passed |
| **AVAILABLE** | Approved, stored, free to sell | Yes | Yes | Yes |
| **RESERVED** | Committed to a confirmed order, still physically in storage | Yes | No — already promised | Yes |
| **STAGED** | Picked and sitting in the Release Area awaiting checking/release | Yes | No | Yes |
| **RELEASED** | Handed over, passed the gate, not yet confirmed delivered | No | No | Yes — until delivery confirmed (goods in transit) |
| **DELIVERED** | Confirmed received by customer or branch | No | No | No — now the customer's |
| **RETURNED — PENDING INSPECTION** | Physically back, not yet graded | Yes | No | Yes, provisionally |
| **DAMAGED** | Graded unsellable, awaiting disposal decision | Yes | No | Yes, at written-down or zero value |
| **FOR DISPOSAL** | Write-off approved, awaiting physical disposal | Yes | No | No — already written off |
| **DISPOSED** | Physically destroyed, sold as scrap, or returned to supplier | No | No | No |
| **UNDER INVESTIGATION** | Variance found; quantity in dispute pending a discrepancy case | Yes (at system quantity) | No — frozen | Yes |
| **IN TRANSIT (branch)** | Released by sending branch, not yet received by receiving branch | Yes — owned by **sending** branch | No | Yes, at sending branch |

## 6.2 State transition rules

| From | To | Trigger | Approval required | Document |
|---|---|---|---|---|
| INCOMING | PENDING INSPECTION | Both counts complete and matching | — | Receiving Report (draft) |
| PENDING INSPECTION | AVAILABLE | Inspection passed + supervisor approval | Warehouse Supervisor | Receiving Report (posted) |
| PENDING INSPECTION | QUARANTINE | Inspection failed / quantity disputed | Warehouse Supervisor | RR + Discrepancy Note |
| QUARANTINE | AVAILABLE | Re-inspection passed, or supplier dispute resolved in our favour | Branch Manager | Quarantine Release Form |
| QUARANTINE | DISPOSED | Returned to supplier | Branch Manager | Return-to-Supplier Form |
| QUARANTINE | DAMAGED | Confirmed unsellable, kept by us | Branch Manager | Damage Report |
| AVAILABLE | RESERVED | Order confirmed in Orders module | Auto, per order approval | Sales Order / Store Request |
| RESERVED | AVAILABLE | Order cancelled or reservation expired | Branch Manager (if manual) | Cancellation note |
| RESERVED | STAGED | Picking completed | — | Picking List (picked) |
| STAGED | RELEASED | Checker verified + supervisor authorized + gate pass issued | Warehouse Supervisor | Delivery Receipt + Gate Pass |
| STAGED | AVAILABLE | Release cancelled; goods returned to storage | Warehouse Supervisor | Put-back note on Picking List |
| RELEASED | DELIVERED | Proof of delivery received | — | Signed DR / POD |
| RELEASED | AVAILABLE | Undelivered goods returned to warehouse | Warehouse Supervisor | Undelivered Return Form + re-count |
| DELIVERED | RETURNED — PENDING INSPECTION | Authorized customer return physically received | Branch Manager (RA issued first) | Return Authorization + Return Receiving Report |
| RETURNED — PENDING INSPECTION | AVAILABLE | Graded sellable | Warehouse Supervisor | Return Inspection Report |
| RETURNED — PENDING INSPECTION | DAMAGED | Graded unsellable | Warehouse Supervisor | Return Inspection Report |
| AVAILABLE | DAMAGED | Damage discovered in storage | Warehouse Supervisor | Damage Report |
| DAMAGED | FOR DISPOSAL | Write-off approved | Br. Manager / Owner by value | Disposal Request |
| FOR DISPOSAL | DISPOSED | Physical disposal witnessed | Two witnesses incl. one non-warehouse | Disposal Certificate |
| AVAILABLE | UNDER INVESTIGATION | Count variance above tolerance | Warehouse Supervisor | Discrepancy Case |
| UNDER INVESTIGATION | AVAILABLE | Case resolved, stock found/explained | Branch Manager | Case closure + Adjustment (if any) |
| AVAILABLE | IN TRANSIT (branch) | Branch transfer released | Branch Manager (sending) | Stock Transfer Note |
| IN TRANSIT (branch) | AVAILABLE (receiving branch) | Receiving branch counts and accepts | Warehouse Supervisor (receiving) | Transfer Receiving Report |

**Rule:** any state a product sits in that is *not* AVAILABLE must be **physically separated** in the warehouse (Section 11). A state that exists only in the computer will eventually be violated by someone reaching for the nearest sack.

**Rule — maximum dwell time in non-sellable states (new rule — G-09):** QUARANTINE, DAMAGED, and FOR DISPOSAL count as on-hand inventory but are functionally invisible to sales and to the ordinary ABC cycle-count schedule (which targets AVAILABLE stock) — left unmonitored, they become a parking lot for stock that has been skimmed but not yet physically removed. Every item entering QUARANTINE, DAMAGED, or FOR DISPOSAL carries a system-set clock from the moment it enters that state. An item remaining in **QUARANTINE beyond 14 days**, or in **DAMAGED/FOR DISPOSAL beyond 30 days**, auto-generates a mandatory re-inspection task assigned to the Branch Manager, and is added to the next scheduled cycle count at **Class A frequency**, regardless of the underlying product's normal ABC class (Section 12.1). A standing "Quarantine & Disposal Ageing" report — items and days-in-state, oldest first — is reviewed weekly by the Auditor, independent of whether the Branch Manager has acted on the auto-escalation.

---

# 7. Complete Stock In Process

## 7.1 Overview

```
SUPPLIER ARRIVES
      ▼
[1] GATE & DOCUMENT CHECK          Guard
      ▼
[2] UNLOAD TO RECEIVING AREA       Receiver + supplier crew
      ▼
[3] DOCUMENT VERIFICATION vs PO    Receiver
      ▼
[4] FIRST PHYSICAL COUNT           Receiver
      ▼
[5] BLIND SECOND COUNT             Checker
      ▼
[6] QUALITY INSPECTION             Receiver (+ Supervisor if issue)
      ▼
[7] RECEIVING REPORT PREPARED      Receiver
      ▼
[8] SUPERVISOR VERIFICATION        Warehouse Supervisor
      ▼
[9] APPROVAL / POSTING             Warehouse Supervisor
      ▼
[10] ENCODING TO SYSTEM            Encoder (same day)
      ▼
[11] PUTAWAY + BIN CARD UPDATE     Receiver / Picker
      ▼
STOCK AVAILABLE
```

## 7.2 Step detail — supplier delivery

### Step 1 — Gate & document check
| | |
|---|---|
| **Purpose** | Confirm the delivery is expected and documented before goods enter the premises |
| **Responsible** | Security Guard |
| **Input** | Supplier vehicle, driver, delivery receipt / invoice |
| **Output** | Gate log entry (time in, plate number, supplier, document number) |
| **Business rules** | No unloading begins before the gate log entry exists. Driver leaves a company ID or licence at the gate until departure. |
| **Exceptions** | No documents → do not unload; call Supervisor. Delivery not on the expected list → Supervisor decides (Section 13, E-4). |
| **Approval** | None |

### Step 2 — Unloading to Receiving Area
| | |
|---|---|
| **Purpose** | Move goods to a controlled, single-purpose area where counting can be done accurately |
| **Responsible** | Warehouse Receiver (supplier crew may carry) |
| **Input** | Goods on the vehicle |
| **Output** | Goods stacked in the Receiving Area only |
| **Business rules** | Goods are **never** unloaded directly into storage. Never stacked next to already-approved stock. One delivery occupies one clearly marked receiving lane at a time. |
| **Exceptions** | Two deliveries at once → second waits or uses a second marked lane; lanes are never merged. |
| **Approval** | None |

### Step 3 — Document verification
| | |
|---|---|
| **Purpose** | Establish what *should* have arrived before anyone sees what did |
| **Responsible** | Warehouse Receiver |
| **Input** | Supplier DR/invoice, Purchase Order (if any) |
| **Output** | Verified expected quantities written on the Receiving Report header |
| **Business rules** | Supplier DR number, date, and supplier name are recorded before counting. If a PO exists, the PO number is recorded and the expected quantity is written down **before** the count begins. Deliveries without a PO are allowed (walk-in/ad hoc purchases are normal here) but are flagged for Branch Manager review. **(Amended — G-04)** A delivery with **no matching PO**, or above the three-way-match materiality threshold, additionally requires the office to log an **independent supplier confirmation** — a call-back to a supplier contact on file, never a number sourced from the delivery paperwork itself — before the Receiving Report can be approved to AVAILABLE (BR-031). The supplier's own DR is not, by itself, proof the shipment was genuinely dispatched by the supplier. |
| **Exceptions** | Illegible or missing supplier document → Supervisor may accept under a "Documents Pending" flag; goods go to QUARANTINE, not AVAILABLE, until documents arrive. |
| **Approval** | Supervisor, for no-document acceptance; office call-back confirmation required before Step 9 approval for no-PO/above-threshold deliveries |

### Step 4 — First physical count
| | |
|---|---|
| **Purpose** | Establish the actual quantity received |
| **Responsible** | Warehouse Receiver |
| **Input** | Physical goods; blank Receiving Report |
| **Output** | Counted quantity per product, per variation, written in ink |
| **Business rules** | Count in the **handling unit** (sacks, boxes, bundles) — never estimate and never convert mentally. Broken/opened packs are counted separately as loose base units, never assumed full. Counts are written in ink; corrections are struck through once and initialled, never erased or overwritten. |
| **Exceptions** | Pack appears opened or reweighed → set aside, count separately, note "opened pack" (Section 13, E-3). |
| **Approval** | None |

### Step 5 — Blind second count
| | |
|---|---|
| **Purpose** | Catch counting errors and deter collusion at the single highest-risk moment |
| **Responsible** | Warehouse Checker (must not be the Receiver) |
| **Input** | Physical goods — **without** sight of the first count |
| **Output** | Second counted quantity, recorded independently |
| **Business rules** | **(Amended — G-02)** The first and second counts are recorded on **physically separate, individually pre-numbered Count Slips** — never as two columns on one shared RR — submitted directly and only to the Supervisor by each counter, without passing through or being shown to the other counter. Where the lane layout allows it, the Receiver and Checker count from opposite ends or opposite sides of the delivery, out of speaking distance, and each slip is time-stamped on submission. The Supervisor reconciles both slips onto the RR only after both are physically in hand; an RR is invalid — and blocked from encoding — unless both underlying Count Slip numbers are recorded on it. If the two slips match → proceed. If they differ → a third count by the Warehouse Supervisor is decisive. **(Amended — G-03)** The Supervisor's tie-break count requires a **second witness present** — any other on-duty employee, logged by name — who independently writes down what they observe the Supervisor count; both the Supervisor's figure and the witness's figure are recorded, and the variance is noted with the reason. |
| **Exceptions** | Repeated mismatch on the same person → Supervisor notes it; three occurrences in a month triggers retraining (Section 12, C-14). A counter-pair whose two independent counts match *exactly* on every delivery over a rolling 90 days (15+ deliveries, zero variance) is a statistical anomaly indicating coordination rather than accuracy, and is auto-flagged for Auditor review. |
| **Approval** | Supervisor for the deciding third count, witnessed by a second on-duty employee |
| **Why this step is non-negotiable** | Without barcode scanning, blind double-counting is the *only* reliable defence against both honest miscounts and deliberate under-recording at receipt. Skipping it to save five minutes reopens the largest loss channel in the entire process. |

### Step 6 — Quality inspection
| | |
|---|---|
| **Purpose** | Prevent unsellable goods from entering sellable stock and being discovered only at the customer |
| **Responsible** | Warehouse Receiver; Supervisor for any rejection |
| **Input** | Counted goods |
| **Output** | Quantity Accepted, Quantity Rejected, and the rejection reason per line |
| **Business rules** | Plastic-specific checks: **thickness/gauge** consistent with what was ordered; **colour and print** correct; **no yellowing or brittleness** (sun-degraded stock); packaging intact and dry; count per bundle/ream verified on a **sample** (open at least 1 pack per 20, minimum 1 per delivery, and record which pack was opened). Rejected goods are physically moved to Quarantine immediately, not left in the receiving lane. |
| **Exceptions** | Partial rejection → accept good quantity, quarantine the rest, raise a supplier claim. Whole-delivery rejection → goods stay on the truck or return to the truck; nothing is posted to stock. |
| **Approval** | Supervisor for any rejection or supplier claim |

### Step 7 — Receiving Report prepared
| | |
|---|---|
| **Purpose** | Create the single legal source document for the receipt |
| **Responsible** | Warehouse Receiver |
| **Input** | All figures from Steps 3–6 |
| **Output** | Completed, pre-numbered Receiving Report (RR) |
| **Business rules** | One RR per supplier delivery. RR is pre-numbered from a controlled booklet. It records: RR number, date/time, supplier, supplier DR number, PO number (if any), the two Count Slip numbers (G-02), per line — product, variation, quantity expected / counted 1 / counted 2 / accepted / rejected, rejection reason, storage location assigned. Signatures: Receiver, Checker, Supervisor, and supplier's driver where a variance exists. Voided RRs are marked VOID across all copies and retained. **(Amended — G-05)** An RR may only be voided **before** goods leave the Receiving Area unhandled. If goods were already counted or inspected, a void is only accepted together with a logged **Return-to-Supplier gate exit** of matching quantity/type, verified by the Guard. A void meeting neither condition requires Owner approval and automatically opens a Discrepancy Case — a signed-off "delivery" that is quietly voided after the goods were physically handled is treated as a potential off-book receipt, not a routine paperwork correction. |
| **Exceptions** | Errors on the RR → void it and issue a new one; never erase. Post-handling void with no matching outbound gate record within 48 hours → automatic exception requiring retroactive Owner sign-off, with the goods' current physical location accounted for. |
| **Approval** | — |

### Step 8 — Supervisor verification
| | |
|---|---|
| **Purpose** | Independent confirmation that the paperwork matches the physical reality before stock becomes sellable |
| **Responsible** | Warehouse Supervisor |
| **Input** | Completed RR, physical goods still in the Receiving Area |
| **Output** | Verified RR |
| **Business rules** | The Supervisor **physically spot-checks at least one line** of the delivery — not just the paper. Both counts must be present. Any variance versus the PO must have a reason code. |
| **Exceptions** | Supervisor absent → Branch Manager verifies. Never self-verified by the Receiver. |
| **Approval** | — |

### Step 9 — Approval / posting
| | |
|---|---|
| **Purpose** | The moment goods become company stock and become sellable |
| **Responsible** | Warehouse Supervisor (within tolerance); Branch Manager (outside tolerance) |
| **Input** | Verified RR |
| **Output** | Approved RR → stock movement authorized |
| **Business rules** | Quantity received **over** PO quantity beyond the agreed tolerance requires Branch Manager approval before posting. Quantity **short** is posted at the accepted quantity, with the shortage recorded against the supplier — never quietly accepted at PO quantity. Zero-cost lines are blocked. Lot/batch is captured where the product requires it. |
| **Exceptions** | Section 13, E-1 and E-4 |
| **Approval** | Per Appendix B |

### Step 10 — Encoding to system
| | |
|---|---|
| **Purpose** | Make the record digital, searchable, and permanent |
| **Responsible** | Encoder |
| **Input** | Approved, signed RR |
| **Output** | Posted STOCK IN movement (converted to base units by the system) |
| **Business rules** | Encoder enters the **RR number first**; the system rejects a duplicate or out-of-sequence number. **(New — G-01)** Before the transaction can post, the Encoder captures a live photograph or scan of the signed RR through the encoding terminal/app itself — never uploaded from a gallery or a prior capture — and attaches it to the transaction record; the system stores the document's total for later independent comparison. A transaction submitted without a valid live-captured attachment is held in a "pending — no evidence" state, excluded from available stock, until resolved by a Supervisor (BR-093). Quantities are entered in the variation actually received (e.g. "5 sacks"); the system displays the base-unit result ("= 2,500 pieces") for confirmation before posting. Encoding must be completed **the same day**. The Encoder cannot alter accepted quantities — a wrong RR is corrected by voiding and re-issuing the paper, not by editing the entry. |
| **Exceptions** | System down → paper continues; encode on restoration with a backdated entry flagged "late encoding," requiring Supervisor approval and stating the reason (Section 13, E-10). |
| **Approval** | Supervisor for any late or backdated encoding |

### Step 11 — Putaway and bin card update
| | |
|---|---|
| **Purpose** | Get goods into their permanent, known location and update the physical running record |
| **Responsible** | Receiver / Picker |
| **Input** | Approved goods, assigned location |
| **Output** | Goods in storage; bin card updated |
| **Business rules** | Goods go to the assigned bin/stack only. **FIFO placement:** new stock goes behind or under existing stock so older stock is picked first — critical for plastics, which degrade with age and sunlight. The bin card at the stack is updated by hand: date, RR number, quantity in, new running balance in base units. Older stock is date-tagged. |
| **Exceptions** | Assigned location full → Supervisor assigns an alternate and it is written on the RR; stock is never left in an unrecorded location. |
| **Approval** | Supervisor for location change |

## 7.3 Other Stock In sources

| Source | Process | Section |
|---|---|---|
| Customer returns | Return Authorization → receiving → inspection → grading → restock or damage | Section 9 |
| Positive adjustment (found stock) | Adjustment request → investigation → approval → posting | Section 10 |
| Branch transfer in | Transfer receiving, treated as a supplier delivery with the sending branch as supplier | Section 15 |
| Undelivered goods returned | Re-count against the DR, re-receive to AVAILABLE, close the DR as undelivered | Section 13, E-6 |

---

# 8. Complete Stock Out Process

## 8.1 Retail sale (store counter, carry-out)

```
CUSTOMER AT COUNTER
      ▼
[1] ITEM SELECTED / QUOTED          Cashier
      ▼
[2] AVAILABILITY CONFIRMED          Cashier (system shows on-hand)
      ▼
[3] PAYMENT COLLECTED               Cashier
      ▼
[4] SALES INVOICE / OR ISSUED       Cashier (BIR-registered, pre-numbered)
      ▼
[5] GOODS HANDED OVER               Cashier / counter staff
      ▼
[6] STOCK OUT POSTED                automatic on sale completion
      ▼
[7] GATE CHECK (bulk only)          Guard
```

| Step | Purpose | Responsible | Input | Output | Business rules | Exceptions | Approval |
|---|---|---|---|---|---|---|---|
| 1 | Identify what the customer wants | Cashier | Verbal request | Selected product + variation | Product chosen from a list with a photo; never typed free-hand | Product unknown → call Supervisor | – |
| 2 | Confirm it exists before promising | Cashier | System balance | Confirmed availability | Sale is **blocked** if on-hand is insufficient (P-08). Counter display shows quantity in the variation being sold. | Shows zero but stock appears present → do **not** sell; raise a Discrepancy (E-8) | – |
| 3 | Collect payment | Cashier | Cash/e-wallet | Payment received | No goods released before payment, unless a documented credit arrangement exists (Debit module) | Credit sale → Debit module rules apply | Br. Manager for credit |
| 4 | Legal + control document | Cashier | Sale details | Pre-numbered Sales Invoice / OR | BIR-registered serial numbering; every serial accounted for daily | Void → mark VOID, keep all copies | – |
| 5 | Hand over the goods | Cashier | Paid invoice | Goods with customer | Quantity handed over is read back aloud to the customer | Wrong item given → E-7 | – |
| 6 | Record the movement | System | Completed sale | Ledger STOCK OUT, in base units | Automatic; no separate encoding step; sale and stock movement post together or not at all | – | – |
| 7 | Verify large removals at exit | Guard | Goods + invoice | Gate log entry | Applies above a defined quantity/value threshold — a customer walking out with 20 sacks passes a document check | No invoice → stop, call Supervisor | – |

**Counter stock note:** where a display/counter area holds stock separate from the main warehouse, it is a **separate location** with its own bin card and its own replenishment transfer from the warehouse. Untracked counter stock is one of the most common quiet leaks in this type of business.

**Voiding a sale after goods handover (new rule — G-12):** Once goods have physically left the counter, a void or refund of that transaction is **never** a simple reversal. It is processed exactly like a Customer Return (Section 9): the physical goods must be re-presented, inspected, and graded before stock is restored. A void requested with no goods physically returned requires Branch Manager approval and is logged as ADJ-01 (shortage) against the original transaction — never a silent, self-service reversal by the Cashier who processed the original sale. All voided/refunded sales with no matching Return Receiving Report are listed on the Daily Exception Report by Cashier; a disproportionate void rate, especially voids clustered near shift-end or on fast-moving, easily-resold products, triggers an Auditor review.

**Discount authorization (new rule — G-13):** A discount beyond a small, pre-configured threshold ([threshold]% or ₱[value], per Appendix B) requires a Branch Manager PIN entered at the point of sale, in real time, before the transaction completes — never a verbal "it's fine" reviewed later. A Discount Report by Cashier and by approving manager is reviewed weekly; concentration of large discounts under one Cashier–Manager pair is the tell.

**Build-scope note:** this rule describes the business control that must exist whenever discounting is offered at all. In the current 5-phase build plan, retail sale ships in Phase 2 at list price only (no discount capability) — Inventory does not own pricing/discount policy, which belongs to the future POS module. The PIN-gate *mechanism* rides Phase 2's session-security infrastructure (G-30) so it's cheap to activate later, but stays dormant until POS is built and this rule is actually enforceable end-to-end. If the business already discounts at the counter today, flag this — it may need to move earlier than POS.

## 8.2 Wholesale sale (order, pick, deliver)

```
CUSTOMER ORDER (Orders module)
      ▼
[1] ORDER CONFIRMED & CREDIT CHECKED     Salesperson / Br. Manager
      ▼
[2] STOCK RESERVED                        automatic on order approval
      ▼
[3] PICKING LIST ISSUED                   Warehouse Supervisor
      ▼
[4] PICKING                               Picker
      ▼
[5] STAGING IN RELEASE AREA               Picker
      ▼
[6] INDEPENDENT CHECK (blind)             Checker
      ▼
[7] DELIVERY RECEIPT PREPARED             Encoder / Supervisor
      ▼
[8] RELEASE AUTHORIZED                    Warehouse Supervisor
      ▼
[9] LOADING + GATE PASS CHECK             Guard
      ▼
[10] STOCK OUT POSTED                     Encoder, same day
      ▼
[11] DELIVERY & PROOF OF DELIVERY         Delivery module
      ▼
[12] ORDER CLOSED / AR TRIGGERED          Debit module
```

| Step | Purpose | Responsible | Input | Output | Business rules | Exceptions | Approval |
|---|---|---|---|---|---|---|---|
| 1 | Ensure the order is real, priced, and payable | Salesperson; Br. Manager for credit | Customer order | Confirmed Sales Order | No picking against a verbal order. Credit customers pass the Debit module's credit check before reservation. | Over credit limit → Br. Manager decides | Br. Manager |
| 2 | Stop the same stock being promised twice | System | Confirmed order | Stock RESERVED | Reservation is automatic at order approval; reservation expires after N days (default 3) and returns stock to AVAILABLE with notice | Insufficient stock → partial reservation + backorder flag | – |
| 3 | Tell the picker exactly what to pull | Warehouse Supervisor | Confirmed order | Pre-numbered Picking List | Picking List shows product, variation, quantity **in handling units**, and location. It shows the quantity to pick; it does **not** show customer prices. | – | – |
| 4 | Pull the goods | Picker | Picking List | Goods pulled, quantities written on the list | **FIFO/oldest-first** is mandatory. Picker writes the actual picked quantity, which may differ from requested. Picker signs. | Location short → write actual, do not substitute silently; call Supervisor (E-5) | – |
| 5 | Assemble in one controlled place | Picker | Picked goods | Goods staged in the Release Area, tagged with the Picking List number | Staged goods for different orders are physically separated and tagged. Nothing is staged without a tag. | – | – |
| 6 | Independent verification before release | Checker (never the Picker) | Staged goods + source order | Verified quantities | Checker counts the staged goods **against the order**, not against the picker's numbers, and records their own count. Mismatch → correct before release and record the variance (E-2). | Repeated variance by the same picker → Supervisor review | – |
| 7 | Create the release document | Encoder / Supervisor | Verified quantities | Pre-numbered Delivery Receipt (DR) | DR quantities equal **checked** quantities, not ordered quantities. Multi-copy: customer, driver, office, warehouse file. | – | – |
| 8 | Authorize goods to leave custody | Warehouse Supervisor | DR + verified goods | Signed DR + Gate Pass | Supervisor's signature is the transfer of custody. Never pre-signed in blank. **(New — G-10)** For releases above the branch's materiality threshold, the system randomly selects a percentage (recommend 15–20%, weighted toward high-value releases) for an unscheduled, independent spot-recount performed after staging but before loading, by a person with no role in that day's picking, checking, or authorization (Cashier, Branch Manager, or Owner remotely via photo) — with no advance notice of which releases will be spot-checked. | Supervisor absent → Br. Manager | Supervisor |
| 9 | Verify the physical load at the exit | Guard + Driver | Loaded vehicle, Gate Pass | Gate log + driver signature | **(Amended — G-11)** Guard verifies both **package count** and **total load weight** against the expected weight range computed from the DR's declared products and quantities (master data records an expected weight per product/pack size); a variance beyond tolerance blocks exit pending Supervisor investigation. Palletized or bundled staged goods are sealed with a numbered tamper-evident seal recorded on the DR at staging and checked unbroken at the gate (C-08). Driver signs to accept custody. No Gate Pass → no exit, regardless of who says otherwise. | Count or weight mismatch at gate, or a broken/missing seal → unload and recheck; do not release | – |
| 10 | Record the movement | Encoder | Signed DR | Ledger STOCK OUT, base units | Same day, without exception. Reservation is consumed by the release. A live-captured photo of the signed DR is attached at encoding (BR-093, G-01). | Late → Supervisor-approved late-encoding flag | Supervisor |
| 11 | Prove it arrived | Driver / Delivery module | DR copies | Signed POD | Customer signs the DR on receipt; discrepancy claim window (default 48 hours) then closes. **(New — G-14)** Separately, the driver must return the signed POD to the office within a fixed **24-hour internal POD-return SLA**, regardless of whether the customer ever disputes anything. A POD not returned within 24 hours auto-opens a Discrepancy Case naming the driver and route, and the internal comparison of checked-at-release vs. delivered quantity is **never** time-barred by the 48-hour customer claim window — the two are separate controls. A standing "Overdue POD" report, sorted by hours overdue, is reviewed daily by the Branch Manager (Section 14.3). | Refusal / short delivery → E-6 | – |
| 12 | Trigger billing | Debit / AR module | Confirmed delivery | Invoice / AR entry | **AR invoices only what Inventory released and Delivery confirmed** | – | – |

## 8.3 Branch transfer (out)

```
REQUESTING BRANCH RAISES TRANSFER REQUEST
      ▼
SENDING BRANCH MANAGER APPROVES
      ▼
PICK · STAGE · BLIND CHECK          (same as wholesale, steps 4–6)
      ▼
STOCK TRANSFER NOTE (STN) ISSUED
      ▼
RELEASE + GATE PASS
      ▼
STOCK OUT (sending) → state IN TRANSIT   ← still owned by sending branch
      ▼
RECEIVING BRANCH COUNTS ON ARRIVAL       ← blind double count, as at receiving
      ▼
STOCK IN (receiving branch) → AVAILABLE
      ▼
VARIANCE? ─► Discrepancy Case owned by the SENDING branch until resolved
```

| Rule | Detail |
|---|---|
| Ownership in transit | Goods in transit remain on the **sending** branch's books until the receiving branch confirms. This makes losses in transit attributable rather than orphaned. |
| Two approvals | Sending Branch Manager approves the release; receiving Branch Manager (or Supervisor) approves the receipt. |
| No transfer without a request | A branch cannot "push" stock to another branch without a request or an Owner instruction. |
| Transit tolerance | Any transit variance opens a Discrepancy Case automatically — there is no acceptable transit shrinkage. |
| Timeliness | Transfers not confirmed within a set window (default 3 days) are escalated to the Owner. |
| **Independent transit evidence (amended — G-35)** | Transfers above [threshold] value require evidence independent of both branches' own paperwork before the transfer can close: a third-party hauler's waybill where a contracted transporter is used, or — for company-operated vehicles — timestamped, geotagged photographs of the loaded and unloaded states at both ends. The **Auditor**, not either branch, confirms this evidence is present and consistent before the transfer is marked closed (BR-089). Both branches' own STN and gate logs are no longer sufficient by themselves for a transfer above threshold. |

## 8.4 Damage & disposal

```
DAMAGE DISCOVERED (receiving, storage, return, or handling)
      ▼
[1] MOVE TO QUARANTINE IMMEDIATELY            whoever finds it
      ▼
[2] DAMAGE REPORT RAISED (with photo)         Receiver / Picker / Supervisor
      ▼
[3] CAUSE INVESTIGATION                       Warehouse Supervisor
      ▼
   ┌──────────┬──────────────┬───────────────┐
   ▼          ▼              ▼               ▼
SUPPLIER   HANDLING      CUSTOMER        STORAGE /
FAULT      FAULT         FAULT           AGEING
   │          │              │               │
   ▼          ▼              ▼               ▼
CLAIM /   ACCOUNTABLE   CHARGE TO       WRITE-OFF
RETURN    PERSON        CUSTOMER
   └──────────┴──────────────┴───────────────┘
      ▼
[4] DISPOSAL DECISION                         Br. Manager / Owner by value
      ▼
   SELL AS SECONDS  ·  SCRAP/RECYCLE SALE  ·  DESTROY  ·  RETURN TO SUPPLIER
      ▼
[5] PHYSICAL DISPOSAL, WITNESSED              2 witnesses, 1 non-warehouse,
                                               + timestamped photo/video (G-18)
      ▼
[6] STOCK OUT POSTED + DISPOSAL CERTIFICATE   Encoder
```

| Rule | Detail |
|---|---|
| Immediate segregation | Damaged goods move to Quarantine **before** paperwork. Damaged stock left in the aisle gets sold. |
| Evidence | Photo required for every damage report. A phone camera is sufficient. |
| No-fault reporting (new — G-20) | Damage reporting is explicitly **no-fault** for the reporting individual — no disciplinary consequence attaches to timely-reported damage, regardless of cause, to remove the incentive to hide it. The alternative to a document trail is silence, and silence is undetectable by any document control; it can only be closed by making honest reporting cost nothing. |
| Cause is mandatory | Every damage write-off states a cause and, where applicable, an accountable party. "Damaged" alone is not an acceptable reason. |
| Value threshold | Write-offs above threshold require Owner approval (Appendix B). |
| Witnessed destruction (amended — G-18) | Physical disposal is witnessed by two people, one of whom is not warehouse staff, both signing the Disposal Certificate. A Disposal Certificate is additionally invalid without an attached, **timestamped photo or short video of the goods actually being destroyed** (cut, punctured, or otherwise rendered unsellable) at the moment of disposal — not a photo of intact goods "about to be" disposed of. Certificates without compliant evidence do not post the stock-out and remain in FOR DISPOSAL pending it (BR-062). |
| Recyclable value (amended — G-19) | Plastic scrap often has resale value. Proceeds must be recorded as a sale, not pocketed — this is a known leakage point in the industry. Scrap or seconds sales above [threshold] value require either **two comparative quotes on file** or sale through an **Owner-approved buyer list with benchmarked rates**; a sale price significantly below the benchmark rate requires Owner approval before completion. Scrap sale price per kg is trended over time on the monthly damage/return trend review — a sustained, unexplained decline against known regional scrap rates is the tell. |
| Trend monitoring | Damage rate by cause and by person is reviewed monthly. A rising "handling damage" rate concentrated on one person is a finding. A location with unusually *low* reported damage but unusually *high* cycle-count variance is the specific pattern that indicates unreported damage or theft rather than genuine low breakage (Section 12.1). |

---

# 9. Customer Return Process

```
CUSTOMER REQUESTS RETURN
      ▼
[1] VERIFY ORIGINAL SALE            Salesperson / Cashier
      ▼
[2] RETURN AUTHORIZATION (RA)       Branch Manager   ← issued BEFORE goods come back
      ▼
[3] GOODS ARRIVE AT RETURNS AREA    Receiver
      ▼
[4] COUNT AGAINST RA                Receiver + Checker (blind second count)
      ▼
[5] INSPECTION & GRADING            Warehouse Supervisor
      ▼
   ┌───────────────┬──────────────────┬─────────────────┐
   ▼               ▼                  ▼                 ▼
SELLABLE      RE-PACKABLE        DAMAGED           NOT OURS /
                                                    FRAUDULENT
   │               │                  │                 │
   ▼               ▼                  ▼                 ▼
RESTOCK to    REPACK then        DAMAGED state     REJECT, return
AVAILABLE     RESTOCK            → disposal        to customer, log
   └───────────────┴──────────────────┴─────────────────┘
      ▼
[6] RETURN RECEIVING REPORT POSTED   Encoder
      ▼
[7] CREDIT / REFUND TRIGGERED        Debit / AR module
```

| Step | Purpose | Responsible | Business rules | Exceptions | Approval |
|---|---|---|---|---|---|
| 1 | Confirm we actually sold it | Salesperson / Cashier | Original Sales Invoice or DR must be identified. Quantity returnable cannot exceed the quantity sold on that document, less prior returns. **(Amended — G-17)** The remaining returnable quantity per invoice line is a real-time, always-current counter, decremented at RA **issuance** (not at return encoding) and enforced as a hard block across all branches querying the same invoice — not a paper log lookup that can lag behind a same-day double-request. | No document → return is not refused outright, but is flagged **High Risk** and requires Branch Manager approval with a written reason. RA request against an invoice line with zero remaining returnable quantity is a hard rejection, logged with the requester's name. | – |
| 2 | Control what comes back through the door | Branch Manager | **Return Authorization is issued before the goods are physically accepted.** RA is pre-numbered and states product, variation, quantity, reason, and expiry (default 7 days). Goods arriving without an RA are held in the Returns Area, not accepted into stock. **(Amended — G-15)** An RA additionally requires either the **physical original receipt/invoice presented in person**, or the returning party's identity matched against the name/contact on file for that sale — an invoice number recited or phoned in, on its own, is not sufficient. For wholesale-value returns above threshold, valid ID is logged against the RA. | Walk-in return at the counter → Cashier calls Br. Manager for an on-the-spot RA; never accept back into stock without one. An RA issued on invoice-number recall alone, with neither the physical document nor a matching identity, is automatically flagged High Risk regardless of Branch Manager approval and routes to the Auditor within 24 hours (BR-045). | Br. Manager |
| 3 | Keep returns physically separate | Receiver | Returned goods go to the **Returns Area** only — never directly to storage or the sales floor. | – | – |
| 4 | Establish what actually came back | Receiver + Checker | Blind double count as at receiving, using separate Count Slips (G-02). Quantity is verified against the RA, not against what the customer says. | Quantity exceeds RA → accept only up to RA quantity; excess is held pending Br. Manager decision | – |
| 5 | Decide condition honestly | Warehouse Supervisor | Grades: **Sellable** (original packing, clean, undamaged, not sun-aged) · **Re-packable** (good product, damaged outer packing) · **Damaged** (torn, brittle, discoloured, contaminated) · **Not ours** (different brand/gauge/print than we sell — a known fraud pattern). Photo required for anything not graded Sellable. **(New — G-16)** Returns above [threshold] value require **independent double grading**: a second person grades the same item without seeing the first grader's conclusion until both are recorded. A grading disagreement escalates to the Branch Manager before disposition. | Supervisor uncertain → default to Quarantine, escalate to Br. Manager. Never default to Sellable. Grading-agreement rate per Supervisor is tracked over time — a consistently 100%-agreeing second grading is as suspicious as a consistently disagreeing one, since both indicate the second grading isn't genuinely independent. | Supervisor (+ second grader above threshold); Br. Manager for disputes |
| 6 | Record it | Encoder | Return Receiving Report references the RA number and the original invoice. Stock is restored to AVAILABLE **only** for Sellable/Re-packed grades, and only at grading — never at physical arrival. | – | – |
| 7 | Settle the money | Debit / AR | Credit note or refund is issued only after grading is complete. Damaged returns may be credited at a reduced value or refused per policy. | – | Br. Manager |

**Return control rules**

| # | Rule |
|---|---|
| R-1 | Goods physically returned are **not stock** until graded. Between arrival and grading they sit in RETURNED — PENDING INSPECTION. |
| R-2 | The person who authorized the RA should not be the sole inspector for returns above the value threshold. |
| R-3 | Cumulative returns per invoice line can never exceed the quantity originally sold on that line. |
| R-4 | Return reasons come from a fixed list (wrong item · wrong size/gauge · damaged on delivery · defective · over-delivered · customer cancelled · unsold stock return), never free text alone. |
| R-5 | Returns by customer and by product are reviewed monthly. A single customer with a high return rate, or a pattern of "unsold stock" returns, is a commercial and fraud signal. |
| R-6 | Returned goods restocked must be placed to be picked **first** (they are already older stock). |
| R-7 | Returns above the value threshold require independent double grading by two people; the second grader must not see the first grader's conclusion until both are recorded (G-16). |

---

# 10. Inventory Adjustment Process

An adjustment is a stock change with no external counterparty. It is the **most dangerous transaction in the system**, because it is the only one that can create or destroy stock on internal say-so. It is therefore the most heavily controlled.

```
DISCREPANCY DISCOVERED
      ▼
[1] FREEZE THE ITEM                       Warehouse Supervisor
      ▼
[2] RECOUNT (independent, blind)          Checker / Auditor
      ▼
[3] SEARCH & RECONCILE                    Supervisor + Encoder
      │   ← check: unencoded documents, wrong location, wrong variation,
      │      unconfirmed transfers, staged-but-unreleased, returns pending
      ▼
   RESOLVED WITHOUT ADJUSTMENT? ──yes──► close, no ledger change, log the cause
      │ no
      ▼
[4] ADJUSTMENT REQUEST RAISED             Supervisor / Encoder / Br. Manager
      │   (mandatory reason code + evidence)
      ▼
[5] INVESTIGATION / DISCREPANCY CASE      Br. Manager (+ Auditor above threshold)
      ▼
[6] APPROVAL                              Br. Manager or Owner by value (Appendix B)
      ▼
[7] POSTING                               Encoder — adjustment ledger entry
      ▼
[8] BIN CARD CORRECTED + CASE CLOSED      Supervisor
      ▼
[9] POST-REVIEW                           Auditor, monthly
```

## 10.1 Who may do what

| Action | Who | Never |
|---|---|---|
| Request an adjustment | Warehouse Supervisor, Encoder, Branch Manager, Auditor (as a finding) | Picker, Receiver, Cashier, Guard |
| Investigate | Branch Manager; Auditor above threshold | The requester alone |
| Approve | Branch Manager (within threshold); Owner (above) | **Never the requester**, at any value |
| Post | Encoder, only after approval | Anyone, before approval |
| Review after the fact | Auditor, monthly | – |

## 10.2 Allowed reasons (fixed list — free text is supplementary only)

| Code | Reason | Direction | Evidence required |
|---|---|---|---|
| ADJ-01 | Physical count variance — shortage | Negative | Signed count sheet + recount |
| ADJ-02 | Physical count variance — overage | Positive | Signed count sheet + recount |
| ADJ-03 | Damage found in storage | Negative | Photo + Damage Report |
| ADJ-04 | Encoding error correction | Either | Original source document |
| ADJ-05 | Wrong variation / conversion posted | Either | Original source document |
| ADJ-06 | Found stock (previously written off) | Positive | Supervisor statement + location |
| ADJ-07 | Sample / promotional / own use | Negative | Approved requisition |
| ADJ-08 | Expiry / degradation (sun-aged, brittle) | Negative | Photo + Damage Report |
| ADJ-09 | Repacking loss / conversion remainder | Negative | Repacking Record |
| ADJ-10 | Theft / confirmed loss | Negative | Incident report + Owner approval **mandatory** |
| ADJ-11 | **Opening Balance** — a distinct, one-time-per-product transaction type, never an ordinary adjustment (BR-064) | Either | Owner-signed Opening Balance Count Sheet — **allowed once per product, ever, at go-live**; the transaction type is disabled system-wide after that branch's go-live cutover date |

## 10.3 Adjustment control rules

| # | Rule |
|---|---|
| A-1 | An adjustment is **never** the first response to a discrepancy. Step 3 (search and reconcile) must be documented as completed first. Most "missing" stock is misplaced, mis-encoded, or in the Release Area. |
| A-2 | Requester ≠ approver. Always. No value is small enough to waive this. |
| A-3 | Every adjustment carries a reason code from the fixed list. |
| A-4 | Adjustments above the Owner threshold require the Owner's approval **and** an Auditor review before posting. |
| A-5 | ADJ-10 (theft/confirmed loss) always requires Owner approval and a written incident report, regardless of value. |
| A-6 | Adjustments cannot be back-dated into a closed period. A closed period is corrected in the current period with a reference to the original date. |
| A-7 | A posted adjustment cannot be edited or deleted — only reversed by a new, separately approved adjustment. |
| A-8 | Repeated adjustments on the same product, location, or person are flagged automatically and reviewed by the Auditor. Three in a rolling 90 days on the same product/location is an automatic investigation. |
| A-9 | The **net** value and **gross** value of adjustments are both monitored. Offsetting plus/minus adjustments that net to near zero are a classic concealment pattern and must not be allowed to hide in a net figure. |
| A-10 | No adjustment may be used to "balance" the books before a physical count. Counts are recorded first; adjustments follow from them, never precede them. |
| A-11 | **(New — G-21)** Approval-tier routing is based on the **cumulative value of a single requester's adjustments within a rolling 7-day window**, not on individual transaction value alone — the peso thresholds in Appendix B apply to that rolling total, not just to each adjustment line. Once a requester's rolling total crosses a threshold, all adjustments in that window — including already-approved ones below the old threshold — are re-routed for the higher tier of approval. This closes the loophole of splitting one large loss into several smaller adjustments across different products to stay under a per-transaction threshold. A standing "Adjustment Velocity by Requester" report, showing rolling 7/30-day cumulative value per person, is reviewed weekly by the Auditor. |

---

# 11. Warehouse Operational Workflow (Manual)

The warehouse stays manual. Layout and discipline therefore **are** the control system. Physical separation is what prevents mistakes that no software can catch after the fact.

## 11.1 Zone layout

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                         GATE / GUARD POST                       │
   │            all vehicles + all goods pass here, both ways        │
   └───────────────┬─────────────────────────────┬───────────────────┘
                   │ IN                          │ OUT
                   ▼                             ▲
   ┌───────────────────────────┐   ┌─────────────┴───────────────────┐
   │  1. RECEIVING AREA        │   │  5. RELEASE / STAGING AREA      │
   │  numbered lanes, one      │   │  one bay per order, tagged      │
   │  delivery per lane        │   │  with Picking List number       │
   └────────────┬──────────────┘   └─────────────▲───────────────────┘
                ▼                                │
   ┌───────────────────────────┐   ┌─────────────┴───────────────────┐
   │  2. INSPECTION AREA       │   │  4. PICKING AISLES              │
   │  good light, flat table,  │   │  clear aisle labels, FIFO       │
   │  sample-opening bench     │   │  front-picking face             │
   └────────────┬──────────────┘   └─────────────▲───────────────────┘
                ▼                                │
   ┌────────────────────────────────────────────┴────────────────────┐
   │  3. STORAGE AREA                                                │
   │  fixed locations · bin card at every stack · date tags          │
   │  pallets/dunnage off the floor · away from direct sunlight      │
   └─────────────────────────────────────────────────────────────────┘

   ┌───────────────────────────┐   ┌─────────────────────────────────┐
   │  6. QUARANTINE / HOLD     │   │  7. RETURNS AREA                │
   │  locked or roped off,     │   │  incoming customer returns,     │
   │  RED tags, damaged and    │   │  YELLOW tags, ungraded          │
   │  disputed goods only      │   │                                 │
   └───────────────────────────┘   └─────────────────────────────────┘
```

## 11.2 Zone rules

| Zone | Purpose | Rules | Who may enter |
|---|---|---|---|
| **1. Receiving** | Hold arriving goods during counting | Never mixed with approved stock. One delivery per marked lane. Cleared before the next delivery. | Receiver, Checker, Supervisor, supplier crew (supervised) |
| **2. Inspection** | Verify quality and sample-open packs | Good light and a flat surface. Opened sample packs are re-sealed and marked. | Receiver, Supervisor |
| **3. Storage** | Hold available stock | Every stack has a fixed location code, a **bin card**, and a date tag. Stacked off the floor. Kept away from direct sunlight and heat — plastics degrade. Aisles kept clear. | Warehouse staff only |
| **4. Picking aisles** | Pull goods for orders | Oldest stock at the picking face. Picking only against a Picking List. No picking "from memory." | Picker, Supervisor |
| **5. Release / staging** | Hold picked goods pending check and release | Each order in its own bay, tagged with the Picking List number. Nothing staged without a tag. Cleared daily — nothing sleeps in staging. | Picker, Checker, Supervisor, driver (at loading) |
| **6. Quarantine** | Isolate damaged/disputed/held goods | Physically separated and **visibly marked with RED tags**. Locked where possible. Nothing leaves without a Branch Manager signature. | Supervisor, Br. Manager |
| **7. Returns** | Hold incoming returns pending grading | **YELLOW tags.** Never adjacent to sellable stock. Cleared within 48 hours. | Receiver, Checker, Supervisor |

## 11.3 The bin card — the manual warehouse's core control

Every stack has a **physical bin card** (stock card / kardex) hanging on it, updated by hand at every movement.

| Date | Document no. | In | Out | Balance | Initials |
|---|---|---|---|---|---|
| 08/05 | RR-0231 | 2,500 | | 4,300 | JR |
| 08/05 | DR-1188 | | 1,000 | 3,300 | AM |

**Why this matters more than anything else in this section:** the bin card is a record of stock maintained by **warehouse hands**, and the system ledger is a record maintained by the **Encoder from signed documents**. They are two independent records of the same reality. When they agree, stock is almost certainly right. When they disagree, the difference is discovered in **days, not months**, and it points at a specific document, a specific date, and a specific pair of initials. This is the manual substitute for barcode verification, and it costs the price of a printed card.

**Bin card rules**
1. **(Amended — G-07)** One card per product per location, maintained on **numbered, bound pages within a single branch-held ledger book per storage zone** — never on loose or replaceable individual cards. Pages cannot be removed without leaving a visible stub, and every page's opening balance is cross-signed by the Supervisor at issuance. The book stays physically at the zone.
2. Written in ink, at the moment of the movement — never reconstructed later.
3. Every line references a document number. A line without one is itself an exception.
4. Errors: strike through once, write the correction, initial. Never erase, never use correction fluid.
5. Balance is always in the **base unit**.
6. **(Amended — G-07)** A full ledger book is filed, never discarded; a new book carries forward the balance, cross-signed by the Supervisor, and references the old book. Where practical, each day's bin card entries are photographed and timestamp-uploaded at end-of-day close (SOP-08 step 7), creating an external, warehouse-staff-inaccessible copy of that day's card state — a rewritten card cannot be made to match its own photographed history.
7. The Supervisor compares bin card balances to the system on the daily cycle-count sample; the Auditor does so on surprise checks. Any missing page-stub or out-of-sequence page number is a hard exception raised at the next Auditor visit.

## 11.4 Manual work discipline

| Practice | Rule | Why |
|---|---|---|
| **Count aloud in pairs** | The counter says the number aloud; the second person hears it | Catches the "counted 12, wrote 21" transposition, which is the most common manual counting error |
| **Count in fixed groupings** | Stack in tens or in fixed layer patterns; count layers × per-layer | Counting a jumbled pile is where errors and disputes are born |
| **Write in ink, correct by strike-through** | Never erase, never use correction fluid | An erased figure is indistinguishable from a concealed one |
| **One document, one job, finish it** | Do not start a second pick before finishing the first | Interleaved tasks are how goods end up on the wrong order |
| **Tag everything staged** | No untagged goods anywhere outside storage | Untagged goods in the release area are the easiest thing in the warehouse to remove |
| **Nothing leaves without a paper** | No exceptions for staff, family, owner, or urgent customers | The moment one exception is allowed, the control is gone |
| **Clear the release area daily** | Nothing sleeps in staging overnight | Overnight staged goods are unattributable if short in the morning |
| **Personal bags stay outside the warehouse** | Lockers at the entrance | Removes both temptation and suspicion; protects honest staff |
| **Announce every discrepancy immediately** | Same shift, to the Supervisor, before it is "sorted out" | A discrepancy reported late is a discrepancy that cannot be investigated |

---

# 12. Internal Controls

| # | Control | Type | Frequency | Owner | Why it exists |
|---|---|---|---|---|---|
| **C-01** | **Blind double count at receiving** | Preventive | Every delivery | Supervisor | Highest-risk moment: goods exist physically but not yet in any record. Only two independent counts make under-recording detectable. |
| **C-02** | **Blind check count at release** | Preventive | Every release | Supervisor | Prevents over-picking with the surplus diverted, and short-shipping a customer. |
| **C-03** | **Pre-numbered controlled forms** | Preventive | Continuous | Supervisor | A skipped or reused number is the standard way an undocumented removal is concealed. |
| **C-04** | **Daily form accountability** | Detective | Daily | Br. Manager | Every serial issued is accounted for as used, voided, or unused — the day it happens, not at audit time. |
| **C-05** | **Bin card vs. system reconciliation** | Detective | Daily (sample), weekly (zone) | Supervisor / Auditor | Two independent records reconciled — the manual warehouse's substitute for scan verification. |
| **C-06** | **Segregation of duties** (SoD-1…4) | Preventive | Continuous | Owner | No single person can both move goods and control the record of them. |
| **C-07** | **Maker–checker on adjustments** | Preventive | Every adjustment | Owner | Closes the only transaction type that can create or destroy stock internally. |
| **C-08** | **Gate pass control** *(amended — G-11: now verifies package count **and** load weight against expected range, plus tamper-evident numbered seals on palletized/bundled loads, checked unbroken at exit)* | Preventive | Every exit | Guard | The last physical checkpoint. Everything else can be defeated on paper; the gate is physical. A package-count-only check catches a quantity swap but not a contents swap (e.g. a sellable sack substituted for a "damaged" one); weight and seals close that gap. |
| **C-09** | **Negative-stock block** | Preventive | Continuous | System | Forces a shortage into the open at the moment it occurs instead of hiding for months. |
| **C-10** | **Same-day encoding** | Preventive | Daily | Br. Manager | Every hour between the physical event and the record is an hour where the two can diverge unnoticed. |
| **C-11** | **ABC cycle counting** | Detective | Daily rolling | Supervisor | Finds variance in days rather than at the annual count, while the trail is still warm. |
| **C-12** | **Surprise counts by the Auditor** | Detective | Random, ≥ monthly | Owner | Scheduled counts can be prepared for; surprise counts cannot. |
| **C-13** | **Daily exception report to the Owner** *(amended — G-28: generation and delivery configuration is centrally controlled, not editable by any branch-level role including the Branch Manager or System Administrator; delivered via at least two independent channels; the Owner can pull an on-demand equivalent at any time from the same centrally-controlled source)* | Detective | Daily | Owner | Ensures the person with the most to lose sees anomalies without having to ask. A report generated and dispatched by a component the Branch Manager can locally configure can be quietly suppressed or delayed without the Owner noticing a difference between "clean" and "missing." A missing scheduled delivery on any channel is itself logged and alerts the Auditor directly — silence is never treated as clean. |
| **C-14** | **Variance-by-person tracking** | Detective | Monthly | Auditor | Loss patterns are usually concentrated, not evenly distributed. |
| **C-15** | **Supplier performance tracking** | Detective | Monthly | Br. Manager | Separates supplier short-shipment from internal loss — different root causes, different fixes. |
| **C-16** | **Physical zone segregation** | Preventive | Continuous | Supervisor | A status that exists only in the computer will eventually be violated by someone reaching for the nearest sack. |
| **C-17** | **Restricted cost visibility** | Preventive | Continuous | Owner | Limits both commercial leakage and targeting of high-value stock. |
| **C-18** | **Named-user access, no shared logins** | Preventive | Continuous | Sys Admin | Without this, "who did it" is unanswerable and every other control weakens. |
| **C-19** | **Immutable ledger, reversal-only correction** | Preventive | Continuous | System | Prevents retroactive rewriting of history to match a count. |
| **C-20** | **Annual full physical count** | Detective | Yearly | Owner | The definitive check that the whole system is telling the truth. |
| **C-21** | **Off-site backup + tested restore** | Corrective | Daily backup, quarterly restore test | Sys Admin | Typhoon, flood, fire, and theft are real risks in Iloilo. An untested backup is not a backup. |
| **C-22** | **Two-witness disposal** | Preventive | Every disposal | Br. Manager | "Disposal" is otherwise an easy cover for removal. |
| **C-23** | **Reservation expiry** | Detective | Continuous | System | Prevents stock being locked indefinitely by stale orders, hiding real availability. |
| **C-24** | **Staging area cleared daily** | Preventive | Daily | Supervisor | Removes the pool of unattributable goods sitting outside both storage and the ledger. |

## 12.1 Cycle counting design (ABC)

| Class | Definition | Count frequency | Tolerance before investigation |
|---|---|---|---|
| **A** | Top ~20% of products by value moved, plus all theft-prone/small-high-value items | Weekly | 0 units — any variance investigated |
| **B** | Next ~30% | Monthly | ≤ 0.5% of counted quantity |
| **C** | Remaining ~50%, low value, bulky | Quarterly | ≤ 1% of counted quantity |

**Counting rules**
1. Counts are **blind** — the count sheet shows product and location, never the expected quantity (P-14).
2. The counter is never the person with primary custody of that zone that week.
3. **(Amended — G-08)** Counts happen at a time of no movement (before opening or after closing), or the zone is frozen during the count — and for the duration of a scheduled cycle count, the **system blocks generation of new Picking Lists and new Receiving postings branch-wide**, not only for the counted location, unless the Warehouse Supervisor logs a named, reasoned exception (SOP-07). A movement encoded with a timestamp inside a declared count window is auto-flagged as a count-window violation, whichever location it touched.
4. Variance → immediate recount by a different person **before** any adjustment is raised.
5. Variance confirmed above tolerance → Discrepancy Case, not a quiet adjustment.
6. The count is recorded first and adjusted after. Never the reverse (A-10).
7. **(New — G-20)** A cycle-count shortfall on a product/location with **zero damage reports** in the preceding count period is escalated **one severity tier above** an equivalent shortfall where damage was actively being reported — the absence of reporting is itself evidence weighing toward concealment, not toward a cleaner record.
8. **(New — G-25)** Cycle count compliance is itself a tracked, mandatory-SLA metric. Every scheduled count (by ABC class) not completed within its scheduled window is auto-logged as a compliance exception. Two consecutive missed counts on the same product/location auto-escalate to the Owner and force that item to the next Auditor-led surprise count, independent of the branch's own scheduling. A "Cycle Count Compliance %" KPI (O-6, Section 2.1) is tracked on the Owner's dashboard alongside the Shrinkage Rate — sustained decline, or persistent gaps on specific products/locations, is itself the alarm, not a downstream discrepancy.

---

# 13. Exception Handling

Every exception follows the same skeleton: **Stop → Segregate → Document → Escalate → Resolve → Record → Review.**

## 13.1 Exception catalogue

### E-1 — Wrong quantity delivered by supplier
```
Count 1 ≠ Count 2 ?  ──yes──► Third count by Supervisor ──► decisive figure
      │ no
      ▼
Counted ≠ Supplier DR ?
      │ yes
      ▼
SHORT: record ACCEPTED = actual counted. Note shortage on RR.
       Driver signs the shortage. Supervisor raises a supplier claim.
       ► Never post the DR quantity "to be fixed later."
OVER:  within tolerance ─► Supervisor approves, post actual
       above tolerance  ─► Br. Manager decides: accept & bill, or return excess
                           Excess held in QUARANTINE until decided.
```

### E-2 — Wrong quantity at picking / checking
```
Checker's count ≠ order quantity
      ▼
Return to the aisle, re-pick or put back, recount ──► corrected
      ▼
Log the variance against the Picker on the Picking List
      ▼
Same picker, 3 variances in 30 days ──► Supervisor review + retraining
Pattern of one-directional variance ──► Auditor investigation
```

### E-3 — Wrong product / wrong variation
```
Discovered BEFORE release ──► correct, no ledger impact, note on the document
Discovered AFTER release  ──► customer contacted same day
                              ├─ customer keeps it   ─► DR amended by credit/debit note
                              └─ customer returns it ─► RA issued, return process (Sec. 9),
                                                        correct product released as replacement
Discovered in the SYSTEM only (encoding error) ─► ADJ-05, both sides corrected,
                                                   requester ≠ approver
```

### E-4 — Missing or invalid documents
```
Supplier delivery with no DR/invoice
      ▼
Do NOT reject the goods outright (it is often a supplier admin failure)
      ▼
Receive to QUARANTINE under "Documents Pending" — NOT to AVAILABLE
      ▼
Supervisor notes it; Br. Manager notified same day
      ▼
Documents received within 3 days ──► release to AVAILABLE
Documents not received in 3 days ──► return to supplier; escalate to Owner
```

### E-5 — Inventory shortage found during picking
```
Location has less than the Picking List says
      ▼
STOP. Do not substitute. Do not pick from another location silently.
      ▼
Call Supervisor ──► check: other locations · staged for another order ·
                    returns pending grading · unencoded receipt
      ▼
Found elsewhere ──► pick from there, note the location correction, fix the bin card
Not found       ──► partial pick, customer informed via Orders,
                    Discrepancy Case opened for the missing quantity
```

### E-6 — Customer dispute / short delivery claim
```
Customer claims short delivery
      ▼
Within the claim window (default 48h) ?
      │ no ──► claim closed per policy; Br. Manager may allow an exception, in writing
      ▼ yes
Compare: Picking List · Checker's count · DR · Gate Pass · Guard's package count
      ▼
├─ Records agree internally and the DR is signed by the customer
│      ──► claim declined, documented, customer shown the signed DR
├─ Internal records disagree at one step
│      ──► that step and person are identified; Discrepancy Case; customer made whole
└─ Genuine short shipment confirmed
       ──► replacement delivery or credit note; ledger corrected via approved adjustment;
           root cause recorded against the responsible step
```

### E-7 — Encoding error
```
Discovered before end-of-day close ──► void the entry, re-encode, Supervisor initials
Discovered after close             ──► ADJ-04 correcting adjustment,
                                        requester ≠ approver, original stays visible
Repeated errors by one Encoder     ──► retraining; considered in the monthly review
```
> The system never allows a posted entry to be edited into correctness (P-06). Correction is always a new, visible entry.

### E-8 — Lost inventory (system says present, shelf is empty)
```
[1] FREEZE the item — no sales, no picking            Supervisor, immediately
[2] BLIND RECOUNT by someone else                     Checker/Auditor
[3] SEARCH: other locations · staging · returns ·
    quarantine · unconfirmed transfers ·
    unencoded documents · counter/display stock       Supervisor + Encoder
[4] Found ──► correct location record, close, no adjustment; log the cause
[5] Not found ──► DISCREPANCY CASE opened
        ├─ pull every ledger movement since the last verified count
        ├─ list every person who handled the product in that window
        ├─ review gate log for the window
        └─ Br. Manager + Auditor review
[6] Resolution: recovered · supplier-caused · handling-caused · unexplained
[7] Unexplained above threshold ──► Owner approval + ADJ-01/ADJ-10 write-off
[8] Case closed only with a documented cause. "Unknown" is a valid cause
    ONLY with the Owner's signature.
```

### E-9 — Found inventory (shelf has more than the system says)
```
Treated with EQUAL seriousness as a shortage — an overage usually means
an earlier transaction was wrong, and the offsetting shortage is elsewhere.
      ▼
Blind recount ──► confirmed overage
      ▼
Search for the cause: unencoded return · double-encoded release ·
wrong variation conversion · transfer received but not posted ·
another product's stock misplaced here
      ▼
Cause found ──► correct the specific transaction (ADJ-04/05)
Cause not found ──► ADJ-02 positive adjustment, Br. Manager approval,
                     flagged for the Auditor's monthly review
      ▼
NEVER offset a found overage against an unrelated shortage. Each is
recorded separately with its own reason (A-9).
```

### E-10 — System downtime / power failure
```
Brownout, internet loss, hardware failure, typhoon
      ▼
[1] REVERT TO PAPER IMMEDIATELY — operations do not stop.
    All processes in this document work on paper; only encoding pauses.
      ▼
[2] Supervisor records the downtime start time in the Downtime Log
      ▼
[3] Manual availability check uses the BIN CARDS (this is exactly why they exist)
      ▼
[4] Releases during downtime require SUPERVISOR authorization on every
    document, and bin card update is mandatory before the goods move
      ▼
[5] On restoration: encode all pending documents in DOCUMENT NUMBER ORDER,
    flagged "late encoding" with the downtime reference
      ▼
[6] Reconcile bin cards to the system before the next day's operations begin
      ▼
[7] Downtime exceeding one business day ──► Owner notified; a bin-card-based
    interim count of Class A items before resuming normal releases
```

### E-11 — Damaged delivery
```
Damage visible on arrival ──► do not accept into the receiving lane;
                              photograph on the truck, note on the DR,
                              driver signs, quantity rejected
Damage found during inspection ──► accept good quantity, quarantine damaged,
                                   photo + Damage Report, supplier claim raised
Damage found after putaway ──► Damage Report; cause investigation
                               determines supplier vs. handling fault (Sec. 8.4)
```

### E-12 — Suspected theft
```
[1] Do NOT confront on the spot. Do NOT announce.
[2] Report privately to the Branch Manager, who informs the Owner the same day.
[3] Preserve evidence: documents, gate log, bin cards, the physical area.
[4] Owner authorizes a surprise count of the affected products by the Auditor.
[5] Findings documented in a Discrepancy Case before any accusation is made.
[6] Any write-off uses ADJ-10 and requires the Owner's approval.
[7] Personnel action is the Owner's decision, guided by Philippine labour law
    and due process; the inventory record is corrected regardless of the outcome.
```

---

# 14. Daily Operations

## 14.1 Morning opening

| Time | Activity | Responsible | Output |
|---|---|---|---|
| T-30 min | Unlock, walk the warehouse, visually check for tampering, water, pest, or fire damage | Supervisor + Guard | Opening walkthrough note |
| T-25 | Confirm the release/staging area is **empty** as it was left | Supervisor | Confirmed or exception raised immediately |
| T-20 | Check quarantine and returns areas: contents match yesterday's list | Supervisor | Confirmed or exception |
| T-15 | Issue form booklets for the day; record starting serial numbers | Supervisor | Form Control Log |
| T-10 | Review yesterday's open items: pending encodings, open cases, unconfirmed transfers | Br. Manager | Day's priority list |
| T-5 | Toolbox brief: expected deliveries, priority orders, yesterday's errors, one control reminder | Supervisor | Team briefed |
| T-0 | Open | – | – |

## 14.2 Normal operations (continuous rules)

1. Deliveries are received as they arrive; the receiving lane is cleared before the next delivery is unloaded.
2. Picking runs against issued Picking Lists only; each is completed before the next begins.
3. Every movement updates the bin card **at the moment of movement**.
4. Encoding runs continuously through the day, not saved for the evening — an Encoder facing 40 documents at 5 PM makes mistakes.
5. Every discrepancy is reported to the Supervisor **within the shift it is discovered**.
6. The staging area is worked down through the day; nothing waits for tomorrow.
7. The Supervisor performs the day's cycle count sample during a quiet period.

## 14.3 End-of-day closing

| Step | Activity | Responsible | Rule |
|---|---|---|---|
| 1 | All source documents collected and sequenced | Encoder | Every document from every booklet, in order |
| 2 | **Form accountability**: every serial issued today is used, voided, or returned unused | Supervisor + Br. Manager | Any unaccounted serial stops the close until explained |
| 3 | All documents encoded | Encoder | **Zero pending encodings** is the standard |
| 4 | Staging area confirmed empty; anything left is documented with a reason | Supervisor | Nothing sleeps in staging |
| 5 | Quarantine and returns contents listed and signed | Supervisor | Carried forward to tomorrow's opening check |
| 6 | Cycle count sample results recorded; variances raised | Supervisor | Counted first, adjusted after |
| 7 | Bin cards for today's moved products compared to the system | **(Amended — G-26)** A person who did **not** personally receive, release, or encode transactions for that product that day — the Cashier, a rotating staff member, or, where branch staffing makes on-site independence impossible, the Owner reviewing the photographed bin card and system export remotely | Mismatches raised as exceptions today, not tomorrow. Reconciliation sign-off is logged with the reviewer's identity and their role relationship to that day's transactions; any reconciliation signed off by someone who also performed a transaction being reconciled is excluded from "clean close" counts and routed to the Auditor. |
| 8 | Daily reconciliation prepared and signed | Encoder → Br. Manager | Below |
| 9 | Exception report sent to the Owner | Br. Manager | Sent daily whether or not anything is wrong |
| 10 | Warehouse locked; gate log closed | Supervisor + Guard | Closing walkthrough note |

## 14.4 Daily reconciliation

```
    Opening balance (yesterday's closing, from the system)
  + Stock in today   (receipts + returns restocked + positive adjustments + transfers in)
  − Stock out today  (retail + wholesale + damage write-offs + negative adjustments + transfers out)
  = Expected closing balance
                    ▼
        Compare against: bin cards of all products moved today
                    ▼
        AGREE ────────► Br. Manager signs the daily reconciliation
        DISAGREE ─────► exception raised TODAY, resolved or escalated before opening tomorrow
```

## 14.5 Daily reports

| Report | Audience | Purpose |
|---|---|---|
| Daily Stock Movement Summary | Br. Manager | Everything in and out today, by document |
| **Daily Exception Report** | **Owner** | Adjustments, count variances, blocked negative-stock attempts, late encodings, unaccounted forms, overdue transfers, open cases, overdue PODs (G-14), emergency role-collapse elevations (G-29). Centrally generated and delivered on ≥ 2 independent channels, not configurable by any branch role (C-13, G-28). |
| Pending Encoding List | Br. Manager | Must be empty at close |
| Low Stock / Out of Stock | Br. Manager, Owner | Reorder action |
| Open Discrepancy Cases | Owner, Auditor | Ageing investigations |
| Form Accountability Sheet | Br. Manager | Every serial accounted for |

## 14.6 Weekly and monthly rhythm

| Cycle | Activity |
|---|---|
| **Weekly** | Class A cycle count · zone bin-card reconciliation · adjustment review by Br. Manager · supplier variance review · staging/quarantine ageing review |
| **Monthly** | Class B cycle count · Auditor's surprise count · variance-by-person and variance-by-location analysis · damage and return trend review · supplier scorecard · slow/dead stock review · form booklet audit |
| **Quarterly** | Class C cycle count · full internal control self-assessment · backup restore test · role and access review |
| **Annually** | Full physical inventory count · policy and threshold review · full audit |

---

# 15. Multi-Branch Readiness

## 15.1 Principles

| # | Principle | Reason |
|---|---|---|
| MB-1 | **Stock is owned by exactly one branch at all times.** | Shared, unowned stock is stock nobody is accountable for. |
| MB-2 | **Every branch is a separate custody unit** with its own locations, bin cards, form booklets, and reconciliation. | Accountability must be traceable to a specific team. |
| MB-3 | **Goods in transit belong to the sending branch** until the receiving branch confirms. | Makes transit losses attributable rather than orphaned. |
| MB-4 | **Transfers require approval on both ends.** | Prevents "pushing" stock to hide a variance at the sending branch. |
| MB-5 | **Product master data, units, and conversion rates are global; prices and stock are per branch.** | A sack must mean 500 pieces everywhere, or consolidated reporting is meaningless. |
| MB-6 | **Every document number carries a branch code.** | Prevents duplicate numbers across branches and identifies origin instantly. |
| MB-7 | **Users belong to a branch**; cross-branch visibility is an explicit permission. | Least privilege scales with the branch count. |
| MB-8 | **Each branch reconciles daily on its own; the Owner sees consolidated figures.** | Local accountability, central oversight. |

## 15.2 Inter-branch transfer flow

```
BRANCH B (needs stock)                          BRANCH A (has stock)
        │
        │ [1] Transfer Request ─────────────────────►
        │                                    [2] Br. Manager A approves
        │                                            │
        │                                    [3] Pick · Stage · Blind Check
        │                                            │
        │                                    [4] Stock Transfer Note (STN) issued
        │                                            │
        │                                    [5] Release + Gate Pass
        │                                            │
        │                                    [6] STOCK OUT posted at A
        │                                        state: IN TRANSIT (owned by A)
        │                                            │
        │  ◄──────────── goods travel ───────────────┘
        │
   [7] Blind double count on arrival at B
        │
   [8] Match ──► STOCK IN posted at B, state AVAILABLE, transfer closed
        │
   [9] Variance ──► Discrepancy Case owned by BRANCH A until resolved;
                    B posts only what it actually received
```

## 15.3 Multi-branch controls

| Control | Detail |
|---|---|
| Transit ageing | Any transfer unconfirmed beyond the window (default 3 days) appears on the Owner's daily exception report. |
| Transit variance | Zero tolerance — any difference opens a case automatically. |
| **Independent transit evidence (amended — G-35)** | Transfers above [threshold] value require transit evidence independent of both branches' own paperwork — a third-party waybill, or timestamped/geotagged photos of loading and unloading — confirmed present and consistent by the **Auditor** before the transfer closes (BR-089). Two branches under common informal trust cannot rely on each other's own STN and gate logs alone to substantiate a transfer above threshold. |
| Cross-branch visibility | A branch sees other branches' stock as availability only (for sourcing decisions); it can never transact on it. |
| Consolidated reporting | The Owner sees total stock, total value, and variance **by branch** — branch comparison is itself a control, since one branch consistently out of line is a finding. |
| Branch opening | A new branch starts with a counted, approved Opening Balance (ADJ-11), signed by the Owner, posted through the dedicated Opening Balance transaction type (BR-064). Opening balances are a one-time, per-product event, and the transaction type is disabled once that branch's go-live cutover has passed. |
| Rotation | Where practical, supervisors and counters rotate between branches periodically — long-unrotated custody is a known risk factor. |

---

# 16. Future ERP Integration

Inventory is the **stock authority**. Other modules request; Inventory decides and records.

```
   ORDERS ──── "reserve 10 sacks" ────► INVENTORY ──► yes/no + reservation ID
   ORDERS ──── "release order #123" ──► INVENTORY ──► release document
   INVENTORY ─ "stock released" ──────► DELIVERY  ──► dispatch & POD
   DELIVERY ── "delivered/confirmed" ─► INVENTORY ──► closes the movement
   INVENTORY ─ "released + confirmed" ► DEBIT/AR  ──► invoice
   POS ─────── "sold 3 bundles" ──────► INVENTORY ──► stock out + block if unavailable
   POS ─────── "customer return" ─────► INVENTORY ──► return process
```

| Module | Inventory provides | Inventory requires | Hard boundary |
|---|---|---|---|
| **Orders** | Available-to-promise quantity (available minus reserved); reservation confirmation and expiry; partial-availability response | An approved order document before any reservation; a cancellation signal to release reservations | Orders can never change stock quantity — only reserve and request release |
| **Delivery** | Released goods with a release document listing exact quantities per line | Proof of delivery, or documented return of undelivered goods to the warehouse | Delivery cannot alter released quantities; a difference is a return or a discrepancy case, never an edit |
| **Store / POS** | Live sellable quantity per variation; hard block when insufficient; price per variation | A completed sale, or a completed void, as a single atomic event | POS cannot sell what Inventory does not have; POS cannot adjust stock |
| **Debit / AR** | Confirmed released and delivered quantities; cost basis for margin | Nothing operationally; AR must not invoice beyond what Inventory confirms | AR can never trigger a stock movement |
| **Purchasing (future)** | Reorder alerts, consumption rates, supplier short-shipment history | Approved purchase orders to receive against | Purchasing cannot post stock; only a receipt does |
| **Accounting (future)** | Valuation, cost of goods sold, write-off values, adjustment register | Approval authority for write-offs above threshold | Accounting cannot change quantities — only how they are valued |

**Integration rules**

| # | Rule |
|---|---|
| I-1 | Inventory is the single source of truth for quantity. No module keeps its own stock count. |
| I-2 | Every stock change originating in another module still creates a normal Inventory movement, with the same rules, approvals, and audit trail. |
| I-3 | Reservation and release are separate events. Reserving is a promise; releasing is a movement. |
| I-4 | A movement request that violates an Inventory rule is **rejected**, whatever module it came from. Inventory rules are not overridable by a calling module. |
| I-5 | Every cross-module movement carries the originating document reference, so any movement can be traced back to the order, sale, or delivery that caused it. |
| I-6 | Modules are added without changing Inventory's rules. If a new module requires an exception to these rules, the exception is a business decision requiring Owner approval and an amendment to this document — not a software workaround. |

---

# 17. Business Rules

## 17.1 Stock integrity

| # | Rule |
|---|---|
| BR-001 | Stock quantity is always the sum of recorded movements. There is no function anywhere that sets a quantity directly. |
| BR-002 | Every stock change requires a transaction of a defined type. |
| BR-003 | Every transaction references a pre-numbered source document. |
| BR-004 | Every transaction records who performed it and when. |
| BR-005 | Stock can never be negative. A movement that would cause it is blocked. |
| BR-006 | **(Amended — G-22)** A transaction that would drive computed stock below zero is held in a blocked state and does **not** post under any circumstance without a **real-time Owner approval captured in the system before posting** (a live mobile push-approval, not an after-the-fact narrative). There is no "post now, approve later" state for this rule, unlike ordinary late-encoding (BR-020) — no retroactive or narrative approval path exists for negative-stock overrides. Every override attempt, approved or not, is logged with full context and appears on the same day's exception report. Same-SKU/location overrides recurring more than once in 30 days force a mandatory Discrepancy Case before any further override is possible for that SKU/location, regardless of Owner willingness to approve. |
| BR-007 | Stock is held in exactly one base unit per product. |
| BR-008 | All movements are converted to the base unit before posting. |
| BR-009 | Stock is tracked per branch and per location, never at company level only. |
| BR-010 | Only AVAILABLE stock is sellable. Reserved, staged, quarantined, returned-ungraded, damaged, and in-transit stock is not. |
| BR-011 | Available-to-promise = AVAILABLE − RESERVED. Never the raw on-hand figure. |

## 17.2 Documents and records

| # | Rule |
|---|---|
| BR-012 | Posted transactions cannot be edited. **(Amended — G-27)** The stock ledger is additionally maintained as a **hash-chained, append-only structure at the database layer**, independent of application-level access controls — each row's hash incorporates the previous row's hash, so altering any historical entry breaks every subsequent hash and is mathematically detectable. This closes the gap left by "no edit" being only an application-layer rule: it defends against a compromised administrator credential, a rogue database administrator, or direct database access that bypasses the application entirely. The chain's terminal hash is exported and distributed outside the system — to the Owner and Auditor, via a channel neither the System Administrator nor branch staff control — at the close of each business day. Chain verification (recomputing the hash chain and comparing to the externally-published daily hashes) is run monthly by the Auditor, or automated with alerting on any mismatch. |
| BR-013 | Posted transactions cannot be deleted. |
| BR-014 | Corrections are new, opposite entries referencing the original. |
| BR-015 | All controlled forms are pre-numbered, sequential, and gapless. **(Amended — G-06)** Controlled-form booklets are additionally **ordered and range-registered centrally by the Owner or Auditor**, never by branch operational staff (including the Warehouse Supervisor, who holds the booklets day-to-day but does not control their supply). A branch may not put a new booklet into circulation unless its number range is confirmed against the central registry; any document number encoded outside a registered range is a hard system rejection, not a warning. The registry is reconciled to the printer's own delivery record quarterly by the Auditor. |
| BR-016 | Voided documents are retained, marked VOID on every copy, and accounted for. **(Amended — G-05)** A Receiving Report specifically may only be voided **before** goods leave the Receiving Area unhandled, or — if goods were already inspected/counted — only together with a logged Return-to-Supplier gate exit of matching quantity, verified by the Guard. A void meeting neither condition requires Owner approval and automatically opens a Discrepancy Case (Section 7.2, Step 7). Every VOID document is cross-referenced monthly against gate exit logs for a matching outbound movement; any VOID RR with no matching outbound gate record within 48 hours is an automatic exception requiring retroactive Owner sign-off, with the goods' current physical location accounted for. |
| BR-017 | Every issued serial number is accounted for daily as used, voided, or unused. |
| BR-018 | A document number can be used once. Re-use is blocked by the system. **(Amended — G-34)** This uniqueness is enforced by a **hard database-level unique constraint** on (branch code, document type, sequence number) — not solely by application/UI-layer validation. Any write path, including direct API access or data migration tooling, is subject to the same constraint with no bypass. A rejected duplicate-key write is logged and reviewed alongside duplicate-submission attempts (BR-093). |
| BR-019 | Transactions are encoded on the day they physically occur. |
| BR-020 | Late or back-dated encoding requires Supervisor approval, states a reason, and is flagged in reports. |
| BR-021 | A closed accounting period cannot be posted into. Corrections post in the current period referencing the original date. |
| BR-022 | Records are retained for at least 10 years (Philippine BIR requirement) and are never purged from the system. |
| BR-023 | Sales invoices and official receipts follow BIR-registered serial numbering; their numbers are recorded against the stock movements they cause. |
| BR-093 | **(New — G-01)** No stock-affecting transaction may be posted without an attached, timestamped image of its signed source document, captured live through the encoding terminal/app at the point of encoding — never uploaded from a gallery or a prior capture. The system stores the document's total for later independent comparison. A transaction submitted without a valid live-captured attachment is held in a "pending — no evidence" state and excluded from available stock until resolved by a Supervisor. This rule is additionally idempotent per Section 5.3 — a resubmission carrying an already-used document key does not create a second entry. A weekly, Auditor-run sample of posted transactions cross-checks typed quantity against photographed quantity; any mismatch is a same-day Discrepancy Case naming the Encoder. |

## 17.3 Receiving

| # | Rule |
|---|---|
| BR-024 | Goods are not stock until counted, inspected, and approved. |
| BR-025 | **(Amended — G-02)** Every receipt requires two independent counts; the second is blind. The two counts are recorded on **separate, independently numbered Count Slips**, submitted directly to the Supervisor by each counter without passing through or being shown to the other counter. An RR is invalid — and blocked from encoding — unless both underlying Count Slip numbers are recorded on it. A counter-pair whose counts match exactly on every delivery over a rolling 90 days (15+ deliveries) is auto-flagged for Auditor review as a statistical anomaly. |
| BR-026 | **(Amended — G-03)** Count differences are settled by a third count from the Supervisor, and the variance is recorded. This tie-break count requires a **witnessed second recording by any other on-duty employee**, logged by name on the RR. The system logs, for every tie-break, whether the Supervisor's resolved figure equals the higher count, the lower count, or neither, and computes a rolling per-Supervisor bias ratio; a Supervisor whose resolutions land at or below the lower count more than 60% of the time over a rolling 20 tie-breaks is auto-flagged. |
| BR-027 | Accepted quantity is what was physically counted, never what the supplier's document states. |
| BR-028 | Shortages are recorded against the supplier, never absorbed. |
| BR-029 | Overages beyond tolerance require Branch Manager approval before posting. |
| BR-030 | Rejected goods move physically to Quarantine before the paperwork is completed. |
| BR-031 | A receipt cannot post without product, variation, quantity, location, receiver, and unit cost. **(Amended — G-04)** A Receiving Report for a delivery with **no matching Purchase Order**, or above the three-way-match materiality threshold, additionally cannot be approved to AVAILABLE until the office has logged an **independent supplier confirmation** — a call-back to a supplier contact on file, never sourced from the delivery paperwork itself. This closes the gap where a plausible but forged or duplicated DR, matched only against a physical count of the same (possibly stolen or diverted) goods, would otherwise pass every internal control. |
| BR-032 | Zero-cost receipts are blocked (free goods are recorded at a nominal or allocated cost with Branch Manager approval). |
| BR-033 | Goods received without supplier documents go to Quarantine, never to AVAILABLE. |
| BR-034 | Receipt approval and receipt recording are performed by different people. |

## 17.4 Releasing

| # | Rule |
|---|---|
| BR-035 | Nothing is picked without an approved order and an issued Picking List. |
| BR-036 | Picked goods are independently checked before release by someone other than the picker. |
| BR-037 | Release requires Supervisor authorization. |
| BR-038 | Nothing leaves the premises without a Gate Pass verified at the exit. |
| BR-039 | Delivery Receipt quantities equal checked quantities, never ordered quantities. |
| BR-040 | Retail sales cannot complete when stock is insufficient. |
| BR-041 | Goods are released only against payment or an approved credit arrangement. |
| BR-042 | Picking follows FIFO/oldest-first. Exceptions require Supervisor approval with a reason. |
| BR-043 | Staged goods not released by end of day are returned to storage or documented with a reason. |
| BR-044 | Reservations expire after the configured period and return stock to AVAILABLE, with notice to Orders. |

## 17.5 Returns

| # | Rule |
|---|---|
| BR-045 | Physical returns require a Return Authorization issued **before** acceptance. **(Amended — G-15)** An RA additionally requires either the **physical original receipt/invoice presented in person**, or the returning party's identity matched against the name/contact on file for that sale. An RA issued on invoice-number recall alone — with neither the physical document nor a matching identity — is automatically flagged High Risk regardless of Branch Manager approval, and routes to the Auditor within 24 hours. |
| BR-046 | Returned quantity cannot exceed the quantity sold on the referenced document, less prior returns. **(Amended — G-17)** The remaining returnable quantity per invoice line is decremented in **real time at RA issuance**, not at return encoding, and is enforced as a **hard block** — not merely a rule to be checked manually — across all branches querying the same invoice. |
| BR-047 | Returns are stock only after grading, never on arrival. |
| BR-048 | Grading uses a fixed list of grades; anything not clearly sellable defaults to Quarantine. |
| BR-049 | Returns without a traceable original sale are accepted only with Branch Manager approval and are flagged high-risk. |
| BR-050 | Photo evidence is mandatory for any return not graded Sellable. |
| BR-051 | Restocked returns are placed to be picked first. Independent double-grading above threshold (G-16) is captured in Section 9, rule R-7. |

## 17.6 Adjustments and write-offs

| # | Rule |
|---|---|
| BR-052 | Every adjustment requires approval by someone other than the requester. |
| BR-053 | Every adjustment carries a reason code from the fixed list. |
| BR-054 | **(Amended — G-21)** Adjustments above threshold require Owner approval. Approval-tier routing is based on the **cumulative value of a single requester's adjustments within a rolling 7-day window**, not on individual transaction value alone (Section 10.3, A-11) — once a requester's rolling total crosses a threshold, all adjustments in that window, including already-approved ones below the old threshold, are re-routed for the higher tier of approval. This prevents a loss being split across several products, each individually under threshold, to evade Owner-level scrutiny. |
| BR-055 | Theft/confirmed-loss adjustments always require Owner approval regardless of value. |
| BR-056 | An adjustment may only be raised after a documented search-and-reconcile step. |
| BR-057 | Physical counts are recorded before any adjustment is raised, never after. |
| BR-058 | Shortages and overages are recorded separately and are never netted against each other. |
| BR-059 | Adjustments cannot be edited or deleted, only reversed by a further approved adjustment. |
| BR-060 | Three or more adjustments on the same product/location within 90 days trigger an automatic investigation. |
| BR-061 | Damage write-offs require a photo and a stated cause. |
| BR-062 | **(Amended — G-18)** Physical disposal is witnessed by two people, one from outside the warehouse, both signing. A Disposal Certificate is additionally **invalid without an attached, timestamped photo or video** showing the goods in a destroyed/unsellable state at the moment of disposal — a photo of intact goods "about to be" disposed of does not satisfy this rule. Certificates without this evidence do not post the stock-out and remain in FOR DISPOSAL status pending compliant evidence. |
| BR-063 | Proceeds from scrap or seconds sales are recorded as sales, never treated as informal income. Sales above [threshold] value require two comparative quotes on file or sale through an Owner-approved buyer list with benchmarked rates (G-19). |
| BR-064 | **(Amended — Opening Balance procedure, identified separately from the fraud audit)** Opening balances are posted through a **distinct, one-time-per-product "Opening Balance" transaction type** (ADJ-11) — never an ordinary adjustment, and never any other transaction type. It is: (a) permanently, structurally distinguishable from an ordinary adjustment in the ledger (its own transaction type, not merely a reason code that could be reused later); (b) **approval-gated** — it requires a physical opening count and is **Owner-signed** before posting, exactly as an Owner-signed adjustment would be, but recorded as its own document (Opening Balance Count Sheet); (c) permitted **once per product**, ever, at go-live — a product that has already received its Opening Balance can never receive a second one; any further correction to that product's stock uses an ordinary adjustment (ADJ-01/02) with its own investigation trail, not a second "opening" entry; (d) the Opening Balance transaction type is **disabled system-wide after the go-live cutover date** for a branch (or, for a new branch under MB-8/Section 15.1, after that branch's own cutover) — it cannot be invoked at all once cutover has passed, closing off the possibility of a stale "opening balance" being used months later to quietly launder an unexplained variance. |

## 17.7 Products and variations

| # | Rule |
|---|---|
| BR-065 | Every product has exactly one base unit, defined at creation. |
| BR-066 | The base unit **cannot be changed** once any movement exists for that product. |
| BR-067 | Every variation declares a conversion rate to the base unit, greater than zero. |
| BR-068 | A conversion rate **cannot be edited** once used in a posted transaction. A changed pack size is a **new variation**; the old one is archived. **(Amended — G-32)** A new or changed conversion rate additionally cannot be **activated for any transaction** until a **physical verification count** is recorded against it — a full unit (a sack, a box) counted out to its base units, witnessed and signed by two people **independent of whoever proposed the rate**. The verification record (who counted, what they found, date) is retained permanently alongside the rate and cannot be edited once the rate is used, exactly as the rate itself. Periodically (recommend quarterly, or triggered by any unexplained shrinkage on a specific product), the physical verification count is re-run for that product's active conversion rates and compared to the recorded verification, catching a supplier-side pack-size change made without notice. **(Conversion-factor versioning — identified separately, closely related to G-32)** Every conversion rate carries an **effective date**, and a changed rate is recorded as a new, dated version rather than a silent replacement — the system can always show which rate applied to which historical transaction by date, even though a "changed pack size" is structurally a new variation (above). The witnessed physical verification count is required before **any** new or changed rate — new variation or re-versioned rate alike — is activated; this closes both the creation-time gap (a wrong rate typed once and then permanently locked in by this same rule) and the change-over-time gap (a supplier quietly changing a pack size that nobody re-verifies). |
| BR-069 | The number of variations per product is unlimited. |
| BR-070 | Each variation has its own selling price, optional barcode, and status. |
| BR-071 | Products and variations are archived, never deleted. |
| BR-072 | Archived variations cannot be used in new transactions but remain visible in history. |
| BR-073 | Products, categories, and variations are created and archived by staff without developer involvement. |
| BR-074 | Selling price changes are logged with user, timestamp, and old/new values. |
| BR-075 | Barcodes, where present, are optional conveniences — the process never depends on them. |
| BR-076 | Physically breaking a larger pack into smaller units is recorded as a **Repacking Record** (it does not change base-unit quantity, but it changes physical form and must be reflected on the bin card). |
| BR-077 | Any material loss during repacking is recorded as ADJ-09 with approval. |

## 17.8 Roles and access

| # | Rule |
|---|---|
| BR-078 | Every user has a unique named account. Shared accounts are prohibited. |
| BR-079 | Every user has exactly one primary role per branch. |
| BR-080 | Nobody approves their own transaction, at any value, in any process. |
| BR-081 | The Auditor is read-only in the system. |
| BR-082 | The System Administrator cannot post or approve stock transactions. |
| BR-083 | Cost and margin data are visible only to Owner, Branch Manager, and Auditor. |
| BR-084 | Every login, approval, override, master-data change, and data export is logged. |
| BR-085 | Accounts of departed staff are deactivated the same day, never deleted, and never reassigned. **(Amended — G-31)** Deactivation additionally triggers an **automatic audit of all open items** associated with that user — pending approvals awaiting their action, Discrepancy Cases assigned to them, unresolved requests they raised. Each is auto-escalated to their manager and the Auditor **within 24 hours** of deactivation, with mandatory reassignment before the item can be closed. A standing report of open items tied to deactivated accounts targets zero within 24 hours; anything older is a direct Owner-visible exception. |
| BR-086 | A user's role change is logged and takes effect prospectively; historical records keep the role held at the time. |

## 17.9 Multi-branch

| # | Rule |
|---|---|
| BR-087 | Every stock quantity belongs to exactly one branch. |
| BR-088 | Transfers require approval at both the sending and receiving branch. |
| BR-089 | Goods in transit remain on the sending branch's books until confirmed received. **(Amended — G-35)** Transfers above [threshold] value additionally require **transit evidence independent of both branches' internal paperwork** — a third-party hauler's waybill, or timestamped/geotagged photographic evidence of loading and unloading — attached before the transfer can close. The **Auditor**, not either branch, confirms this evidence is present and consistent before a transfer is marked closed in the system. This closes the gap where two branches under common informal trust could use fictitious transfers to mutually explain away a real shortage, since neither branch's own paperwork is, by itself, an independent check. |
| BR-090 | Transfer variances open a Discrepancy Case automatically, owned by the sending branch. |
| BR-091 | Document numbers include a branch code. |
| BR-092 | Product master data and conversion rates are global; prices and stock are per branch. |

---

# 18. Standard Operating Procedures

Each SOP is written to be posted on the wall at the place it is performed.

## SOP-01 — Receiving a supplier delivery
**Who:** Receiver (with Checker and Supervisor) · **When:** every delivery · **Form:** Receiving Report (RR)

1. Confirm the Guard has logged the vehicle and that the supplier's delivery document is in hand.
2. Direct the crew to unload into **one marked receiving lane only**. Never into storage.
3. Write on a new RR: date, time, supplier, supplier DR number, PO number if any.
4. Write the **expected** quantity per line from the PO/DR **before counting**.
5. Count each line in the handling unit (sacks, boxes, bundles). Count aloud. Count in fixed groupings. Write in ink.
6. **(Amended — G-02)** Write your figures on your own **pre-numbered Count Slip** and hand it **directly to the Supervisor only** — not to the Checker, and not spoken aloud where the Checker can hear. Where the lane layout allows it, count from the opposite end or side of the delivery from the Checker.
7. Checker counts independently on a **separate, independently numbered Count Slip** and submits it directly to the Supervisor, without comparing notes with the Receiver.
8. **(Amended — G-03)** The Supervisor reconciles both Count Slips onto the RR only once both are physically in hand; record both Count Slip numbers on the RR. If the two counts differ, the Supervisor counts a third time — with a **second on-duty employee witnessing and independently recording** what they observe the Supervisor count. Both the Supervisor's and witness's figures are recorded, and the Supervisor's figure is decisive; note the difference and the witness's name.
9. Inspect quality: gauge/thickness, colour and print, no yellowing or brittleness, packaging intact and dry. Open at least 1 pack per 20 (minimum 1) and verify the count inside; record which pack was opened.
10. Record Accepted and Rejected quantities per line with a reason for any rejection.
11. Move rejected goods to **Quarantine (RED tags)** immediately.
12. Complete the RR; sign it; obtain the Checker's and Supervisor's signatures; have the driver sign any variance.
13. Give the RR to the Encoder **the same day**.
14. **(New — G-01)** Encoder captures a **live photograph or scan of the signed RR** through the encoding terminal/app itself — never from a gallery upload — and attaches it before the transaction can post.
15. Put away accepted goods to the assigned location, **new stock behind or under old stock**.
16. Update the **bin card** at the stack: date, RR number, quantity in, new balance.

**Never:** unload into storage · count with the first count visible · show or speak your count to the other counter before both slips reach the Supervisor · accept the supplier's number without counting · post stock before approval or without a live-captured document photo · leave rejected goods in the receiving lane.

## SOP-02 — Storage and putaway
**Who:** Receiver / Picker · **When:** after every receipt or restock

1. Take goods to the location written on the RR. If it is full, ask the Supervisor for an alternate and write it on the RR.
2. Place new stock **behind or under** existing stock (FIFO).
3. Keep goods off the floor on pallets or dunnage.
4. Keep plastics out of direct sunlight and away from heat.
5. Do not block aisles or fire exits.
6. Attach or update the date tag on the stack.
7. Update the bin card immediately.
8. Report any damage found during putaway to the Supervisor before storing it.

## SOP-03 — Picking
**Who:** Picker · **When:** against an issued Picking List

1. Accept only a Picking List issued and signed by the Supervisor.
2. Work one Picking List at a time to completion.
3. Go to the stated location; confirm the product name **and** the variation.
4. Take the **oldest** stock first (front picking face / lowest date tag).
5. Count as you pull. Count aloud.
6. Write the **actual** picked quantity on the list, even if it differs from what was requested.
7. If the location is short: **stop**. Do not substitute. Do not take from another location. Call the Supervisor.
8. Update the bin card: date, document number, quantity out, new balance.
9. Move the goods to the Release Area, into one bay, and attach the tag with the Picking List number.
10. Sign the Picking List and hand it to the Checker.

**Never:** pick without a list · pick from memory · substitute a different variation · pick newest stock · leave goods untagged.

## SOP-04 — Checking and releasing
**Who:** Checker, then Supervisor, then Guard · **When:** before every release

1. **Checker:** take the customer order (not the picker's figures) and count what is staged.
2. Record your count. If it differs from the order, return to step 1 of SOP-03 with the Picker to correct it, and record the variance against the Picker.
3. Confirm the variation is correct, not just the quantity — a bundle is not a ream.
4. Sign the Picking List as Checker.
5. **Encoder/Supervisor:** prepare the Delivery Receipt using the **checked** quantities.
6. **Supervisor:** verify the DR against the staged goods, then sign to authorize release and issue the Gate Pass. **(New — G-10)** If this release is selected for the random independent spot-recount, wait for the spot-checker (uninvolved in today's picking/checking) to recount before loading proceeds.
7. **Driver:** count the packages being loaded and sign the DR to accept custody.
8. **(Amended — G-11)** **Guard:** at the exit, count packages **and** weigh the load against the Gate Pass and the expected weight range for its declared contents; check any tamper-evident seal on palletized/bundled loads is unbroken; log the vehicle out and keep the gate copy.
9. **Encoder:** post the stock-out movement the same day, with a live-captured photo of the signed DR attached (G-01).
10. Update the bin card if not already updated at picking.

**Never:** release without a Checker's count · pre-sign a blank DR or Gate Pass · let a vehicle leave without a gate check, a weight check, or with a broken seal.

## SOP-05 — Handling customer returns
**Who:** Cashier/Salesperson → Br. Manager → Receiver/Checker → Supervisor

1. Identify the original Sales Invoice or DR. Confirm the quantity is within what was sold — the system's real-time remaining-returnable counter (G-17) enforces this as a hard block.
2. **(Amended — G-15)** Request a **Return Authorization** from the Branch Manager **before** accepting the goods — the returning party must present the **physical original receipt/invoice in person** or have their identity matched against the name/contact on file for that sale; an invoice number recited or phoned in alone is not enough and auto-flags the RA High Risk.
3. Receive the goods into the **Returns Area (YELLOW tags)** only.
4. Count against the RA — blind double count on separate Count Slips, as at receiving (G-02).
5. **(Amended — G-16)** Supervisor grades each item: Sellable · Re-packable · Damaged · Not ours. Above [threshold] value, a **second person independently grades the same item** without seeing the first grader's conclusion until both are recorded; a disagreement escalates to the Branch Manager.
6. Photograph anything not graded Sellable.
7. Sellable/Re-packed → restock, placed to be picked first, bin card updated.
8. Damaged → Quarantine (RED tags), Damage Report raised.
9. Not ours → refuse, return to customer, log the incident and inform the Branch Manager.
10. Encoder posts the Return Receiving Report referencing the RA and original invoice.
11. Credit or refund is triggered only after grading.

**Never:** accept a return into stock without an RA · put returns straight onto the shelf · grade Sellable when unsure.

## SOP-06 — Requesting and approving an adjustment
**Who:** Supervisor/Encoder (request) → Br. Manager/Owner (approve) → Encoder (post)

1. **Do not raise an adjustment first.** Freeze the item and recount blind, by a different person.
2. Search: other locations · staging · quarantine · returns · unconfirmed transfers · unencoded documents · counter stock.
3. Document the search on the Adjustment Request, whatever the outcome.
4. If found: correct the location record, close the matter, no ledger adjustment.
5. If not found: complete the Adjustment Request with reason code, quantity, product, location, and evidence.
6. Route to the approver — **never yourself**. Above threshold, route to the Owner. If your own rolling 7-day cumulative adjustment value has crossed a threshold (A-11), the system re-routes automatically to the higher tier regardless of this line's own value.
7. **(Amended — G-23)** Approver reviews the evidence and the search documentation, then approves or rejects **in writing** — this physical signature is not sufficient by itself. The approver must **also** perform a distinct, individually-authenticated **system approval action** (their own login credentials, ideally with a PIN or biometric step), separate from an already-open session. An adjustment posted with a signature but no matching system-side approval event does not post and is flagged for Owner review.
8. Encoder posts only after approval, referencing the approved request number.
9. Supervisor corrects the bin card to match.
10. Auditor reviews all adjustments monthly for pattern and repetition.

## SOP-07 — Cycle counting
**Who:** Supervisor or assigned counter (never that zone's primary custodian) · **When:** per the ABC schedule

1. Print the count sheet: product and location only — **no expected quantity**.
2. **(Amended — G-08)** Freeze movement for the products being counted, or count outside operating hours. For the duration of the count window, the **system blocks new Picking Lists and new Receiving postings branch-wide**, not only for the counted location — a Supervisor may log a named, reasoned emergency exception, but this is not routine.
3. Count physically. Count aloud. Count in fixed groupings. Write in ink.
4. Include partially opened packs, counted as loose base units — never assumed full.
5. **(Amended — G-24)** The moment counting finishes, the sheet is **collected immediately by a third party not involved in either count**, or photographed and submitted through the system on the spot — the counter does not retain physical custody of their own sheet afterward and does not get a chance to compare results with the other counter before both are logged. Sign and submit the count sheet **before** seeing the system figure.
6. Supervisor compares against the system.
7. Variance within tolerance → record and close.
8. Variance above tolerance → **recount by a different person**, blind, then follow SOP-06.
9. Record every count, including those with zero variance — the clean counts are what make the variances meaningful.

## SOP-08 — Daily closing
**Who:** Encoder → Supervisor → Branch Manager

1. Collect every source document from the day and arrange in number order.
2. Complete form accountability: every issued serial used, voided, or returned unused.
3. Encode everything. **Pending encodings must be zero.**
4. Confirm the release/staging area is empty; document any exception.
5. List quarantine and returns contents; sign; carry forward to tomorrow's opening.
6. Record the day's cycle count results.
7. **(Amended — G-26, G-07)** Photograph today's closing bin card entries for the day's moved products and upload them, then compare bin cards against the system. This comparison is performed or independently re-verified by **someone who did not personally receive, release, or encode** transactions for that product today; where staffing makes on-site independence impossible, send the photographed bin card and system export to the Owner for remote review before the close is final.
8. Prepare the daily reconciliation (opening + in − out = closing).
9. Branch Manager reviews and signs.
10. Send the exception report to the Owner — every day, whether or not there are exceptions.
11. Lock the warehouse; close the gate log.

## SOP-09 — Weekly cycle count review
**Who:** Branch Manager with Supervisor · **When:** weekly

1. Review all Class A count results for the week.
2. Review every adjustment raised: reason, requester, approver, value.
3. Review variance by person and by location.
4. Review ageing items: quarantine over 7 days, returns over 48 hours, transfers unconfirmed over 3 days, open cases.
5. Review supplier variance for the week.
6. Assign corrective actions with named owners and dates.
7. Send the summary to the Owner.

## SOP-10 — Monthly physical count
**Who:** Auditor leads; teams of two; Branch Manager oversees · **When:** monthly for Class B; annually for everything

1. Announce the freeze window. No receiving or releasing during the count; anything unavoidable goes into a clearly marked "count exception" lane and is counted separately.
2. Ensure all documents are encoded and the staging area is empty **before** counting begins.
3. Issue blind count sheets by zone. Each team counts a zone that is not its own.
4. Count, in pairs, aloud, in fixed groupings, in ink.
5. Second team performs a blind recount of a sample (minimum: all Class A items and 10% of everything else).
6. Submit all sheets before any system figures are revealed.
7. Compare to the system; list every variance with its value.
8. Recount every variance above tolerance before any adjustment is proposed.
9. Investigate variances above the investigation threshold as Discrepancy Cases.
10. Owner approves the final adjustment schedule; the Encoder posts it as a batch, each line with its reason code.
11. Correct all bin cards to match.
12. Issue the count report: total variance, variance %, by product, by location, by class, versus prior periods.

---

# 19. Risk Analysis

Likelihood and Impact: **H**igh · **M**edium · **L**ow. Rating assumes controls are **absent**; the mitigation column brings the residual risk down.

| # | Risk | L | I | Primary mitigation | Preventive controls |
|---|---|---|---|---|---|
| **R-01** | **Employee theft — small, repeated** (a bundle at a time) | H | H | Blind double counts + bin card vs. system reconciliation + ABC cycle counts on small-high-value items | C-01, C-02, C-05, C-08, C-11, C-12; personal bags outside; gate control |
| **R-02** | **Employee theft — collusion** (picker + checker, or receiver + driver) | M | H | Role rotation, surprise counts by an independent Auditor, variance-by-person analysis, Supervisor spot-checks that follow no pattern | C-06, C-12, C-14; rotation; SoD-3 |
| **R-03** | **Under-recording at receipt** (goods arrive, less is recorded, the difference walks) | M | H | Blind second count at receiving; Supervisor physically spot-checks one line of every delivery | C-01, BR-025, BR-034 |
| **R-04** | **Encoding errors** (transposition, wrong variation) | H | M | Confirmation screen showing both entered and base-unit quantities; same-day encoding; daily bin card reconciliation | U-4, C-05, C-10 |
| **R-05** | **Wrong variation / conversion error** (5 sacks entered as 5 pieces) | H | H | Quantities entered in the handling unit with the base-unit result displayed for confirmation; conversion rates locked after first use | BR-067, BR-068, U-3, U-4 |
| **R-06** | **Supplier short-shipment** billed as full | M | M | Count-before-accept; shortage recorded against the supplier; supplier scorecard | C-15, BR-027, BR-028 |
| **R-07** | **Customer return fraud** (returning goods not bought here, or already-damaged goods) | M | M | RA before acceptance; original invoice matching; grading with photos; "not ours" grade | BR-045, BR-046, BR-049, R-5 |
| **R-08** | **Shrinkage from damage and degradation** (sun, moisture, crushing, pests) | H | M | Storage discipline, FIFO, off-floor storage, out of sunlight, dead-stock review | SOP-02, C-11, monthly damage trend |
| **R-09** | **Paper documents lost before encoding** | M | H | Pre-numbered forms + daily accountability of every serial; zero-pending-encoding close | C-03, C-04, C-10, BR-017 |
| **R-10** | **Staff bypass the system and revert to paper** | H | H | Extreme UX simplicity, training, Owner's daily exception report, no releases accepted without a system-generated document once live | U-1…U-9; parallel-run rollout; management enforcement |
| **R-11** | **Encoder becomes a single point of failure** (only one person can operate the system) | H | M | At least two trained encoders per branch; **(amended — G-29)** in a genuine emergency the Supervisor may encode only under a real-time, Owner-granted, time-boxed elevation that auto-expires at end of day and flags every transaction under it for priority review — never a self-declared "the Encoder is out" workaround; written SOPs posted | Cross-training; SOP-08; Section 4.4 emergency elevation rule |
| **R-12** | **System downtime / brownout** (common in the region) | H | M | Full paper fallback that is already the working process; bin cards give availability without the system; UPS on the office PC | E-10, C-05; UPS; mobile data backup line |
| **R-13** | **Data loss** (fire, flood, typhoon, theft of the PC, ransomware) | M | H | Daily off-site/cloud backup with a **tested** quarterly restore | C-21 |
| **R-14** | **Unauthorized access / shared passwords** | H | H | Named accounts, role-based access, logged actions, immediate deactivation of departed staff | BR-078, BR-085, C-18 |
| **R-15** | **Management override** (owner or manager instructs a bypass) | M | H | Every override logged and reported; Auditor reports directly to the Owner; overrides visible on the daily exception report | C-13, BR-084; documented override policy |
| **R-16** | **Adjustment abuse** (repeated small "corrections" that hide removals) | M | H | Maker–checker on every adjustment; gross **and** net monitoring; automatic flag at 3 in 90 days | C-07, A-8, A-9, BR-060 |
| **R-17** | **Ghost stock** (records show stock that has not existed for months) | M | H | Negative-stock block; cycle counting; bin card reconciliation; investigation of every variance | C-09, C-11, C-05 |
| **R-18** | **Stockout of fast movers** (lost sales, customer goes to a competitor) | H | M | Reorder points, low-stock alerts, consumption-rate reporting | Reorder point per product; daily low-stock report |
| **R-19** | **Dead stock / obsolescence** (capital locked in unsellable plastic) | M | M | Dead-stock report, monthly slow-mover review, clearance decisions | Monthly review; ageing report |
| **R-20** | **Operational delay from new controls** (double counting slows receiving; staff cut corners) | H | M | Time the process during rollout, staff appropriately, keep the count in handling units, accept a slightly slower receipt as the cost of accuracy | O-2 target; measure and tune, but **never** waive C-01 or C-02 |
| **R-21** | **Regulatory / BIR non-compliance** (invoice serials, retention) | L | H | BIR-registered serial numbering; 10-year retention; no deletion | BR-022, BR-023 |
| **R-22** | **Key-person dependency in the warehouse** (only one person knows where things are) | M | M | Fixed locations, bin cards, labelled aisles, written SOPs, rotation | SOP-02, C-05; location discipline |

---

# 20. Recommendations

Ordered by impact-per-peso. All are achievable in a traditional manual warehouse.

## 20.1 Do first (low cost, high impact)

| # | Recommendation | Why it matters |
|---|---|---|
| 1 | **Install bin cards on every stack.** Printed cards, string, ballpoint pens. | The single highest-value control available without technology. Creates a second independent record, so errors surface in days instead of at the annual count. Cost: negligible. |
| 2 | **Adopt blind double counting at receiving and release.** | Replaces barcode verification. Two independent counts make both honest error and deliberate under-recording detectable. Adds minutes; prevents the largest loss channel. |
| 3 | **Move to pre-numbered, controlled forms with daily accountability.** | Converts "we lost the paper" into a same-day, answerable question. A local print shop can produce numbered booklets cheaply. |
| 4 | **Paint and label the zones.** Receiving lanes, release bays, quarantine, returns — with RED and YELLOW tags. | Physical separation prevents entire categories of mistake that no system can catch afterwards. Cost: paint, rope, printed tags. |
| 5 | **Enforce a Gate Pass at the exit, with no exceptions for anyone.** | The last physical checkpoint. Everything upstream can be defeated on paper; the gate cannot. |
| 6 | **Send the Owner a daily exception report.** | Ensures the person with the most to lose sees anomalies daily without asking. Almost free once the system exists. |
| 7 | **Fix locations and label the aisles.** | Ends key-person dependency; makes counting and picking faster and verifiable. |
| 8 | **Post the SOPs on the wall in Hiligaynon and English, with pictures.** | Training that does not depend on memory or on one senior staff member being present. |

## 20.2 Do during implementation

| # | Recommendation | Why |
|---|---|---|
| 9 | **Enter quantities in handling units; let the system convert.** | Removes the single most dangerous manual step — mental conversion — and eliminates the "5 sacks entered as 5 pieces" error class. |
| 10 | **Use picture-based product selection.** | Non-readers and senior staff can select correctly; virtually eliminates wrong-product entry. |
| 11 | **Confirm every posting in plain language.** "5 SACKS of Tiny Plastic = 2,500 pieces. Correct?" | Catches errors before posting, when correction is free. |
| 12 | **Train and certify two encoders per branch.** | Removes the single point of failure that would otherwise sink the whole system on one person's sick day. |
| 13 | **Run parallel (paper + system) for 4 weeks, then paper as source only.** | Builds confidence, exposes process gaps, and gives a fallback while staff learn. |
| 14 | **Start with a clean, counted, owner-signed opening balance.** | A system started on wrong numbers produces variances forever and loses staff trust in month one. |
| 15 | **Put a UPS on the office PC and keep a mobile-data backup line.** | Brownouts are routine; an interrupted posting mid-transaction is a data-integrity problem. |
| 16 | **Configure cheap phone-camera photo capture for damage and returns.** | Evidence for supplier claims and return disputes at zero incremental hardware cost. |

## 20.3 Do after stabilisation (3–12 months)

| # | Recommendation | Why |
|---|---|---|
| 17 | **ABC-classify the catalogue and set count frequencies accordingly.** | Focuses counting effort where the money and the theft risk are. |
| 18 | **Introduce supplier scorecards.** | Separates supplier short-shipment from internal loss — two different problems with two different fixes. |
| 19 | **Rotate custody and counting assignments periodically.** | Long-unrotated custody is a recognised risk factor; rotation also spreads knowledge. |
| 20 | **Set reorder points on the top 50 products.** | Converts stockouts from a recurring surprise into a managed alert. |
| 21 | **Review the adjustment register monthly with the Owner present.** | Nothing deters adjustment abuse like the Owner reading every line, by name, every month. |
| 22 | **Consider optional barcode labels for the highest-value items only** — printed in-house, scanned with a phone. | Not required by this design. Worth adding *only after* the manual disciplines are solid; a scanner layered on weak process discipline just automates the errors. |
| 23 | **Publish a monthly one-page scorecard**: shrinkage %, count accuracy %, adjustments (gross and net), open cases, stockouts. | Makes progress visible and keeps attention on the goal after the initial enthusiasm fades. |

## 20.4 What NOT to do

| # | Anti-recommendation | Why |
|---|---|---|
| A | **Do not add a "quick edit stock" function**, however often it is requested. | It defeats every control in this document. Every such request has a legitimate underlying need that an existing transaction type already covers. |
| B | **Do not allow shared logins** to "save time." | It makes "who did it" permanently unanswerable and quietly voids every other control. |
| C | **Do not waive the blind second count when busy.** | The busiest days are exactly when errors and removals happen. |
| D | **Do not let the system show the expected quantity on a count sheet.** | A confirming count is not verification. |
| E | **Do not net shortages against overages** to make the monthly figure look better. | It conceals two separate problems behind one clean number. |
| F | **Do not buy scanners, RFID, or a WMS before the manual disciplines hold for six months.** | Technology on top of weak process discipline produces faster, more confident errors. |

---

# Appendix A — Document register & numbering

Format: `TYPE-BRANCH-YEAR-SEQUENCE` — e.g. `RR-ILO-2026-000231`

| Code | Document | Created by | Approved by | Copies |
|---|---|---|---|---|
| PO | Purchase Order | Br. Manager / Owner | Owner | Supplier, office, warehouse |
| RR | Receiving Report | Receiver | WH Supervisor | Warehouse, office, supplier (variance) |
| QTN | Quarantine Tag / Note | Receiver / Supervisor | Br. Manager (to release) | Attached to goods, office |
| RTS | Return to Supplier | Supervisor | Br. Manager | Supplier, office, warehouse |
| SO | Sales Order (Orders module) | Salesperson | Br. Manager (credit) | Customer, office |
| PL | Picking List | WH Supervisor | — | Warehouse |
| DR | Delivery Receipt | Encoder / Supervisor | WH Supervisor | Customer, driver, office, warehouse |
| GP | Gate Pass | WH Supervisor | WH Supervisor | Gate, driver |
| SI/OR | Sales Invoice / Official Receipt (BIR) | Cashier | — | Customer, office (BIR serials) |
| RA | Return Authorization | Br. Manager | Br. Manager | Customer, warehouse, office |
| RRR | Return Receiving Report | Receiver | WH Supervisor | Warehouse, office |
| DMG | Damage Report | Anyone finding damage | WH Supervisor | Warehouse, office |
| DSP | Disposal Certificate | Supervisor | Br. Manager / Owner | Office, warehouse, witnesses |
| IAV | Inventory Adjustment Voucher | Supervisor / Encoder | Br. Manager / Owner | Office, warehouse |
| CCS | Cycle Count Sheet | Supervisor | Br. Manager | Office |
| PIC | Physical Inventory Count Sheet | Auditor | Owner | Office |
| STR | Stock Transfer Request | Receiving branch | Sending Br. Manager | Both branches |
| STN | Stock Transfer Note | Sending branch | Sending Br. Manager | Both branches, driver |
| DCR | Discrepancy Case Record | Supervisor / Auditor | Br. Manager / Owner | Office |
| RPK | Repacking Record | Supervisor | WH Supervisor | Warehouse |

---

# Appendix B — Approval matrix

Peso thresholds are **placeholders for client confirmation** (see Open Questions). Values are per transaction, at cost.

| Transaction | ≤ ₱1,000 | ₱1,001 – ₱10,000 | > ₱10,000 |
|---|---|---|---|
| Receipt within PO tolerance | WH Supervisor | WH Supervisor | Br. Manager |
| Receipt over PO tolerance | Br. Manager | Br. Manager | Owner |
| Receipt without supplier documents | Br. Manager | Br. Manager | Owner |
| Retail sale | Cashier | Cashier | Br. Manager |
| Wholesale release (cash) | WH Supervisor | WH Supervisor | Br. Manager |
| Wholesale release (credit) | Br. Manager | Br. Manager | Owner |
| Customer return | Br. Manager | Br. Manager | Owner |
| Return without original invoice | Br. Manager | Owner | Owner |
| Inventory adjustment | Br. Manager | Br. Manager | Owner |
| Damage write-off | Br. Manager | Br. Manager | Owner |
| Theft / confirmed loss (ADJ-10) | **Owner** | **Owner** | **Owner** |
| Disposal | Br. Manager | Br. Manager | Owner |
| Branch transfer | Br. Manager (both ends) | Br. Manager (both ends) | Owner + both managers |
| Negative-stock override | **Owner** | **Owner** | **Owner** |
| Price change | Br. Manager | Br. Manager | Owner |
| Conversion-rate creation (new variation) | Owner | Owner | Owner |

**Universal rule:** the requester never approves, at any value, in any row above.

---

# Appendix C — Base unit & variation worked example

**Product:** Tiny Plastic · **Base unit:** PIECE (fixed permanently at creation, BR-066)

| Variation | Conversion to base | Selling price | Barcode | Status |
|---|---|---|---|---|
| Per Piece | 1 | ₱1.50 | optional | Active |
| Per Bundle | 20 | ₱28.00 | optional | Active |
| Per Ream | 100 | ₱130.00 | optional | Active |
| Per Sack | 500 | ₱600.00 | optional | Active |
| Per Box | 1,000 | ₱1,150.00 | optional | Active |
| Per Carton | 5,000 | ₱5,500.00 | optional | Active |

**Receiving 5 sacks**
```
Receiver enters:  5 SACKS
System shows:     5 × 500 = 2,500 PIECES   ── "Receiving 5 SACKS of Tiny Plastic
                                                = 2,500 pieces. Correct?"
Ledger records:   +2,500 PIECES
Bin card records: +2,500, new balance in PIECES
```

**Selling 3 bundles from the same stock**
```
Cashier enters:   3 BUNDLES
System shows:     3 × 20 = 60 PIECES
Ledger records:   −60 PIECES
Balance:          2,500 − 60 = 2,440 PIECES
Displayed as:     4 sacks + 4 reams + 2 bundles + 0 pieces  (or simply 2,440 pieces)
```

**Key points**
1. There is **one** stock pool: 2,440 pieces. There is no separate "sack stock" or "bundle stock."
2. Availability for any variation is derived: sacks available = 2,440 ÷ 500 = 4 whole sacks (with 440 pieces remaining).
3. Physically opening a sack to sell loose pieces does **not** change the base-unit quantity. It changes physical form and is recorded as a **Repacking Record** (BR-076) so the bin card and the physical count stay consistent. Any loss during repacking is ADJ-09.
4. Adding "Per Pack of 250" tomorrow is a new variation with conversion 250 — no change to existing stock, history, or software.
5. If the supplier changes a sack from 500 to 480 pieces, that is a **new variation** (BR-068). The old one is archived. The conversion rate on a used variation is never edited, because doing so would silently rewrite the quantity of every historical transaction that used it.

---

# Appendix D — Glossary

| Term | Meaning |
|---|---|
| **Base unit** | The single unit in which all stock is held and counted (e.g. PIECE) |
| **Variation** | A sellable/handling form of a product with a conversion rate to the base unit (sack, ream, box) |
| **Conversion rate** | How many base units one variation contains |
| **Bin card / stock card** | The handwritten card at each stack showing every movement and the running balance |
| **Blind count** | A count performed without knowledge of the expected or previously counted quantity |
| **Maker–checker** | The rule that the person performing an action is never the person approving it |
| **Segregation of duties (SoD)** | Splitting a process so no single person controls it end to end |
| **Available-to-promise** | AVAILABLE minus RESERVED — the quantity that can still be sold |
| **Discrepancy Case** | A formal, closeable investigation opened when a variance exceeds tolerance |
| **Cycle count** | A rolling partial count of selected products, done without stopping operations |
| **FIFO / oldest-first** | Issuing the oldest stock first |
| **Quarantine** | Physically segregated area for damaged, disputed, or held goods |
| **Gate pass** | The document authorizing goods to physically leave the premises |
| **Form accountability** | Confirming every pre-numbered form issued is used, voided, or unused |
| **Shrinkage** | Loss of inventory with no matching transaction |
| **Suki** | Regular/loyal customer, typically with informal credit terms |
| **Utang** | Credit / amount owed (handled by the Debit/AR module) |

---

# Appendix E — Open questions for the client

These must be answered before the build begins; each changes the process, not just a setting.

| # | Question | Why it matters |
|---|---|---|
| 1 | Do retail and wholesale draw from the **same** stock pool, or should stock be ring-fenced per channel? | Determines whether reservations are needed for retail and how available-to-promise is calculated. |
| 2 | What peso thresholds should apply in Appendix B? | Sizes the entire approval structure and determines how often the Owner is interrupted. |
| 3 | How many staff are available per branch, and can the four irreducible separations (SoD-1…4) be maintained today? | If not, the compensating controls in Section 4.4 become mandatory from day one. |
| 4 | Who fills the **Auditor** role? A family member, an outside accountant, or the Owner personally? | Independence is what makes the detective controls work. Without an independent Auditor, Section 12 weakens materially. |
| 5 | What is the acceptable claim window for wholesale delivery disputes — 24, 48, or 72 hours? | Determines when a delivery record locks and when a shortage becomes non-recoverable. |
| 6 | Are there products requiring **batch/lot** tracking (supplier lot, production date)? | Plastics may need it for gauge/quality claims; it changes the receiving form. |
| 7 | Which products are considered high-theft or high-value and need Class A treatment? | Sets the cycle count schedule. |
| 8 | Is there existing BIR-registered invoice/receipt numbering in use, and what are the current series? | Section 17.2 must align with what the BIR has already authorized. |
| 9 | How many branches are planned, and over what horizon? | Determines whether multi-branch is configured at go-live or later. |
| 10 | Who currently holds the warehouse keys, and who will hold them after go-live? | Custody accountability starts with physical access. |
| 11 | Is there a reliable internet connection at the warehouse, or must the system work offline-first? | Determines the downtime procedure's weight (E-10) and the technical approach. |
| 12 | Should the Owner's daily exception report go by SMS, email, or a messaging app? | Determines whether C-13 is actually read every day, which is the entire point of it. |

---

**End of document.**

*Approved by:* ______________________ (Owner) · *Date:* ______________
*Reviewed by:* ______________________ (Branch Manager) · *Date:* ______________

*Amendments to this document require the Owner's written approval. The software is built to enforce this document; where they disagree, this document governs until formally amended.*
