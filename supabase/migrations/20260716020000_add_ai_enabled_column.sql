-- Add ai_enabled column to public.store_users table
ALTER TABLE public.store_users
ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false;
