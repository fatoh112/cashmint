import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // Create client using user's JWT to authenticate them
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Initialize service client
    const serviceClient = createClient(supabaseUrl, supabaseServiceRole)

    let body: any = {}
    try {
      body = await req.json()
    } catch (e) {
      console.warn("Could not parse request JSON body:", e.message)
    }

    const { user_id } = body

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Find store of target user mapping
    const { data: targetMapping } = await serviceClient
      .from('store_users')
      .select('store_id')
      .eq('user_id', user_id)
      .maybeSingle()

    if (!targetMapping) {
      return new Response(JSON.stringify({ error: 'Target user mapping not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check permissions
    const { data: callerMapping } = await serviceClient
      .from('store_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('store_id', targetMapping.store_id)
      .maybeSingle()

    const { data: isSuper } = await serviceClient.rpc('is_superadmin')

    const isAuthorized = isSuper || (callerMapping && callerMapping.role === 'admin')
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin access required for this store' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Delete mapping record from public.store_users first
    const { error: deleteMappingError } = await serviceClient
      .from('store_users')
      .delete()
      .eq('user_id', user_id)

    if (deleteMappingError) {
      console.error("Error deleting store_users mapping:", deleteMappingError)
      return new Response(JSON.stringify({ error: deleteMappingError.message || 'Failed to delete store mapping' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Delete user account from Auth securely
    const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(user_id)

    if (deleteUserError) {
      console.error("Error deleting user from Auth:", deleteUserError)
      return new Response(JSON.stringify({ error: deleteUserError.message || 'Failed to delete user account' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, user_id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error("admin-delete-user error:", err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
