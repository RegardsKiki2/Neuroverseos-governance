/**
 * Simulation Compiler
 * 
 * Compiles parsed rules into enforceable guards.
 * Compile-time only - no runtime execution.
 */

import type { ParsedRule, CompiledSimulation, SimulatorBuildState } from '../types';
import { MAX_EXPANSIONS_PER_RULE } from '../types';

/**
 * Compile rules into guard patterns
 */
export function compileSimulation(state: SimulatorBuildState): CompiledSimulation {
  const required = state.parsedRules.filter(r => r.type === 'do');
  const forbidden = state.parsedRules.filter(r => r.type === 'dont');
  
  // Generate patterns from expansions
  const patterns: CompiledSimulation['guards']['patterns'] = [];
  
  for (const rule of forbidden) {
    if (rule.expansion && rule.expansion.patterns.length > 0) {
      // Use expansion patterns (limited)
      const limitedPatterns = rule.expansion.patterns.slice(0, MAX_EXPANSIONS_PER_RULE);
      for (const pattern of limitedPatterns) {
        patterns.push({
          rule: rule.text,
          regex: pattern.source,
          type: 'dont',
        });
      }
    } else {
      // Literal enforcement - create simple pattern
      const escaped = escapeRegex(rule.text);
      patterns.push({
        rule: rule.text,
        regex: escaped,
        type: 'dont',
      });
    }
  }
  
  // Requirements (DOs) - these check for presence, not absence
  const requirements: CompiledSimulation['guards']['requirements'] = required.map(rule => ({
    rule: rule.text,
    type: 'do' as const,
  }));
  
  // Count custom rules (those without template match)
  const customRulesCount = state.parsedRules.filter(r => r.isLiteral).length;
  const templateUsed = state.domain !== 'custom';
  
  return {
    domain: state.domain,
    rules: {
      required,
      forbidden,
    },
    guards: {
      patterns,
      requirements,
    },
    metadata: {
      name: state.name || `${state.domain}-simulation`,
      templateUsed,
      customRulesCount,
      totalRulesCount: state.parsedRules.length,
      compiledAt: new Date().toISOString(),
      version: '1.0.0',
    },
    // Preserve raw source for iteration
    source: {
      dosText: state.dosText,
      dontsText: state.dontsText,
    },
  };
}

/**
 * Escape special regex characters for literal matching
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate guard code (TypeScript)
 */
export function generateGuardTS(compiled: CompiledSimulation): string {
  return `/**
 * Simulation Guard - ${compiled.metadata.name}
 * Domain: ${compiled.domain}
 * Generated: ${compiled.metadata.compiledAt}
 * 
 * This is a compile-time artifact. No runtime inference.
 */

export interface GuardResult {
  allowed: boolean;
  violations: string[];
  warnings: string[];
}

// Forbidden patterns (DON'Ts)
const FORBIDDEN_PATTERNS: Array<{ rule: string; regex: RegExp }> = [
${compiled.guards.patterns.map(p => `  { rule: ${JSON.stringify(p.rule)}, regex: /${p.regex}/gi },`).join('\n')}
];

// Required elements (DOs) - check for presence
const REQUIREMENTS: string[] = [
${compiled.guards.requirements.map(r => `  ${JSON.stringify(r.rule)},`).join('\n')}
];

/**
 * Check output against simulation rules
 */
export function checkOutput(text: string): GuardResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  
  // Check forbidden patterns
  for (const { rule, regex } of FORBIDDEN_PATTERNS) {
    if (regex.test(text)) {
      violations.push(\`Violated: \${rule}\`);
    }
  }
  
  return {
    allowed: violations.length === 0,
    violations,
    warnings,
  };
}

/**
 * Get all rules for inspection
 */
export function getRules() {
  return {
    forbidden: FORBIDDEN_PATTERNS.map(p => p.rule),
    required: REQUIREMENTS,
  };
}
`;
}

/**
 * Generate guard code (JavaScript)
 */
export function generateGuardJS(compiled: CompiledSimulation): string {
  return `/**
 * Simulation Guard - ${compiled.metadata.name}
 * Domain: ${compiled.domain}
 * Generated: ${compiled.metadata.compiledAt}
 * 
 * This is a compile-time artifact. No runtime inference.
 */

// Forbidden patterns (DON'Ts)
const FORBIDDEN_PATTERNS = [
${compiled.guards.patterns.map(p => `  { rule: ${JSON.stringify(p.rule)}, regex: /${p.regex}/gi },`).join('\n')}
];

// Required elements (DOs)
const REQUIREMENTS = [
${compiled.guards.requirements.map(r => `  ${JSON.stringify(r.rule)},`).join('\n')}
];

/**
 * Check output against simulation rules
 */
function checkOutput(text) {
  const violations = [];
  const warnings = [];
  
  for (const { rule, regex } of FORBIDDEN_PATTERNS) {
    if (regex.test(text)) {
      violations.push('Violated: ' + rule);
    }
  }
  
  return {
    allowed: violations.length === 0,
    violations,
    warnings,
  };
}

/**
 * Get all rules for inspection
 */
function getRules() {
  return {
    forbidden: FORBIDDEN_PATTERNS.map(p => p.rule),
    required: REQUIREMENTS,
  };
}

module.exports = { checkOutput, getRules, FORBIDDEN_PATTERNS, REQUIREMENTS };
`;
}

/**
 * Generate guard code (Python)
 */
export function generateGuardPy(compiled: CompiledSimulation): string {
  return `"""
Simulation Guard - ${compiled.metadata.name}
Domain: ${compiled.domain}
Generated: ${compiled.metadata.compiledAt}

This is a compile-time artifact. No runtime inference.
"""

import re
from dataclasses import dataclass
from typing import List

@dataclass
class GuardResult:
    allowed: bool
    violations: List[str]
    warnings: List[str]

# Forbidden patterns (DON'Ts)
FORBIDDEN_PATTERNS = [
${compiled.guards.patterns.map(p => `    {"rule": ${JSON.stringify(p.rule)}, "regex": re.compile(r"${p.regex}", re.IGNORECASE)},`).join('\n')}
]

# Required elements (DOs)
REQUIREMENTS = [
${compiled.guards.requirements.map(r => `    ${JSON.stringify(r.rule)},`).join('\n')}
]

def check_output(text: str) -> GuardResult:
    """Check output against simulation rules"""
    violations = []
    warnings = []
    
    for item in FORBIDDEN_PATTERNS:
        if item["regex"].search(text):
            violations.append(f"Violated: {item['rule']}")
    
    return GuardResult(
        allowed=len(violations) == 0,
        violations=violations,
        warnings=warnings
    )

def get_rules():
    """Get all rules for inspection"""
    return {
        "forbidden": [p["rule"] for p in FORBIDDEN_PATTERNS],
        "required": REQUIREMENTS,
    }
`;
}
