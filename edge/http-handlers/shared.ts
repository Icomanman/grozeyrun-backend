/**
 * Shared utilities for Edge Function HTTP handlers.
 * 
 * Deno-specific implementations for:
 * - JWT decoding and extraction
 * - Supabase client creation
 * - Error → HTTP response mapping
 * - CORS handling
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, content-type',
};

/**
 * Extract JWT token from Authorization header.
 * @param req - The incoming request
 * @returns The JWT token, or null if missing/invalid
 */
export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Decode JWT payload without verification (Edge Functions pattern).
 * Used to extract user_id from the token.
 * @param token - The JWT token
 * @returns The decoded payload, or null if invalid
 */
export function decodeJWT(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (e) {
    console.error('[JWT decode] error:', e);
    return null;
  }
}

/**
 * Extract user_id from a decoded JWT payload.
 * @param payload - The decoded JWT payload
 * @returns The user_id (sub claim), or null if missing
 */
export function getUserIdFromToken(payload: Record<string, any>): string | null {
  return payload?.sub ?? null;
}

/**
 * Create a Supabase client configured for Edge Functions.
 * Uses the service role key to bypass RLS.
 * @returns The Supabase client, or throws if env vars are missing
 */
export function createSupabaseClient() {
  // Deno imports are at the top of the edge function files
  // This is a utility signature; actual import happens in the edge function.
  // Workaround: we'll inject the client from the edge function itself.

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // NOTE: The actual client creation happens in the edge function
  // because we need to import from the Supabase CDN there.
  // This function just validates env vars.
  return {
    url: supabaseUrl,
    serviceKey: supabaseServiceKey,
  };
}

/**
 * Map an error to an HTTP response.
 * @param err - The error to map
 * @param statusCode - Optional HTTP status code (default 500)
 * @returns A Response object
 */
export function errorToHttpResponse(err: unknown, statusCode = 500): Response {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Internal server error';

  return new Response(
    JSON.stringify({
      success: false,
      message,
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    }
  );
}

/**
 * Build a successful HTTP response.
 * @param data - The response data
 * @param statusCode - Optional HTTP status code (default 200)
 * @returns A Response object
 */
export function successResponse(data: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Handle CORS preflight requests.
 * @returns A Response object
 */
export function handleCORS(): Response {
  return new Response('ok', {
    status: 200,
    headers: corsHeaders,
  });
}
