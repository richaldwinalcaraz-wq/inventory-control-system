# Inventory Management System — Architecture & Workflow Design

**Status:** Draft for review · **Version:** 0.2 · **Date:** 2026-08-10
**Objective:** Eliminate unexplained inventory loss by making every unit traceable from the moment it enters the warehouse to the moment it leaves.

**v0.2 revision note:** v0.1 assumed barcode/QR scan-to-confirm as the primary verification mechanism at every handoff. The client has since confirmed the warehouse stays fully manual — no scanners, RFID, or automated equipment (see `business-process-design.md`, the governing process document). This revision removes that assumption throughout and replaces it with the BPD's manual controls (blind double counts on independent slips, bound numbered bin cards, gate weight-range checks, tamper-evident seals). It also defers to the BPD for role definitions and step-by-step workflow detail (this document is now scoped to schema, ledger design, and tech stack — not process), and replaces the Phased Rollout in [Section 15](#15-phased-rollout) with the current 5-phase build plan. The ledger design in [Section 5](#5-the-inventory-ledger-the-single-source-of-truth) is schema/scanning-agnostic and is unchanged.

---

## 1. Executive Summary

The client's core business problem is that inventory units go missing without anyone being able to say **when**, **who**, or **which transaction** caused it. Every design decision in this document is subordinate to that objective. The single most important architectural choice is in [Section 5](#5-the-inventory-ledger-the-single-source-of-truth): stock levels are never stored as a number that gets directly edited — they are always the *sum of an immutable history*. Everything else (workflows, dashboard, reports, roles) is built on top of that ledger.

Secondary objectives — dynamic products/categories/variants, a dashboard, exportable reports, and room to plug in Sales/Purchasing/Accounting/Warehouse modules later — are addressed in the sections that follow, but none of them are allowed to compromise the ledger's integrity.

---

## 2. Architecture Overview

A **modular monolith**, not microservices — one system, four internally-separated layers, so a future split into standalone Sales/Purchasing/Accounting services doesn't require a rewrite:

```mermaid
flowchart TB
    subgraph presentation["Presentation"]
        UI["Dashboard · Manual Data-Entry & Counting UI · Reports UI"]
    end
    subgraph application["Application"]
        WF["Workflow Orchestration<br/>(receiving, dispatch, returns, cycle count)"]
        RPT["Reporting Engine"]
    end
    subgraph domain["Domain"]
        LEDGER["Stock Ledger<br/>(append-only movements)"]
        CATALOG["Product / Variant / Category Catalog"]
        RULES["Approval & Validation Rules"]
    end
    subgraph data["Data Access"]
        DB[("PostgreSQL")]
        EVENTS["Outbox / Event Log"]
    end

    UI --> WF
    UI --> RPT
    WF --> LEDGER
    WF --> RULES
    RPT --> LEDGER
    LEDGER --> CATALOG
    LEDGER --> DB
    LEDGER --> EVENTS
    EVENTS -. future .-> SALES["Sales module"]
    EVENTS -. future .-> PURCH["Purchasing module"]
    EVENTS -. future .-> ACCT["Accounting module"]
```

Dependencies point inward only: presentation depends on application, application depends on domain, nothing in the domain layer (the ledger, the catalog, the rules) knows anything about HTTP, React, or PDF generation. This is what lets Sales/Purchasing/Accounting/Warehouse be added later as consumers of the same domain events instead of bolt-ons that reach into the database directly (see [Section 13](#13-future-integration-hooks)).

---

## 3. Core Domain Model

At the center of the schema are five families of tables. Full field-level detail for each is in the sections that follow; this is the map.

```mermaid
erDiagram
    PRODUCT ||--o{ PRODUCT_VARIANT : "has"
    CATEGORY ||--o{ PRODUCT : "classifies"
    PRODUCT_VARIANT }o--|| UNIT_OF_MEASURE : "sold in"
    PRODUCT_VARIANT ||--o{ STOCK_LEDGER : "moves via"
    WAREHOUSE ||--o{ WAREHOUSE_LOCATION : "contains"
    WAREHOUSE_LOCATION ||--o{ STOCK_LEDGER : "records at"
    BATCH_LOT ||--o{ STOCK_LEDGER : "tracked by"
    SUPPLIER ||--o{ PURCHASE_ORDER : "receives"
    PURCHASE_ORDER ||--o{ DELIVERY : "fulfilled by"
    DELIVERY ||--o{ STOCK_LEDGER : "posts"
    RETURN ||--o{ STOCK_LEDGER : "posts"
    STORE_REQUEST ||--o{ STOCK_LEDGER : "posts"
    SALES_ORDER ||--o{ STOCK_LEDGER : "posts"
    ADJUSTMENT ||--o{ STOCK_LEDGER : "posts"
    USER ||--o{ STOCK_LEDGER : "performs"
    APPROVAL }o--|| STOCK_LEDGER : "authorizes (when required)"
```

Every arrow into `STOCK_LEDGER` is one-directional and append-only — a delivery, return, dispatch, or adjustment *creates* ledger rows; none of them ever edit a row that already exists.

---

## 4. Product, Category, Variant & Unit-of-Measure Design

### 4.1 Dynamic categories
`category` is a self-referencing table (`parent_category_id`) so users can create unlimited categories and subcategories without a developer. Categories are **archived, never hard-deleted** (`archived_at` timestamp) — a category used by historical transactions can't disappear out from under a report.

### 4.2 Products vs. variants

The client's own example — **Tiny**, sold as *Per Sack / Per Ream / Per Piece* — is the standard "one product, many sellable units" problem. The correct structure separates three concerns that are easy to conflate: *what the thing is* (product), *what unit it's counted in physically* (base unit), and *what unit it's sold in* (variant + conversion ratio).

| Table | Purpose | Key fields |
|---|---|---|
| `product` | The conceptual item | `id`, `name`, `description`, `category_id`, `base_unit_id`, `supplier_id` (primary/default), `status` (Active/Archived), `created_by`, `created_at` |
| `unit_of_measure` | Canonical unit list (piece, ream, sack, kg, box…) | `id`, `code`, `name` |
| `product_variant` | A sellable form of a product | `id`, `product_id`, `sku`, `barcode`, `unit_id`, `conversion_to_base` (decimal), `cost`, `selling_price`, `status` |
| `stock_balance` | **Cached, derived** on-hand quantity — always in `base_unit`, never edited directly | `product_id`, `warehouse_location_id`, `batch_id`, `qty_on_hand` |

**Why quantity lives only in the base unit:** if "Per Sack," "Per Ream," and "Per Piece" each kept their own independent stock counter, a sale of one sack and a sale of 40 loose pieces would need two separate manual reconciliations to agree on how much *Tiny* is actually left — that gap is exactly how "missing inventory" complaints start. Instead:

- Every variant declares a `conversion_to_base` (e.g., 1 Sack = 50 kg, 1 Ream = 500 Pieces, 1 Piece = 1 Piece if the base unit is "piece").
- Every stock movement — regardless of which variant was sold or received — is converted to base-unit quantity before it's posted to the ledger.
- `qty_on_hand` and "current stock" always mean *base-unit stock*; the UI converts back to whichever variant a user is looking at (e.g., "held stock" ÷ `conversion_to_base` = sellable reams remaining), including fractional/partial-unit remainders so nothing is silently rounded away.
- Selling a variant that would require *breaking* a larger unit (e.g., selling 3 pieces when only whole sacks are on hand) is a warehouse *unit-conversion* transaction in its own right — a Stock Ledger movement that removes N sacks and adds (N × conversion) pieces — not a silent inference. This keeps the "why did piece-stock suddenly appear" question answerable.

Each variant also keeps its **own** `sku`, `barcode` (kept as an optional reference field, not a workflow dependency), `selling_price`, so retail-store and wholesale pricing work per sellable unit exactly as requested, while inventory truth stays unified underneath.

### 4.3 Recommended additional product fields

Beyond SKU, Name, Description, Category, Unit, Cost, Selling Price, Supplier, Barcode, Status:

| Field | Why |
|---|---|
| `reorder_point` / `reorder_qty` | Drives the Low Stock KPI and future auto-PO trigger to Purchasing |
| `min_stock` / `max_stock` | Enables both **Low Stock** and **Overstock** exception reporting |
| `is_lot_tracked` (bool) | Forces batch/lot capture at receiving for perishables/regulated goods |
| `is_serialized` (bool) | Flags theft-prone/high-value SKUs for unit-level serial tracking; with no scanning hardware, serial capture is a manually-typed field at receiving/dispatch — treat as a post-launch option once basic manual discipline is proven, not a day-one build item |
| `default_warehouse_location_id` | Speeds up putaway suggestions |
| `weight` / `dimensions` | Needed later for shipping/carrier integration |
| `tax_category` | Needed later for Accounting/invoicing integration |
| `image_url` | Warehouse staff visually confirm the right item, reducing pick errors |

---

## 5. The Inventory Ledger — the single source of truth

This is the load-bearing decision in the whole system.

**Rule: no table anywhere stores a stock quantity that application code increments or decrements directly.** Every single unit that enters or leaves the warehouse — supplier delivery, customer return, store dispatch, wholesale dispatch, transfer, scrap, or manual adjustment — creates one row in `stock_ledger`. Current stock is *always* a derived sum, never a stored fact that can silently drift from reality.

```sql
stock_ledger (
  id                  bigint PK,
  product_variant_id  bigint FK,
  warehouse_location_id bigint FK,
  batch_id            bigint FK NULL,
  quantity_delta_base  numeric,      -- + for stock in, − for stock out, always base unit
  movement_type       enum (
    'PO_RECEIPT','CUSTOMER_RETURN','STORE_DISPATCH','WHOLESALE_DISPATCH',
    'TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_POSITIVE','ADJUSTMENT_NEGATIVE',
    'SCRAP','CYCLE_COUNT_CORRECTION','UNIT_CONVERSION'
  ),
  unit_cost_at_movement numeric,
  reference_type       varchar,      -- 'delivery' | 'return' | 'dispatch' | 'adjustment' | ...
  reference_id         bigint,       -- polymorphic link to the source document
  reason_code          varchar NULL, -- required for ADJUSTMENT_* and SCRAP
  performed_by         uuid FK -> users,
  approved_by          uuid FK -> users NULL,
  reversed_by_ledger_id bigint FK -> stock_ledger NULL,  -- corrections reference, never overwrite
  created_at           timestamptz  -- immutable, never updated
)
```

Consequences of this design, mapped directly to the client's stated needs:

- **Prevents missing inventory:** stock cannot become "wrong" through a UI bug or a forgotten update, because there is no mutable number to forget updating — it's always `SUM(quantity_delta_base)`.
- **Tracks every movement:** by construction — a movement that isn't a ledger row didn't happen, and stock that changed without a ledger row is itself the anomaly a nightly reconciliation job will catch.
- **Fully auditable:** every row carries who (`performed_by`/`approved_by`), what (`movement_type`, `reference_id`), and when (`created_at`, immutable).
- **Corrections never destroy history:** fixing a mistake posts a new reversing row (`reversed_by_ledger_id`) rather than editing or deleting the original — the mistake itself stays visible, which is often exactly what an investigation needs to see.

**Performance:** a `stock_balance` table caches `SUM(quantity_delta_base)` per `(product_variant, location, batch)` so the dashboard and pick lists don't re-aggregate millions of ledger rows on every read. It's updated in the same DB transaction as the ledger insert, and a nightly reconciliation job re-derives it from the ledger and alerts on any mismatch — catching bugs or direct database tampering before they become an unexplained variance months later.

**Negative-stock guard:** the application layer rejects any movement that would drive a computed balance below zero. An explicit, logged, approval-gated "negative stock override" exists for rare legitimate timing issues (e.g., a dispatch that must go out before a delivery is formally posted) — every use of it surfaces on the dashboard, because it's a common way real shortages get hidden until a count finds them.

---

## 6. Stock In Workflows

> **Process authority note:** the field lists and validation rules below describe schema-relevant data capture. For the authoritative, step-by-step operational workflow — including the mandatory blind double count, photo-evidence-at-encoding, and supervisor sign-off sequence — see `business-process-design.md` §7 (Supplier Receiving) and §9 (Customer Returns), as amended by `inventory-fraud-audit.md`.

### 6.1 Supplier Deliveries

**Given fields**, plus recommended additions and why:

| Field | Given / Added | Notes |
|---|---|---|
| Purchase Order (if applicable) | Given | Nullable — supports non-PO/ad-hoc deliveries |
| PO Line reference | **Added** | Needed for partial deliveries against a multi-line PO |
| Supplier | Given | |
| Delivery Date (expected vs. actual) | Given / **Added actual vs. expected** | Feeds the OTIF supplier KPI |
| Delivery Receipt Number | Given | System-generated fallback if supplier doesn't provide one; sequential, gapless |
| Received By | Given | |
| Warehouse Location | Given | Location-level, not just warehouse-level ([Section 12](#12-additional-features-to-reduce-inventory-loss)) |
| Product / Variant | Given | |
| Quantity Ordered / Received / Accepted / Rejected | Given (as "Quantity") / **split into four** | The gap between these four numbers *is* the discrepancy — collapsing them into one field throws away the exact information the client is trying to recover |
| Unit | Given | |
| Batch/Lot (if applicable) | Given | Mandatory when `product.is_lot_tracked` |
| Expiry Date | **Added** | Required with batch/lot for perishables; feeds FEFO picking |
| Cost / Landed Cost | Given / **Added landed cost** | Freight & duties allocated across lines when relevant |
| QC/Inspection Status + Inspector | **Added** | Pass / Partial / Fail, separate from receiving clerk |
| Discrepancy Reason | **Added** | Short-shipped / Damaged / Wrong item — structured, not free text only |
| Photo Attachment | **Added** | Evidence for damage or shortage claims against the supplier |
| Remarks | Given | Free text, supplementary to structured discrepancy reason |

**Status workflow:** `Draft → Received → Inspected → Posted to Stock → Closed`. Stock only posts to the ledger at **Posted**, not at Received — so a delivery that's physically in the building but not yet inspected doesn't count as available stock a store could pick against.

**Validation rules:**
- Cannot post without Product + Quantity + Location + Received By.
- Quantity Received exceeding PO quantity by more than a configurable tolerance requires supervisor approval before posting.
- Lot-tracked categories cannot post without a batch/lot number.
- Zero-cost deliveries are blocked from posting (prevents "phantom value" stock with no cost basis, which breaks valuation reports later).

### 6.2 Returned Items (from customers)

**Given fields**, plus recommended additions:

| Field | Given / Added | Notes |
|---|---|---|
| Original Sales Invoice | Given | Line-level link to the specific SO line, not just the order |
| Return Authorization Number (RMA) | **Added** | Issued *before* physical goods are accepted back — blocks unauthorized walk-in returns from bypassing the process |
| Customer | Given | |
| Return Reason | Given | Structured list (defective, wrong item, changed mind, overshipped…), drives the Return Reason Analysis report |
| Condition of Returned Goods | Given → **graded** | Sellable / Damaged-Repairable / Damaged-Scrap / Expired |
| Quantity | Given | Cannot exceed remaining returnable quantity on the original invoice line |
| Warehouse Destination | Given | Driven by condition grade, see below |
| Inspector | Given | Must differ from the person who authorized the RMA where the return value exceeds a threshold (segregation of duties) |
| Date Returned | Given | |
| Photo Evidence | **Added** | Required when condition = Damaged |
| Refund/Credit Note reference | **Added** | Placeholder link for future Accounting integration |

**Disposition logic (recommended validation rule):** condition grade determines destination automatically, not by clerk judgment call alone —

- **Sellable** → posted back to sellable stock at the warehouse location.
- **Damaged-Repairable** → quarantine location; not sellable until a repair/re-grade transaction moves it out.
- **Damaged-Scrap / Expired** → write-off queue; requires a scrap approval before it leaves inventory value on the books.

**Status workflow:** `Requested → RMA Authorized → Received → Inspected → Disposition → Closed`. Stock is only restored to *sellable* balance at Disposition, never at Received — an unopened-looking box isn't stock until someone has actually looked inside it.

**Validation rules:**
- A return with no matching original invoice/SO is not blocked, but is auto-flagged for manual review — this is a known channel for return fraud.
- Cumulative returned quantity per invoice line cannot exceed originally sold quantity.

---

## 7. Stock Out Workflows

Both channels share one principle: **every handoff between people is independently re-verified by a second, uninvolved person against a physical count — never a re-typed number taken on trust from whoever last touched it.** With no scanners, the equivalent of "scan-to-confirm" is a **blind recount on a separate, independently-numbered slip**: the Checker counts without seeing the Picker's figures, submits directly to the Supervisor, and only a match — or a witnessed, bias-tracked tie-break — clears the release. This is the exact discipline `business-process-design.md` §8 specifies; the diagrams below reflect it. See that document for the full step sequence, including the fraud-audit-driven controls (random independent spot-recount, gate weight-range check, tamper-evident seals).

### 7.1 Retail Store Orders

```mermaid
flowchart LR
    A["Store Request"] --> B["Approval"]
    B --> C["Inventory Allocation<br/>(soft reserve)"]
    C --> D["Picking<br/>(manual pick list)"]
    D --> E["Packing"]
    E --> F["Dispatch"]
    F --> G["Delivery Confirmation<br/>(store counts in)"]
    G -->|qty mismatch| H["Discrepancy Ticket"]
    G -->|match| I["Closed"]
```

| Step | Given | Recommended detail |
|---|---|---|
| Store Request | Given | Requesting store, requested by, product/variant + qty, priority, needed-by date |
| Approval | Given | Auto-approve under a configurable value/qty threshold; above it, named approver required |
| **Inventory Allocation** | **Added** | Soft-reserves the requested quantity at approval time so two stores can't both be promised the same last units |
| Picking | Given | System-generated pick list, hand-counted against it; picked-vs-requested variance logged per line |
| Packing | Given | Carton count, weight, tamper-seal number recorded |
| Dispatch | Given | Vehicle/driver, dispatch timestamp, system-generated Stock Transfer Note (sequential, gapless numbering) |
| Delivery Confirmation | Given | Receiving store hand-counts items in; confirmed qty vs. dispatched qty compared automatically |

Any mismatch at Picking, Dispatch, or Delivery Confirmation auto-opens a **Discrepancy Ticket** tied to the specific step and the specific person who counted it — this is the mechanism that answers "which transaction caused it."

### 7.2 Wholesale Orders

```mermaid
flowchart LR
    A["Sales Order"] --> B["Inventory Allocation<br/>(FEFO/FIFO reserve)"]
    B --> C["Picking<br/>(manual, FIFO)"]
    C --> D["Blind Checker Recount<br/>(separate slip)"]
    D --> E["Packing<br/>(packing slip vs SO)"]
    E --> F["Dispatch<br/>(gate weight check + seal)"]
    F --> G["Delivery<br/>(Proof of Delivery)"]
    G --> H["Confirmation<br/>(claim window)"]
    H -->|mismatch| I["Discrepancy Ticket"]
    H -->|match, window closes| J["Closed → Invoicing trigger"]
```

| Step | Given | Recommended detail |
|---|---|---|
| Sales Order | Given | Customer, SO number, order date, requested delivery date, payment terms (future Accounting hook), sales rep |
| Inventory Allocation | Given | Reserved at SO confirmation; lot-tracked stock allocated FEFO (First-Expired-First-Out) by default |
| Picking | Given | Manual pick list, FIFO order |
| Blind Checker Recount | **Added** | Independent recount against the order (not against the Picker's figures) on a separate slip, submitted straight to the Supervisor |
| Packing | Given | Packing slip auto-matched line-by-line against the checked (not ordered) quantity |
| Dispatch | Given | Waybill/DR number, carrier, tracking number, gate weight-range check against expected load weight, tamper-evident numbered seal |
| Delivery | Given | Proof of Delivery — signature or photo; partial deliveries recorded per line, not just per order |
| Confirmation | Given | Customer sign-off; a defined discrepancy-claim window (e.g. 48 hours) after which the delivery record locks and cannot be disputed retroactively — kept separate from the internal 24-hour POD-return SLA |

Confirmed delivery is the trigger point for a future Accounting integration (invoice generation) — the ledger doesn't need to know about invoicing, it just needs to emit the event ([Section 13](#13-future-integration-hooks)).

---

## 8. Roles, Approvals & Segregation of Duties

> **Superseded by `business-process-design.md` §4.** That document defines the authoritative, more granular role set (Owner/GM, Branch Manager, Warehouse Supervisor, Receiver, Picker, Checker, Encoder, Cashier, Sales Rep, Auditor, Security Guard, System Administrator), the full permission matrix, the four irreducible separations (Custody≠Recording, Requesting≠Approving, Picking≠Checking, Operations≠Audit), and the small-branch compensating controls. RBAC implementation should map directly to that role set, not the simplified table previously here.

**Core rule (maker–checker):** the person who records a stock adjustment, scrap, or negative-stock override is never the person who approves it. This single rule closes the most common inventory-loss channel — one person with unilateral power to both create and justify a "correction." (Formalized as SoD-2 in the BPD.)

---

## 9. Audit Trail & Missing-Inventory Investigation Design

Mapped directly to the client's primary objective:

| Client question | Answered by |
|---|---|
| When did the discrepancy happen? | `stock_ledger.created_at` (immutable) brackets the window; cycle count timestamps narrow it further |
| Who performed the transaction? | `performed_by` / `approved_by` on every ledger row |
| Which transaction caused it? | `reference_type` + `reference_id` links every ledger row to its source document (delivery, dispatch, adjustment, cycle count) |
| Expected quantity vs. actual quantity | Captured at every handoff: pick-list expected vs. blind-counted, dispatched vs. delivered, and system balance vs. physical cycle count |
| Adjustment history | `adjustment` table — append-only, each row linked 1:1 to the ledger row it created |
| Approval history | `approval` table — requested_by, approved_by/rejected_by, timestamp, comment, linked to the action it authorized |
| Audit trail | The ledger *is* the audit trail for stock; a separate generic `audit_log` covers non-stock actions (master data edits, price changes, permission changes) |

**Recommended addition — Discrepancy Case:** when a cycle count or delivery variance exceeds tolerance, the system opens a formal case bundling expected qty, actual qty, variance value, every ledger entry in the affected window, an assigned investigator, and a required resolution (write-off / correction / recovered) before any financial impact is booked. This turns "inventory went missing" from a one-line adjustment into a tracked, closeable investigation with its own history.

---

## 10. Inventory Summary Dashboard

**Requested KPIs** — all included as specified: Total Inventory Value, Total Products, Total Stock On Hand, Low Stock Items, Out of Stock Items, Returned Items, Stock In Today, Stock Out Today, Fast Moving Products, Slow Moving Products, Most Returned Products.

**Recommended additions**, prioritized by relevance to the stated shrinkage problem:

| KPI | Why it matters here |
|---|---|
| **Shrinkage / Variance Rate (%)** | Directly tracks the client's core pain point period over period — the single most important new number on this dashboard |
| **Open Discrepancy Cases** (count + value at risk) | Shows unresolved investigations before they age into write-offs |
| **Negative-Stock Override count** | Should sit at ~0; any nonzero value is a red flag worth surfacing prominently |
| **Cycle Count Accuracy %** | Leading indicator — degrading accuracy predicts future "missing inventory" reports |
| **Top Discrepancy Locations** | Pinpoints *where* loss concentrates (which warehouse or bin), narrowing investigation scope |
| Inventory Turnover Ratio / Days on Hand | Standard warehouse-management KPIs stakeholders will expect |
| Dead Stock Value (no movement in N days) | Capital tied up, distinct from "slow moving" |
| Pending Approvals | Surfaces bottlenecks in the approval-gated workflows |
| Supplier OTIF Rate | Separates supplier short-shipment from warehouse-side loss — an important root-cause split |
| Avg. Dispatch Cycle Time | Operational efficiency, useful once loss-prevention controls are in place |

---

## 11. Inventory Reports

**Exports:** CSV, Excel, and PDF as requested (Excel and PDF generated server-side; large exports run through a background job queue rather than blocking the request). **Periods:** Daily, Weekly, Monthly, Custom range — all as requested.

**Exception highlighting**, all requested items included: Missing inventory, Discrepancies, Negative stock, Unusual stock movements, Low stock, Overstock, Items without movement, Returned items.

**Recommended additional reports**, each aimed at the auditability objective:

| Report | Purpose |
|---|---|
| **Full Stock Ledger / Movement History** | The master audit report — every movement, filterable by product, location, user, date, or movement type. This is the report an external auditor or the client will ask for first. |
| **Adjustment Report** | Every manual adjustment, by user, with approval status — surfaces a specific individual repeatedly "correcting" stock before it becomes a pattern |
| **Cycle Count Variance Report** | Expected vs. counted, by counter and location, flagging repeat-offender locations |
| **Reconciliation Report** | Ledger-derived balance vs. physical count, variance %, by location — the report that proves the ledger and reality agree |
| **Return Reason Analysis** | Top return reasons by product/customer — root-causes return-driven loss instead of just logging it |
| **Batch/Lot Expiry Report** | Upcoming expirations and FEFO compliance |
| **Supplier Performance / OTIF Report** | Short-shipment and damage rate by supplier — separates supplier-side loss from warehouse-side loss |
| **User Activity Report** | Volume and type of transactions per user — anomaly detection input |
| **Valuation Report** | Weighted-average cost valuation, structured for future Accounting reconciliation |

---

## 12. Additional Features to Reduce Inventory Loss

Ranked by expected impact on the client's stated problem. This ranking is superseded in priority order by `inventory-fraud-audit.md` §16's "Top 10 changes ranked by leverage," which was produced by adversarially testing the process design rather than ranking generically — treat that list as authoritative for sequencing; the items below remain valid as a feature inventory.

1. **Blind independent recount on a separate, numbered slip at every handoff** — receiving, picking/checking, cycle count. The manual equivalent of scan-to-confirm: removes the single largest source of untraceable variance (one person's uncorroborated count) without requiring scanning hardware.
2. **Append-only, hash-chained ledger with derived balances** ([Section 5](#5-the-inventory-ledger-the-single-source-of-truth)) — makes tampering or bugs *detectable*, not just harder.
3. **Maker–checker on all adjustments and write-offs** above a configurable threshold ([Section 8](#8-roles-approvals--segregation-of-duties)), with approval routed on the requester's rolling cumulative value, not per-transaction.
4. **ABC-classified cycle counts** — high-value/fast-moving items counted more often than low-value slow movers; variance beyond tolerance auto-opens a Discrepancy Case; count compliance itself is monitored as a KPI.
5. **Photo/video evidence** at receiving (source document + damage claims), returns (condition grading), and disposal (proof of actual destruction).
6. **Bin/location-level tracking** via bound, pre-numbered physical bin cards with daily photographic capture — "missing from Bin A-14" is investigable; "missing from Warehouse 1" is not.
7. **Hard block on negative stock**, real-time pre-transaction Owner approval only, no retroactive override path — stops dispatches from silently drawing down stock that was never actually received.
8. *(Post-launch option, once manual discipline is proven — not a Phase 1 investment)* Serialized tracking for theft-prone/high-value SKUs, layered on top of batch/lot tracking for perishables; would require scanning hardware to be worthwhile at scale.
9. **Real-time low-stock/zero-stock alerts** — prevents a genuine stockout from being misreported as "missing" inventory.
10. **Supplier scorecards** (short-shipment rate, damage rate) — much reported "missing" stock at receiving is actually supplier short-shipment, a different root cause than warehouse theft.
11. **Gate weight-range check + tamper-evident numbered seals** on top of package-count verification at every exit — closes the gap a count-only gate check leaves open.
12. **Sequential, gapless document numbering** (DR numbers, RMAs, dispatch notes) enforced as a hard database constraint, plus a central booklet registry so pre-numbered paper forms can't be sourced outside the system.
13. **Nightly reconciliation job** comparing the ledger's derived total against the cached balance table, alerting on any mismatch; daily reconciliation independently re-verified by someone who didn't create that day's records.
14. **Least-privilege, role-based access** with idle-timeout re-authentication before every posting — pickers can't touch cost fields; only authorized roles can post adjustments; ledger exports are restricted and logged.
15. *(Later-stage, optional)* RFID or shelf weight-sensors for the highest-shrinkage categories, once manual-count discipline is already mature and six months of clean data exists — explicitly not a near-term investment per the client's confirmed manual-warehouse decision.

---

## 13. Future Integration Hooks

Every ledger insert writes a row to an `event_outbox` table in the same DB transaction (the outbox pattern — guarantees the event is never lost or double-fired independent of the ledger write):

```mermaid
flowchart LR
    LEDGER["Stock Ledger insert"] -->|same transaction| OUTBOX["Event Outbox"]
    OUTBOX --> DISPATCH["Event Dispatcher"]
    DISPATCH -.-> SALES["Sales module<br/>(real-time available-to-promise)"]
    DISPATCH -.-> PURCH["Purchasing module<br/>(auto-PO on low stock)"]
    DISPATCH -.-> ACCT["Accounting module<br/>(COGS / inventory valuation entries)"]
    DISPATCH -.-> WH["Warehouse module<br/>(native — already this system)"]
```

All future modules integrate through this event stream and versioned internal APIs (`/api/v1/...`), never through direct database access — each module owns its own data, per the standard service-oriented boundary. This means Sales, Purchasing, and Accounting can be built later without touching the ledger's schema or logic.

---

## 14. Recommended Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui | Org default; dashboard + forms fit the App Router model well |
| Backend | Next.js API routes, or Fastify/Nest if split out later | Start monolithic, split only when a real scaling reason appears |
| Database | PostgreSQL | Transactional integrity for the ledger is non-negotiable |
| ORM | Prisma | Versioned migrations; no hand-edited prod schema |
| Evidence capture | Mobile-web camera capture (photo/short video) attached directly to receiving, count-slip, return-grading, and disposal records; no barcode/QR scanning — the warehouse is confirmed fully manual | Runs in any phone browser via a PWA, no native app or scanning hardware required |
| Reports | `exceljs` (Excel), headless PDF render (e.g. Puppeteer/React-PDF), native streaming CSV | Server-side generation, queued for large exports |
| Auth | Clerk / Auth.js, role-based access control | Never hand-roll session/credential handling |
| Queue | Redis + BullMQ | Report generation, nightly reconciliation job |
| Observability | Sentry + structured logs with correlation IDs on every ledger movement | Every movement traceable end to end, including in application logs |

---

## 15. Phased Rollout

> **Superseded.** The 3-phase table previously here (MVP / Phase 2 / Phase 3) predates the fraud audit and the manual-warehouse decision, and no longer reflects how the build is sequenced. The current, authoritative build plan is 5 phases, sequenced specifically to front-load the highest-leverage anti-fraud controls (the ledger, receiving hardening, and stock-out hardening land in Phases 1–2, before cycle counts/reconciliation/multi-branch in Phase 4 and UAT/parallel-run/cutover in Phase 5). See the project's current build plan for the full phase breakdown, the fraud-audit-finding-to-phase mapping (all 35 findings), and phase-by-phase acceptance criteria.

---

## Open Questions for the Client

> **Superseded by the consolidated decision list.** The four questions previously here are a subset of the fuller list already tracked in `business-process-design.md` Appendix E (12 open questions) and distilled for the client in `executive-summary.html` as the "six decisions we need from you" (Auditor identity, approval peso-thresholds, one stock pool vs. two, delivery dispute-window length, which products get weekly vs. monthly cycle counts, and branch count/timing). Answering those six resolves this section's four questions as a subset — question 2 (FEFO scope) is the one item not already covered and should be confirmed alongside the six.

---

## 16. Implementation Note — Inventory, Alerts & Reporting UI (2026-08-20)

BPD sec.14.5/14.6 promised six daily reports and a weekly/monthly analytics
rhythm; `five-phase-build-plan.md`'s Phase 4 line item promised "the full
reporting and dashboard suite." The backend for several of these (shrinkage
rate, cycle-count compliance, CSV/Excel/PDF export) existed and was correct
but had no UI page; several others (an inventory stock-level browse screen,
low-stock/out-of-stock alerts, daily stock movement, variance analysis,
damage/return trend, slow-stock review) had neither backend nor UI. Closed
in this pass:

- **New pages** (all under `src/app/(dashboard)/`): `inventory` (stock
  browse, reuses the existing `getConsolidatedBranchStockView`),
  `inventory/low-stock` + `inventory/reorder-points` (alerts + settings),
  `reports/daily-exception`, `reports/cycle-count-compliance`,
  `reports/shrinkage-rate` (wiring up existing backends), and new backends
  + pages for `reports/daily-stock-movement`, `reports/variance-analysis`,
  `reports/trend-review`. All follow the existing report-page pattern
  (async server component, `getAppSession`, `assertPermission`-backed
  domain call, redirect-to-`/` on `PermissionDeniedError`).
- **Schema change**: `ProductVariant.reorderPoint Decimal?` (nullable —
  unconfigured, not zero) — a company-wide per-product threshold, editable
  by Branch Manager/Owner on the new Reorder Points settings page, per the
  BPD's own "set reorder points on the top 50 products" recommendation.
  Migration `20260820093538_add_product_variant_reorder_point`.
- **New RBAC actions** (seeded, `reporting.*` convention):
  `reporting.low-stock.view`/`.manage` (Branch Manager, Owner — narrower
  audience, matches BPD sec.14.5's stated table), `reporting.daily-stock-movement.view`,
  `reporting.variance-analysis.view`, `reporting.trend-review.view` (all
  three: Branch Manager, Auditor, Owner — the usual `reporting.*` trio).
- **Deferred, explicitly out of scope for this pass**: supplier scorecard
  (BPD sec.14.6) has no supplier-performance data model yet; Pending
  Encoding List and Form Accountability Sheet (BPD sec.14.5) remain
  unbuilt. Both are real gaps, tracked here rather than silently dropped.

## 17. Bug Fix — Ledger Hash-Chain Concurrency (2026-08-24)

A concurrency stress test (50+ simultaneous `postLedgerEntry` calls) found
that the stock ledger's chain-tail lock did not actually serialize
concurrent posters: under real concurrent load, most postings failed with
a `sequence_no` unique-constraint violation instead of being safely
queued. Root cause: the lock acquired `SELECT ... FROM stock_ledger ORDER
BY sequence_no DESC LIMIT 1 FOR UPDATE` — in Postgres, a blocked `FOR
UPDATE` waiter re-locks the *exact row it originally identified*, not
whatever is now the true tail, so every waiter unblocks holding the same
stale `prevHash`/`sequenceNo` and collides on insert. This is a
well-known Postgres anti-pattern; every other lock in this codebase
(cycle-count window lock, disposal lock, return-quantity lock, stock
reservation lock, adjustment-velocity lock, document-number sequence) was
already using the correct pattern — a stable, pre-identified key row — so
this was an isolated gap, not a systemic one.

**Fix**: a new singleton pointer row, `StockLedgerChainTail` (id always
1), tracking `sequenceNo`/`rowHash` of the current tail. Every poster
locks this *same physical row* every time, so a blocked waiter correctly
re-reads the fresh, just-committed value once unblocked. The row is
lazily seeded on first use, deriving its starting point from
`stock_ledger`'s own current tail (`COALESCE(MAX(sequence_no), 0)`) rather
than assuming an empty chain — a database with existing ledger history
(true of every real environment past initial install) would otherwise
desync the pointer from reality and reproduce the same collision cascade.
Migration `20260824094108_add_stock_ledger_chain_tail`.

Verified: 200 concurrent postings across 4 products with mixed
positive/negative deltas — 0 failures, all sequence numbers unique, hash
chain valid, `StockBalance` exactly correct; the full 126-test fraud-audit
regression suite still passes at its baseline (101 real, 25 documented
gaps) against a pre-populated test database.

## 18. Feature Removal + Catalog Creation (2026-08-24)

Per explicit client request, three features were reviewed for removal;
each was scoped individually rather than deleted uniformly, since their
blast radius differed:

- **Discrepancy Cases — fully deleted** (client's explicit choice, after
  being told ~14 fraud-control workflows still auto-create rows there and
  will now dead-end silently instead of surfacing for review). Removed
  `src/app/(dashboard)/discrepancy-cases/`, `src/app/api/v1/discrepancy-cases/`,
  and the nav/Sidebar/Overview quick-link entries. `DiscrepancyCase` has no
  FK to any other model, so the underlying writes (still made by those ~14
  workflows) succeed as before — they just have no UI to be reviewed from
  anymore. Flagged as a real operational gap, not silently dropped.

  **Correction (2026-08-25):** the deleted API tree also removed the
  *only* triggers for three on-demand fraud/compliance checks —
  `checkQuarantineDisposalAging` (G-09), `checkOverdueTransfers` (BPD
  §15.3 / BR-090), and `checkDeactivatedUserOpenItems` (G-31) — which
  briefly meant these could no longer run at all, not just "run with no
  review UI." Restored via a new standalone page,
  `/reports/integrity-checks` (`reports/integrity-checks/page.tsx` +
  `RunCheckButton.tsx`), with one button per check posting to
  `POST /api/v1/integrity-checks/{quarantine-disposal-aging,overdue-transfers,deactivated-users}`.
  Deliberately does not resurrect Discrepancy Cases' browse/close UI —
  each check still just opens/reassigns `DiscrepancyCase` rows the same
  way it always did; there is simply no case list to browse anymore
  (client's decision, unchanged). RBAC unchanged (same three actions as
  before: `disposal.aging-check.create`, `multibranch.transfer.overdue-check.create`,
  `discrepancy.deactivated-users-check.create`). Verified over HTTP as
  Auditor: all three run, results render inline, re-running is idempotent
  (no duplicate cases), Encoder gets 403. The overdue-transfer check
  immediately flagged two real `InterBranchTransfer` rows in the dev
  database that had been silently overdue the whole time the trigger was
  missing.
- **Counter Transfer — explicitly left untouched.** This is the only
  mechanism that stocks the COUNTER zone for Retail Sales; removing it
  would have broken retail checkout entirely. Client confirmed after this
  was surfaced.
- **Cycle-Count Compliance — page only, deleted.** The domain function
  (`getCycleCountComplianceKpi`), its export-registry entry, and its RBAC
  row were deliberately kept: the fraud-audit regression suite
  (`g25-cycle-count-compliance.test.ts`) calls the function directly, and
  it's inert infrastructure with the page gone (no nav entry, no route).

**New: manual product/catalog creation** (`/inventory/new`,
`POST /api/v1/inventory/products`, `src/server/application/inventory/createProduct.ts`,
RBAC action `inventory.product.create` — Branch Manager, Owner). Deliberately
scoped to catalog metadata only (name, SKU, unit, category, price, cycle-count
class) — it never touches stock or the ledger. A new product starts at zero
on-hand and gets its first real quantity through the normal audited paths
(Receiving for a delivery, Adjustments for a found/corrected count), the
same as the client chose when asked how this should be gated. `OPENING_BALANCE`
was explicitly ruled out as the posting mechanism — it's a one-time,
Owner-approval-gated lock reserved for the Phase 5 go-live physical count
cutover, not routine new-SKU stocking.

Bug found and fixed during verification: `getConsolidatedBranchStockView`
(the function backing the Inventory browse page) only returns
`StockBalance` rows with `quantityOnHand > 0` — it was built for the MB-7
"check another branch's stock before requesting a transfer" report, which
correctly has no reason to list zero-stock items. Reusing it as-is for the
Inventory page meant a newly created product had no `StockBalance` row
anywhere and simply never appeared — silently defeating the point of
letting someone add it. Fixed by leaving that function's MB-7 semantics
untouched (it's also used by a separate export/report) and instead having
`/inventory/page.tsx` start from the full active `ProductVariant` catalog,
left-merging in balances where they exist and defaulting to zero
otherwise. Verified end-to-end over HTTP: product created as Branch
Manager, appears in `/inventory` search at zero stock across all branches,
rejected with 403 for Encoder, duplicate SKU rejected with 409.

**Deployment-scope gate (2026-08-28).** Client asked to launch with only 7
of the built features visible: Receiving, Damage & Disposal, Inventory,
Low Stock Alerts, Reorder Points, Daily Exception Report, Shrinkage Rate.
Implemented as a single enforcement point, `src/middleware.ts` — page
routes not on an allowlist redirect to `/`, API routes on a blocklist
return 404 `FEATURE_DISABLED`. Nothing was deleted: every hidden
page/route/domain function is untouched and still works, `nav-items.ts`
keeps the full original nav split into `NAV_ITEMS` (shown) and
`DISABLED_NAV_ITEMS` (everything else, kept intact for restoration).
Restoring a feature is a one-line move back into `NAV_ITEMS` plus removing
its matching block in `middleware.ts` — no rewriting needed either
direction. Overview dashboard trimmed to match (Quick Actions, stat
cards); `computeLowStockAlerts` was split out of `getLowStockAlerts` so
the dashboard's stat card works for every role, not just the ones with
`reporting.low-stock.view`.

Note: `middleware.ts` must live at `src/middleware.ts`, not the project
root — this repo's `app/` is under `src/`, and Next.js only picks up
middleware from the same level. Placing it at the root silently no-ops
(no build/type error either) until moved.

**Pre-Vercel-launch fixes (2026-08-28).**
- `npm run lint` was completely broken — ESLint 9 needs a flat
  `eslint.config.js` and none existed (no `.eslintrc` either). Added one
  reusing the already-installed `eslint-config-next`. Also fixed the 2
  real issues it then surfaced (unescaped JSX quote, a stale unused
  eslint-disable comment).
- `npm audit` turned up a **critical unauthenticated RCE** in the
  installed Next.js range (16.0.0–16.3.2, GHSA-p293-qw3h-jr36 and
  GHSA-2xp9-vwfh-vxw4). Upgraded to 16.3.5. Also took the safe
  non-breaking `js-yaml` fix; left the `uuid`/`exceljs` moderate finding
  alone since the only fix path is a breaking downgrade of `exceljs` for
  a buffer-bounds issue that doesn't apply to server-generated UUIDs.
- `saveEvidencePhoto.ts` (backs Receiving's encode step, Disposal's
  destroy-evidence step, returns grading, reconciliation bin-card, scrap
  sale quotes) only ever wrote to the local filesystem —
  `EVIDENCE_STORAGE_DRIVER` existed in `.env.example` but nothing read
  it, so it was dead config. That's a hard blocker on Vercel: serverless
  functions have no persistent or shared filesystem, so evidence photos
  would silently vanish in production. Wired the env var up for real:
  `EVIDENCE_STORAGE_DRIVER=filesystem` (default, unchanged local-dev
  behavior) or `EVIDENCE_STORAGE_DRIVER=vercel-blob` (production — uses
  `@vercel/blob`, needs `BLOB_READ_WRITE_TOKEN`, which Vercel injects
  automatically once a Blob store is connected under the project's
  Storage tab). Returns the blob's public URL as the `storageKey`; no
  caller-side changes needed since the interface (dataUrl in, storageKey
  out) is unchanged.
