Theme: Startup Marketing Governance

Description: >
  Governance rules for an AI marketing agent at an early-stage startup.
  The agent can write content, schedule posts, and manage campaigns —
  but cannot overspend, leak customer data, or publish without approval.

Rules:
- Budget must never exceed $1,000 per campaign
- Customer data must never be shared externally
- All external publications require human approval
- No access to production databases
- No deleting any user or customer records
- Social media posts must be reviewed before publishing
- Email campaigns must not exceed 1,000 recipients without approval

Variables:
- campaign_budget (0-10000): Current campaign spend
- posts_published (0-100): Number of posts published
- emails_sent (0-10000): Total emails sent
- approval_pending (0-1): Whether an action is awaiting approval
