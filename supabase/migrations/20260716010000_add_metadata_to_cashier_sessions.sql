-- Add metadata column to cashier_sessions if it does not exist
ALTER TABLE public.cashier_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
