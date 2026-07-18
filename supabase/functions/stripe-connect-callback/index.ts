import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const requiredSecrets = ["STRIPE_SECRET_KEY", "STRIPE_CONNECT_CLIENT_ID", "STRIPE_CONNECT_REDIRECT_URI", "STRIPE_CONNECT_SUCCESS_URL", "STRIPE_CONNECT_ERROR_URL"];
const configured = () => requiredSecrets.every((name) => Boolean(Deno.env.get(name)?.trim()));
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const redirect = (target: string) => Response.redirect(target, 302);

serve(async (req) => {
  if (req.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!configured()) return json({ error: "STRIPE_CONNECT_NOT_CONFIGURED" }, 503);

  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const stripeError = url.searchParams.get("error");
  const errorUrl = Deno.env.get("STRIPE_CONNECT_ERROR_URL")!;
  if (!state || stripeError || !code) return redirect(errorUrl);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const now = new Date().toISOString();
  const { data: stateRecord, error: stateError } = await admin
    .from("stripe_connect_states")
    .update({ consumed_at: now })
    .eq("state", state)
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("store_id")
    .maybeSingle();
  if (stateError || !stateRecord) return redirect(errorUrl);

  const tokenResponse = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_secret: Deno.env.get("STRIPE_SECRET_KEY")!,
    }),
  });
  if (!tokenResponse.ok) {
    console.error("Stripe Connect token exchange failed", tokenResponse.status);
    return redirect(errorUrl);
  }
  const token = await tokenResponse.json();
  if (typeof token.stripe_user_id !== "string" || typeof token.scope !== "string" || typeof token.livemode !== "boolean") return redirect(errorUrl);

  const { error: connectionError } = await admin.from("stripe_connect_connections").upsert({
    store_id: stateRecord.store_id,
    stripe_account_id: token.stripe_user_id,
    scope: token.scope,
    livemode: token.livemode,
    status: "connected",
    connected_at: now,
    disconnected_at: null,
    updated_at: now,
  }, { onConflict: "store_id" });
  if (connectionError) {
    console.error("Unable to save Stripe Connect account", connectionError);
    return redirect(errorUrl);
  }
  return redirect(Deno.env.get("STRIPE_CONNECT_SUCCESS_URL")!);
});
