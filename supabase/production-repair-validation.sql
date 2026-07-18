-- READ-ONLY validation; run before and after an approved repair.
SELECT p.oid::regprocedure::text AS function_signature, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('next_store_receipt_number','create_accounting_order');
SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('orders','order_items','payments','store_receipt_counters') ORDER BY table_name,ordinal_position;
SELECT c.relname AS table_name,i.relname AS index_name,pg_get_indexdef(i.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_index x ON x.indrelid=c.oid JOIN pg_class i ON i.oid=x.indexrelid WHERE n.nspname='public' AND c.relname IN ('orders','order_items','payments','store_receipt_counters') ORDER BY 1,2;
SELECT o.store_id,o.receipt_number,count(*) FROM public.orders o WHERE o.receipt_number IS NOT NULL GROUP BY 1,2 HAVING count(*)>1;
SELECT c.relname,c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('orders','order_items','payments','store_receipt_counters');
SELECT table_name,privilege_type,grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('payments','store_receipt_counters') ORDER BY 1,2,3;
SELECT count(*) AS orders_count FROM public.orders; SELECT count(*) AS order_items_count FROM public.order_items; SELECT count(*) AS payments_count FROM public.payments;
SELECT provider,provider_reference,count(*) FROM public.payments WHERE provider_reference IS NOT NULL GROUP BY 1,2 HAVING count(*)>1;
