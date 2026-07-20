import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const NAV: Record<string, [string, string][]> = {
  STAFF: [["/dashboard", "Dashboard"], ["/requests/new", "New Request"], ["/requests/mine", "My Requests"], ["/audit", "Audit Trail"], ["/account", "My Account"]],
  DEPUTY_DIRECTOR: [["/dashboard", "Dashboard"], ["/approvals/dd", "Pending My Approval"], ["/register", "Register"], ["/reports", "Reports"], ["/audit", "Audit Trail"], ["/account", "My Account"]],
  DIRECTOR: [["/dashboard", "Dashboard"], ["/approvals/director", "Pending My Approval"], ["/register", "Register"], ["/reports", "Reports"], ["/audit", "Audit Trail"], ["/account", "My Account"]],
  ACCOUNTS: [["/dashboard", "Dashboard"], ["/payments", "Awaiting Payment"], ["/payments/open", "Open Payments"], ["/register", "Register"], ["/reports", "Reports"], ["/audit", "Audit Trail"], ["/account", "My Account"]],
  SYSTEM_OWNER: [["/dashboard", "Dashboard"], ["/register", "Register"], ["/reports", "Reports"], ["/admin", "Admin"], ["/audit", "Audit Trail"], ["/account", "My Account"]],
};

const ROLE_LABEL: Record<string, string> = {
  STAFF: "Staff",
  DEPUTY_DIRECTOR: "Deputy Director",
  DIRECTOR: "Director",
  ACCOUNTS: "Accounts",
  SYSTEM_OWNER: "System Owner",
};

// Maps a nav href to a live pending-count query, per role. Only hrefs listed
// here can show a badge; everything else renders plain.
async function getBadgeCounts(role: string, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (role === "STAFF") {
    counts["/requests/mine"] = await prisma.request.count({
      where: { requesterId: userId, status: { in: ["RETURNED_BY_DD", "RETURNED_BY_DIRECTOR"] } },
    });
  } else if (role === "DEPUTY_DIRECTOR") {
    counts["/approvals/dd"] = await prisma.request.count({ where: { status: "SUBMITTED" } });
  } else if (role === "DIRECTOR") {
    counts["/approvals/director"] = await prisma.request.count({ where: { status: "APPROVED_BY_DD" } });
  } else if (role === "ACCOUNTS") {
    counts["/payments"] = await prisma.request.count({ where: { status: "FINALLY_APPROVED" } });
  }
  return counts;
}

export default async function Sidebar() {
  const session = await auth();
  if (!session?.user) return null;
  const role = session.user.role || "STAFF";
  const items = NAV[role] || NAV.STAFF;
  const badges = await getBadgeCounts(role, session.user.id);

  return (
    <aside className="w-52 shrink-0 border-r" style={{ borderColor: "var(--line)", background: "var(--paper-2)" }}>
      <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ border: "1.5px solid var(--gold)", color: "var(--gold)" }}>PC</div>
        <span className="text-sm" style={{ color: "var(--heading)", fontFamily: "Georgia, serif" }}>Petty Cash</span>
      </div>
      <nav className="py-3">
        {items.map(([href, label]) => {
          const count = badges[href] || 0;
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-[var(--paper-3)]"
              style={{ color: "var(--foreground)" }}
            >
              <span>{label}</span>
              {count > 0 && <span className="nav-badge">{count > 99 ? "99+" : count}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 mt-4 text-xs" style={{ borderTop: "1px solid var(--line)", color: "var(--slate)" }}>
        <div className="font-semibold">{session.user.name}</div>
        <div className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase mt-1" style={{ background: "var(--gold)", color: "#221a08" }}>
          {ROLE_LABEL[role]}
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="btn btn-outline btn-small mt-2 w-full" type="submit">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
