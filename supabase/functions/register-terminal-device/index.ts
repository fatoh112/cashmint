import { corsHeaders, json, service } from '../_shared/terminal.ts'

const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map((byte) => byte.toString(16).padStart(2, '0')).join('')
const randomPassword = () => crypto.randomUUID() + crypto.randomUUID() + 'Aa1!'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { enrollment_code, display_name } = await req.json()
    if (!enrollment_code || typeof enrollment_code !== 'string' || enrollment_code.length < 12) throw new Error('Invalid enrollment code')
    const db = service()
    const codeHash = await sha256(enrollment_code)
    const { data: enrollment, error: enrollmentError } = await db.from('terminal_enrollment_codes').select('*').eq('code_hash', codeHash).is('redeemed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (enrollmentError || !enrollment) throw new Error('Enrollment code is invalid, expired, or already used')
    const { data: config } = await db.from('restaurant_payment_configs').select('id,restaurant_id,location_id,provider_type,provider_config').eq('id', enrollment.payment_config_id).eq('location_id', enrollment.location_id).eq('is_enabled', true).single()
    if (!config || config.provider_type !== 'stripe_android_bridge') throw new Error('Invalid terminal payment configuration')
    const bridgeEmail = `terminal-${crypto.randomUUID()}@bridge.cashmint.invalid`; const bridgePassword = randomPassword()
    const { data: bridge, error: bridgeError } = await db.auth.admin.createUser({ email: bridgeEmail, password: bridgePassword, email_confirm: true, app_metadata: { terminal_bridge: true } })
    if (bridgeError || !bridge.user) throw new Error(bridgeError?.message ?? 'Could not create terminal bridge identity')
    const { data: device, error } = await db.from('terminal_devices').insert({ restaurant_id: config.restaurant_id, location_id: enrollment.location_id, payment_config_id: config.id, bridge_user_id: bridge.user.id, display_name: display_name || 'Cashmint bridge' }).select('id,restaurant_id,location_id,display_name').single()
    if (error) throw error
    const { data: redeemed } = await db.from('terminal_enrollment_codes').update({ redeemed_at: new Date().toISOString(), redeemed_by_device_id: device.id }).eq('id', enrollment.id).is('redeemed_at', null).select('id').maybeSingle()
    if (!redeemed) { await db.from('terminal_devices').delete().eq('id', device.id); throw new Error('Enrollment code was redeemed concurrently') }
    const tokenResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/token?grant_type=password`, { method:'POST', headers:{ apikey:Deno.env.get('SUPABASE_ANON_KEY') ?? '', 'Content-Type':'application/json' }, body:JSON.stringify({ email:bridgeEmail, password:bridgePassword }) })
    const session = await tokenResponse.json(); if (!tokenResponse.ok || !session.access_token) throw new Error('Could not establish bridge session')
    const { data: location } = await db.from('restaurant_locations').select('name,restaurants(name)').eq('id', enrollment.location_id).single()
    return json({ device_id:device.id, restaurant_id:device.restaurant_id, location_id:device.location_id, restaurant_name:location?.restaurants?.name, location_name:location?.name, stripe_location_id:config.provider_config?.stripe_location_id ?? null, session, supabase_url:Deno.env.get('SUPABASE_URL'), anon_key:Deno.env.get('SUPABASE_ANON_KEY') })
  } catch (error) { return json({ error: error.message }, 400) }
})
