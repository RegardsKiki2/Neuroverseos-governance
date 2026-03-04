---
world_id: configurator_governance_v1
name: The Configurator Governance World
version: 1.0.0
runtime_mode: SIMULATION
default_profile: careful_builder
alternative_profile: fast_ship
---

# Thesis

The structural integrity of a governed AI environment depends entirely on the discipline of the building process. Rushed builds, missing invariants, vague rules, and absent enforcement produce fragile worlds that collapse under real use.

# Invariants

- `testable_thesis` — Every world must have a testable thesis — a structural claim that simulation can confirm or refute (structural, immutable)
- `structural_invariants` — Invariants must be structural truths, not aspirational goals — they constrain, not inspire (structural, immutable)
- `declared_variables_only` — Rules may only reference declared state variables and assumption parameters — no hidden physics (structural, immutable)
- `no_invented_physics` — No rule can invent new causal mechanics at runtime — all physics are declared in advance (structural, immutable)
- `enforcement_references_constitution` — Enforcement logic must reference declared invariants — guards cannot invent constraints (structural, immutable)

# State

## thesis_clarity
- type: number
- min: 0
- max: 100
- default: 70
- label: Thesis Clarity
- description: How specific, testable, and structural the world thesis is. 0 = no thesis. 100 = falsifiable structural claim.

## invariant_count
- type: number
- min: 0
- max: 20
- step: 1
- default: 4
- label: Invariant Count
- description: Number of declared structural invariants. Too few = governance vacuum. Too many = over-constrained.

## invariant_quality
- type: number
- min: 0
- max: 100
- default: 60
- label: Invariant Quality
- description: Are invariants structural truths or aspirational statements? 0 = all aspirational. 100 = all structural.

## rule_count
- type: number
- min: 0
- max: 50
- step: 1
- default: 8
- label: Rule Count
- description: Number of declared deterministic rules

## rule_specificity
- type: number
- min: 0
- max: 100
- default: 55
- label: Rule Specificity
- description: How precisely rules define triggers and effects. 0 = impossibly vague. 100 = extremely brittle. Sweet spot is 40-70.

## enforcement_depth
- type: enum
- options: none, pattern_only, structural, full_stack
- default: structural
- label: Enforcement Depth
- description: How deeply enforcement logic covers the constitution

## testing_coverage
- type: number
- min: 0
- max: 100
- default: 40
- label: Testing Coverage
- description: Percentage of rules and edge cases tested before deployment

## role_separation
- type: number
- min: 0
- max: 100
- default: 50
- label: Role Separation
- description: How well-defined and non-overlapping role authorities are. 0 = all roles can do everything. 100 = perfect separation.

## builder_experience
- type: enum
- options: novice, intermediate, expert
- default: intermediate
- label: Builder Experience
- description: Experience level of the person building the world

## base_integrity
- type: number
- min: 0.10
- max: 0.95
- step: 0.01
- default: 0.60
- label: Base Integrity Score
- description: Starting integrity before governance effects are applied

# Assumptions

## careful_builder
- name: Careful Builder
- description: Takes time to define a clear thesis, author comprehensive invariants, write specific rules, and test thoroughly before shipping.
- build_discipline: methodical
- review_process: full
- testing_approach: comprehensive
- template_reliance: minimal

## fast_ship
- name: Fast Ship
- description: Prioritizes speed over thoroughness. Skips invariant authoring, writes minimal rules, ships without testing. Relies heavily on templates.
- build_discipline: rushed
- review_process: none
- testing_approach: none
- template_reliance: heavy

## template_first
- name: Template-First Builder
- description: Starts from a template and customizes. Moderate thoroughness. Some invariants inherited, some authored. Partial testing.
- build_discipline: moderate
- review_process: partial
- testing_approach: partial
- template_reliance: heavy

# Rules

## rule-001: Thesis Anchor Missing (structural)
A world without a clear, testable thesis has no anchor. Rules float free. Invariants have no purpose. The world cannot be validated.

When thesis_clarity < 25 [state]
Then world_integrity *= 0.20, thesis_anchored = false
Collapse: world_integrity < 0.15

> trigger: Thesis clarity is below 25% — the world has no testable structural claim.
> rule: Without a thesis, there is nothing to simulate. Rules become arbitrary constraints with no explanatory power.
> shift: The world loses its anchor. Every invariant, rule, and gate becomes unjustified.
> effect: World integrity reduced to 20% of baseline. Thesis anchor: MISSING.

## rule-002: Invariant Vacuum (structural)
A world with zero invariants has no structural constraints. Rules exist but nothing is non-negotiable. Governance is optional.

When invariant_count < 1 [state]
Then world_integrity *= 0.25, invariants_enforceable = false
Collapse: world_integrity < 0.15

> trigger: No invariants declared — the world has zero non-negotiable constraints.
> rule: Without invariants, nothing is structurally protected. Any rule can be overridden, any constraint ignored.
> shift: The world moves from governed to ungoverned. Everything becomes negotiable.
> effect: World integrity reduced to 25% of baseline. Invariants: NOT ENFORCEABLE.

## rule-003: Rule Vagueness Drift (degradation)
Rules that are too vague cannot be evaluated deterministically. They become suggestions rather than physics.

When rule_specificity < 30 [state] AND rule_count > 0 [state]
Then world_integrity *= 0.60, rules_deterministic = false

> trigger: Rule specificity is below 30% — rules are too vague to evaluate deterministically.
> rule: Vague rules cannot produce consistent outcomes. Different evaluations of the same state yield different results.
> shift: The rule engine loses determinism. Outcomes become unpredictable.
> effect: World integrity reduced to 60% of baseline. Rules: NOT DETERMINISTIC.

## rule-004: Rule Brittleness Trap (degradation)
Rules that are too specific break under normal variation. They produce false positives and fail on edge cases.

When rule_specificity > 85 [state] AND rule_count > 5 [state]
Then world_integrity *= 0.70

> trigger: Rule specificity exceeds 85% with more than 5 rules — the system is over-constrained.
> rule: Overly specific rules reject valid states. The world becomes hostile to legitimate use.
> shift: False positives increase. Users encounter blocks on normal actions.
> effect: World integrity reduced to 70% of baseline due to brittleness.

## rule-005: Enforcement Gap (structural)
Rules exist but enforcement is absent. The world has a constitution but no judiciary.

When enforcement_depth == "none" [state] AND rule_count > 3 [state]
Then world_integrity *= 0.35, enforcement_active = false
Collapse: world_integrity < 0.15

> trigger: Enforcement depth is none despite having rules declared.
> rule: Rules without enforcement are documentation, not governance. Nothing prevents violation.
> shift: The world has declared physics that are never applied. Governance exists on paper only.
> effect: World integrity reduced to 35% of baseline. Enforcement: INACTIVE.

## rule-006: Role Confusion (degradation)
Roles overlap significantly, creating authority conflicts. Multiple roles believe they can approve or deny the same actions.

When role_separation < 25 [state]
Then world_integrity *= 0.65

> trigger: Role separation below 25% — roles have significant authority overlap.
> rule: Overlapping authorities create conflicts. Two roles may produce contradictory decisions on the same action.
> shift: Governance becomes inconsistent. The same action may be allowed or blocked depending on which role evaluates it first.
> effect: World integrity reduced to 65% of baseline due to role confusion.

## rule-007: Testing Quality Buffer (advantage)
Thorough testing catches rule conflicts, edge cases, and enforcement gaps before deployment.

When testing_coverage > 70 [state]
Then world_integrity *= 1.15

> trigger: Testing coverage exceeds 70% — comprehensive validation is in place.
> rule: Testing reveals contradictions, orphan rules, and enforcement gaps that authoring alone misses.
> shift: The world moves from assumed-correct to verified-correct.
> effect: World integrity boosted by 15% due to testing quality buffer.

## rule-008: Expert Efficiency Bonus (advantage)
Experienced builders produce higher-quality governance with fewer defects.

When builder_experience == "expert" [state]
Then world_integrity *= 1.10

> trigger: Builder experience is expert level.
> rule: Expert builders understand the structural requirements of governance. They write testable theses, structural invariants, and specific-but-flexible rules.
> shift: Quality improves across all dimensions — fewer vague rules, better invariants, more appropriate enforcement.
> effect: World integrity boosted by 10% from expert efficiency.

## rule-009: Template Dependency Risk (degradation)
Heavy reliance on templates without customization produces generic worlds that don't match the actual domain.

When builder_experience == "novice" [state] AND invariant_quality < 40 [state]
Then world_integrity *= 0.55

> trigger: Novice builder with low invariant quality — likely template dependency.
> rule: Templates provide structure but not domain knowledge. Without customization, invariants and rules don't match the actual governance needs.
> shift: The world looks complete but is structurally hollow. Governance constraints don't match reality.
> effect: World integrity reduced to 55% of baseline due to template dependency without customization.

## rule-010: Governance Coherence Reward (advantage)
When thesis, invariants, rules, and enforcement all align, governance becomes self-reinforcing.

When thesis_clarity > 75 [state] AND invariant_quality > 70 [state] AND enforcement_depth == "full_stack" [state]
Then world_integrity *= 1.20, governance_coherent = true

> trigger: Thesis clarity above 75%, invariant quality above 70%, and full-stack enforcement.
> rule: Coherent governance creates positive feedback. Clear thesis guides invariants, invariants guide rules, rules guide enforcement.
> shift: The world moves from mechanically correct to structurally coherent. Governance becomes self-documenting.
> effect: World integrity boosted by 20%. Governance coherence: ACHIEVED.

# Gates

- EXEMPLARY: world_integrity >= 0.85
- SOUND: world_integrity >= 0.60
- FRAGILE: world_integrity >= 0.35
- BRITTLE: world_integrity > 0.15
- GOVERNANCE_FAILURE: world_integrity <= 0.15

# Outcomes

## world_integrity
- type: number
- range: 0-1
- display: percentage
- label: World Integrity Score
- primary: true

## governance_status
- type: enum
- label: Governance Status

## thesis_anchored
- type: boolean
- label: Thesis Anchored

## invariants_enforceable
- type: boolean
- label: Invariants Enforceable

## rules_deterministic
- type: boolean
- label: Rules Deterministic

## enforcement_active
- type: boolean
- label: Enforcement Active

## governance_coherent
- type: boolean
- label: Governance Coherent
