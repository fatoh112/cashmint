-- Create system_settings table
CREATE TABLE IF NOT EXISTS public.system_settings (
  id INTEGER PRIMARY KEY,
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  auto_backup BOOLEAN NOT NULL DEFAULT true
);

-- Insert default system configurations row
INSERT INTO public.system_settings (id, maintenance_mode, auto_backup)
VALUES (1, false, true)
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security (RLS)
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists
DROP POLICY IF EXISTS "Allow superadmin ALL on system_settings" ON public.system_settings;

-- Policy: Allow superadmins full CRUD access to system settings
CREATE POLICY "Allow superadmin ALL on system_settings"
ON public.system_settings FOR ALL
TO authenticated
USING (is_superadmin())
WITH CHECK (is_superadmin());
