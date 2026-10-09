# Changelog

User-facing changes, newest first. Design detail lives in `docs/architecture.md`.

## Unreleased — branch `feat/product-pricing`

### Added
- **Retail and wholesale prices per unit.** A "Prices" button on every variant
  in Inventory sets both prices for each unit (Sack, Rim…). The item page shows
  both columns; the Price List page has a Wholesale / Retail switch. Old prices
  are kept in each item's price history.
- **Price List page** (all roles): pick product, variant, unit and quantity to
  see the price and total — nobody types prices.
- **Selling units and pack sizes.** Items can be sold in several units. A size
  such as "1 Sack = 40 Rim" only counts after two people other than the one who
  set it open a sack and confirm the count, on the receiving report or the item
  page.
- **Client price list import** (`npm run db:import-price-list`), keeping every
  original spreadsheet row and its open questions.
- **Three roles:** Owner, Encoder, Secretary. Other accounts are deactivated.

### Changed
- **Changing a unit's size clears its prices.** When a new size (e.g. 50 rims
  in a sack instead of 40) is confirmed, that unit's old wholesale and retail
  prices are cleared, so it is never sold at a price meant for the old size.
  The item page asks the Owner to set new prices.
- **Inactive needs zero stock.** An item or product can only be set Inactive
  when nothing is on hand and no delivery or adjustment for it is in
  progress — the same rule as archiving.
- **The Encoder who checked a delivery can't also verify it.** Another Encoder
  or the Owner verifies.
- Maintenance scripts refuse to run against the live database unless given
  `--target=production`.
- Inventory is organised as Product → Variant folders. ASIN is optional.
- Retail sales now charge the item's Retail price, and wholesale orders its
  Wholesale price. An item with no price on that list can't be sold (it used to
  fall back to the old single price, or ₱0).
- Receiving count lines show the item name and the unit being counted (e.g. RIM).
- Product pickers list items in the client's price-list order.

### Removed
- The old "Add Product" page — products and variants are added from Inventory.
