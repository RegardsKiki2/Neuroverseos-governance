/**
 * Enforcement Registry - Pattern-based invariant enforcement
 * 
 * Maps invariant types to actual enforcement logic with pattern matching.
 * Used by guard generators to produce working code.
 * 
 * This is the SINGLE SOURCE OF TRUTH for enforcement patterns.
 * Both UI and API consume this module.
 */

import type { EnforcementRule } from '../types.js';

/**
 * Standard enforcement rules for common invariant types
 */
export const ENFORCEMENT_REGISTRY: EnforcementRule[] = [
  {
    id: 'no-phantom',
    name: 'No Phantom State',
    category: 'phantom',
    patterns: [
      "i('ve| have) (done|completed|finished|updated|created|deleted|fixed|deployed|pushed|merged)",
      "it('s| is) (done|complete|finished|ready|deployed|fixed|pushed|merged)",
      "changes? (have been|were|are now) (made|applied|completed|pushed|deployed)",
      "already (deployed|updated|created|finished|done|fixed|pushed|merged)",
      "(successfully|just) (deployed|completed|updated|created|finished|pushed|merged)",
      "the (update|change|fix|deployment) (is|has been) (complete|done|finished)",
    ],
    message: 'Claimed action completion without proof',
  },
  {
    id: 'no-execution',
    name: 'No Execution Claims',
    category: 'execution',
    patterns: [
      "i (deployed|executed|ran|installed|triggered|started|launched|processed)",
      "(is|are) now (live|deployed|running|active|processing)",
      "(successfully|just) (deployed|executed|completed|ran|processed)",
      "the (server|system|service|process|job) (is|has been) (started|launched|running)",
    ],
    message: 'Claimed execution without confirmation',
  },
  {
    id: 'no-hallucinated-files',
    name: 'No Hallucinated Files',
    category: 'hallucination',
    patterns: [
      "I (read|opened|checked|examined|reviewed|modified|updated|created) (the |a |file |code )?[\\w\\/\\.\\-]+\\.(ts|js|py|json|md|yaml|yml|tsx|jsx)",
      "in the file [\\w\\/\\.\\-]+",
      "at line \\d+ (of|in) [\\w\\/\\.\\-]+",
    ],
    message: 'Referenced file without confirmation it was read',
  },
  {
    id: 'no-assumption',
    name: 'No Assumptions',
    category: 'assumption',
    patterns: [
      "I (assume|presume|guess|suppose|believe|think|imagine)",
      "probably|likely|might be|could be|should be|must be",
      "seems like|appears to|looks like",
      "I('m| am) (pretty |fairly |quite )?(sure|certain|confident) (that)?",
      "my (guess|assumption|belief) is",
    ],
    message: 'Made assumption instead of stating fact',
  },
  {
    id: 'no-false-certainty',
    name: 'No False Certainty',
    category: 'assumption',
    patterns: [
      "I('m| am) (100%|absolutely|completely|totally|definitely) (sure|certain|confident)",
      "there('s| is) no (way|chance|doubt|question)",
      "this (will|definitely|always|never) (work|fail|succeed)",
      "guaranteed to",
    ],
    message: 'Expressed false certainty without evidence',
  },
  {
    id: 'no-fictional-data',
    name: 'No Fictional Data',
    category: 'hallucination',
    patterns: [
      "for example, (if|let's say|suppose|imagine)",
      "let('s| us) (say|assume|pretend|imagine)",
      "hypothetically",
      "in this (fictional|imaginary|made-up|example) scenario",
    ],
    message: 'Presented fictional data as real',
  },
  {
    id: 'no-premature-completion',
    name: 'No Premature Completion',
    category: 'phantom',
    patterns: [
      "task (completed|done|finished)",
      "all (done|finished|complete|set)",
      "(everything|that's all|we're all) (done|set|finished|complete)",
      "nothing (else|more) (needed|required|to do)",
    ],
    message: 'Claimed task completion prematurely',
  },
];

/**
 * Detect which enforcement rules apply to a given invariant rule text
 */
export function detectEnforcementRules(ruleText: string): EnforcementRule[] {
  const lowerRule = ruleText.toLowerCase();
  const matched: EnforcementRule[] = [];

  const keywordMap: Record<string, string[]> = {
    'phantom': ['phantom', 'proof', 'evidence', 'verify', 'confirm', 'claim', 'state'],
    'execution': ['execute', 'run', 'deploy', 'launch', 'trigger', 'process'],
    'hallucination': ['hallucinate', 'invent', 'fabricate', 'file', 'read', 'reference'],
    'assumption': ['assume', 'guess', 'presume', 'certain', 'sure', 'believe'],
  };

  for (const [category, keywords] of Object.entries(keywordMap)) {
    if (keywords.some(kw => lowerRule.includes(kw))) {
      matched.push(...ENFORCEMENT_REGISTRY.filter(r => r.category === category));
    }
  }

  // Default to phantom rules if no match
  if (matched.length === 0) {
    matched.push(...ENFORCEMENT_REGISTRY.filter(r => r.category === 'phantom'));
  }

  // Dedupe
  const seen = new Set<string>();
  return matched.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/**
 * Generate TypeScript enforcement code for a set of rules
 */
export function generateTSEnforcementCode(rules: EnforcementRule[]): string {
  const patternChecks = rules.map(rule => {
    const patterns = rule.patterns.map(p => `/${p}/i`).join(',\n        ');
    return `
    // ${rule.name}
    {
      const patterns = [
        ${patterns}
      ];
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          violations.push(\`${rule.id}: ${rule.name} - ${rule.message}\`);
          break;
        }
      }
    }`;
  }).join('\n');

  return patternChecks;
}

/**
 * Generate JavaScript enforcement code
 */
export function generateJSEnforcementCode(rules: EnforcementRule[]): string {
  return generateTSEnforcementCode(rules);
}

/**
 * Generate Python enforcement code
 */
export function generatePyEnforcementCode(rules: EnforcementRule[]): string {
  const patternChecks = rules.map(rule => {
    const patterns = rule.patterns.map(p => `r"${p}"`).join(',\n            ');
    return `
        # ${rule.name}
        patterns_${rule.id.replace(/-/g, '_')} = [
            ${patterns}
        ]
        for pattern in patterns_${rule.id.replace(/-/g, '_')}:
            if re.search(pattern, text, re.IGNORECASE):
                violations.append("${rule.id}: ${rule.name} - ${rule.message}")
                break`;
  }).join('\n');

  return patternChecks;
}
