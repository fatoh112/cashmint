-- Migration: Create receipt_templates table and RLS policies

CREATE TABLE IF NOT EXISTS public.receipt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN ('pos_receipt', 'kitchen_ticket', 'invoice', 'refund_receipt')),
  template_name TEXT NOT NULL,
  paper_width INTEGER NOT NULL DEFAULT 80 CHECK (paper_width IN (80, 58)),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_store_template_type UNIQUE (store_id, template_type)
);

-- Index for fast lookup by store and type
CREATE INDEX IF NOT EXISTS idx_receipt_templates_store_type ON public.receipt_templates(store_id, template_type);

-- RLS Setup
ALTER TABLE public.receipt_templates ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow SELECT for store users and global defaults (store_id IS NULL)
DROP POLICY IF EXISTS "Allow read for store users and global defaults" ON public.receipt_templates;
CREATE POLICY "Allow read for store users and global defaults"
  ON public.receipt_templates FOR SELECT
  USING (
    store_id IS NULL OR 
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );

-- Policy 2: Allow store users to INSERT/UPDATE/DELETE templates for their store
DROP POLICY IF EXISTS "Allow store users to manage templates" ON public.receipt_templates;
CREATE POLICY "Allow store users to manage templates"
  ON public.receipt_templates FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM public.store_users WHERE user_id = auth.uid()
    )
  );
