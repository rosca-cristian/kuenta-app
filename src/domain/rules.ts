import type { Cents } from './money';
import type { Rule, RuleActions, RuleMatch } from './model';
import { normalizeText } from './text';

/** The bank data a rule looks at. */
export interface RuleSubject {
  concept: string;
  movement: string;
  /** Signed: negative for charges, positive for credits. */
  amount: Cents;
}

function textMatches(op: RuleMatch['op'], text: string, value: string): boolean {
  const normalized = normalizeText(text);
  switch (op) {
    case 'contains':
      return normalized.includes(value);
    case 'startsWith':
      return normalized.startsWith(value);
    case 'equals':
      return normalized === value;
  }
}

/**
 * A rule's text, normalized like any text but keeping one leading or trailing
 * space, so that "dia " only matches the word "dia", never "Media Markt".
 */
function normalizeValue(value: string): string {
  const core = normalizeText(value);
  if (core === '') return '';
  return (/^\s/.test(value) ? ' ' : '') + core + (/\s$/.test(value) ? ' ' : '');
}

export function ruleMatches(match: RuleMatch, subject: RuleSubject): boolean {
  if (match.direction === 'out' && subject.amount >= 0) return false;
  if (match.direction === 'in' && subject.amount <= 0) return false;
  const value = normalizeValue(match.value);
  if (value === '') return false;
  const texts =
    match.field === 'concept' ? [subject.concept] : match.field === 'movement' ? [subject.movement] : [subject.concept, subject.movement];
  return texts.some((text) => textMatches(match.op, text, value));
}

/** The actions of the first enabled rule, by order, that matches; null when none does. */
export function applyRules(rules: Rule[], subject: RuleSubject): RuleActions | null {
  const winner = [...rules].sort((a, b) => a.order - b.order).find((rule) => rule.enabled && ruleMatches(rule.match, subject));
  return winner ? winner.actions : null;
}

/**
 * The text Kuenta proposes for a rule learnt from a transaction: the bank concept cut at
 * the first `-`, `*` or digit, normalized, so it covers every branch or order code
 * ("Mercadona - crta del inge" → "mercadona", "Www.amazon*nv14y8j34" → "www.amazon").
 * Empty for a Bizum, whose concept is just "Bizum": such a rule would match every Bizum.
 */
export function suggestedRuleText(concept: string): string {
  if (normalizeText(concept) === 'bizum') return '';
  return normalizeText(concept.split(/[-*\d]/)[0]);
}
