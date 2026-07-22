import { assertCardPaymentsCapability, authenticatedUserContext, corsHeaders, json, safeReader, service, stripeRequest } from '../_shared/terminal.ts'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { user, client } = await authenticatedUserContext(req); const input = await req.json(); const db = service()
    const { data: config } = await db.from('restaurant_payment_configs').select('*, restaurant_locations!inner(store_id)').eq('id', input.payment_config_id).eq('provider_type','stripe_server_driven').maybeSingle()
    if (!config) throw new Error('Server-driven configuration not found')
    const { data: member } = await db.from('store_users').select('role').eq('store_id', config.restaurant_locations.store_id).eq('user_id', user.id).maybeSingle()
    const { data: superadmin } = await client.rpc('is_superadmin')
    if ((!member || !['admin','superadmin'].includes(member.role)) && !superadmin) throw new Error('Store admin access required')
    const action = input.action
    if (action === 'disable' || action === 'enable') { await db.from('stripe_terminal_readers').update({ is_enabled: action === 'enable', updated_at:new Date().toISOString() }).eq('id',input.reader_id).eq('payment_config_id',config.id); return json({ ok:true }) }
    await assertCardPaymentsCapability(config.provider_config ?? {})
    let reader: Record<string,any>
    if (action === 'register') {
      if (!input.registration_code) throw new Error('A real WisePOS E registration code is required')
      reader = await stripeRequest('/terminal/readers', config.provider_config ?? {}, { method:'POST', body:new URLSearchParams({ registration_code:input.registration_code, location:config.provider_config.stripe_location_id, ...(input.label ? {label:String(input.label)} : {}) }) }, `reader-register:${config.id}:${input.registration_code}`)
    } else {
      if (!input.stripe_reader_id && action === 'attach_existing') throw new Error('Stripe Reader ID is required')
      let stripeId = input.stripe_reader_id
      if (!stripeId && input.reader_id) { const { data: stored } = await db.from('stripe_terminal_readers').select('stripe_reader_id').eq('id',input.reader_id).eq('payment_config_id',config.id).maybeSingle(); stripeId = stored?.stripe_reader_id }
      if (!stripeId) throw new Error('Reader ID is required')
      reader = await stripeRequest(`/terminal/readers/${stripeId}`, config.provider_config ?? {})
    }
    if (reader.location !== config.provider_config.stripe_location_id) throw new Error('Reader is assigned to a different Stripe Location')
    const safe = safeReader(reader); const payload = { store_id:config.restaurant_locations.store_id, restaurant_id:config.restaurant_id, location_id:config.location_id, payment_config_id:config.id, stripe_account_id:config.provider_config.stripe_account_id ?? null, stripe_location_id:reader.location, stripe_reader_id:reader.id, serial_number:safe.serial_number, label:safe.label, device_type:safe.device_type, status:safe.status, action_status:safe.action_status, action_type:safe.action_type, livemode:safe.livemode, last_seen_at:safe.last_seen_at, last_synced_at:new Date().toISOString(), metadata:safe.metadata, is_enabled:true }
    const { data: saved, error } = await db.from('stripe_terminal_readers').upsert(payload,{onConflict:'stripe_account_id,stripe_reader_id'}).select().single(); if(error) throw error
    await db.from('superadmin_audit_logs').insert({ actor_user_id:user.id, actor_email:user.email, action:`server_reader_${action}`, entity_type:'stripe_terminal_reader', entity_id:saved.id, store_id:config.restaurant_locations.store_id, new_value:{reader_id:saved.id, stripe_reader_id:saved.stripe_reader_id, location_id:config.location_id} })
    return json({ reader:saved })
  } catch(error) { return json({error:error instanceof Error?error.message:'Reader operation failed'},400) }
})
