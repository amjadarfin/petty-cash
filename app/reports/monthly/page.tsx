import { prisma } from "@/lib/prisma";
import { activeFiscalYear, money } from "@/lib/pettycash";
import ReportTabs from "@/components/ReportTabs";
import ReportMeta from "@/components/ReportMeta";

function withRunningBalance(data: [string, { approved: number; paid: number; byCategory: Record<string, number> }][], openingBalance: number) {
  let runningBalance = openingBalance;
  return data.map(([key, m]) => {
    const opening = runningBalance;
    const closing = opening - m.approved;
    runningBalance = closing;
    return { key, ...m, opening, closing };
  });
}

export const dynamic = "force-dynamic";

async function monthlyBreakdown(fiscalYearId: string) {
  const approved = await prisma.request.findMany({
    where: { fiscalYearId, status: { in: ["FINALLY_APPROVED", "PAID", "SETTLED"] } },
    select: { requestedAmount: true, directorDecisionDate: true, budgetHead: { select: { name: true } } },
  });
  const payments = await prisma.payment.findMany({
    where: { request: { fiscalYearId } },
    select: { paidAmount: true, paymentDate: true },
  });

  const months: Record<string, { approved: number; paid: number; byCategory: Record<string, number> }> = {};
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  for (const r of approved) {
    if (!r.directorDecisionDate) continue;
    const key = monthKey(new Date(r.directorDecisionDate));
    months[key] = months[key] || { approved: 0, paid: 0, byCategory: {} };
    months[key].approved += Number(r.requestedAmount);
    const cat = r.budgetHead?.name || "Uncategorized";
    months[key].byCategory[cat] = (months[key].byCategory[cat] || 0) + Number(r.requestedAmount);
  }
  for (const p of payments) {
    const key = monthKey(new Date(p.paymentDate));
    months[key] = months[key] || { approved: 0, paid: 0, byCategory: {} };
    months[key].paid += Number(p.paidAmount);
  }

  return Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
}

export default async function MonthlyExpenditureReport() {
  const fy = await activeFiscalYear();
  const data = await monthlyBreakdown(fy.id);
  const openingBalance = Number(fy.opening) + Number(fy.supplementary);

  // Running balances are computed in a plain standalone function (above), not
  // inline in the component body, so there's no variable reassignment during render.
  const rowsWithBalance = withRunningBalance(data, openingBalance);

  return (
    <div>
      <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>Reports</h2>
      <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>Month-by-month expenditure for {fy.name}.</p>
      <ReportTabs active="/reports/monthly" />
      <ReportMeta fyName={fy.name} />

      <div className="flex justify-end mb-3">
        <a className="btn btn-outline btn-small" href="/api/export/monthly">Export to Excel</a>
      </div>

      {rowsWithBalance.length === 0 ? (
        <div className="empty">No approved expenditure recorded yet this fiscal year.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Month</th><th>Opening Balance</th><th>Approved Expenditure</th><th>Payments</th><th>Closing Balance</th><th>Category Breakdown</th></tr>
          </thead>
          <tbody>
            {rowsWithBalance.map((m) => (
              <tr key={m.key}>
                <td>{m.key}</td>
                <td>{money(m.opening)}</td>
                <td>{money(m.approved)}</td>
                <td>{money(m.paid)}</td>
                <td>{money(m.closing)}</td>
                <td style={{ fontSize: 11.5 }}>
                  {Object.entries(m.byCategory).map(([cat, amt]) => `${cat}: ${money(amt)}`).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
