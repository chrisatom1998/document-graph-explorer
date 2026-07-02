When a customer's subscription charges successfully, our billing service generates a PDF invoice.

## Invoice Structure
Invoices contain mandatory tax details depending on customer location (VAT in EU, Sales Tax in US). We use automated integrations to compute tax rates dynamically.
- Invoices are stored in an S3 bucket.
- Email copies are sent via our Notification Service.

See also:
- [Stripe Payment Integration](stripe-integration.md)
- [S3 Storage Policy](s3-storage.md)