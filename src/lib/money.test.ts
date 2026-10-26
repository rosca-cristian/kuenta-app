import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Money, PrivacyProvider } from './money';
import { Amount } from '../ui/components';

const render = (element: ReactElement, hidden: boolean) => renderToStaticMarkup(createElement(PrivacyProvider, { hidden, children: element }));

describe('Money', () => {
  it('writes the amount as usual with privacy mode off', () => {
    expect(render(createElement(Money, { cents: -123456 }), false)).toBe('−1.234,56 €');
    expect(render(createElement(Money, { cents: 1250, format: 'signed' }), false)).toBe('+12,50 €');
    expect(render(createElement(Money, { cents: 123456, format: 'compact' }), false)).toBe('1,2 mil €');
    expect(render(createElement(Money, { cents: 500, sign: '−', className: 'text-muted' }), false)).toBe('<span class="text-muted">−5,00 €</span>');
  });

  it('never puts the real amount on the page in privacy mode: a blurred placeholder and "Importe oculto"', () => {
    for (const format of ['plain', 'signed', 'compact'] as const) {
      const html = render(createElement(Money, { cents: -123456, format, sign: '+', className: 'text-income' }), true);
      expect(html).toBe(
        '<span class="whitespace-nowrap text-income" data-testid="hidden-amount">' +
          '<span aria-hidden="true" class="masked-amount">0.000,00 €</span>' +
          '<span class="sr-only">Importe oculto</span></span>',
      );
    }
  });

  it('keeps Amount working through it: signs dropped when hidden, colours kept', () => {
    expect(render(createElement(Amount, { cents: 1500, kind: 'income' }), false)).toBe('<span class="tabular-nums text-income ">+15,00 €</span>');
    expect(render(createElement(Amount, { cents: -3000, kind: 'expense' }), false)).toBe('<span class="tabular-nums  ">−30,00 €</span>');
    const hidden = render(createElement(Amount, { cents: 1500, kind: 'income' }), true);
    expect(hidden).toContain('text-income');
    expect(hidden).not.toMatch(/15|\+/);
  });
});
