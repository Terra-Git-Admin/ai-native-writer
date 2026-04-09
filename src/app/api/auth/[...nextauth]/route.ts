import { handlers } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// When BYPASS_AUTH=true, return a fake session for the /session endpoint
// so the client-side useSession() hook works during local dev.
const BYPASS_SESSION = {
  user: {
    id: "dev-bypass-user",
    email: process.env.ADMIN_EMAIL || "vikas@terra.com",
    name: "Dev User",
    image: null,
    role: "admin",
  },
  expires: new Date(Date.now() + 86400 * 1000).toISOString(),
};

export async function GET(req: NextRequest) {
  if (process.env.BYPASS_AUTH === "true") {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/session")) {
      return NextResponse.json(BYPASS_SESSION);
    }
    // Other auth endpoints (csrf, providers, etc.) — pass through
    return handlers.GET(req);
  }
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  return handlers.POST(req);
}
