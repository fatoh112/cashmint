-- CREATE TABLE statements with IF NOT EXISTS for resilience

CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  hubrise_location_id TEXT UNIQUE,
  hubrise_api_key TEXT,
  logo_url TEXT,
  theme_color TEXT,
  primary_color TEXT,
  bg_color TEXT,
  banner_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'cashier')),
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_store UNIQUE (user_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  vat_rate NUMERIC NOT NULL DEFAULT 12.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_adjustment NUMERIC NOT NULL DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('new', 'pending', 'completed', 'cancelled')),
  total_amount NUMERIC NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  subtotal NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.item_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  is_required BOOLEAN NOT NULL DEFAULT false,
  min_items INTEGER NOT NULL DEFAULT 0,
  max_items INTEGER NOT NULL DEFAULT 1,
  price_strategy TEXT NOT NULL CHECK (price_strategy IN ('keep_initial', 'set_price')),
  group_price NUMERIC NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_item_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.item_groups(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  override_price NUMERIC,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
