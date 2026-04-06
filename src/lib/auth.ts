import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/lib/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Lazy NextAuth initialization — during `next build`, Turbopack evaluates this
// module but never handles real requests. By deferring NextAuth() (which calls
// DrizzleAdapter(getDb())) we avoid opening SQLite during build.
type AuthExports = ReturnType<typeof NextAuth>;
let _nextAuth: AuthExports | null = null;

function getNextAuth(): AuthExports {
  if (!_nextAuth) {
    _nextAuth = NextAuth({
      adapter: DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      }),
      providers: [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
      ],
      pages: {
        signIn: "/login",
      },
      callbacks: {
        async signIn({ user }) {
          if (!user.email) return false;

          // Domain restriction
          const allowedDomain = process.env.ALLOWED_DOMAIN;
          if (allowedDomain) {
            const emailDomain = user.email.split("@")[1];
            if (emailDomain !== allowedDomain) {
              return false;
            }
          }

          // Check if user exists and is active
          const db = getDb();
          const existingUser = await db.query.users.findFirst({
            where: eq(users.email, user.email),
          });

          if (existingUser && !existingUser.active) {
            return false;
          }

          return true;
        },
        async session({ session, user }) {
          if (session.user) {
            session.user.id = user.id;
            // Fetch role from DB
            const db = getDb();
            const dbUser = await db.query.users.findFirst({
              where: eq(users.id, user.id),
            });
            if (dbUser) {
              session.user.role = dbUser.role;
            }
          }
          return session;
        },
      },
      events: {
        async createUser({ user }) {
          // Auto-promote first admin
          const adminEmail = process.env.ADMIN_EMAIL;
          if (adminEmail && user.email === adminEmail) {
            const db = getDb();
            await db
              .update(users)
              .set({ role: "admin" })
              .where(eq(users.id, user.id!));
          }
        },
      },
    });
  }
  return _nextAuth;
}

// Static exports for Turbopack — each lazily delegates to getNextAuth().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazy = () => getNextAuth() as any;

export const handlers = {
  GET: ((req: any) => lazy().handlers.GET(req)) as AuthExports["handlers"]["GET"],
  POST: ((req: any) => lazy().handlers.POST(req)) as AuthExports["handlers"]["POST"],
};

export const auth = ((...args: any[]) => lazy().auth(...args)) as AuthExports["auth"];
export const signIn = ((...args: any[]) => lazy().signIn(...args)) as AuthExports["signIn"];
export const signOut = ((...args: any[]) => lazy().signOut(...args)) as AuthExports["signOut"];
