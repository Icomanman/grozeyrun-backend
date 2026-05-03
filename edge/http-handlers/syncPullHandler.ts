/**
 * HTTP handler for sync-pull (GET /api/sync).
 * Thin wrapper around the core syncPull logic.
 * 
 * Responsibilities:
 * - Extract and validate auth token
 * - Manage HTTP request/response lifecycle
 * - Delegate business logic to core syncPull()
 */

import syncPull from '../syncPull';
import {
  extractAuthToken,
  decodeJWT,
  getUserIdFromToken,
  errorToHttpResponse,
  successResponse,
} from './shared';

type SyncPullHandlerDeps = {
  supabaseClient: any; // Supabase client instance
  parseError: (err: unknown) => string;
};

/**
 * Handle GET /api/sync request.
 * @param req - The incoming request
 * @param deps - Dependencies (supabaseClient, parseError)
 * @returns The HTTP response
 */
export async function handleSyncPull(req: Request, deps: SyncPullHandlerDeps): Promise<Response> {
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

    // 3. Extract schema_version from query params
    const url = new URL(req.url);
    const schema_version = parseInt(url.searchParams.get('schema_version') || '1', 10);

    console.log('[sync-pull] Auth OK, user_id:', user_id);

    // 4. Call core sync logic
    const result = await syncPull({
      user_id,
      schema_version,
      db: deps.supabaseClient,
    });

    // 5. Return success response
    return successResponse(
      {
        success: true,
        data: result,
        message: 'Sync successful.',
      },
      200
    );
  } catch (err) {
    console.error('[sync-pull] error:', err);

    // Determine status code based on error message
    let statusCode = 500;
    if (err instanceof Error) {
      if (err.message.includes('Unsupported schema version')) {
        statusCode = 400;
      }
    }

    return errorToHttpResponse(err, statusCode);
  }
}
