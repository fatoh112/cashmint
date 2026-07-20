-- Migration: Additive schema for Cash + Card split payments
-- Strictly additive. No deletion, dropping, or renaming of existing columns/tables.

-- 1. Store and Restaurant level feature flag (default false)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS split_payment_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS split_payment_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. Update orders status check constraint additively to include partially_paid
DO $$ BEGIN
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
  ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
    CHECK (status IN ('new', 'pending', 'partially_paid', 'completed', 'cancelled', 'failed', 'expired'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- 3. Create payment_splits table
CREATE TABLE IF NOT EXISTS public.payment_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.restaurant_locations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_card', 'partially_paid', 'succeeded', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cash_confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cash_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- 4. Create payment_split_parts table
CREATE TABLE IF NOT EXISTS public.payment_split_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id UUID NOT NULL REFERENCES public.payment_splits(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  payment_request_id UUID REFERENCES public.payment_requests(id) ON DELETE SET NULL,
  provider_reference TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 5. Add additive columns to payment_requests for split support & explicit amounts
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS amount_cents BIGINT,
  ADD COLUMN IF NOT EXISTS split_part_id UUID REFERENCES public.payment_split_parts(id) ON DELETE SET NULL;

-- 6. Relax UNIQUE(order_id) on payment_requests to support retries and split parts
DO $$ BEGIN
  ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_order_id_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- 7. Add partial unique index to enforce active card-request uniqueness per split part
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_active_split_part
  ON public.payment_requests(split_part_id)
  WHERE status IN ('pending', 'claimed', 'creating_payment_intent', 'waiting_for_card', 'processing', 'cancel_requested');

CREATE INDEX IF NOT EXISTS idx_payment_requests_order_id ON public.payment_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_splits_order_id ON public.payment_splits(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_splits_store_status ON public.payment_splits(store_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_split_parts_split_id ON public.payment_split_parts(split_id);

-- 8. Enable RLS on split tables
ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_split_parts ENABLE ROW LEVEL SECURITY;

-- 9. Tenant RLS policies for payment_splits and payment_split_parts
DO $$ BEGIN
  DROP POLICY IF EXISTS "Tenant payment splits" ON public.payment_splits;
  CREATE POLICY "Tenant payment splits" ON public.payment_splits FOR ALL TO authenticated
  USING (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()))
  WITH CHECK (store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Tenant payment split parts" ON public.payment_split_parts;
  CREATE POLICY "Tenant payment split parts" ON public.payment_split_parts FOR ALL TO authenticated
  USING (order_id IN (SELECT id FROM public.orders WHERE store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin())))
  WITH CHECK (order_id IN (SELECT id FROM public.orders WHERE store_id IN (SELECT store_id FROM public.store_users WHERE user_id = (SELECT auth.uid())) OR (SELECT is_superadmin())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enable Realtime for payment_splits and payment_split_parts
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_splits;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_split_parts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
