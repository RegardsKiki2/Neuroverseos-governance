/**
 * Domain Pattern Registry
 * 
 * Maps domain templates to regex enforcement patterns.
 * These patterns are injected into generated guards based on the selected domain.
 */

import { DOMAIN_TEMPLATES, type SimulationDomain } from '@/simulator/templates/domains';
import { RULE_EXPANSIONS } from '@/simulator/patterns/expansions';

export interface DomainPatternSet {
  forbidden: {
    category: string;
    patterns: RegExp[];
    keywords: string[];
  }[];
  required: {
    category: string;
    patterns: RegExp[];
    keywords: string[];
  }[];
}

/**
 * Get all regex patterns for a given domain's DON'Ts.
 * Maps domain template rules to RULE_EXPANSIONS patterns.
 */
export function getDomainForbiddenPatterns(domain: SimulationDomain): DomainPatternSet['forbidden'] {
  const template = DOMAIN_TEMPLATES[domain];
  if (!template || domain === 'custom') {
    return [];
  }
  
  const patterns: DomainPatternSet['forbidden'] = [];
  
  for (const dontRule of template.donts) {
    const expansion = findBestExpansion(dontRule);
    if (expansion) {
      patterns.push({
        category: expansion.key,
        patterns: expansion.patterns,
        keywords: expansion.keywords,
      });
    }
  }
  
  return patterns;
}

/**
 * Find the best matching expansion for a rule text.
 */
function findBestExpansion(ruleText: string): { key: string; patterns: RegExp[]; keywords: string[] } | null {
  const normalized = ruleText.toLowerCase();
  
  for (const [key, expansion] of Object.entries(RULE_EXPANSIONS)) {
    const hasMatchingTag = expansion.tags.some(tag => 
      normalized.includes(tag.toLowerCase())
    );
    
    if (hasMatchingTag && expansion.patterns.length > 0) {
      return {
        key,
        patterns: expansion.patterns,
        keywords: expansion.tags,
      };
    }
  }
  
  return null;
}

/**
 * Generate pattern code for TypeScript guard.
 * Only includes patterns that match the user's forbidden rules.
 */
export function generateTSPatternCode(forbiddenRules: string[]): string {
  const matchedCategories = new Map<string, { patterns: RegExp[]; keywords: string[] }>();
  
  for (const rule of forbiddenRules) {
    const expansion = findBestExpansion(rule);
    if (expansion && !matchedCategories.has(expansion.key)) {
      matchedCategories.set(expansion.key, {
        patterns: expansion.patterns,
        keywords: expansion.keywords,
      });
    }
  }
  
  if (matchedCategories.size === 0) {
    return `  // No semantic patterns - using direct keyword matching only
  const semanticPatterns: Record<string, { keywords: string[]; patterns: RegExp[] }> = {};`;
  }
  
  let code = `  // User-derived semantic patterns (from selected domain/rules)
  const semanticPatterns: Record<string, { keywords: string[]; patterns: RegExp[] }> = {\n`;
  
  for (const [category, config] of matchedCategories) {
    code += `    '${category}': {\n`;
    code += `      keywords: [${config.keywords.map(k => `'${k}'`).join(', ')}],\n`;
    code += `      patterns: [\n`;
    for (const pattern of config.patterns) {
      code += `        ${pattern.toString()},\n`;
    }
    code += `      ],\n`;
    code += `    },\n`;
  }
  
  code += `  };`;
  return code;
}

/**
 * Generate pattern code for JavaScript guard.
 */
export function generateJSPatternCode(forbiddenRules: string[]): string {
  const matchedCategories = new Map<string, { patterns: RegExp[]; keywords: string[] }>();
  
  for (const rule of forbiddenRules) {
    const expansion = findBestExpansion(rule);
    if (expansion && !matchedCategories.has(expansion.key)) {
      matchedCategories.set(expansion.key, {
        patterns: expansion.patterns,
        keywords: expansion.keywords,
      });
    }
  }
  
  if (matchedCategories.size === 0) {
    return `  // No semantic patterns - using direct keyword matching only
  var semanticPatterns = {};`;
  }
  
  let code = `  // User-derived semantic patterns (from selected domain/rules)
  var semanticPatterns = {\n`;
  
  for (const [category, config] of matchedCategories) {
    code += `    '${category}': {\n`;
    code += `      keywords: [${config.keywords.map(k => `'${k}'`).join(', ')}],\n`;
    code += `      patterns: [\n`;
    for (const pattern of config.patterns) {
      code += `        ${pattern.toString()},\n`;
    }
    code += `      ],\n`;
    code += `    },\n`;
  }
  
  code += `  };`;
  return code;
}

/**
 * Generate pattern code for Python guard.
 */
export function generatePyPatternCode(forbiddenRules: string[]): string {
  const matchedCategories = new Map<string, { patterns: RegExp[]; keywords: string[] }>();
  
  for (const rule of forbiddenRules) {
    const expansion = findBestExpansion(rule);
    if (expansion && !matchedCategories.has(expansion.key)) {
      matchedCategories.set(expansion.key, {
        patterns: expansion.patterns,
        keywords: expansion.keywords,
      });
    }
  }
  
  if (matchedCategories.size === 0) {
    return `    # No semantic patterns - using direct keyword matching only
    semantic_patterns = {}`;
  }
  
  let code = `    # User-derived semantic patterns (from selected domain/rules)
    semantic_patterns = {\n`;
  
  for (const [category, config] of matchedCategories) {
    code += `        '${category}': {\n`;
    code += `            'keywords': [${config.keywords.map(k => `'${k}'`).join(', ')}],\n`;
    code += `            'patterns': [\n`;
    for (const pattern of config.patterns) {
      // Convert JS regex to Python raw string
      code += `                r'${pattern.source}',\n`;
    }
    code += `            ],\n`;
    code += `        },\n`;
  }
  
  code += `    }`;
  return code;
}
