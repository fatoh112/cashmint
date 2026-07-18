import { describe, expect, it } from 'vitest';
import { contrastRatio, DEFAULT_STORE_THEME, generateStoreTheme, readableText } from './storeTheme';

describe('store theme generation', () => {
  it('chooses readable text for contrasting surfaces', () => {
    expect(readableText('#111827')).toBe('#ffffff');
    expect(readableText('#ffffff')).toBe('#111827');
  });
  it('creates a complete usable theme from a logo color', () => {
    const theme = generateStoreTheme('#0ea5e9', '#475569');
    expect(theme.primary).toBe('#0ea5e9');
    expect(theme.sidebarBackground).toBe('#475569');
    expect(contrastRatio(theme.primary, theme.buttonText)).toBeGreaterThan(3);
  });
  it('falls back from unsuitable pale or near-black logo colors', () => {
    expect(generateStoreTheme('#ffffff').primary).toBe(DEFAULT_STORE_THEME.primary);
    expect(generateStoreTheme('#000000').primary).toBe(DEFAULT_STORE_THEME.primary);
  });
});
