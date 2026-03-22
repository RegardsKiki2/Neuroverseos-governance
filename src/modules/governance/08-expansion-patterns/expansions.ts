/**
 * Rule Expansion System
 * 
 * Maps common rule phrases to regex patterns for enforcement.
 * This is compile-time only - no inference, no NLP.
 */

export interface RuleExpansion {
  /** Keywords that trigger this expansion */
  tags: string[];
  /** Regex patterns for enforcement */
  patterns: RegExp[];
  /** Examples for UI preview */
  examples: {
    catches: string[];
    allows: string[];
  };
}

/**
 * Expansion registry - maps rule keywords to enforcement patterns
 */
export const RULE_EXPANSIONS: Record<string, RuleExpansion> = {
  // Financial domain
  'price prediction': {
    tags: ['price', 'prediction', 'forecast', 'target'],
    patterns: [
      /will (reach|hit|go to|climb to|fall to) \$?\d+/i,
      /going to (reach|hit|be worth)/i,
      /price target of/i,
      /expect(ed)? to trade at/i,
      /should reach \$?\d+/i,
    ],
    examples: {
      catches: ['Bitcoin will reach $100k', 'Stock going to hit $50'],
      allows: ['If X happens, price could range between...'],
    },
  },
  'investment recommendation': {
    tags: ['invest', 'recommendation', 'advice', 'buy', 'sell'],
    patterns: [
      /you should (buy|sell|invest|hold)/i,
      /I (recommend|suggest|advise) (buying|selling)/i,
      /this is a (good|great|strong) (buy|investment)/i,
      /consider (buying|selling|investing)/i,
    ],
    examples: {
      catches: ['You should buy this stock', 'I recommend selling'],
      allows: ['Historical performance shows...', 'Factors to consider include...'],
    },
  },
  'certainty claim': {
    tags: ['certainty', 'guarantee', 'definitely', 'will'],
    patterns: [
      /will (definitely|certainly|absolutely)/i,
      /guaranteed to/i,
      /100% (chance|certain|sure)/i,
      /there is no (doubt|question)/i,
      /this will (happen|occur)/i,
    ],
    examples: {
      catches: ['This will definitely happen', 'Guaranteed returns'],
      allows: ['Based on analysis, scenarios include...'],
    },
  },
  
  // Medical domain
  'diagnosis': {
    tags: ['diagnose', 'diagnosis', 'condition', 'disease'],
    patterns: [
      /you (have|suffer from|are diagnosed with)/i,
      /this (is|indicates|suggests) [a-z]+ (disease|syndrome|disorder)/i,
      /diagnosis: /i,
      /I diagnose/i,
    ],
    examples: {
      catches: ['You have diabetes', 'This indicates heart disease'],
      allows: ['Symptoms may be consistent with...', 'Consider consulting a doctor about...'],
    },
  },
  'prescription': {
    tags: ['prescribe', 'medication', 'drug', 'treatment'],
    patterns: [
      /take \d+ ?mg of/i,
      /I prescribe/i,
      /you (need|should take|must take) [a-z]+( medication)?/i,
      /start taking/i,
    ],
    examples: {
      catches: ['Take 50mg of aspirin', 'You need antibiotics'],
      allows: ['Common treatments include...', 'Discuss with your doctor...'],
    },
  },

  // Legal domain  
  'legal advice': {
    tags: ['legal', 'advice', 'sue', 'lawsuit'],
    patterns: [
      /you (should|could|can) sue/i,
      /I advise you to/i,
      /legally, you (must|should|can)/i,
      /my legal (opinion|advice) is/i,
    ],
    examples: {
      catches: ['You should sue them', 'My legal advice is...'],
      allows: ['Legal considerations include...', 'Consult an attorney about...'],
    },
  },
  'case outcome': {
    tags: ['win', 'lose', 'case', 'verdict'],
    patterns: [
      /you will (win|lose) (this|the|your) case/i,
      /guaranteed (verdict|judgment|outcome)/i,
      /the court will (rule|decide|find)/i,
    ],
    examples: {
      catches: ['You will win this case', 'The court will rule in your favor'],
      allows: ['Similar cases have resulted in...', 'Factors affecting outcomes include...'],
    },
  },

  // General
  'show calculations': {
    tags: ['show', 'calculations', 'methodology', 'work'],
    patterns: [], // This is a DO - requires presence, not absence
    examples: {
      catches: [],
      allows: ['Step 1: Calculate X by...', 'Methodology: Using formula...'],
    },
  },
  'cite sources': {
    tags: ['cite', 'source', 'reference', 'data'],
    patterns: [], // DO - requires citation presence
    examples: {
      catches: [],
      allows: ['According to [Source]...', 'Data from X shows...'],
    },
  },
  'state assumptions': {
    tags: ['assumption', 'assume', 'assuming', 'given'],
    patterns: [], // DO - requires assumption statement
    examples: {
      catches: [],
      allows: ['Assuming X, then...', 'Given the assumption that...'],
    },
  },
};

/**
 * Find matching expansion for a rule text
 * Returns null if no match (literal enforcement)
 */
export function findExpansion(ruleText: string): RuleExpansion | null {
  const normalized = ruleText.toLowerCase();
  
  for (const [key, expansion] of Object.entries(RULE_EXPANSIONS)) {
    // Check if any tag matches
    const hasMatchingTag = expansion.tags.some(tag => 
      normalized.includes(tag.toLowerCase())
    );
    
    if (hasMatchingTag) {
      return expansion;
    }
  }
  
  return null;
}

/**
 * Get expansion key for a rule (for display purposes)
 */
export function getExpansionKey(ruleText: string): string | null {
  const normalized = ruleText.toLowerCase();
  
  for (const [key, expansion] of Object.entries(RULE_EXPANSIONS)) {
    const hasMatchingTag = expansion.tags.some(tag => 
      normalized.includes(tag.toLowerCase())
    );
    
    if (hasMatchingTag) {
      return key;
    }
  }
  
  return null;
}
