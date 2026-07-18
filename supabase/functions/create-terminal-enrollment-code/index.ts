import { authenticatedUser, corsHeaders, json, service } from '../_shared/terminal.ts'

const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map((byte) => byte.toString(16).padStart(2, '0')).join('')

const randomCode = () => {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 24).toUpperCase()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const user = await authenticatedUser(req)
    const { store_id } = await req.json()
    if (!store_id) throw new Error('store_id is required')
    const db = service()
    const { data: membership } = await db.from('store_users').select('id').eq('store_id', store_id).eq('user_id', user.id).maybeSingle()
    if (!membership) throw new Error('Not allowed to create terminal enrollment codes for this store')
    const { data: location } = await db.from('restaurant_locations').select('id,restaurant_id').eq('store_id', store_id).single()
    if (!location) throw new Error('Store has no payment location')
    const { data: config } = await db.from('restaurant_payment_configs')
      .select('id,provider_config')
      .eq('location_id', location.id)
      .eq('provider_type', 'stripe_android_bridge')
      .eq('is_enabled', true)
      .single()
    if (!config?.provider_config?.stripe_location_id) throw new Error('Stripe Android bridge is not configured for this location')
    const code = randomCode()
    const { error } = await db.from('terminal_enrollment_codes').insert({
      code_hash: await sha256(code),
      restaurant_id: location.restaurant_id,
      location_id: location.id,
      payment_config_id: config.id,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      created_by: user.id,
    })
    if (error) throw error
    return json({ enrollment_code: code, expires_in_seconds: 900 })
  } catch (error) {
    return json({ error: error.message }, 400)
  }
})
