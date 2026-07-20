-- Migration: Expand receipt_templates.template_type check constraint to support customer_receipt and cashier_receipt

ALTER TABLE public.receipt_templates 
  DROP CONSTRAINT IF EXISTS receipt_templates_template_type_check;

ALTER TABLE public.receipt_templates 
  ADD CONSTRAINT receipt_templates_template_type_check 
  CHECK (template_type IN ('pos_receipt', 'cashier_receipt', 'customer_receipt', 'kitchen_ticket', 'invoice', 'refund_receipt'));
