import { corsHeaders, json, bridgeDevice, stripeRequest } from '../_shared/terminal.ts'
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { device, db } = await bridgeDevice(req)
    const { data: config } = await db.from('restaurant_payment_configs').select('provider_config').eq('id', device.payment_config_id).single()
    const token = await stripeRequest('/terminal/connection_tokens', config?.provider_config ?? {}, { method: 'POST', body: '' })
    return json({ secret: token.secret })
  } catch (error) { return json({ error: error.message }, 401) }
})
