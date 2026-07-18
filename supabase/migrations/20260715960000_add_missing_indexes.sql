-- Create performance indexes for tenant query optimizations

CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_store_id ON public.products(store_id);
CREATE INDEX IF NOT EXISTS idx_categories_store_id ON public.categories(store_id);
CREATE INDEX IF NOT EXISTS idx_modifiers_product_id ON public.modifiers(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_store_id ON public.orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_store_id ON public.order_items(store_id);
CREATE INDEX IF NOT EXISTS idx_pos_devices_store_id ON public.pos_devices(store_id);
CREATE INDEX IF NOT EXISTS idx_cashier_sessions_device_id ON public.cashier_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_store_users_user_id ON public.store_users(user_id);
CREATE INDEX IF NOT EXISTS idx_store_users_store_id ON public.store_users(store_id);
CREATE INDEX IF NOT EXISTS idx_group_item_mapping_group_id ON public.group_item_mapping(group_id);
CREATE INDEX IF NOT EXISTS idx_group_item_mapping_product_id ON public.group_item_mapping(product_id);
CREATE INDEX IF NOT EXISTS idx_group_item_mapping_store_id ON public.group_item_mapping(store_id);
CREATE INDEX IF NOT EXISTS idx_item_groups_store_id ON public.item_groups(store_id);
CREATE INDEX IF NOT EXISTS idx_coupons_store_id ON public.coupons(store_id);
