import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

serve(async (req) => {
  // Handle CORS Preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
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
    const kimiApiKey = Deno.env.get('KIMI_API_KEY');
    if (!kimiApiKey) {
      throw new Error("KIMI_API_KEY environment secret is not set in Deno.");
    }

    const { file_data } = await req.json();
    if (!file_data) {
      return new Response(JSON.stringify({ error: "Missing 'file_data' base64 payload." }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Call Kimi Vision API endpoint
    const response = await fetch("https://inference.dahl.global/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${kimiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "kimi-2.6",
        messages: [
          {
            role: "system",
            content: "You are an expert OCR and POS menu architect. Read the attached menu image, extract all items, categories, and modifier groups, and return a strict JSON object with this structure: { items: [{ itemName: string, suggestedPrice: number, accountingGroup: string, itemType: string, options: [{ groupName: string, choices: string[] }] }] }"
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract and structure all items, prices, and option groups from the attached menu image."
              },
              {
                type: "image_url",
                image_url: {
                  url: file_data
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kimi API responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    // Extract the content from the LLM's response message
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Empty message content returned from Kimi model.");
    }

    // Parse the inner JSON returned by Kimi
    const parsedMenu = JSON.parse(rawContent);

    return new Response(JSON.stringify(parsedMenu), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("AI OCR Assistant Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
