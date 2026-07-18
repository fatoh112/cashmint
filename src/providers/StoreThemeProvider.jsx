import { useEffect } from 'react';
import { DEFAULT_STORE_THEME } from '../utils/storeTheme';

export default function StoreThemeProvider({ store, children }) {
  useEffect(() => {
    const theme = { ...DEFAULT_STORE_THEME, ...(store?.theme_config || {}) };
    const root = document.documentElement;
    const names = { primary: '--store-primary', primaryHover: '--store-primary-hover', primaryLight: '--store-primary-light', secondary: '--store-secondary', accent: '--store-accent', background: '--store-background', surface: '--store-surface', textPrimary: '--store-text-primary', textSecondary: '--store-text-secondary', border: '--store-border', sidebarBackground: '--store-sidebar', sidebarText: '--store-sidebar-text', buttonText: '--store-button-text' };
    Object.entries(names).forEach(([key, variable]) => root.style.setProperty(variable, theme[key]));
    return () => Object.values(names).forEach((variable) => root.style.removeProperty(variable));
  }, [store?.id, store?.theme_config]);
  return children;
}
