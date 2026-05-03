/**
 * HTTP handler for sync-push (POST /api/sync).
 * Thin wrapper around the core syncPush logic.
 * 
 * Responsibilities:
 * - Extract and validate auth token
 * - Parse request body
 * - Manage HTTP request/response lifecycle
 * - Delegate business logic to core syncPush()
 */

import syncPush from '../syncPush';
import {
  extractAuthToken,
  decodeJWT,
  getUserIdFromToken,
  errorToHttpResponse,
  successResponse,
} from './shared';

type SyncPushHandlerDeps = {
  supabaseClient: any; // Supabase client instance
  parseError: (err: unknown) => string;
};

/**
 * Handle POST /api/sync request.
 * @param req - The incoming request
 * @param deps - Dependencies (supabaseClient, parseError)
 * @returns The HTTP response
 */
export async function handleSyncPush(req: Request, deps: SyncPushHandlerDeps): Promise<Response> {
  try {
    // 1. Extract and validate auth token
    const token = extractAuthToken(req);
    if (!token) {
      return errorToHttpResponse('Missing or invalid Authorization header.', 401);
    }

    // 2. Decode JWT and extract user_id
    const tokenPayload = decodeJWT(token);
    if (!tokenPayload) {
      return errorToHttpResponse('Invalid token.', 401);
    }

    const user_id = getUserIdFromToken(tokenPayload);
    if (!user_id) {
      return errorToHttpResponse('Invalid token.', 401);
    }

    // 3. Parse request body
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object') {
      return errorToHttpResponse('Invalid request body.', 400);
    }

    const { schema_version, data } = body as {
      schema_version?: unknown;
      data?: unknown;
    };

    if (typeof schema_version !== 'number') {
      return errorToHttpResponse('Missing or invalid schema_version.', 400);
    }

    if (!data) {
      return errorToHttpResponse('Missing data field.', 400);
    }

    // 4. Calculate payload size for logging
    const rawBody = await req.clone().text();
    const data_size = new TextEncoder().encode(rawBody).length;

    console.log('[sync-push] Auth OK, user_id:', user_id);

    // 5. Call core sync logic
    const result = await syncPush({
      schema_version,
      user_id,
      data,
      data_size,
      db: deps.supabaseClient,
    });

    // 6. Return success response
    return successResponse(result, 200);
  } catch (err) {
    console.error('[sync-push] error:', err);

    // Determine status code based on error message
    let statusCode = 500;
    if (err instanceof Error) {
      if (
        err.message.includes('Unsupported schema version') ||
        err.message.includes('Missing required field') ||
        err.message.includes('must be') ||
        err.message.includes('Invalid')
      ) {
        statusCode = 400;
      } else if (err.message.includes('Ownership mismatch')) {
        statusCode = 403;
      }
    }

    return errorToHttpResponse(err, statusCode);
  }
}
