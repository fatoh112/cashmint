-- Link public.store_users.user_id with auth.users with CASCADE updates/deletes

ALTER TABLE public.store_users
ADD CONSTRAINT fk_store_users_user_id
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE CASCADE;
