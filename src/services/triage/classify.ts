import type { Category, CustomRuleConfig, Rule } from '../types';
import { BUILT_IN_RULES, compileCustomRules } from './rules';

export interface Classification {
  category: Category;
  ruleId: string;
  explanation: string;
}

export const UNCLASSIFIED: Classification = {
  category: 'unclassified',
  ruleId: 'NONE',
  explanation: 'No rule matched. Ask the ShipProof agent for a suggestion or reclassify the cluster.',
};

/** Step 3 (§6.3): ordered rules, first match wins. Custom rules run before built-ins. */
export function classify(error: string | undefined, customRules?: CustomRuleConfig[] | Rule[]): Classification {
  if (!error || !error.trim()) return UNCLASSIFIED;
  const text = error.slice(0, 4000);
  const custom = toRules(customRules);
  for (const rule of [...custom, ...BUILT_IN_RULES]) {
    if (rule.pattern.test(text)) {
      return { category: rule.category, ruleId: rule.id, explanation: rule.explanation };
    }
  }
  return UNCLASSIFIED;
}

function toRules(custom: CustomRuleConfig[] | Rule[] | undefined): Rule[] {
  if (!custom || custom.length === 0) return [];
  return custom[0].pattern instanceof RegExp ? (custom as Rule[]) : compileCustomRules(custom as CustomRuleConfig[]);
}
