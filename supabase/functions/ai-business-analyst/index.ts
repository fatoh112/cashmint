import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const kimiApiKey = Deno.env.get('KIMI_API_KEY');
    if (!kimiApiKey) {
      throw new Error("KIMI_API_KEY environment secret is not set in Deno.");
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Create client using user's JWT to authenticate them
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      console.warn("Could not parse request JSON body:", e.message);
    }

    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Missing or invalid 'messages' array payload." }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify if caller is superadmin via DB rpc helper
    const { data: isSuperAdminCheck } = await userClient.rpc('is_superadmin');
    const isSuper = !!isSuperAdminCheck;

    // Securely define the system prompt server-side based on is_superadmin
    const systemPrompt = isSuper
      ? "You are an expert global platform analyst for Cashmint POS. Help the super admin analyze overall system performance, stores, analytics, system health, and configurations. Keep your responses concise, highly professional, and directly actionable. Use bullet points where appropriate."
      : "You are an expert POS business analyst. Help the store owner analyze their sales, products, menu architecture, and general settings. Keep your responses concise, highly professional, and directly actionable. Use bullet points where appropriate.";

    // Call Dahl completions endpoint with moonshotai/Kimi-K2.6 model
    const response = await fetch("https://inference.dahl.global/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${kimiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "moonshotai/Kimi-K2.6",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...messages
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Dahl API responded with status ${response.status}: ${errorText}`);
      return new Response(JSON.stringify({ error: `Dahl API error: ${errorText}` }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message;

    return new Response(JSON.stringify({ message: assistantMessage }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("AI Business Analyst Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
