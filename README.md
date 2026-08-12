# Inventory Management System

Design phase — no code yet. Documents, for different audiences:

- **[docs/executive-summary.html](docs/executive-summary.html)** ([PDF](docs/Inventory-Executive-Summary.pdf)) — **start here for the client.** A 14-page illustrated summary: the problem, the five rules, the audit we ran against our own design, how stock moves in and out, the warehouse layout, what the owner sees, what to buy, and the six decisions needed. About a twelve-minute read. v2.0 — rebuilt after the fraud audit.
- **[docs/five-phase-build-plan.md](docs/five-phase-build-plan.md)** ([PDF](docs/Inventory-Five-Phase-Build-Plan.pdf)) — **the build plan.** How the system gets built, in five phases, sequenced so the highest-leverage anti-fraud controls land earliest rather than in a late "hardening" pass. Maps all 35 fraud-audit findings to the phase that closes them.
- **[docs/client-decisions-needed.md](docs/client-decisions-needed.md)** — the six decisions (plus four lower-urgency ones) the client needs to make before Phase 1's schema locks, each with what it drives and a recommended default.
- **[docs/inventory-fraud-audit.md](docs/inventory-fraud-audit.md)** ([PDF](docs/Inventory-Fraud-Audit.pdf)) — **adversarial audit of the governing document.** 35 findings (14 critical, 12 high, 7 medium, 2 low), each with an attack scenario, a system-enforced replacement, the exact rule amendment, and a detection mechanism. Merged into the governing document as of v1.1 (below).
- **[docs/business-process-design.md](docs/business-process-design.md)** ([PDF](docs/Inventory-Business-Process-Design.pdf)) — **the governing document, v1.1.** Full ERP-consulting Business Process Design for the Inventory subsystem: roles, lifecycle, states, every Stock In / Stock Out / return / adjustment workflow, manual warehouse procedures, internal controls, exception handling, daily operations, multi-branch, business rules, SOPs, and risk analysis. All 35 fraud-audit findings are merged in place (see its Revision History). No schemas, APIs, or code — the blueprint the software is built to enforce.
- **[docs/inventory-control-plan.md](docs/inventory-control-plan.md)** ([PDF](docs/Inventory-Control-Plan.pdf)) — plain-English version for business review, predates the BPD and is kept for reference only.
- **[docs/architecture.md](docs/architecture.md)** ([PDF](docs/Inventory-Management-System-Architecture-Spec.pdf) — **stale, see note below**) — technical spec: database design, the append-only stock ledger, integration hooks, tech stack. v0.2 — scanning assumptions removed (the warehouse is confirmed fully manual); role definitions and workflow detail now defer to the BPD as authoritative; its old 3-phase rollout table is superseded by `five-phase-build-plan.md`.

All documents agree on the same core idea: every stock movement is permanently recorded and never silently edited, with two-person sign-off on manual corrections.

## Outstanding

- **`Inventory-Management-System-Architecture-Spec.pdf` was not regenerated** after `architecture.md`'s v0.2 edit. `architecture.md` contains Mermaid diagrams; `Convert-MarkdownToPdf.ps1` explicitly does not render Mermaid (see below) and this PDF was originally produced with a different tool. The markdown source is current and accurate — only the PDF is behind. Regenerate it with whatever Mermaid-capable tool produced the original, or ask for a Mermaid-diagram-free PDF export via the existing script instead.

Give the client the executive summary; the business process design (v1.1) is the authority behind it and the document to build from; the five-phase build plan is what to hand engineering.

## Regenerating the PDFs

Both scripts use headless Microsoft Edge — no pandoc, Node, or Python needed.

**Executive summary** — authored directly as self-contained HTML (inline SVG illustrations, A4 print CSS, one idea per page). Edit the HTML, then:

```powershell
.\scripts\Convert-HtmlToPdf.ps1 `
    -HtmlPath .\docs\executive-summary.html `
    -PdfPath  .\docs\Inventory-Executive-Summary.pdf
```

**Business process design / build plan** — Markdown converted to styled HTML, then rendered. Handles headings, tables, fenced ASCII diagrams, lists, blockquotes, and inline formatting, and auto-generates a table of contents. It does **not** render Mermaid — fine for `business-process-design.md`, `client-decisions-needed.md`, and `five-phase-build-plan.md` (none use Mermaid), but **not** `architecture.md` (uses Mermaid flowcharts/ER diagrams) or `inventory-control-plan.md`'s PDF, both produced elsewhere.

```powershell
.\scripts\Convert-MarkdownToPdf.ps1 `
    -MarkdownPath .\docs\business-process-design.md `
    -PdfPath      .\docs\Inventory-Business-Process-Design.pdf

.\scripts\Convert-MarkdownToPdf.ps1 `
    -MarkdownPath .\docs\five-phase-build-plan.md `
    -PdfPath      .\docs\Inventory-Five-Phase-Build-Plan.pdf
```

Add `-KeepHtml` to inspect the intermediate HTML, or `-NoToc` to omit the contents page.

After changing either document, re-render and confirm the PDF still has the expected page count — the summary is fixed at 13 pages, and a stray extra page means content has overflowed its A4 frame.
