Stripe serves as our payment processor. This document details how we handle payment tokens, checkout sessions, and webhook processing.

## Checkout Session Flow
1. User clicks "Upgrade" -> server creates a Stripe Checkout Session.
2. User is redirected to Stripe's secure payment page.
3. Upon completion, Stripe redirects the user back to our billing page.

## Webhooks
We process Stripe webhook events asynchronously to handle invoicing and upgrades.
See also:
- [Stripe Webhooks](stripe-webhooks.md)
- [Subscription Lifecycle](subscription-lifecycle.md)