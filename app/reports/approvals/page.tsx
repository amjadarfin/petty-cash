import { prisma } from "@/lib/prisma";
import { activeFiscalYear } from "@/lib/pettycash";
import ReportTabs from "@/components/ReportTabs";
import ReportMeta from "@/components/ReportMeta";

export const dynamic = "force-dynamic";

export default async function ApprovalHistoryReport() {
  const fy = await activeFiscalYear();
  const actions = await prisma.approvalAction.findMany({
    where: { request: { fiscalYearId: fy.id } },
    include: { actor: true },
    orderBy: { actionDate: "desc" },
    take: 500,
  });

  return (
    <div>
      <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>Reports</h2>
      <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>Every approval action taken this fiscal year, most recent first.</p>
      <ReportTabs active="/reports/approvals" />
      <ReportMeta fyName={fy.name} />

      <div className="flex justify-end mb-3">
        <a className="btn btn-outline btn-small" href="/api/export/approvals">Export to Excel</a>
      </div>

      {actions.length === 0 ? (
        <div className="empty">No approval actions recorded yet.</div>
      ) : (
        <table>
          <thead><tr><th>Voucher</th><th>Cycle</th><th>Stage</th><th>Decision</th><th>Actor</th><th>When</th><th>Comments</th></tr></thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td className="voucher">{a.voucherNo || "—"}</td>
                <td>{a.cycleNo}</td>
                <td>{a.stage.replace(/_/g, " ")}</td>
                <td>{a.decision}</td>
                <td>{a.actor.name}</td>
                <td>{new Date(a.actionDate).toLocaleString("en-GB")}</td>
                <td>{a.comments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
