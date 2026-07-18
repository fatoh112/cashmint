-- Trigger to clean up auth.users when a store is deleted
CREATE OR REPLACE FUNCTION public.handle_store_deletion_cleanup()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete users associated with this store from auth.users
  -- only if they do not have mappings to other stores.
  DELETE FROM auth.users
  WHERE id IN (
    SELECT user_id 
    FROM public.store_users 
    WHERE store_id = OLD.id
  )
  AND id NOT IN (
    SELECT user_id 
    FROM public.store_users 
    WHERE store_id != OLD.id
  );
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER on_store_delete_cleanup_auth
  BEFORE DELETE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_store_deletion_cleanup();
