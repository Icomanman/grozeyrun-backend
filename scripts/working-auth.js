import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

serve(async (req) => {
  // 1. Get JWT
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing auth", { status: 401 });
  }

  // 2. Extract token (DO NOT verify manually)
  const token = authHeader.replace("Bearer ", "");

  // 3. Decode ONLY (no verification)
  const payload = JSON.parse(
    atob(token.split(".")[1])
  );

  const user_id = payload.sub;

  if (!user_id) {
    return new Response("Invalid token", { status: 401 });
  }

  // 4. Now you're safe to query DB
  return new Response(
    JSON.stringify({
      user_id,
      message: "Auth OK",
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
});