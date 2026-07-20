import { prisma } from "@/lib/prisma";
import {
  activeFiscalYear,
  totalAllocation,
  approvedExpenditure,
  paidExpenditure,
  pendingCommitment,
  budgetHeadSpent,
  money,
} from "@/lib/pettycash";
import ReportTabs from "@/components/ReportTabs";
import ReportMeta from "@/components/ReportMeta";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const fy = await activeFiscalYear();
  const [total, approved, paid, pending, budgetHeads, transactionCount] = await Promise.all([
    totalAllocation(fy.id),
    approvedExpenditure(fy.id),
    paidExpenditure(fy.id),
    pendingCommitment(fy.id),
    prisma.budgetHead.findMany(),
    prisma.request.count({ where: { fiscalYearId: fy.id, status: { not: "DRAFT" } } }),
  ]);
  const remaining = total - approved;
  const carryforward = fy.carryforwardStatus === "APPLIED" ? Number(fy.carryforwardAmount) : 0;

  const rows = await Promise.all(
    budgetHeads.map(async (bh) => {
      const spent = await budgetHeadSpent(bh.id, fy.id);
      const pct = Number(bh.annualLimit) > 0 ? Math.round((spent / Number(bh.annualLimit)) * 100) : 0;
      return { ...bh, spent, pct };
    })
  );

  return (
    <div>
      <div className="flex justify-between items-start flex-wrap gap-2 mb-1">
        <div>
          <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>Reports</h2>
          <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>Fiscal-year summary and category breakdown.</p>
        </div>
      </div>
      <ReportTabs active="/reports" />
      <ReportMeta fyName={fy.name} />

      <div className="flex justify-end mb-3">
        <a className="btn btn-outline btn-small" href="/api/export/budget">Export Budget Utilization to Excel</a>
      </div>

      <h3 style={{ color: "var(--heading)" }}>Fiscal-Year Summary</h3>
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Opening Allocation" value={money(Number(fy.opening))} />
        <Kpi label="Supplementary Allocation" value={money(Number(fy.supplementary))} />
        <Kpi label="Carryforward Applied" value={money(carryforward)} />
        <Kpi label="Total Allocation" value={money(total)} />
        <Kpi label="Approved Expenditure" value={money(approved)} />
        <Kpi label="Paid" value={money(paid)} />
        <Kpi label="Pending Commitments" value={money(pending)} />
        <Kpi label="Remaining Balance" value={money(remaining)} color={remaining < 0 ? "var(--red)" : undefined} />
      </div>
      <p style={{ color: "var(--slate)", fontSize: 12, marginTop: 10 }}>Transaction count (non-draft requests this fiscal year): <strong style={{ color: "var(--heading)" }}>{transactionCount}</strong></p>

      <h3 style={{ color: "var(--heading)", marginTop: 24 }}>Budget Head Utilization</h3>
      <table>
        <thead><tr><th>Code</th><th>Budget Head</th><th>Annual Limit</th><th>Approved Spend</th><th>Consumption %</th><th>Threshold</th></tr></thead>
        <tbody>
          {rows.map((bh) => (
            <tr key={bh.id}>
              <td>{bh.code}</td>
              <td>{bh.name}</td>
              <td>{money(Number(bh.annualLimit))}</td>
              <td>{money(bh.spent)}</td>
              <td>{bh.pct}%</td>
              <td>{bh.pct >= bh.thresholdPercent ? <span style={{ color: "var(--gold)", fontWeight: 700 }}>NEAR LIMIT</span> : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card">
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--slate)", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, marginTop: 6, color: color || "var(--heading)", fontFamily: "Georgia, serif" }}>{value}</div>
    </div>
  );
}
