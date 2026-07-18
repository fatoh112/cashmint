-- Create pos_devices table
CREATE TABLE IF NOT EXISTS public.pos_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  activation_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  last_active_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create cashier_sessions table
CREATE TABLE IF NOT EXISTS public.cashier_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.pos_devices(id) ON DELETE CASCADE,
  cashier_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_balance NUMERIC NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS) on both tables
ALTER TABLE public.pos_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow public read of devices" ON public.pos_devices;
DROP POLICY IF EXISTS "Allow store admins to manage devices" ON public.pos_devices;
DROP POLICY IF EXISTS "Allow public insert of cashier sessions" ON public.cashier_sessions;
DROP POLICY IF EXISTS "Allow public select/update of cashier sessions" ON public.cashier_sessions;
DROP POLICY IF EXISTS "Allow store admins to select cashier sessions" ON public.cashier_sessions;

-- RLS Policies for pos_devices
-- Anyone can select devices to verify activation codes (needed for anonymous login & realtime check)
CREATE POLICY "Allow public read of devices"
ON public.pos_devices FOR SELECT
USING (true);

-- Admins can manage pos_devices (insert, update, delete)
CREATE POLICY "Allow store admins to manage devices"
ON public.pos_devices FOR ALL
TO authenticated
USING (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  store_id IN (
    SELECT store_id 
    FROM public.store_users 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- RLS Policies for cashier_sessions
-- Public insert of cashier sessions (to open shift from POS anonymously)
CREATE POLICY "Allow public insert of cashier sessions"
ON public.cashier_sessions FOR INSERT
WITH CHECK (true);

-- Public select and update of cashier sessions (to verify status and close shift)
CREATE POLICY "Allow public select/update of cashier sessions"
ON public.cashier_sessions FOR SELECT, UPDATE
USING (true);

-- Store admins can select/read all cashier sessions for their store (for reporting)
CREATE POLICY "Allow store admins to select cashier sessions"
ON public.cashier_sessions FOR SELECT
TO authenticated
USING (
  device_id IN (
    SELECT id 
    FROM public.pos_devices 
    WHERE store_id IN (
      SELECT store_id 
      FROM public.store_users 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
);
