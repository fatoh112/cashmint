import { bridgeDevice, corsHeaders, json } from '../_shared/terminal.ts'

const failure = (error: string, status: number) => json({ error }, status)
const realtimeKey = () => Deno.env.get('REALTIME_API_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return failure('Method not allowed', 405)
  try {
    await bridgeDevice(req)
    const key = realtimeKey()
    if (!key) return failure('Realtime key is not configured', 500)
    return json({ realtime_key: key })
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'Could not load Realtime key', 401)
  }
})
