import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const configured = () => ["STRIPE_SECRET_KEY", "STRIPE_CONNECT_CLIENT_ID", "STRIPE_CONNECT_REDIRECT_URI", "STRIPE_CONNECT_SUCCESS_URL", "STRIPE_CONNECT_ERROR_URL"].every((name) => Boolean(Deno.env.get(name)?.trim()));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "UNAUTHORIZED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "UNAUTHORIZED" }, 401);
  let storeId: string | undefined;
  try { ({ store_id: storeId } = await req.json()); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
  if (!storeId) return json({ error: "INVALID_REQUEST" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: membership } = await admin.from("store_users").select("role").eq("store_id", storeId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "admin" && membership?.role !== "superadmin") return json({ error: "FORBIDDEN" }, 403);
  if (!configured()) return json({ configured: false, error: "STRIPE_CONNECT_NOT_CONFIGURED" }, 503);

  const { data: connection, error } = await admin
    .from("stripe_connect_connections")
    .select("stripe_account_id, scope, livemode, status, connected_at")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) return json({ error: "STRIPE_CONNECT_STATUS_FAILED" }, 500);
  return json({ configured: true, connection: connection ?? null });
});
