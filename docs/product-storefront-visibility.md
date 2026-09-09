# Product storefront visibility — implementation report

1. **Original worktree:** Read-only checks before and after implementation confirmed `main` at `0a611e53c55f893c05fc27e1ed139c870e1e238a`. Its AI changes remain uncommitted. Additional concurrent AI edits and two `_torture_*.ts` files appeared during this task; no attempt was made to restore or alter them.
2. **Isolated worktree:** `C:\Users\PC\Desktop\Ovi Mobile\Ovi Mobile-product-visibility`.
3. **Isolated branch:** `feat/product-storefront-visibility`.
4. **Base commit:** `0a611e53c55f893c05fc27e1ed139c870e1e238a`, used explicitly by `git worktree add -b`.
5. **Schema field:** `Product.isStorefrontVisible Boolean @default(true)`.
6. **Migration:** `20260909120000_add_product_storefront_visibility`.
7. **SQL:** `ALTER TABLE "products" ADD COLUMN "isStorefrontVisible" BOOLEAN NOT NULL DEFAULT true;`. Offline Prisma schema-to-schema diff independently produced the same sole change.
8. **Existing products:** Receive `true` when the migration is applied; new products also default to `true`. Migration was created locally, not applied to any database.
9. **Admin UI:** Existing status cell now also contains an RTL badge (`ظاهر بالمتجر` / `مخفي عن المتجر`) and compact existing SubmitButton (`إخفاء من المتجر` / `إظهار في المتجر`). Pending submission uses the existing SubmitButton behavior.
10. **Authorization:** Only `ADMIN`, matching existing create/edit/activity mutations. `ADMIN_ASSISTANT` has manual-sale permissions but does not have product-edit permission; it cannot change visibility. The server action authenticates first, validates id and a strict Boolean value, reloads the product, and updates only visibility (plus Prisma's normal `updatedAt`). The setter expresses a desired value rather than trusting a client-supplied current state.
11. **Listing:** Shared `STOREFRONT_PRODUCT_WHERE` requires both activity and visibility. Existing `buildProductWhere` uses it, so `/products` list and count share the restriction. Search, category, brand, ordering, prices, pagination, new-arrival and stock options retain their previous conditions.
12. **Direct detail:** Both retail/public and wholesale SKU queries exclude hidden products, invoking the existing `notFound()` path. Related product queries also exclude hidden products.
13. **Retail:** Hidden products are excluded from discovery and cannot be added to cart or purchased.
14. **Wholesale:** Exactly the same visibility rule; existing approved-merchant price selection and eligibility are preserved.
15. **Representatives:** Existing product picker and sale core ignore storefront visibility. A mocked-boundary execution of the real sale core successfully sold two units of the active hidden fixture.
16. **Admin manual sale:** Product preload and server sale implementation are unchanged; active hidden products remain eligible under existing stock and operational checks.
17. **REP_CAR:** Loading, returns, transfers, stock requests and car inventory remain unchanged. The real picker returned the hidden fixture with quantity 10; sale core requested the normal car decrement of 2.
18. **Cart/checkout:** Add and quantity mutations reject hidden items. Existing cart rows are retained and display an unavailable badge instead of quantity controls. Checkout page redirects such carts to `/cart`; server checkout rejects them. A second check inside the order transaction locks product rows in id order with `FOR SHARE`, rechecks activity/visibility, and rejects before order or inventory writes if an admin hid a product since the initial read. Existing stock decrement logic is unchanged.
19. **Wishlist:** Adds reject hidden products; both price modes filter them out of the saved-products display. Saved rows are not deleted by hiding, and can reappear after showing the product again.
20. **Recent products:** Both price branches of `/api/products/recent` exclude hidden products, retaining requested ordering and `private, no-store`. Homepage new arrivals and featured products are also filtered.
21. **Zero stock:** No visibility changes occur on depletion or replenishment. Existing stock calculation and inventory mutation code are unchanged.
22. **Activity:** Visibility is independent of `isActive`. Showing an internally inactive product does not reactivate it or make it storefront-eligible.
23. **History:** Order, invoice, merchant history, correction and reversal implementations and historical relation queries are unchanged.
24. **Revalidation:** Setter revalidates `/admin/products`, `/products`, `/`, `/wishlist`, `/cart`, `/checkout`, `/api/products/recent` and the `/products/[sku]` page pattern (including related-product displays). Existing dynamic rendering and API no-store behavior remain in place. No global cache purge was introduced.
25. **Audit log:** No established AdminAuditLog pattern was found in product-management mutations. No logging subsystem was introduced.
26. **Exact customer-facing query changes:** See the query inventory below, including the existing listing's shared builder, homepage collection counts, cart selections and checkout validation.
27. **Exact internal queries deliberately untouched:** See the internal inventory below. No shared storefront filter was installed in Prisma middleware or internal inventory helpers.
28. **Tests 1–20:** All mapped checks pass; see the evidence table below. The suite has 23 passing tests, including additional authorization, wishlist, transaction recheck and cart mutation coverage. These are mocked-boundary function tests and source-preservation checks, not live database/browser integration tests.
29. **Modified files:** Exactly the 15 files listed below.
30. **Added files:** Exactly the four files listed below, including this report.
31. **Deleted files:** None.
32. **Schema status:** Prisma client generation passed. Offline Prisma migration diff contains only the new Boolean column. No `db push`, reset, migration application or production database connection occurred.
33. **Typecheck:** `npm run typecheck` passed; build's type validation also passed.
34. **Lint:** `npm run lint` passed, including the new test file.
35. **Build:** `npm run build` passed after granting network access for the existing Google Fonts fetch. Known `libheif-js` static dependency warning remains. `npm ci` passed; it reported 11 dependency vulnerabilities (1 moderate, 9 high, 1 critical). No dependency files were changed and no audit-fix command was run.
36. **Whitespace:** `git diff --check` passed.
37. **Security:** Changed-source scan found no connection strings, private keys, common credential patterns, environment changes, AI changes or protected-path changes. No database environment was configured. Role checks and server-authoritative checkout checks are enforced; there is no customer-selectable visibility override.
38. **Commit:** The commit containing this report uses `feat: add storefront product visibility control`; its exact hash is returned in the completion message. Only enumerated feature files are staged.
39. **Branch status:** Expected clean after that commit; verified and reported in the completion message.
40. **Merge:** Not merged into main.
41. **Push:** Not pushed.
42. **Original tree:** No files, checkout, index, stash, or commits in the original tree were changed by this task. Worktree registration necessarily updated shared Git metadata.
43. **Items/:** Untouched in the original tree and not copied into the isolated tree.
44. **SQL audit file:** `scripts/ovi87-ovi88-merge-audit.sql` untouched and not copied into the isolated tree.
45. **Infrastructure:** No SSH, deploy, or production database connection. No local database migration was applied either. Apply the additive migration through the normal deployment process before running the changed application. UI appearance and PostgreSQL lock behavior were not exercised against a live database/browser in this task.

## Customer-facing query inventory

| File | Query / change |
| --- | --- |
| `src/lib/catalog-filters.ts` | `buildProductWhere`: common base predicate consumed by `/products` product count and both price-mode `findMany` branches; list page itself needed no edit. |
| `src/app/page.tsx` | Four product `findMany` branches: retail/wholesale featured and new arrivals. |
| `src/app/products/[sku]/page.tsx` | Two SKU `findFirst` branches and two related-product `findMany` branches. |
| `src/app/api/products/recent/route.ts` | Both product `findMany` price branches. |
| `src/lib/homepage-queries.ts` | Product relation counts for category and brand collections. Navigation category/brand names remain unchanged. |
| `src/lib/wishlist.ts` | `addToWishlist` product `findFirst`; both `getWishlistPage` product relation filters. Membership lookup and explicit removal remain unchanged. |
| `src/lib/cart.ts` | `STOCK_CHECK_PRODUCT_SELECT`, `CART_PRODUCT_RETAIL_SELECT`, `CART_PRODUCT_WHOLESALE_SELECT` now select visibility. Cart rows are deliberately not silently filtered/deleted. |
| `src/app/cart/actions.ts` | Existing product and cart-item queries use those selects; availability checks reject hidden products. |
| `src/app/checkout/actions.ts` | Existing fresh cart read validates visibility; new parameterized, transaction-local product row query rechecks and locks before sale. |

The API tree contains the recent-products endpoint and wishlist routes. No separate customer search/autocomplete product endpoint was found. Storefront search goes through the listing builder. Ovi AI catalog/search tools are internal and were deliberately left untouched.

## Internal query inventory deliberately unchanged

| Files / functions | Preserved use |
| --- | --- |
| `src/app/admin/products/page.tsx` product `findMany` | All products fetched; only row mapping/UI extended. |
| `src/app/admin/products/actions.ts` pre-existing reads | SKU checks, activity toggle, removal logic. |
| `src/app/admin/products/[id]/edit/page.tsx`, `purge/actions.ts`, `[id]/variants/{page.tsx,actions.ts}`, `[id]/device-inventory/{page.tsx,actions.ts}` | Editing, purge, variant and device stock management. |
| `src/app/admin/orders/new/{page.tsx,actions.ts}` | Manual-sale product preload and validation. |
| `src/lib/rep-sales.ts`: `getRepCarSaleProducts`, `createRepSaleCore` | REP product picker and sale product/inventory validation. |
| `src/app/rep/requests/new/{page.tsx,actions.ts}` | Stock-request products. |
| `src/app/admin/rep-requests/[requestId]/actions.ts` | Request approval product reads. |
| `src/app/admin/reps/actions.ts`, `[id]/assign-stock/page.tsx` | Product transfer/loading/return queries. |
| `src/app/admin/inventory/{page.tsx,actions.ts,warehouseStockOptions.ts}`, `overview/page.tsx`, `movements/page.tsx` | Warehouse stock, adjustments, movement selection. |
| `src/lib/inventory.ts`, `inventory-tracking.ts`, `inventory-transactions.ts`, `company-inventory-report.ts`, `reps.ts`, `product-purge.ts` | Inventory, tracking conversion, stock mutation, reports and internal removal. |
| `src/lib/ai/tools/{catalog,inventory,sales}.ts` | Internal AI product reads. All AI files unchanged. |
| `src/app/orders/**`, `src/app/merchant/orders/**`, `src/app/admin/orders/**`, `src/app/rep/sales/**`, account/report/correction implementations | Historical relations, snapshots, invoices, payments and reversals; no visibility predicates. |

## Test evidence

Run `node --test tests/storefront-visibility.test.mjs` (23 passing tests).

| Requirement | Evidence |
| --- | --- |
| 1 | Schema/migration default assertions; offline Prisma diff. SQL not applied to a database. |
| 2–4 | Real shared listing builder evaluated against visible/hidden fixtures for retail and wholesale. |
| 5 | Real SKU page calls notFound for hidden fixture in both price modes. |
| 6 | Real admin page query remains unrestricted and its mapped row includes the hidden product. |
| 7 | Manual-sale page and server implementation identical to committed base. |
| 8–9 | Real REP picker returns hidden product with car quantity 10. |
| 10 | Real REP sale core succeeds for hidden product; asserts car decrement of 2 and order product id. Database write functions are mocked. |
| 11 | Order/invoice source preservation against committed base. No live rendering assertion. |
| 12–13 | Real admin setter updates false-to-true and true-to-false, with exact update payload and revalidation assertions. |
| 14–15 | Availability independent of stock 0/100; inventory mutation sources identical to base. |
| 16 | Real setter leaves an inactive product inactive. |
| 17 | Real checkout rejects stale hidden cart; additional test simulates hiding between initial read and transaction. |
| 18 | Real recent-products handler returns only visible fixture for both price modes. |
| 19–20 | Admin inventory/REP trees and core inventory/report/REP-sale files identical to base. |

Additional tests cover non-admin and malformed setter inputs, wishlist filtering without deletion, transaction lock query construction, and cart add/update rejection. Mocked SQL construction does not substitute for a live PostgreSQL concurrency test.

## Exact file manifest

Modified:

```text
prisma/schema.prisma
src/app/admin/products/actions.ts
src/app/admin/products/page.tsx
src/app/api/products/recent/route.ts
src/app/cart/actions.ts
src/app/cart/page.tsx
src/app/checkout/actions.ts
src/app/checkout/page.tsx
src/app/page.tsx
src/app/products/[sku]/page.tsx
src/components/admin/products/AdminProductsSearch.tsx
src/lib/cart.ts
src/lib/catalog-filters.ts
src/lib/homepage-queries.ts
src/lib/wishlist.ts
```

Added:

```text
docs/product-storefront-visibility.md
prisma/migrations/20260909120000_add_product_storefront_visibility/migration.sql
src/lib/storefront-products.ts
tests/storefront-visibility.test.mjs
```

Deleted: none.
