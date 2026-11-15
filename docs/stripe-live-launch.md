# LIVE launch and subscriber review

Cottage Mercantile is owner-approved for LIVE purchase at $40 USD per business per month with six total users, including the owner. Tier approval does not activate checkout or change existing subscriptions. Partial and planned features remain identified as such.

After this change is published, open Platform Admin → Billing → Stripe on the production administrator site and select **LIVE**. Under **Tier and recurring Price mappings**, choose Cottage Mercantile and use its existing validated LIVE recurring Price for $40 USD/month. Select **Approve LIVE purchase availability for this mapped tier** and **Validate and save mapping**. Saving a mapping disables new checkout until activation is confirmed again. Existing subscribers keep their linked prices.

## Complete the existing subscriber review

This is a written record of the account owner's review; the field does not perform a migration or cancel anything.

1. Open the Stripe Dashboard for the account selling Cottage Pantry subscriptions. Switch to **LIVE**, then open **Billing → Subscriptions**. Review all statuses, including past-due and canceled subscriptions, and check for unfinished subscription checkouts.
2. If a previous provider such as Square was used for software subscriptions, review its current subscription and unfinished-checkout records too. Customer retail sales integrations are separate from these software subscriptions.
3. In Cottage Pantry, open **Required policies and activation review**. In **Existing subscriber review and activation decision**, record the date, which records/providers you checked, what you found, how existing subscribers retain their current billing, and your decision to enable new LIVE checkout.

If you actually found no existing subscribers or unfinished checkouts, adapt this example to your review:

> Reviewed Stripe LIVE subscriptions and unfinished subscription checkouts on [date]. No existing subscribers or unfinished checkouts found. No previous-provider subscriptions require migration. I approve new LIVE checkout, including Cottage Mercantile at $40/month for six total users including the owner.

If records exist, describe them accurately and preserve their current provider, subscription and payment history. Do not reuse the empty-account example or recreate subscribers in Stripe.

## Activate checkout

Confirm the LIVE API connection, signed webhook delivery and intended purchase mappings are verified. If LIVE policies are not configured, review them, retain the saved `bpc_…` portal ID, enter **APPROVE POLICIES** in **Policy approval confirmation** and select **Approve policies**.

After completing the subscriber review, enter **ENABLE LIVE CHECKOUT** in **LIVE checkout confirmation** and select **Confirm checkout activation**. Refresh connection status and confirm **New checkout: Enabled**. Production requires recorded TEST subscription linking, verified business access and a billing portal launch followed by reconciliation. Missing evidence must be completed using the disposable test business before retrying activation.

Activation requires the signed-in administrator's recent verification. This code change does not write a production activation flag or establish a hosted LIVE payment.
