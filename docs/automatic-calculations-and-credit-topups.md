# Pilot: automatic calculations and commercial credits

## Scope of this increment

New products default to calculated recipe cost. The user supplies ingredients, quantities consumed by one product, and a real acquisition price. A new ingredient can be created inside the product drawer from package price and package quantity; the UI calculates unit cost. The existing authenticated ingredient RPC persists it, the refreshed catalogue confirms the row, and the existing atomic product/recipe RPC calculates the final product cost again from database ingredients. Saving a catalogue ingredient is not a purchase or stock movement. Canceling the product does not delete an ingredient already saved.

New manual closures default to an explicit net-sales calculator: gross less discounts, refunds, collection commissions, stated withholdings and other sales deductions. Zero deductions must be confirmed. Withdrawals and change float in free-text notes are NOT interpreted as expenses. Net sales is not business profit and is not expected cash in drawer. A manual reported-net alternative remains for historical entries/corrections. Canonical totals plus the calculation description persist through the existing atomic closure service and its retry receipt. No tax rate is guessed from a screenshot or applied across tenants.

These calculations are deterministic; they must not use LLM tokens. Missing source information is not zero and must not produce a fictitious margin.

## Owner's commercial assumption — 2026-10-15

The owner stated a total tax burden of **6%** for the GastroPilot business. This is a supplied business assumption for planning, NOT a verified tax determination, NOT a restaurant tax rate, and NOT a default deduction on pilot closures.

For all amounts converted to the same currency, assuming tax and processor fees are percentages of selling revenue:

`net contribution = price * (1 - 0.06 - payment_fee_rate) - provider_cost - allocated_infrastructure_support`

`price = (provider_cost + allocated_infrastructure_support + fixed_fees) / (1 - 0.06 - payment_fee_rate - target_margin_rate)`

If the tax base or fee base differs, change the model. No price, target margin, package size or automatic charge has been approved by this document. Never alter actual token usage to manufacture margin. Sell a transparent service/credit allowance, retaining the true provider usage/cost privately.

## Two independent balances

1. Customer balance: monthly GastroPilot credits shared by the business, plus purchased credits. Track requesting actor separately for diagnostics and optional user budgets.
2. Provider balance: the owner's API organization funding/billing. Customers do not receive or transfer OpenAI API tokens. Their payment to GastroPilot does not itself refill provider billing.

The OpenAI prepaid account may use auto recharge with a threshold, recharge amount/target and monthly reload limit. Owner must authorize those monetary settings. A reload cap is not a cap on API consumption. Funds, rate limits, upstream outages and payment failures require separate monitoring. Never promise uninterrupted availability from a positive ledger alone.

Official reference: https://help.openai.com/es-419/articles/8264644-setting-up-and-managing-prepaid-api-billing

## Next coherent PR: credit purchases and operator controls

No live checkout is exposed by this UI increment. Required contract:

- Owner/admin opens Usage and plan, chooses a published pack, sees credits, price, currency, expiration and tax treatment, and starts checkout.
- Authenticated backend resolves business and permissions; price/credits come only from a versioned server catalogue. Browser cannot provide trusted price, business ID or credits.
- Persist order intent with UUID, exact amount/currency, merchant account, package/version, created-by actor and request id before creating checkout. Reuse on timeout; never double-create charges on blind retry.
- Initial Argentina candidate: Mercado Pago hosted checkout. Credentials belong to the GastroPilot seller, not a pilot restaurant. Confirm account ownership, integration credentials and webhook signing secret before activation.
- Signed webhook is notification, not payment proof. Verify signature and independently fetch current payment/order from provider; validate approved/settled status, exact merchant, amount, currency and our external reference. Never grant credits from the browser success URL, email, or screenshot.
- In one database transaction: unique provider transaction ID + order lock + immutable credit grant + balance update + audit/outbox. Duplicate, delayed and concurrent events must grant only once. Preserve original financial event; record refunds/chargebacks as compensating entries with explicit insufficient-balance policy.
- Notification/outbox informs operator and buyer after committed grant. A notification failure does not undo a valid purchase or grant credits twice.
- Show pending/failed payments without increasing allowance. Block only paid AI calls when allowance is exhausted, not manual data entry or access/export.
- Before enabling sale: fix current reservation/finalization reconciliation, enforce monetary budget as well as credits, hide supplier costs/raw tokens from general members, and test expiry/rollover/overspend/duplicate and forged events/cross-business attacks.
- Separate prepaid top-ups from any recurring card authorization. A customer's optional automatic purchase requires its own explicit consent and ceiling; do not enable merely because owner wants automation.

Official provider reference: https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/payment-notifications

## Activation gates still external

Verified seller account and credentials/signature secret; package prices/quantities/expiry; actual processor fees; owner approval of provider auto-recharge amounts/ceiling; real webhook-payment-credit-notification acceptance test. No funds were charged, no credits changed and no auto-recharge enabled during this increment.

## Independent pilot work retained

PR144: finish and verify account/business deletion, invitation acceptance without mandatory business creation and internal assistant. PR140: reconcile operating-parity changes and migration/backup gate. SMTP signup/recovery/invitations and official Meta end-to-end remain independent acceptance gates. Never merge those implicitly with calculator changes.
