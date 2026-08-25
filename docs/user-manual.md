# Inventory Control System — User Manual

A step-by-step guide to every screen in the system: what it does, who can use it, and how to work through it from start to finish.

## 1. Getting Started

### 1.1 Logging in

1. Open the system in your browser. You will land on the **Sign in** screen.
2. Enter your **Username** — this is your role name (e.g. `owner`, `branch_manager`, `cashier`).
3. Enter your **Password**.
4. Click **Sign in**.

If your username or password is wrong, the screen will show "Incorrect username or password." — check with your administrator if this persists.

Once signed in, you will see the **Overview** dashboard and a sidebar with every section you have access to. Sections you don't have permission for simply won't appear as working links — if you follow a direct link to something outside your role, you'll be sent back to the Overview page.

### 1.2 The sidebar and navigation

The left sidebar is split into two groups:

- **Main** — the day-to-day transactional workflows (Gate Log, Receiving, Retail Sales, Wholesale, Returns, Damage & Disposal, Adjustments, Counter Replenishment).
- **Reports** — read-only views and monitoring tools (Inventory, Low Stock Alerts, Reorder Points, and every report under §14).

Click any item to navigate there. The current page is highlighted.

### 1.3 The transaction PIN — why you'll be asked for it

Any action that **posts to the stock ledger or approves something** (completing a sale, posting a receiving report, approving an adjustment, posting a disposal, etc.) requires you to enter your **PIN** immediately before submitting — even if you just logged in a minute ago. This is deliberate: it proves a real person authorized this specific action, not just that a browser tab was left open and unattended.

Wherever you see a box labeled **"Enter your PIN to authorize this action"**:

1. Type your PIN (default for every seeded demo account: `1234` — your real deployment will use unique PINs per person).
2. Click **Verify PIN**.
3. Once it shows **"PIN verified — ready to submit,"** the action button below it becomes usable.

The PIN check expires after about a minute, so verify it right before you click the final submit button, not earlier in the form.

### 1.4 Live photo evidence — why the camera opens instead of a file picker

Some steps (posting a receiving report, grading a damaged/non-sellable return, destroying goods, quote evidence for a scrap sale) require a **live-captured photo**, not an uploaded file. This is intentional — it stops someone from re-using an old or unrelated photo as fake evidence.

1. Click **Open camera** and allow the browser to use your camera when prompted.
2. Point the camera at the actual goods/documents.
3. Click **Capture photo**. It appears as a thumbnail below.
4. Repeat for additional photos if needed, or click the **×** on a thumbnail to remove one.
5. Click **Close camera** when done.

The action button stays disabled until at least one photo (or however many the step requires) has been captured.

### 1.5 Roles in this system

| Role | Typical focus |
|---|---|
| Owner | Full oversight, approvals, final say on disputes and high-value exceptions |
| Branch Manager | Runs one branch — approvals, investigations, returns, void authority |
| Warehouse Supervisor | Warehouse operations, counts, tie-breaks, disposal certificates |
| Warehouse Receiver | Receives incoming deliveries, damage reporting |
| Warehouse Picker | Picks wholesale orders |
| Warehouse Checker | Independent (blind) recounts across receiving, wholesale, and returns |
| Encoder | Final posting step for receiving, adjustments, returns, wholesale releases |
| Cashier | Retail counter sales |
| Sales Rep | Wholesale order intake and confirmation |
| Auditor | Independent oversight, spot recounts, investigations, exception reporting |
| Security Guard | Gate log entries, outbound gate weight/seal checks |
| System Administrator | System configuration (not a transactional role) |

A full action-by-action permission reference is in **Appendix A**.

---

## 2. Overview (Dashboard Home)

The landing page after login. Shows:

- **Pending Receiving** — receiving reports not yet posted.
- **Open Wholesale Orders** — orders not yet fully released.
- **Pending Adjustments** — adjustment requests awaiting investigation or approval.
- **This Month Retail Revenue** — posted counter sales, month to date.
- **Quick Actions** — one-click links into every main workflow.

There is nothing to configure here — it's a jumping-off point and a quick read on what's outstanding at your branch.

---

## 3. Gate Log

**Sidebar:** Gate Log — typically used by the **Security Guard**.

Logs every vehicle/goods movement in or out of the branch. This is Step 1 of both Receiving (inbound) and Wholesale Release (outbound) — those workflows check that a matching gate entry exists.

**Steps:**

1. Go to **Gate Log**.
2. Select **Direction**: `IN` (goods/vehicle arriving) or `OUT` (leaving).
3. Enter **Vehicle plate** and **Driver name** if applicable (optional).
4. Click **Log entry**.

That's it — this is a single-step log, not a multi-stage workflow.

---

## 4. Receiving

**Sidebar:** Receiving. Records an incoming delivery from a supplier and walks it through independent counting, inspection, and approval before it posts to stock.

### 4.1 Create a Receiving Report

Who: **Warehouse Receiver**.

1. From the Receiving list, click **New Receiving Report**.
2. Select the **Supplier**.
3. Enter the **Delivery Receipt (DR) number**.
4. Enter the **PO reference** if one exists. **Leaving it blank means a supplier call-back must be confirmed later (see 4.5) before this report can be approved** — this guards against a delivery that was never actually ordered.
5. For each line item, choose the **Product variant**, **Expected qty**, and **Unit cost**. Click **+ Add another line** for more items.
6. Click **Create Receiving Report**.

You're taken to the report's detail page, which will now guide you through the remaining steps in order — only the step that's currently relevant to your role shows an action panel.

### 4.2 Blind double count (Steps 4–5)

This is a fraud control: two different people count the same delivery independently, without seeing each other's numbers.

1. **Receiver count** — the Warehouse Receiver enters the counted quantity for each line and clicks **Submit receiver count**.
2. **Checker count** — a different person, the Warehouse Checker, enters their own count (they cannot see the receiver's figures) and clicks **Submit checker count**.
3. **If the two counts disagree**, a **Tie-break** panel appears for the Warehouse Supervisor: pick someone to witness the recount (**Witnessed by**), enter the tie-break quantities, and click **Submit tie-break count**.

### 4.3 Quality inspection (Step 6)

Who: **Warehouse Receiver** or **Warehouse Supervisor**.

- Click **Pass** if the goods are acceptable.
- The Warehouse Supervisor also has a **Reject (quarantine)** option — this routes the report to quarantine (see 4.7) instead of continuing normally.

### 4.4 Prepare & verify (Steps 7–8)

Who: **Warehouse Supervisor**, but **not** the same person who received the delivery (separation of duties — the panel will tell you if you can't verify your own receipt).

Click **Verify receiving report**.

### 4.5 Supplier call-back confirmation (only if no PO was entered)

Who: **Warehouse Receiver** or **Warehouse Supervisor**.

If no PO reference was entered at creation, this step appears before approval: call the supplier back on the number on file to confirm the delivery is genuine, then click **Confirm call-back completed**.

### 4.6 Approve (Step 9)

Who: **Branch Manager** or **Owner**.

1. Verify your PIN (§1.3).
2. Click **Approve**.

### 4.7 Encode & post (Step 10)

Who: **Encoder**.

1. Capture at least one live photo of the received goods (§1.4).
2. Verify your PIN.
3. Click **Post to ledger**.

The report status becomes **POSTED** and stock is now reflected in Inventory.

### 4.8 Quarantine exit

If a report was rejected at inspection (4.3), it sits in **QUARANTINE** status — the stock is real but physically segregated, not mixed into normal storage. A Warehouse Supervisor, Branch Manager, or Owner can click **Exit quarantine — proceed to verification** to send it back into the normal flow starting at verification.

### 4.9 Void

Who: **Warehouse Supervisor** or **Owner**, any time before the report is posted.

Enter a **Reason** and click **Void**.

---

## 5. Retail Sales

**Sidebar:** Retail Sales. A simple counter sale at list price.

### 5.1 Start a sale

Anyone can open the form, but only a **Cashier** can actually complete one.

1. Click **New Sale**.
2. For each item, choose the **Product variant** and **Quantity**. Click **+ Add another item** for more.
3. Click **Start Sale**. Prices are captured automatically at list price — there is no discount entry in this phase.

### 5.2 Complete the sale

Who: **Cashier**.

1. On the sale's detail page, verify your PIN.
2. Click **Complete sale & issue invoice**. This posts the sale to the stock ledger.

### 5.3 Cancel a sale (before posting)

Who: **Cashier** or **Branch Manager**.

Enter a **Reason** and click **Cancel sale**.

### 5.4 Void an already-posted sale (goods not coming back)

Who: **Branch Manager** or **Owner**, only after the sale is posted.

This does **not** reverse the stock movement — it voids the sale record and raises a separate, independently-approved shortage adjustment (ADJ-01) for the loss. **If the goods are physically coming back, use Customer Returns instead (§7)** — this option is only for goods that are gone for good.

1. Enter a **Reason**.
2. Click **Void without return**.

---

## 6. Wholesale Orders

**Sidebar:** Wholesale. The longest workflow in the system — order intake through to a physically verified, weighed, sealed release.

### 6.1 Create an order

Who: **Sales Rep** (to complete the intake steps).

1. Click **New Order**.
2. Choose the **Customer**.
3. For each item, choose the **Product variant** and **Ordered qty**. Click **+ Add another line** for more.
4. Click **Create**. You land on the order's detail page.

### 6.2 Confirm

Who: **Sales Rep**. Click **Confirm**.

### 6.3 Reserve stock

Who: **Warehouse Supervisor**. Click **Reserve**.

### 6.4 Pick

Who: **Warehouse Picker**.

Enter the **picked quantity** for each line, then click **Submit Picking List**.

### 6.5 Blind checker recount

Who: **Warehouse Checker** — must be a different person than whoever picked it (the panel blocks the picker from checking their own work).

You will not see the picker's figures. Enter your own count for each line and click **Submit Count**.

### 6.6 Independent spot recount (only if flagged)

Some orders are randomly flagged for an extra, independent recount (**"Spot recount flagged (G-10)"** badge on the order). Who: **Warehouse Supervisor** or **Auditor**, and specifically someone who had **no role** in picking, checking, or authorizing any order at this branch that day.

Enter counts per line and click **Submit Spot Recount**.

### 6.7 Authorize release

Who: **Warehouse Supervisor**. Click **Authorize**.

### 6.8 Create a release (supports partial delivery)

Who: **Warehouse Supervisor**.

1. Enter the quantity to release per line (you can release less than the full remaining amount — the form shows how much remains).
2. Verify your PIN.
3. Click **Create Release**. You're taken to the release's own detail page.

An order can have multiple releases if goods go out in batches.

### 6.9 Gate check (outbound)

Who: **Security Guard**, on the release's detail page.

1. Enter the **Seal number**.
2. Check **Seal verified intact** if true.
3. Enter the **Actual weight (kg)**.
4. Click **Record Gate Check**.

The recorded weight is checked against the expected weight band for the order — if it or the seal check fails, the release cannot be posted until that's resolved.

### 6.10 Post the release

Who: **Encoder**.

1. Verify your PIN (only enabled if the weight check and seal check both passed).
2. Click **Post Release**.

### 6.11 After posting: POD and customer confirmation

On a posted release:

- Click **Record POD Returned** once the signed proof-of-delivery document is back at the branch.
- Click **Record Customer Confirmation** once the customer has confirmed receipt.

### 6.12 Void

- **Order**: Branch Manager/Owner, only if it has no active releases yet. Enter a reason and click **Void**.
- **Release**: Warehouse Supervisor/Branch Manager/Owner, before it's posted. Enter a reason, verify your PIN, and click **Void**.

---

## 7. Customer Returns

**Sidebar:** Customer Returns. Only **Branch Manager** or **Owner** can issue a Return Authorization — everyone else is redirected if they try the "new" page directly.

### 7.1 Issue a Return Authorization

1. Click **Issue Return Authorization**.
2. Select the **Original sale line** (only posted retail sales and released wholesale lines are eligible).
3. Enter the **Quantity to return**. This is checked server-side against how much is actually still returnable on that line — you cannot return more than what remains (see the box below).
4. Choose a **Reason**.
5. Choose **Identity verification**: physical receipt presented, identity matched on file, or none (invoice recall only). **Choosing "None" auto-flags the return as high risk** and routes it through a stricter approval tier.
6. Optionally enter a **Verified ID name/contact**.
7. Verify your PIN.
8. Click **Issue Return Authorization**.

> **If you see "Requested N exceeds the M still returnable against this line"** — this is the system correctly blocking an over-return. It's not a bug: it cross-checks the real sale line server-side so no one can claim a refund/return for more than was actually sold. Re-check the line and enter a quantity at or below what's shown as still returnable.

### 7.2 Log goods arrival

Who: **Warehouse Receiver**. Click **Log goods received**.

### 7.3 Blind double count of the returned goods

Same pattern as Receiving (§4.2):

1. **Receiver count** — Warehouse Receiver enters the counted quantity, clicks **Submit receiver count**.
2. **Checker count** — Warehouse Checker enters their own count blind, clicks **Submit checker count**. If the counts don't match, a Discrepancy Case is opened automatically for Branch Manager reconciliation.

### 7.4 Grade the return

Who: **Warehouse Supervisor** or **Warehouse Checker** — two independent gradings are required, and you cannot grade the same return twice.

1. Choose a **Grade**: `SELLABLE`, `REPACKABLE`, `DAMAGED`, or `NOT_OURS`.
2. Add optional **Notes**.
3. If the grade is anything other than `SELLABLE`, capture at least one live photo (§1.4).
4. Click **Submit grading**.

If the two gradings disagree, the return moves to **GRADING_DISPUTED**.

### 7.5 Resolve a grading dispute

Who: **Branch Manager** or **Owner**. Pick the **Final grade** and click **Set final grade**.

### 7.6 Post the return

Who: **Encoder**. Verify your PIN and click **Post return**.

### 7.7 Void

Who: **Branch Manager** or **Owner**, only while status is still `ISSUED`. Enter a reason and click **Void**.

---

## 8. Damage & Disposal

**Sidebar:** Damage & Disposal. Reports damaged/quarantined stock and tracks its disposal to completion.

### 8.1 Report damage

Who: **Warehouse Receiver** or **Warehouse Supervisor**.

1. Click **Report Damage**.
2. Choose the **Product variant** and **Location**.
3. Choose the **Source**: Receiving, Storage, Customer return, or Handling.
4. Enter the **Quantity**.
5. Enter the **Cause** — required, and a bare word like "Damaged" is not accepted; describe what actually happened (e.g. "forklift impact during restacking").
6. Click **Report Damage**.

This is deliberately **no-fault reporting** — the goal is getting damage logged quickly, not assigning blame at the point of reporting.

### 8.2 Investigate

Who: **Warehouse Supervisor**. Click **Mark investigated**.

### 8.3 Create a disposal certificate

Who: **Warehouse Supervisor** or **Branch Manager**, whenever there's an undisposed quantity remaining on the report.

1. Choose a **Disposition**: `DESTROY`, `SCRAP_SALE`, `RETURN_TO_SUPPLIER`, or `SELL_AS_SECONDS`.
2. Enter the **Quantity** (up to what's remaining).
3. Choose **Witness 1** and **Witness 2** — Witness 2 must not be a warehouse role, for an independent perspective.
4. Click **Create certificate**. You're taken to the certificate's own page, where the steps differ by disposition (below).

### 8.4 Completing a DESTROY certificate

1. **Record destruction evidence** — capture a live photo of the destroyed/unsellable goods, click **Attach evidence**.
2. **Post destruction** — verify your PIN, click **Post destruction**.

### 8.5 Completing a SELL_AS_SECONDS certificate

Verify your PIN and click **Post** — this transfers the goods to sellable stock as seconds.

### 8.6 Completing a SCRAP_SALE certificate

1. **Record scrap sale**: enter **Buyer name**, **Price/kg**, and **Weight (kg)**.
2. Choose a justification path:
   - **Matched scrap-buyer benchmark** — pick a configured benchmark rate.
   - **Two comparative quotes on file** — enter two buyers and their prices, and capture a live photo of the quote documents.
3. Click **Record scrap sale**.
4. **If the price is below the matched benchmark**, an Owner must click **Approve** (with PIN) before it can post.
5. Once ready, verify your PIN and click **Post**.

### 8.7 Completing a RETURN_TO_SUPPLIER certificate

Enter the **Vehicle plate** / **Driver name** (optional), verify your PIN, and click **Post return to supplier**.

### 8.8 Void a certificate

Who: **Branch Manager** or **Owner**, before it's posted. Enter a reason and click **Void**.

---

## 9. Adjustments

**Sidebar:** Adjustments. The audited path for correcting stock quantities — this is also how new products get their real starting quantity (see §10.2).

### 9.1 Submit an adjustment request

Who: **Warehouse Supervisor**, **Encoder**, **Branch Manager**, or **Auditor**.

1. Click **New Adjustment Request**.
2. Choose the **Product variant** and **Location**.
3. Choose a **Reason code** (ADJ-01 through ADJ-10 — e.g. count variance, damage found, encoding error, found stock, theft/confirmed loss). The direction (increase/decrease) is applied automatically based on the reason.
4. If the reason is **ADJ-03 (damage found in storage)**, you must link a fully-disposed **Damage Report** — ADJ-03 write-offs route through Damage & Disposal first.
5. Enter the **Quantity** (magnitude only — sign is automatic).
6. Enter **Search & reconcile notes** — required. Describe what was checked before concluding an adjustment is actually needed (unencoded documents, wrong location, unconfirmed transfers, etc.).
7. Click **Submit for Investigation**.

### 9.2 Investigate

Who: **Branch Manager** or **Auditor**, and never the person who requested it.

1. Enter **investigation notes**.
2. Click either **Proceed to approval** or **Resolved — no adjustment needed**.

### 9.3 Approve

Who: **Branch Manager** or **Owner** (the exact tier required depends on the requester's rolling 7-day adjustment total), and never the requester.

1. Verify your PIN.
2. Click **Approve** or **Reject**.

### 9.4 Post

Who: **Encoder**. Verify your PIN and click **Post adjustment**. Once posted, an adjustment is permanently immutable.

### 9.5 Void

Who: **Branch Manager** or **Owner**, before posting. Enter a reason and click **Void**.

---

## 10. Inventory

### 10.1 Browse current stock

**Sidebar:** Inventory. Who: **Branch Manager**, **Owner**, **Auditor**.

Shows every active product with its quantity on hand at each branch and a company-wide total — including products that haven't received any stock yet (they show as zero). Use the search box to filter by SKU or product name.

Click **Add Product** to add a new product to the catalog (§10.2), or use the **CSV / Excel / PDF** links to export the current view (§14).

### 10.2 Add a new product

**Sidebar:** Inventory → **Add Product**. Who: **Branch Manager** or **Owner**.

1. Enter the **Product name**.
2. Enter a unique **SKU** and, optionally, a **Barcode**.
3. Choose a **Category** and **Base unit**.
4. Enter the **Selling price**.
5. Choose a **Cycle-count class** (A counted most often, C least — defaults to C).
6. Enter **Unit weight (kg)** if this product is ever sold wholesale — it's required for the wholesale gate weight check (§6.9); leave blank otherwise.
7. Click **Create Product**.

**A new product starts at zero stock everywhere.** This screen only adds it to the catalog — to give it a real quantity, use **Receiving** (§4) for an actual delivery, or **Adjustments** (§9, reason ADJ-02/ADJ-06) for a found/corrected count. There is no shortcut that skips the audit trail.

### 10.3 Low Stock / Out of Stock Alerts

**Sidebar:** Low Stock Alerts. Who: **Branch Manager**, **Owner**.

Lists every product at or below its configured reorder point. **Products with no reorder point set are not monitored at all** — set one on the Reorder Points screen to start alerting on a product.

Click **Manage reorder points** to configure thresholds.

### 10.4 Reorder Points

**Sidebar:** Inventory → Low Stock Alerts → **Manage reorder points**. Who: **Branch Manager**, **Owner**.

For each product:

1. Enter a quantity in the **Reorder point** column (or clear it to stop monitoring that product).
2. Click **Save** on that row.

---

## 11. Reports

All reports below are read-only. Every one has **CSV / Excel / PDF** download links (§14). Access is generally limited to **Branch Manager, Auditor, and Owner**, with two deliberate exceptions noted below.

### 11.1 Daily Exception Report

**Sidebar:** Daily Exception Report. Who: **Owner and Auditor only** — deliberately never Branch Manager, so a branch-level role can never suppress its own exception report.

Nine categories of daily exceptions for a chosen business date (defaults to today) — use the date field to look at a different day.

### 11.2 Shrinkage Rate

**Sidebar:** Shrinkage Rate. Unexplained loss (from shortage/theft/expiry-type adjustments) as a percentage of cost of goods sold, per branch, over a trailing window.

### 11.3 Damage vs. Shrinkage

**Sidebar:** Damage vs. Shrinkage. Flags locations with shortage adjustments but disproportionately few damage reports — a signal that damage may be going unreported and showing up as unexplained shrinkage instead.

### 11.4 Quarantine & Disposal Aging

**Sidebar:** Quarantine & Disposal Aging. Everything currently sitting in quarantine or awaiting disposal, oldest first — rows over the dwell threshold (14 days quarantined, 30 days awaiting disposal) are highlighted.

### 11.5 Daily Stock Movement Summary

**Sidebar:** Daily Stock Movement. Everything that moved in and out on a chosen date, grouped by document type. Use the date field (and branch selector, if you can see more than one branch) to change what you're looking at.

### 11.6 Variance Analysis

**Sidebar:** Variance Analysis. Posted adjustment value over a trailing window, grouped by who requested it and by location — useful for spotting a person or location generating disproportionate adjustments.

### 11.7 Trend Review (Damage/Return Trend & Slow-Dead Stock)

**Sidebar:** Trend Review. Two views: a weekly damage/return trend, and a list of products sitting with stock on hand but no outbound movement in the trailing window (slow/dead stock).

### 11.8 Integrity Checks

**Sidebar:** Integrity Checks. Who: **Auditor**, plus **Branch Manager** (first two checks) or **Owner** (third check) — see Appendix A for exact role mapping.

Three on-demand sweeps. Nothing runs these automatically — someone with access needs to visit this page and click the button:

- **Run aging check** — escalates quarantine/disposal items sitting past their dwell limit.
- **Run overdue-transfer check** — escalates inter-branch transfers stuck in transit 3+ days.
- **Run reassignment check** — reassigns any open case still sitting with a now-deactivated user.

Each button shows how many items it flagged (or "No items flagged") right below it. Running a check again after it's already handled the same items does nothing new — it's safe to click more than once.

---

## 12. Counter Replenishment

**Sidebar:** Counter Replenishment (labeled "Counter Transfer" in some places). Moves stock from Storage to the Counter (sales-floor) location — this is what Retail Sales actually posts against, never Storage directly.

1. Choose the **Product variant**.
2. Enter the **Quantity** to move from Storage to Counter.
3. Verify your PIN.
4. Click **Transfer to Counter**.

---

## 13. Where PIN and evidence requirements come from — quick reference

| Requires PIN | Requires live photo |
|---|---|
| Receiving: Approve, Encode & post | Receiving: Encode & post |
| Retail: Complete sale | Returns: Grade (if not SELLABLE) |
| Wholesale: Create release, Post release, Void release | Disposal: Destruction evidence |
| Returns: Issue RA, Post return | Disposal: Scrap-sale quotes (if using the quotes path) |
| Disposal: Post destruction, Post scrap sale, Approve below-benchmark scrap sale, Post return-to-supplier | |
| Adjustments: Approve, Post | |
| Counter Replenishment: Transfer | |

---

## 14. Exporting a report

Every report page has three links at the top — **CSV**, **Excel**, **PDF**. Click any one to download that report in that format with whatever filters (date, branch, search) are currently applied on the page.

---

## Appendix A — Role & Permission Reference

| Action | Roles allowed |
|---|---|
| Create receiving report | Warehouse Receiver |
| Approve receiving report | Branch Manager, Owner |
| Encode & post receiving report | Encoder |
| Retail sale (draft, post, void) | Cashier |
| Void retail sale (no return) | Branch Manager, Owner |
| Create wholesale order (draft/confirm) | Sales Rep |
| Reserve wholesale order | Warehouse Supervisor |
| Pick wholesale order | Warehouse Picker |
| Check wholesale order (blind recount) | Warehouse Checker |
| Spot recount (wholesale) | Warehouse Supervisor, Auditor |
| Authorize/create release | Warehouse Supervisor |
| Gate check (outbound) | Security Guard |
| Post release | Encoder |
| Void order | Branch Manager, Owner |
| Void release | Warehouse Supervisor |
| Issue Return Authorization | Branch Manager, Owner |
| Post return | Encoder |
| Report damage | Warehouse Supervisor, Warehouse Receiver |
| Adjustment request (create) | Warehouse Supervisor, Encoder, Branch Manager, Auditor |
| Adjustment investigate/approve | Branch Manager, Auditor / Branch Manager, Owner (never the requester) |
| Post adjustment | Encoder |
| Gate log entry | Security Guard |
| Add new product | Branch Manager, Owner |
| Browse inventory / view other branches' stock | Branch Manager, Owner, Auditor |
| Low stock alerts (view / manage) | Branch Manager, Owner |
| Daily Exception Report | **Owner, Auditor only** (never Branch Manager) |
| Shrinkage Rate, Damage vs. Shrinkage, Quarantine & Disposal Aging, Daily Stock Movement, Variance Analysis, Trend Review | Branch Manager, Auditor, Owner |
| Integrity check — aging | Branch Manager, Auditor |
| Integrity check — overdue transfers | Branch Manager, Auditor |
| Integrity check — deactivated-user reassignment | Owner, Auditor |

---

## Appendix B — Not Yet Available in the Web UI

The following areas have working, tested backend logic but **no screen to use them from yet**. If you're looking for one of these and can't find it, this is why:

- **Cycle Counts** — scheduling and submitting physical cycle counts (by ABC class) has no UI page. The compliance report (backend) exists but isn't wired to a screen either.
- **Inter-Branch Transfer** — moving stock *between branches* (as opposed to Counter Replenishment, which moves stock within one branch from Storage to the Counter) has no creation screen. The Integrity Checks page (§11.8) can still flag an inter-branch transfer that's overdue, but nothing in the UI can start one.
- **Reconciliation** — no dedicated screen.
- **User, Supplier, and Customer administration** — accounts, suppliers, and customers are set up by an administrator directly; there is no in-app screen to add or edit them. They appear as dropdown choices inside the forms above once configured.

These are known gaps, not oversights — ask your project contact if any of these need to be prioritized next.
