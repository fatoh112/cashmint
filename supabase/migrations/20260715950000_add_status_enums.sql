-- Create enums for cashier sessions and device statuses
CREATE TYPE public.cashier_session_status AS ENUM ('open', 'closed');
CREATE TYPE public.pos_device_status AS ENUM ('active', 'revoked');

-- Alter cashier_sessions status to use enum
ALTER TABLE public.cashier_sessions 
ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.cashier_sessions 
ALTER COLUMN status TYPE public.cashier_session_status USING status::public.cashier_session_status;

ALTER TABLE public.cashier_sessions 
ALTER COLUMN status SET DEFAULT 'open'::public.cashier_session_status;

-- Alter pos_devices status to use enum
ALTER TABLE public.pos_devices 
ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.pos_devices 
ALTER COLUMN status TYPE public.pos_device_status USING status::public.pos_device_status;

ALTER TABLE public.pos_devices 
ALTER COLUMN status SET DEFAULT 'active'::public.pos_device_status;
