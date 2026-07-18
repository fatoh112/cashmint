-- Add total_sales and cash_balance columns to cashier_sessions
ALTER TABLE public.cashier_sessions ADD COLUMN IF NOT EXISTS total_sales NUMERIC NOT NULL DEFAULT 0.00;
ALTER TABLE public.cashier_sessions ADD COLUMN IF NOT EXISTS cash_balance NUMERIC NOT NULL DEFAULT 0.00;
