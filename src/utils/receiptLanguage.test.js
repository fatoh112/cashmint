import { describe, expect, it } from 'vitest';
import { buildReceiptXML } from './printerService';
import { getLocalizedReceiptText, mergeAndEnforceReceiptConfig, normalizeReceiptLanguage } from './receiptSchema';

describe('receipt language isolation', () => {
  it('normalizes legacy pos_language to English', () => {
    expect(normalizeReceiptLanguage('pos_language')).toBe('en');
    expect(mergeAndEnforceReceiptConfig({ language_mode: 'pos_language' }).language_mode).toBe('en');
  });

  it.each(['ar', 'fr', 'nl'])('preserves explicit %s receipt language', (language) => {
    expect(normalizeReceiptLanguage(language)).toBe(language);
    expect(mergeAndEnforceReceiptConfig({ language_mode: language }).language_mode).toBe(language);
  });

  it('does not let Backoffice isArabic affect an explicit receipt language', async () => {
    const xml = await buildReceiptXML({
      total_amount: 10,
      vat_amount: 1,
      subtotal_excl_vat: 9,
      raw_payload: { order_type: 'takeaway', cart_items: [] }
    }, 'Cashmint', {
      templateConfig: { language_mode: 'fr', header: { show_logo: false } },
      isArabic: true
    });
    expect(xml).toContain('Sous-total HT');
  });
});

describe('receipt catalog localization', () => {
  const arabicChocolate = '\u0634\u0648\u0643\u0648\u0644\u0627\u062a\u0629 \u0633\u0627\u062e\u0646\u0629';
  const arabicCinnamon = '\u0642\u0631\u0641\u0629';

  it('localizes catalog items and modifiers using the selected receipt language', () => {
    const item = { name: 'Hot Chocolate', name_ar: arabicChocolate, translations: { fr: 'Chocolat chaud', nl: 'Warme chocolademelk' } };
    const modifier = { name: 'Cinnamon', translations: { ar: arabicCinnamon, fr: 'Cannelle', nl: 'Kaneel' } };
    expect(getLocalizedReceiptText(item, 'en')).toBe('Hot Chocolate');
    expect(getLocalizedReceiptText(item, 'ar')).toBe(arabicChocolate);
    expect(getLocalizedReceiptText(item, 'fr')).toBe('Chocolat chaud');
    expect(getLocalizedReceiptText(item, 'nl')).toBe('Warme chocolademelk');
    expect(getLocalizedReceiptText(modifier, 'ar')).toBe(arabicCinnamon);
  });

  it('never uses an Arabic base name for English when an identifier exists', () => {
    expect(getLocalizedReceiptText({ name: arabicChocolate, sku: 'CAF-01' }, 'en')).toBe('CAF-01');
  });
});
