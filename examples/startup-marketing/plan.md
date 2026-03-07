---
plan_id: product_launch_q1
objective: Launch new product with marketing campaign under $1,000
sequential: false
budget: 1000
---

# Steps
- Research target audience and competitors [tag: research]
- Write product announcement blog post [tag: content]
- Create social media launch thread [tag: content, social]
- Design email campaign for existing customers [tag: email]
- Publish blog post (after: write_product_announcement_blog_post) [tag: deploy]
- Send email campaign (after: design_email_campaign_for_existing_customers) [tag: email, deploy]
- Post social media thread (after: publish_blog_post) [tag: social, deploy]

# Constraints
- No spending above $1,000
- All external posts require human review [type: approval]
- No access to customer PII
- Email sends limited to existing opt-in subscribers
