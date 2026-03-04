---
world_id: derivationworld
name: DerivationWorld
version: 1.0.0
runtime_mode: synthesis
default_profile: strict_synthesis
alternative_profile: permissive_synthesis
---

# Thesis

AI-synthesized governance documents must be structurally valid, epistemically honest, and deterministically verifiable. A derived .nv-world.md is only legitimate if it satisfies the same parser constraints as a hand-authored world, distinguishes declared facts from inferred claims, and never introduces governance domains beyond the source material.

# Invariants

- `output_must_be_valid_nv_world` — Synthesized output must parse successfully under parseWorldMarkdown with zero errors (prompt, immutable)
- `must_include_required_sections` — Output must contain Thesis, Invariants, State, Rules, Gates, and Outcomes sections (prompt, immutable)
- `must_distinguish_declared_vs_inferred` — Invariants derived from explicit source statements must be marked structural; those inferred by the model must be marked operational (prompt, immutable)
- `must_not_invent_external_domains` — All state variables, rules, and invariants must trace to concepts present in the input markdown (prompt, immutable)
- `invariants_must_be_enforceable_or_marked` — Every invariant must be structurally enforceable via rules, or explicitly tagged as non-enforceable with rationale (prompt, immutable)
- `no_json_output` — Output must be .nv-world.md markdown only, never JSON (prompt, immutable)
- `no_extra_commentary` — Output must contain only the .nv-world.md document, no preamble, explanation, or trailing commentary (prompt, immutable)
- `frontmatter_must_be_complete` — Output frontmatter must include world_id, name, and version fields (prompt, immutable)
- `rules_must_have_triggers_and_effects` — Every rule must include a When trigger line and a Then effect line (prompt, immutable)
- `gate_thresholds_must_be_ordered` — Gate thresholds must be monotonically decreasing from best to worst status (prompt, immutable)

# State

## source_section_count
- type: number
- min: 0
- max: 100
- step: 1
- default: 5
- label: Source Section Count
- description: Number of distinct sections or files in the input markdown. More sections generally means richer synthesis material.

## source_token_estimate
- type: number
- min: 0
- max: 200000
- step: 100
- default: 2000
- label: Source Token Estimate
- description: Approximate token count of concatenated input. Determines whether context window constraints may truncate material.

## declared_concept_count
- type: number
- min: 0
- max: 200
- step: 1
- default: 10
- label: Declared Concept Count
- description: Number of distinct governance concepts explicitly named in source material. Drives state variable and rule generation.

## concept_specificity
- type: number
- min: 0
- max: 100
- default: 50
- label: Concept Specificity
- description: How precisely the source material defines its governance concepts. 0 = vague aspirations. 100 = precise structural claims with measurable criteria.

## domain_coherence
- type: number
- min: 0
- max: 100
- default: 60
- label: Domain Coherence
- description: How well source sections relate to a single governance domain. Low coherence indicates conflicting or unrelated source material.

## synthesis_fidelity
- type: number
- min: 0.00
- max: 1.00
- step: 0.01
- default: 0.70
- label: Synthesis Fidelity
- description: Measure of how faithfully the derived world represents the source material. Primary outcome metric.

## structural_completeness
- type: number
- min: 0
- max: 100
- default: 60
- label: Structural Completeness
- description: Percentage of required .nv-world.md sections that contain meaningful content rather than stubs.

## epistemic_honesty
- type: number
- min: 0
- max: 100
- default: 70
- label: Epistemic Honesty
- description: Degree to which the output correctly distinguishes source-declared constraints from model-inferred constraints. 0 = everything claimed as declared. 100 = perfect attribution.

## invention_ratio
- type: number
- min: 0.00
- max: 1.00
- step: 0.01
- default: 0.10
- label: Invention Ratio
- description: Fraction of output concepts that have no traceable origin in the source material. Should be near zero. Above 0.30 indicates hallucination.

# Assumptions

## strict_synthesis
- name: Strict Synthesis
- description: Conservative derivation that only produces governance elements with clear source basis. Prefers omission over invention. Marks all inferred elements as operational.
- invention_tolerance: minimal
- attribution_mode: strict
- completeness_priority: low
- fidelity_priority: high

## permissive_synthesis
- name: Permissive Synthesis
- description: Broader derivation that fills structural gaps with reasonable inferences. Produces more complete worlds but with higher invention ratio. All inferences are still marked operational.
- invention_tolerance: moderate
- attribution_mode: standard
- completeness_priority: high
- fidelity_priority: moderate

# Rules

## rule-001: Empty Source Rejection (structural)
Synthesis from empty or trivially short input cannot produce meaningful governance. The derivation must fail rather than fabricate.

When source_section_count < 1 [state]
Then synthesis_fidelity *= 0.00
Collapse: synthesis_fidelity < 0.05

> trigger: Source input contains no sections — nothing to derive from.
> rule: A world cannot be synthesized from nothing. Empty input must produce a clear failure, not a fabricated world.
> shift: Derivation halts. No output file is written.
> effect: Synthesis fidelity set to zero. Derivation rejected.

## rule-002: Sparse Source Warning (degradation)
Minimal source material limits the quality of derived governance. Output will be structurally thin.

When source_section_count < 3 [state] AND source_token_estimate < 500 [state]
Then synthesis_fidelity *= 0.50, structural_completeness *= 0.60

> trigger: Source has fewer than 3 sections and under 500 tokens — sparse material.
> rule: Sparse input yields sparse governance. The model cannot reliably infer structure from fragments.
> shift: Output quality degrades. State variables and rules will be minimal.
> effect: Synthesis fidelity reduced to 50%. Structural completeness reduced to 60%.

## rule-003: Concept Vagueness Penalty (degradation)
Source material with low concept specificity produces invariants and rules that are aspirational rather than structural.

When concept_specificity < 25 [state]
Then synthesis_fidelity *= 0.60, epistemic_honesty *= 0.70

> trigger: Source concept specificity below 25% — governance concepts are vague.
> rule: Vague concepts cannot produce structural invariants. The model must either invent specificity or produce unenforceable constraints.
> shift: Output invariants trend toward aspiration. Rules lack deterministic triggers.
> effect: Synthesis fidelity reduced to 60%. Epistemic honesty reduced to 70%.

## rule-004: Domain Incoherence Penalty (degradation)
Source material spanning unrelated domains produces a world with conflicting governance logic.

When domain_coherence < 30 [state]
Then synthesis_fidelity *= 0.55

> trigger: Domain coherence below 30% — source material is internally contradictory or covers unrelated domains.
> rule: A single .nv-world.md should govern a coherent domain. Mixed domains produce conflicting rules and meaningless invariants.
> shift: Output becomes structurally confused. State variables may not relate to each other.
> effect: Synthesis fidelity reduced to 55%.

## rule-005: Invention Threshold Breach (structural)
Excessive invention without source basis constitutes fabrication, not derivation.

When invention_ratio > 0.30 [state]
Then synthesis_fidelity *= 0.30, epistemic_honesty *= 0.40
Collapse: synthesis_fidelity < 0.05

> trigger: Invention ratio exceeds 30% — more than a third of output has no source basis.
> rule: Derivation must be grounded. A world that is mostly invented does not represent the user's governance intent.
> shift: Output crosses from synthesis to hallucination. Fidelity drops below usable threshold.
> effect: Synthesis fidelity reduced to 30%. Epistemic honesty reduced to 40%.

## rule-006: High Fidelity Source (advantage)
Rich, specific, coherent source material enables high-quality derivation.

When concept_specificity > 70 [state] AND domain_coherence > 70 [state] AND declared_concept_count > 8 [state]
Then synthesis_fidelity *= 1.20, structural_completeness *= 1.15

> trigger: High concept specificity, strong domain coherence, and rich concept count.
> rule: Quality source material produces quality governance. The model has enough structure to derive rather than invent.
> shift: Output is well-grounded. Most invariants and rules trace directly to source.
> effect: Synthesis fidelity boosted by 20%. Structural completeness boosted by 15%.

## rule-007: Structural Completeness Gate (degradation)
A derived world missing critical sections is not usable regardless of quality in present sections.

When structural_completeness < 40 [state]
Then synthesis_fidelity *= 0.50

> trigger: Structural completeness below 40% — too many required sections are empty or stub.
> rule: A partial world is not a valid world. Missing sections mean missing governance.
> shift: The output may parse but cannot function as meaningful governance.
> effect: Synthesis fidelity reduced to 50%.

## rule-008: Epistemic Honesty Reward (advantage)
Correct attribution of declared versus inferred constraints makes output trustworthy and auditable.

When epistemic_honesty > 80 [state]
Then synthesis_fidelity *= 1.10

> trigger: Epistemic honesty above 80% — model correctly attributes constraint origins.
> rule: Honest attribution makes governance auditable. Users can verify which constraints they declared versus which the model suggested.
> shift: Output gains trust. Declared constraints can be relied upon; inferred ones can be reviewed.
> effect: Synthesis fidelity boosted by 10%.

## rule-009: Context Window Overflow Risk (degradation)
Extremely large source material risks truncation and missed governance concepts.

When source_token_estimate > 100000 [state]
Then synthesis_fidelity *= 0.75

> trigger: Source material exceeds 100k tokens — likely to be truncated.
> rule: Truncated input means incomplete synthesis. The model may miss governance concepts that appear late in the concatenation.
> shift: Output may be partial. Critical sections from later source files may be absent.
> effect: Synthesis fidelity reduced to 75% due to truncation risk.

## rule-010: Derivation Coherence Reward (advantage)
Aligned quality metrics across fidelity, honesty, and invention produce a genuine governance document.

When synthesis_fidelity > 0.80 [state] AND epistemic_honesty > 75 [state] AND invention_ratio < 0.15 [state]
Then synthesis_fidelity *= 1.15
Collapse: synthesis_fidelity < 0.05

> trigger: Synthesis fidelity above 80%, epistemic honesty above 75%, and invention ratio below 15%.
> rule: Coherent derivation across all metrics indicates a faithful, usable governance document.
> shift: The derived world moves from draft to production-quality. Suitable for bootstrap and validation.
> effect: Synthesis fidelity boosted by 15%. Derivation coherence achieved.

# Gates

- FAITHFUL: synthesis_fidelity >= 0.85
- USABLE: synthesis_fidelity >= 0.60
- REVIEWABLE: synthesis_fidelity >= 0.40
- SUSPECT: synthesis_fidelity > 0.15
- DERIVATION_REJECTED: synthesis_fidelity <= 0.15

# Outcomes

## synthesis_fidelity
- type: number
- range: 0-1
- display: percentage
- label: Synthesis Fidelity
- primary: true

## structural_completeness
- type: number
- range: 0-100
- display: percentage
- label: Structural Completeness

## epistemic_honesty
- type: number
- range: 0-100
- display: percentage
- label: Epistemic Honesty

## invention_ratio
- type: number
- range: 0-1
- display: percentage
- label: Invention Ratio
- assignment: external

## derivation_status
- type: enum
- label: Derivation Status
- assignment: external
