import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

    // Initialize service client to run roles check and admin queries
    const serviceClient = createClient(supabaseUrl, supabaseServiceRole)

    let body: any = {}
    try {
      body = await req.json()
    } catch (e) {
      console.warn("Could not parse request JSON body:", e.message)
    }

    const { email, password, role, store_id, ai_enabled } = body

    if (!email || !password || !role || !store_id) {
      return new Response(JSON.stringify({ error: 'Missing required parameters: email, password, role, store_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify caller has permissions (is store admin of that store or is superadmin)
    const { data: callerMapping } = await serviceClient
      .from('store_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('store_id', store_id)
      .maybeSingle()

    const { data: isSuper } = await serviceClient.rpc('is_superadmin')

    // ONLY verified superadmins can assign the superadmin role
    if (role === 'superadmin' && !isSuper) {
      return new Response(JSON.stringify({ error: 'Forbidden: Only verified superadmins can assign the superadmin role' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const isAuthorized = isSuper || (callerMapping && callerMapping.role === 'admin')
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin access required for this store' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Create the user in auth.users
    const { data: userData, error: userError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })

    if (userError || !userData?.user) {
      console.error("Auth admin createUser error:", userError)
      return new Response(JSON.stringify({ error: userError?.message || 'Failed to create user in Auth' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userUuid = userData.user.id
    console.log(`Created user in Auth successfully: ${email} (${userUuid})`)

    // 2. Insert the mapping into public.store_users
    const { data: mappingData, error: mappingError } = await serviceClient
      .from('store_users')
      .insert({
        user_id: userUuid,
        store_id,
        role,
        ai_enabled: !!ai_enabled
      })
      .select()
      .single()

    if (mappingError) {
      console.error("Error inserting store_users mapping:", mappingError)
      try {
        await serviceClient.auth.admin.deleteUser(userUuid)
      } catch (cleanupErr) {
        console.error("Failed to delete user on cleanup:", cleanupErr)
      }
      return new Response(JSON.stringify({ error: mappingError.message || 'Failed to insert store mapping' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, user_id: userUuid, mapping_id: mappingData.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error("admin-create-user error:", err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
