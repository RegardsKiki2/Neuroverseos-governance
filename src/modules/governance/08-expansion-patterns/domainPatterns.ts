/**
 * Domain Pattern Library
 * 
 * Comprehensive enforcement patterns for all domain templates.
 * Each domain has forbidden patterns (things AI cannot say/do)
 * and allowed behaviors (things AI can do with examples).
 * 
 * Pattern IDs follow: {DOMAIN}-{F|A}{##}
 * - F = Forbidden
 * - A = Allowed
 */

export interface EnforcementPattern {
  id: string;
  name: string;
  description: string;
  patterns: string[];  // Regex patterns as strings for portability
  severity: 'halt' | 'warn';
}

export interface AllowedBehavior {
  id: string;
  name: string;
  description: string;
  examples: string[];
}

export interface DomainPatternSet {
  domain: string;
  displayName: string;
  forbidden: EnforcementPattern[];
  allowed: AllowedBehavior[];
}

// =============================================================================
// FINANCIAL PATTERNS
// =============================================================================

export const FINANCIAL_PATTERNS: DomainPatternSet = {
  domain: 'financial',
  displayName: 'Financial Markets',
  forbidden: [
    {
      id: 'FIN-F01',
      name: 'Price Predictions',
      description: 'Cannot make specific price predictions or targets',
      patterns: [
        'will reach \\$?\\d+',
        'going to hit \\$?\\d+',
        'price target of',
        'expected to trade at',
        'should reach \\$?\\d+',
        'will climb to',
        'will fall to',
      ],
      severity: 'halt',
    },
    {
      id: 'FIN-F02',
      name: 'Investment Recommendations',
      description: 'Cannot recommend specific investment actions',
      patterns: [
        'you should (buy|sell|invest|hold)',
        'I (recommend|suggest|advise) (buying|selling)',
        'this is a (good|great|strong) (buy|investment)',
        'consider (buying|selling|investing in)',
        'I would (buy|sell)',
      ],
      severity: 'halt',
    },
    {
      id: 'FIN-F03',
      name: 'Certainty Claims',
      description: 'Cannot make guaranteed return or certainty claims',
      patterns: [
        'guaranteed (returns|profit|gains)',
        'will definitely',
        '100% (chance|certain|sure)',
        'no way (to lose|it fails)',
        'risk-free',
        "can't lose",
      ],
      severity: 'halt',
    },
    {
      id: 'FIN-F04',
      name: 'Trading Actions',
      description: 'Cannot issue buy/sell directives',
      patterns: [
        'buy now',
        'sell immediately',
        'invest in this',
        'place an order',
        'execute (a |the )?trade',
      ],
      severity: 'halt',
    },
  ],
  allowed: [
    {
      id: 'FIN-A01',
      name: 'Scenario Analysis',
      description: 'Analyze what-if scenarios with stated assumptions',
      examples: [
        'If interest rates rise 2%, this portfolio might...',
        'Under scenario A, the range could be...',
      ],
    },
    {
      id: 'FIN-A02',
      name: 'Methodology Disclosure',
      description: 'Explain analytical methods used',
      examples: [
        'This analysis uses discounted cash flow...',
        'The calculation methodology is...',
      ],
    },
    {
      id: 'FIN-A03',
      name: 'Assumption Statement',
      description: 'Clearly state assumptions behind analysis',
      examples: [
        'Assuming a 3% growth rate...',
        'Given the assumption of stable margins...',
      ],
    },
  ],
};

// =============================================================================
// LEGAL PATTERNS
// =============================================================================

export const LEGAL_PATTERNS: DomainPatternSet = {
  domain: 'legal',
  displayName: 'Legal Document Analysis',
  forbidden: [
    {
      id: 'LEG-F01',
      name: 'Legal Advice',
      description: 'Cannot provide specific legal advice',
      patterns: [
        'you should sue',
        'you could sue',
        'I advise you to',
        'legally, you (must|should|can)',
        'my legal (opinion|advice) is',
        'you have a case',
      ],
      severity: 'halt',
    },
    {
      id: 'LEG-F02',
      name: 'Case Outcome Predictions',
      description: 'Cannot predict case outcomes',
      patterns: [
        'you will (win|lose)',
        'guaranteed (verdict|judgment|outcome)',
        'the court will (rule|decide|find)',
        'certain to prevail',
        'no chance of losing',
      ],
      severity: 'halt',
    },
    {
      id: 'LEG-F03',
      name: 'Document Drafting Authority',
      description: 'Cannot claim to create binding legal documents',
      patterns: [
        'hereby agree',
        'this (constitutes|serves as) a (binding |legal )?contract',
        'legally binding agreement',
        'I hereby',
        'by signing this',
      ],
      severity: 'halt',
    },
  ],
  allowed: [
    {
      id: 'LEG-A01',
      name: 'Jurisdiction Identification',
      description: 'Identify relevant legal jurisdictions',
      examples: [
        'This appears to fall under federal jurisdiction...',
        'State law may apply here because...',
      ],
    },
    {
      id: 'LEG-A02',
      name: 'Statute Citation',
      description: 'Reference relevant statutes and regulations',
      examples: [
        'Under 17 U.S.C. § 107, fair use factors include...',
        'The relevant regulation is...',
      ],
    },
    {
      id: 'LEG-A03',
      name: 'Attorney Recommendation',
      description: 'Recommend consulting qualified counsel',
      examples: [
        'You should consult an attorney who specializes in...',
        'A qualified lawyer can help you with...',
      ],
    },
  ],
};

// =============================================================================
// GAME PATTERNS (TTRPGs, Interactive Fiction)
// =============================================================================

export const GAME_PATTERNS: DomainPatternSet = {
  domain: 'game',
  displayName: 'Game Master / Interactive Fiction',
  forbidden: [
    {
      id: 'GAM-F01',
      name: 'Player Override',
      description: 'Cannot override player agency or choices',
      patterns: [
        'you must do',
        'you have no choice',
        "your choice doesn't matter",
        'you are forced to',
        'you cannot choose',
        'I decide for you',
      ],
      severity: 'halt',
    },
    {
      id: 'GAM-F02',
      name: 'Rule Invention',
      description: 'Cannot invent new rules that contradict established ones',
      patterns: [
        'new rule:',
        "I'm adding a rule",
        'from now on, the rule is',
        'forget the previous rules',
        "rules don't apply here",
      ],
      severity: 'halt',
    },
    {
      id: 'GAM-F03',
      name: 'Meta-Gaming',
      description: 'Cannot break fourth wall or reveal GM intentions',
      patterns: [
        'the DM wants',
        'behind the screen',
        'as the game master, I',
        'out of character',
        'breaking character',
        'the plot requires',
      ],
      severity: 'warn',
    },
  ],
  allowed: [
    {
      id: 'GAM-A01',
      name: 'Lore Consistency',
      description: 'Maintain consistent world lore and history',
      examples: [
        "According to the realm's history...",
        'The ancient texts speak of...',
      ],
    },
    {
      id: 'GAM-A02',
      name: 'Mechanic Application',
      description: 'Apply game mechanics fairly',
      examples: [
        'Roll a d20 for the skill check...',
        'The DC for this action is...',
      ],
    },
    {
      id: 'GAM-A03',
      name: 'State Tracking',
      description: 'Track game state and player resources',
      examples: [
        'Your inventory now contains...',
        'You have 3 spell slots remaining...',
      ],
    },
  ],
};

// =============================================================================
// ACADEMIC PATTERNS
// =============================================================================

export const ACADEMIC_PATTERNS: DomainPatternSet = {
  domain: 'academic',
  displayName: 'Academic Research',
  forbidden: [
    {
      id: 'ACA-F01',
      name: 'Uncited Fact Claims',
      description: 'Cannot make factual claims without citation',
      patterns: [
        'it is proven that',
        'science (says|shows|proves)',
        'research proves',
        'studies confirm',
        'experts agree that',
      ],
      severity: 'warn',
    },
    {
      id: 'ACA-F02',
      name: 'Fabricated Citations',
      description: 'Cannot fabricate sources or citations',
      patterns: [
        'according to Dr\\. [A-Z][a-z]+ \\(\\d{4}\\)',
        'in the study by',
        'as published in',
      ],
      severity: 'halt',
    },
    {
      id: 'ACA-F03',
      name: 'Overstatement',
      description: 'Cannot overstate significance of findings',
      patterns: [
        'this proves conclusively',
        'definitively shows',
        'beyond any doubt',
        'irrefutable evidence',
        'the definitive answer',
      ],
      severity: 'warn',
    },
  ],
  allowed: [
    {
      id: 'ACA-A01',
      name: 'Source Citation',
      description: 'Cite sources when making claims',
      examples: [
        'According to Smith et al. (2023)...',
        'The data from [source] suggests...',
      ],
    },
    {
      id: 'ACA-A02',
      name: 'Hypothesis Framing',
      description: 'Frame claims as hypotheses to test',
      examples: [
        'One hypothesis is that...',
        'This suggests, though more research is needed...',
      ],
    },
    {
      id: 'ACA-A03',
      name: 'Limitation Acknowledgment',
      description: 'Acknowledge limitations of analysis',
      examples: [
        'This analysis is limited by...',
        'Caveats include...',
      ],
    },
  ],
};

// =============================================================================
// MEDICAL PATTERNS
// =============================================================================

export const MEDICAL_PATTERNS: DomainPatternSet = {
  domain: 'medical',
  displayName: 'Medical Research Assistant',
  forbidden: [
    {
      id: 'MR-F01',
      name: 'Diagnostic Claims',
      description: 'Cannot claim to diagnose conditions',
      patterns: [
        'you have',
        'you are suffering from',
        'this indicates you have',
        'you likely have',
        'diagnosis:',
        'you are diagnosed with',
        'this is definitely',
      ],
      severity: 'halt',
    },
    {
      id: 'MR-F02',
      name: 'Treatment Prescriptions',
      description: 'Cannot prescribe treatments or medications',
      patterns: [
        'you should take',
        'I recommend taking',
        'stop taking',
        'increase your dose',
        'take \\d+ ?mg',
        'try this medication',
        'start treatment with',
      ],
      severity: 'halt',
    },
    {
      id: 'MR-F03',
      name: 'Outcome Guarantees',
      description: 'Cannot guarantee health outcomes',
      patterns: [
        'this will cure',
        'guaranteed to work',
        'you will be healed',
        'certain recovery',
        'no side effects',
        'completely safe',
      ],
      severity: 'halt',
    },
    {
      id: 'MR-F04',
      name: 'Anti-Medical Advice',
      description: 'Cannot advise against medical care',
      patterns: [
        "don't see a doctor",
        'no need for medical',
        'ignore your physician',
        'doctors are wrong',
        'skip your appointment',
      ],
      severity: 'halt',
    },
  ],
  allowed: [
    {
      id: 'MR-A01',
      name: 'Pattern Analysis',
      description: 'Analyze patterns in health data',
      examples: [
        'What patterns appear in my symptom log?',
        'When do my headaches typically occur?',
      ],
    },
    {
      id: 'MR-A02',
      name: 'Research Comparison',
      description: 'Compare findings to published research',
      examples: [
        'How do these findings compare to the study?',
        'What does the literature say about this pattern?',
      ],
    },
    {
      id: 'MR-A03',
      name: 'Question Preparation',
      description: 'Help prepare questions for healthcare providers',
      examples: [
        'What questions should I ask my doctor?',
        'Help me summarize this for my appointment.',
      ],
    },
    {
      id: 'MR-A04',
      name: 'Educational Context',
      description: 'Provide general educational information',
      examples: [
        'What is the general mechanism of...?',
        'How is this condition typically studied?',
      ],
    },
  ],
};

// =============================================================================
// DOMAIN REGISTRY
// =============================================================================

export const DOMAIN_PATTERNS: Record<string, DomainPatternSet> = {
  financial: FINANCIAL_PATTERNS,
  legal: LEGAL_PATTERNS,
  game: GAME_PATTERNS,
  academic: ACADEMIC_PATTERNS,
  medical: MEDICAL_PATTERNS,
};

/**
 * Get pattern set for a domain
 */
export function getDomainPatterns(domain: string): DomainPatternSet | null {
  return DOMAIN_PATTERNS[domain] || null;
}

/**
 * Convert domain patterns to ResponseBoundary format for the configurator
 */
export function domainPatternsToResponseBoundaries(
  domain: string
): Array<{
  id: string;
  text: string;
  type: 'must' | 'must-not';
  patterns: string[];
  severity: 'halt' | 'warn';
  linkedPatternId: string;
}> {
  const patternSet = getDomainPatterns(domain);
  if (!patternSet) return [];

  return patternSet.forbidden.map(f => ({
    id: f.id,
    text: f.description,
    type: 'must-not' as const,
    patterns: f.patterns,
    severity: f.severity,
    linkedPatternId: f.id,
  }));
}

/**
 * Get all available domain keys
 */
export function getAvailableDomains(): string[] {
  return Object.keys(DOMAIN_PATTERNS);
}
