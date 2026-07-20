import NextAuth from "next-auth";
import authConfig from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

const ROLE_PREFIXES: Record<string, string[]> = {
  "/approvals/dd": ["DEPUTY_DIRECTOR", "SYSTEM_OWNER"],
  "/approvals/director": ["DIRECTOR", "SYSTEM_OWNER"],
  "/payments": ["ACCOUNTS", "SYSTEM_OWNER"],
  "/admin": ["SYSTEM_OWNER"],
};

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth");

  if (isPublic) {
    return NextResponse.next();
  }

  if (!req.auth?.user) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  const role = (req.auth.user as any).role;

  for (const prefix of Object.keys(ROLE_PREFIXES)) {
    if (pathname.startsWith(prefix)) {
      if (!ROLE_PREFIXES[prefix].includes(role)) {
        return NextResponse.redirect(
          new URL("/dashboard", req.url)
        );
      }
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};