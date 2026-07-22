import { describe, expect, it } from 'vitest';
import { buildReceiptXML } from './printerService';
import { mergeAndEnforceReceiptConfig, normalizeReceiptLanguage } from './receiptSchema';

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
    expect(xml).not.toContain('Ø§Ù„Ù…Ø¬Ù…ÙˆØ¹');
  });
});
