import { corsHeaders, json, service } from '../_shared/terminal.ts'

const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map((byte) => byte.toString(16).padStart(2, '0')).join('')
// GoTrue bcrypt rejects passwords longer than 72 bytes.
const randomPassword = () => `${crypto.randomUUID()}Aa1!`
type FailureCode =
  | 'method_not_allowed' | 'invalid_json' | 'invalid_enrollment_code'
  | 'enrollment_lookup_failed' | 'enrollment_unavailable'
  | 'payment_config_lookup_failed' | 'invalid_payment_configuration'
  | 'bridge_identity_creation_failed' | 'device_creation_failed'
  | 'enrollment_redemption_failed' | 'enrollment_already_redeemed'
  | 'bridge_session_creation_failed' | 'location_lookup_failed' | 'enrollment_failed'

const failure = (code: FailureCode, error: string, status: number, details?: string) => json({ error, code, ...(details ? { details } : {}) }, status)
const logFailure = (stage: string, error: unknown) => {
  // Keep request secrets (code, password, token) out of function logs.
  console.error('register-terminal-device failed', { stage, message: error instanceof Error ? error.message : String(error) })
}
const safeDisplayName = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : ''
  return (raw || 'Cashmint bridge').slice(0, 80)
}
const displayNameCandidate = (base: string, attempt: number) => {
  if (attempt === 0) return base
  const suffix = ` (${attempt + 1})`
  return `${base.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`
}
const safeDbDetails = (error: unknown) => {
  if (!error || typeof error !== 'object') return undefined
  const value = error as { code?: string, message?: string, details?: string }
  if (value.code === '23505') return 'A terminal device with that display name already exists for this location'
  if (value.code === '23503') return 'Terminal enrollment references a missing restaurant, location, payment configuration, or bridge user'
  if (value.message) return value.message.replace(/[a-f0-9]{64}/gi, '[redacted]')
  return undefined
}
const authAdminRequest = (path: string, init: RequestInit) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) throw new Error('Service role key is unavailable')
  return fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/admin${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return failure('method_not_allowed', 'Method not allowed', 405)
  try {
    let input: { enrollment_code?: unknown, display_name?: unknown }
    try { input = await req.json() } catch { return failure('invalid_json', 'Request body must be valid JSON', 400) }
    const { enrollment_code, display_name } = input
    if (!enrollment_code || typeof enrollment_code !== 'string' || enrollment_code.length < 12) return failure('invalid_enrollment_code', 'Enrollment code is invalid', 400)
    const db = service()
    const codeHash = await sha256(enrollment_code)
    const { data: enrollment, error: enrollmentError } = await db.from('terminal_enrollment_codes').select('*').eq('code_hash', codeHash).is('redeemed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (enrollmentError) { logFailure('enrollment_lookup', enrollmentError); return failure('enrollment_lookup_failed', 'Could not validate enrollment code', 500) }
    if (!enrollment) return failure('enrollment_unavailable', 'Enrollment code is invalid, expired, or already used', 400)
    const { data: config, error: configError } = await db.from('restaurant_payment_configs').select('id,restaurant_id,location_id,provider_type,provider_config').eq('id', enrollment.payment_config_id).eq('location_id', enrollment.location_id).eq('is_enabled', true).single()
    if (configError) { logFailure('payment_config_lookup', configError); return failure('payment_config_lookup_failed', 'Could not load terminal payment configuration', 500, safeDbDetails(configError)) }
    if (!config || config.provider_type !== 'stripe_android_bridge') return failure('invalid_payment_configuration', 'Terminal payment configuration is inactive or invalid', 400)
    if (config.restaurant_id !== enrollment.restaurant_id || config.location_id !== enrollment.location_id) {
      return failure('invalid_payment_configuration', 'Terminal payment configuration does not match the enrollment code', 400)
    }
    const { data: location, error: locationError } = await db.from('restaurant_locations').select('name,restaurants(name)').eq('id', enrollment.location_id).single()
    if (locationError || !location) { logFailure('location_lookup', locationError); return failure('location_lookup_failed', 'Could not load restaurant location', 500, safeDbDetails(locationError)) }
    const bridgeEmail = `terminal-${crypto.randomUUID()}@bridge.cashmint.example.com`; const bridgePassword = randomPassword()
    const bridgeResponse = await authAdminRequest('/users', { method: 'POST', body: JSON.stringify({ email: bridgeEmail, password: bridgePassword, email_confirm: true, app_metadata: { terminal_bridge: true } }) })
    const bridge = await bridgeResponse.json().catch(() => null)
    if (!bridgeResponse.ok || !bridge?.id) { logFailure('bridge_identity_creation', `Auth status ${bridgeResponse.status}`); return failure('bridge_identity_creation_failed', `Bridge identity service rejected enrollment (HTTP ${bridgeResponse.status})`, 500, 'Bridge Auth user was not created') }
    const deleteBridge = () => authAdminRequest(`/users/${bridge.id}`, { method: 'DELETE' }).catch(() => undefined)
    const baseDisplayName = safeDisplayName(display_name)
    let device: { id: string, restaurant_id: string, location_id: string, display_name: string } | null = null
    let lastDeviceError: unknown = null
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = displayNameCandidate(baseDisplayName, attempt)
      const { data, error } = await db.from('terminal_devices').insert({
        restaurant_id: config.restaurant_id,
        location_id: enrollment.location_id,
        payment_config_id: config.id,
        bridge_user_id: bridge.id,
        display_name: candidate,
      }).select('id,restaurant_id,location_id,display_name').single()
      if (!error && data) { device = data; break }
      lastDeviceError = error
      if (error?.code !== '23505' || !String(error.message ?? '').includes('terminal_devices_location_id_display_name_key')) break
    }
    if (!device) { logFailure('device_creation', lastDeviceError); await deleteBridge(); return failure('device_creation_failed', 'Could not register terminal device', 500, safeDbDetails(lastDeviceError)) }
    const tokenResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/token?grant_type=password`, { method:'POST', headers:{ apikey:Deno.env.get('SUPABASE_ANON_KEY') ?? '', 'Content-Type':'application/json' }, body:JSON.stringify({ email:bridgeEmail, password:bridgePassword }) })
    const session = await tokenResponse.json().catch(() => null)
    if (!tokenResponse.ok || !session?.access_token) {
      logFailure('bridge_session_creation', `Auth status ${tokenResponse.status}`)
      await db.from('terminal_devices').delete().eq('id', device.id)
      await deleteBridge()
      return failure('bridge_session_creation_failed', 'Could not establish bridge session', 500, `Bridge Auth token endpoint rejected enrollment (HTTP ${tokenResponse.status})`)
    }
    const { data: redeemed, error: redemptionError } = await db.from('terminal_enrollment_codes').update({ redeemed_at: new Date().toISOString(), redeemed_by_device_id: device.id }).eq('id', enrollment.id).is('redeemed_at', null).select('id').maybeSingle()
    if (redemptionError) { logFailure('enrollment_redemption', redemptionError); await db.from('terminal_devices').delete().eq('id', device.id); await deleteBridge(); return failure('enrollment_redemption_failed', 'Could not redeem enrollment code', 500, safeDbDetails(redemptionError)) }
    if (!redeemed) { await db.from('terminal_devices').delete().eq('id', device.id); await deleteBridge(); return failure('enrollment_already_redeemed', 'Enrollment code was redeemed concurrently', 409) }
    return json({
      device_id: device.id,
      restaurant_id: device.restaurant_id,
      location_id: device.location_id,
      restaurant_name: location?.restaurants?.name,
      location_name: location?.name,
      stripe_location_id: config.provider_config?.stripe_location_id ?? null,
      session,
      supabase_url: Deno.env.get('SUPABASE_URL'),
      anon_key: Deno.env.get('SUPABASE_ANON_KEY'),
      realtime_key: Deno.env.get('REALTIME_API_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'),
    })
  } catch (error) { logFailure('unexpected', error); return failure('enrollment_failed', 'Enrollment could not be completed', 500) }
})
