import type { NextAuthConfig } from "next-auth";

export default {
  pages: {
    signIn: "/login",
  },

  callbacks: {
    authorized({ auth, request }) {
      return !!auth?.user;
    },

    jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.department = (user as any).department;
        token.id = (user as any).id;
      }
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).department = token.department;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;