import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const storesSource = fs.readFileSync(path.join(root, 'src/superadmin/StoresManagement.jsx'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const deletionMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260724091213_safe_store_deletion.sql'), 'utf8');

describe('safe Super Admin store deletion regressions', () => {
  it('uses the secure RPC and never deletes store rows directly from the UI', () => {
    expect(storesSource).toContain("rpc('superadmin_delete_store'");
    expect(storesSource).not.toMatch(/from\(['"]stores['"]\)[\s\S]{0,120}\.delete\(/);
    expect(storesSource).toContain('deleteConfirmation !== deleteStore.name');
    expect(storesSource).toContain('deleteSubmitting');
  });

  it('defines authorization, confirmation, history, active-payment, and rollback guards in the RPC', () => {
    expect(deletionMigration).toContain('SECURITY DEFINER');
    expect(deletionMigration).toContain('SET search_path TO public, pg_temp');
    expect(deletionMigration).toContain('SUPERADMIN_REQUIRED');
    expect(deletionMigration).toContain('CONFIRMATION_NAME_MISMATCH');
    expect(deletionMigration).toContain('STORE_NOT_FOUND');
    expect(deletionMigration).toContain('STORE_HAS_FINANCIAL_HISTORY');
    expect(deletionMigration).toContain('ACTIVE_TERMINAL_PAYMENT_EXISTS');
    expect(deletionMigration).toContain('REVOKE ALL ON FUNCTION');
    expect(deletionMigration).not.toContain('auth.users');
  });

  it('keeps the catalog deletion order and leaves auth accounts untouched', () => {
    expect(deletionMigration.indexOf('DELETE FROM public.group_item_mapping')).toBeLessThan(deletionMigration.indexOf('DELETE FROM public.products'));
    expect(deletionMigration.indexOf('DELETE FROM public.products')).toBeLessThan(deletionMigration.indexOf('DELETE FROM public.categories'));
    expect(deletionMigration.indexOf('DELETE FROM public.store_users')).toBeLessThan(deletionMigration.indexOf('DELETE FROM public.stores'));
  });

  it('does not start terminal availability polling in Master or Store builds', () => {
    expect(appSource).toContain('if (!isPosMode) return;');
    expect(appSource).toContain('terminal_payment_availability');
  });
});
