import { NextResponse, type NextRequest } from "next/server";

// UX gate only: sends visitors without a session cookie to /login. The backend verifies the cookie on every API call.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*"] };
