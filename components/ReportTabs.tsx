import Link from "next/link";

const TABS: [string, string][] = [
  ["/reports", "Fiscal Year Summary"],
  ["/reports/pending", "Pending Approvals"],
  ["/reports/monthly", "Monthly Expenditure"],
  ["/reports/approvals", "Approval History"],
  ["/reports/payments", "Payment & Settlement"],
  ["/reports/exceptions", "Exceptions"],
  ["/reports/delegation", "Delegation Log"],
];

export default function ReportTabs({ active }: { active: string }) {
  return (
    <div className="flex gap-1 mb-6 flex-wrap" style={{ borderBottom: "1px solid var(--line)" }}>
      {TABS.map(([href, label]) => {
        const isActive = href === active;
        return (
          <Link
            key={href}
            href={href}
            className="px-3 py-2 text-sm"
            style={{
              color: isActive ? "var(--heading)" : "var(--slate)",
              fontWeight: isActive ? 700 : 500,
              borderBottom: isActive ? "2px solid var(--gold)" : "2px solid transparent",
              marginBottom: -1,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
