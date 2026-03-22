---
world_id: social-media
name: Social Media Governance
version: 1.0.0
runtime_mode: COMPLIANCE
default_profile: moderate
alternative_profile: strict
---

# Thesis

Social media platforms hosting AI agents must govern what agents can post, share, amplify, and interact with. An ungoverned social network of AI agents allows misinformation to cascade, bot amplification to distort discourse, and coordinated inauthentic behavior to manipulate public opinion. Governance doesn't silence agents — it shapes how they participate, turning potential harm into constructive discourse.

# Invariants

- `no_unverified_amplification` — Agents must not amplify unverified claims to large audiences (structural, immutable)
- `no_bot_amplification` — Bot accounts must not create original posts or amplify content (structural, immutable)
- `no_coordinated_inauthentic_behavior` — Coordinated campaigns from low-credibility accounts must be blocked (structural, immutable)
- `misinfo_cascade_prevention` — When misinformation levels exceed thresholds, sharing restrictions tighten automatically (structural, immutable)
- `source_verification_required` — Agents sharing factual claims must have credibility above minimum threshold (structural, immutable)
- `audit_trail_maintained` — Every post, share, block, and moderation action must be logged (structural, immutable)

# State

## misinfo_level
- type: number
- min: 0
- max: 100
- step: 1
- default: 0
- label: Misinformation Level
- description: Percentage of recent feed content that is misinformation (0-100)

## network_mood
- type: enum
- options: calm, neutral, agitated, polarized
- default: neutral
- label: Network Mood
- description: Overall emotional state of the agent network

## engagement_health
- type: number
- min: 0
- max: 100
- step: 1
- default: 80
- label: Engagement Health
- description: Quality of discourse (high = constructive, low = toxic)

## trust_score
- type: number
- min: 0
- max: 100
- step: 1
- default: 50
- label: Network Trust Score
- description: Aggregate trust in content authenticity across the network

## active_agents
- type: number
- min: 0
- max: 1000
- step: 1
- default: 50
- label: Active Agents
- description: Number of agents currently active on the network

## total_reach
- type: number
- min: 0
- max: 100000000
- step: 100
- default: 0
- label: Total Reach
- description: Cumulative audience reach across all posts

# Assumptions

## moderate
- name: Moderate Governance
- description: Balance free expression with misinformation prevention. Allow sharing with verification requirements. Penalize repeat offenders.
- amplification_threshold: 0.5
- bot_posting: blocked
- credibility_floor: 0.2
- cascade_threshold: 40

## strict
- name: Strict Governance
- description: Aggressive misinformation prevention. Higher credibility requirements. Lower cascade thresholds. Faster enforcement.
- amplification_threshold: 0.3
- bot_posting: blocked
- credibility_floor: 0.4
- cascade_threshold: 25

# Rules

## rule-001: Misinformation Amplification (structural)
When misinformation is being shared by agents with significant influence, block the amplification.

When misinfo_level > 40 [state]
Then engagement_health *= 0.30
Collapse: engagement_health < 10

> trigger: Misinformation level exceeds 40% of recent feed content.
> rule: Unverified claims cannot be amplified to large audiences. Block sharing content marked as misinformation when the agent has influence above the threshold.
> shift: Amplification halts. Agents who were sharing misinformation go silent or redirect to fact-checking.
> effect: Engagement health drops severely. Network enters protective mode.

## rule-002: Bot Content Creation (structural)
Bot accounts must not create original posts. They can only interact passively.

When active_agents > 0 [state]
Then engagement_health *= 0.70

> trigger: Bot agent attempts to create an original post.
> rule: Bot accounts are restricted to passive actions (like, scroll). They cannot create posts, share content, or amplify messages. This prevents automated content flooding.
> shift: Bot agents are redirected from posting to passive observation.
> effect: Engagement health reduced. Bot activity is suppressed.

## rule-003: Low Credibility Sharing (degradation)
Agents with very low credibility scores should face restrictions on sharing content.

When trust_score < 30 [state]
Then engagement_health *= 0.60

> trigger: Agent credibility score falls below 0.2 threshold.
> rule: Low-credibility agents (bots, trolls, new accounts) face sharing restrictions. They can still consume content but cannot amplify it. Credibility is earned through constructive participation.
> shift: Low-credibility agents are penalized. Their sharing ability is reduced.
> effect: Engagement health degrades. Network quality is protected at the cost of some participation.

## rule-004: Cascade Prevention (structural)
When misinformation reaches dangerous levels, emergency sharing restrictions activate.

When misinfo_level > 60 [state]
Then engagement_health *= 0.10
Collapse: engagement_health < 10

> trigger: Misinformation exceeds 60% of recent content — cascade imminent.
> rule: Emergency governance mode. All sharing paused except from high-credibility agents (scientists, fact-checkers). This is the kill switch for information cascades.
> shift: Network goes quiet. Only verified voices can still share. Cascade is prevented at the cost of reduced activity.
> effect: Engagement health near-zero. Network enters lockdown.

## rule-005: Fact-Checker Reward (advantage)
Agents who report misinformation constructively should be rewarded.

When trust_score > 60 [state] AND misinfo_level > 10 [state]
Then engagement_health *= 1.25

> trigger: High-credibility agent reports or debunks misinformation.
> rule: Constructive correction of misinformation is the behavior governance should encourage. Fact-checkers and scientists who report false content get influence boosts and priority.
> shift: Fact-checking behavior is amplified. Constructive correction becomes the dominant response to misinformation.
> effect: Engagement health improves. Network self-corrects.

## rule-006: Healthy Discourse (advantage)
When misinformation is low and engagement is constructive, the network thrives.

When misinfo_level < 10 [state] AND trust_score > 70 [state]
Then engagement_health *= 1.20

> trigger: Low misinformation, high trust — the network is functioning well.
> rule: Healthy discourse deserves recognition. When governance has successfully maintained a clean information environment, all agents benefit from increased engagement quality.
> shift: Network enters virtuous cycle. Constructive participation increases.
> effect: Engagement health boosted. Trust reinforced.

# Gates

- THRIVING: engagement_health >= 80
- HEALTHY: engagement_health >= 60
- STRESSED: engagement_health >= 35
- CRITICAL: engagement_health > 10
- COLLAPSED: engagement_health <= 10

# Outcomes

## engagement_health
- type: number
- range: 0-100
- display: percentage
- label: Engagement Health
- primary: true

## misinfo_level
- type: number
- range: 0-100
- display: percentage
- label: Misinformation Level

## trust_score
- type: number
- range: 0-100
- display: percentage
- label: Network Trust

## total_reach
- type: number
- range: 0-100000000
- display: integer
- label: Total Reach
