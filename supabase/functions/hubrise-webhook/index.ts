import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// Basic implementation of a secure string comparison helper
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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

    const payload = await req.json()
    console.log("Received HubRise Webhook:", JSON.stringify(payload))

    const orderData = payload.order || payload
    const locationId = payload.location_id || orderData.location_id

    if (!locationId) {
      return new Response(JSON.stringify({ error: 'Missing location_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Initialize Supabase Client with service_role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceRole)

    // 1. Query the stores table to find the matching store
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id, name, hubrise_api_key')
      .eq('hubrise_location_id', locationId)
      .single()

    if (storeError || !store) {
      console.error(`Store not found for HubRise location_id: ${locationId}`, storeError)
      return new Response(JSON.stringify({ error: `Store not found for location_id: ${locationId}` }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify webhook signature if secret key/API key is configured
    const requestSignature = req.headers.get('X-Hubrise-Signature')
    if (store.hubrise_api_key) {
      // In HubRise, signature verification compares the signature header against the configured api key
      if (!requestSignature || !safeCompare(requestSignature, store.hubrise_api_key)) {
        return new Response(JSON.stringify({ error: 'Forbidden: Invalid HubRise signature' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    console.log(`Matching store found: ${store.name} (${store.id})`)

    let totalAmount = 0
    if (orderData.payment?.total) {
      totalAmount = parseFloat(orderData.payment.total) || 0
    } else if (orderData.total) {
      totalAmount = parseFloat(orderData.total) || 0
    }

    // 2. Insert new order into orders table
    const { data: insertedOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        store_id: store.id,
        status: 'new',
        total_amount: totalAmount,
        raw_payload: payload
      })
      .select()
      .single()

    if (orderError || !insertedOrder) {
      console.error("Error inserting order:", orderError)
      throw new Error(`Failed to insert order: ${orderError?.message}`)
    }

    console.log(`Inserted order successfully: ${insertedOrder.id}`)

    // 3. Insert items into order_items
    const hubriseItems = orderData.items || []
    if (hubriseItems.length > 0) {
      const { data: storeProducts } = await supabase
        .from('products')
        .select('id, name, price')
        .eq('store_id', store.id)

      const orderItemsToInsert = []

      for (const item of hubriseItems) {
        const hrItemName = item.product_name || item.name || item.product
        const quantity = parseInt(item.quantity) || 1
        
        let matchedProduct = storeProducts?.find(
          p => p.name.toLowerCase() === hrItemName?.toLowerCase()
        )

        if (!matchedProduct && storeProducts && storeProducts.length > 0) {
          matchedProduct = storeProducts[0]
          console.warn(`Product not matched for '${hrItemName}', falling back to '${matchedProduct.name}'`)
        }

        if (matchedProduct) {
          const itemPrice = parseFloat(item.price || item.unit_price) || parseFloat(matchedProduct.price) || 0
          const subtotal = itemPrice * quantity
          
          orderItemsToInsert.push({
            order_id: insertedOrder.id,
            product_id: matchedProduct.id,
            quantity: quantity,
            subtotal: subtotal,
            store_id: store.id
          })
        }
      }

      if (orderItemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('order_items')
          .insert(orderItemsToInsert)

        if (itemsError) {
          console.error("Error inserting order items:", itemsError)
        } else {
          console.log(`Inserted ${orderItemsToInsert.length} order items successfully.`)
        }
      }
    }

    return new Response(JSON.stringify({ success: true, order_id: insertedOrder.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error("Webhook processing error:", err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
