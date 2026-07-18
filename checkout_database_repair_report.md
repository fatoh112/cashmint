# Checkout database repair audit

## Verdict: NEEDS REVIEW

No remote database changes were made. The live project was inspected with read-only system-catalog and aggregate-count queries only.

## Root cause

Production has the trusted version of `public.create_accounting_order(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, jsonb, jsonb)` and `public.resolve_store_tax_rate(uuid, uuid, text)`. That function calls `public.next_store_receipt_number(uuid)`, inserts accounting columns into `orders` and `order_items`, and inserts into `payments`.

The required dependencies are absent in production: the receipt function and counter table, the `payments` table, all accounting header columns on `orders`, the accounting snapshot columns on `order_items`, and their indexes. This is a partial deployment: `20260718022000_trusted_tax_checkout.sql` was applied after or independently of its prerequisite `20260717233429_accounting_exports.sql`.

`20260717233429_accounting_exports.sql` should have created `next_store_receipt_number(uuid)`, `store_receipt_counters`, `payments`, all listed accounting columns, and receipt/payment indexes. `20260718020000_accounting_groups_tax_profiles.sql` created the tax/accounting-group dependencies; `20260718022000_trusted_tax_checkout.sql` replaced the checkout function to calculate totals server-side. `20260718030000_accounting_groups_need_configuration.sql` makes `accounting_groups.tax_profile_id` nullable and is reflected in production.

Local migrations contain duplicate timestamp prefixes (`20260716010000`, `20260716020000`, `20260718010000`, and `20260718020000`). Production migration history also uses different version/name pairs and ends before the local accounting migrations. This drift makes a normal migration replay unsafe without manual review.

## Live schema findings

- `next_store_receipt_number(uuid)`: absent.
- `create_accounting_order(...)`: present, SECURITY DEFINER, fixed `search_path=public`, callable by `anon` and `authenticated`; it calls the missing receipt function.
- `resolve_store_tax_rate(...)`: present with the expected signature.
- `orders`: only `id`, `status`, `total_amount`, `raw_payload`, `created_at`, and `store_id`; all nine accounting columns are absent.
- `order_items`: has base and some accounting-group snapshot columns, but lacks the receipt/accounting export line columns used by checkout (`product_name_snapshot`, `category_name_snapshot`, `vat_rate`, `unit_price_incl_vat`, `discount_amount`, `net_amount`, `vat_amount`, `gross_amount`).
- `payments` and `store_receipt_counters`: absent.
- The only `orders`/`order_items` indexes are primary keys; no receipt uniqueness or supporting checkout indexes exist.
- RLS is disabled on `orders`, `order_items`, and `cashier_sessions`, despite policies existing on the first two. The preview does not change those legacy settings; that requires separate security review.
- Aggregate counts at audit time: 60 orders and 171 order items. Customer/order rows were not read.

## Frontend compatibility

`src/App.jsx` calls the exact RPC name and supplies all 13 expected parameters. It sends `p_lines` as a JavaScript array (serialized as JSONB), uses `cash`/`card` and `dine_in`/`takeaway`/`delivery`, throws on RPC error, and clears the cash cart only after an order is returned. Browser totals are supplied but the trusted SQL recomputes price, modifiers, coupon discount, VAT, and total server-side.

Uncertainty: the frontend can pass `null`/empty device or cashier identifiers from local storage; the database authorization check rejects an invalid device unless the caller has tenant membership. Card follow-up functions (`request_terminal_card_payment`, `complete_accounting_card_payment`) were not found in the live catalog query and need a separate terminal-flow audit after checkout is restored.

## Repair preview

`supabase/production-repair-preview.sql` is additive, transactional, and local only. It preserves existing orders by leaving historic `receipt_number` values nullable. It seeds a per-store counter while holding a table lock, then uses an atomic `INSERT ... ON CONFLICT DO UPDATE` counter function—never `MAX(receipt_number)+1` during checkout. It adds only missing checkout columns/tables/indexes, RLS/policies for the newly created tables, and the two checkout functions/grants.

## Manual deployment order and rollback

1. Take a verified production backup and record the validation-query counts.
2. Review the SQL against the live schema during a short checkout maintenance window.
3. Run the preview manually as one transaction, then run the read-only validation file.
4. Test one cash and one card order in a non-customer store; confirm no duplicate payment and per-store receipt uniqueness.
5. If validation fails, rollback the transaction before commit. After commit, do not drop objects or delete orders; disable checkout traffic and prepare a narrowly scoped follow-up only after review.

## Remote read-only queries executed

1. System catalogs for functions, columns, indexes, constraints, grants, RLS policies, and aggregate counts (first attempt failed harmlessly because `public.payments` is absent).
2. Corrected system-catalog query for the same metadata.
3. Supabase migration-history listing.
4. Catalog/table-presence query for tax, accounting, coupon, terminal, and aggregate-order metadata (first attempt had a query alias error; corrected retry succeeded).

Every successful remote query was `SELECT` only. **NO REMOTE DATABASE CHANGES WERE MADE.**

---

## Execution update — 2026-07-19

### Status: APPLIED BUT VALIDATION FAILED

The checkout dependency repair was applied as the new migration
`20260718221249_checkout_accounting_dependency_repair`. No pre-existing migration-history row was altered.

### Exact applied SQL scope

The applied transaction executed these statements (with the exact column lists and definitions retained in `supabase/production-repair-preview.sql`):

1. `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS` for `receipt_number`, `order_type`, `cashier_session_id`, `pos_device_id`, `completed_at`, `subtotal_excl_vat`, `vat_amount`, `discount_amount`, and `currency`.
2. `ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS` for the eight missing accounting snapshots/totals.
3. `CREATE TABLE IF NOT EXISTS public.store_receipt_counters` and `public.payments`.
4. A `LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE` followed by counter seeding; `MAX(receipt_number)` was used only while the table was locked to initialize existing per-store counters, never to issue a receipt.
5. Creation of receipt, order-item, and payment indexes; the receipt uniqueness index is scoped to `(store_id, receipt_number)` and excludes historic `NULL` values.
6. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for `orders`, `order_items`, `payments`, and `store_receipt_counters`.
7. Creation of the two new tenant-scoped policies only when absent.
8. `CREATE OR REPLACE FUNCTION public.next_store_receipt_number(uuid)` using an atomic `INSERT ... ON CONFLICT DO UPDATE`.
9. `REVOKE ALL ... FROM PUBLIC` and explicit `GRANT EXECUTE` to `anon, authenticated` for `create_accounting_order`.

`create_accounting_order` itself was deliberately **not** replaced: the preflight confirmed that its live definition is already the server-authoritative trusted-checkout version. No DROP, TRUNCATE, DELETE, ALTER TYPE, data rewrite, migration repair, or frontend/Android/Stripe deployment was performed.

### Validation results

- Orders before/after: **60 / 60**.
- Order items before/after: **171 / 171**.
- Existing sales total before/after: **2312.88 / 2312.88**.
- Payments before/after: **not present / 0**.
- `store_receipt_counters`: present.
- `next_store_receipt_number(uuid)`: present.
- `create_accounting_order` expected 13-parameter signature: present.
- Required orders and order-item columns: present.
- Required indexes: present.
- RLS: enabled on `orders`, `order_items`, `payments`, and `store_receipt_counters`; tenant-scoped policies are present.
- Duplicate receipts per store: **0**.
- Duplicate provider references: **0**.

### Remaining blocker

The controlled checkout test was not run. A read-only search found no explicitly test-named/demo/sandbox/staging store with an active device and configured product/tax profile. Creating an order or consuming receipt numbers in an unknown customer store would violate the requested production-safety constraint. Provide a designated test store plus active device identifier to complete the cash/card checkout, receipt-sequence, independent-counter, authorization, and rollback tests.

**Remote database changes were made only by the authorized repair transaction above.**
