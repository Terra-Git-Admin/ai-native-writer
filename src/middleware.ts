import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Simple middleware that checks for session cookie
// The actual auth validation happens in API routes via auth()
export function middleware(request: NextRequest) {
  // Bypass auth for local development
  if (process.env.BYPASS_AUTH === "true") {
    return NextResponse.next();
  }

  const sessionCookie =
    request.cookies.get("authjs.session-token") ||
    request.cookies.get("__Secure-authjs.session-token");

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protect everything except auth routes, login page, and static assets
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
