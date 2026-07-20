import { prisma } from "@/lib/prisma";
import { activeFiscalYear, money } from "@/lib/pettycash";
import ReportTabs from "@/components/ReportTabs";
import ReportMeta from "@/components/ReportMeta";

export const dynamic = "force-dynamic";

function daysPending(from: Date | null): number {
  if (!from) return 0;
  return Math.floor((Date.now() - new Date(from).getTime()) / (1000 * 60 * 60 * 24));
}

export default async function PendingApprovalsReport() {
  const fy = await activeFiscalYear();
  const [pending, configs] = await Promise.all([
    prisma.request.findMany({
      where: { fiscalYearId: fy.id, status: { in: ["SUBMITTED", "APPROVED_BY_DD"] } },
      include: { requester: true },
      orderBy: { requestDate: "asc" },
    }),
    prisma.approverConfig.findMany(),
  ]);
  const approverIds = [...new Set(configs.flatMap((c) => [c.primaryApproverId, c.backupApproverId].filter(Boolean)))] as string[];
  const approverUsers = await prisma.user.findMany({ where: { id: { in: approverIds } } });
  const approverName = (id: string | null) => approverUsers.find((u) => u.id === id)?.name || "—";

  function isDelegated(status: string): boolean {
    const roleName = status === "SUBMITTED" ? "DEPUTY_DIRECTOR" : "DIRECTOR";
    const config = configs.find((c) => c.roleName === roleName);
    if (!config || !config.delegationActive || !config.backupApproverId) return false;
    const now = new Date();
    return !!(config.delegationStart && config.delegationEnd && now >= config.delegationStart && now <= config.delegationEnd);
  }

  return (
    <div>
      <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>Reports</h2>
      <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>Requests currently sitting with an approver.</p>
      <ReportTabs active="/reports/pending" />
      <ReportMeta fyName={fy.name} filters="Status: Submitted or Approved by DD" />

      <div className="flex justify-end mb-3">
        <a className="btn btn-outline btn-small" href="/api/export/pending">Export to Excel</a>
      </div>

      {pending.length === 0 ? (
        <div className="empty">Nothing currently pending.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Voucher</th><th>Amount</th><th>Current Stage</th><th>Approver</th><th>Submitted</th><th>Days Pending</th></tr>
          </thead>
          <tbody>
            {pending.map((r) => {
              const delegated = isDelegated(r.status);
              return (
                <tr key={r.id}>
                  <td className="voucher">{r.voucherNo}</td>
                  <td>{money(Number(r.requestedAmount))}</td>
                  <td>{r.status === "SUBMITTED" ? "Deputy Director" : "Director"}</td>
                  <td>
                    {approverName(r.currentApproverId)}
                    {delegated && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--gold)", fontWeight: 700 }}>(DELEGATE)</span>}
                  </td>
                  <td>{r.requestDate ? new Date(r.requestDate).toLocaleDateString("en-GB") : "—"}</td>
                  <td style={{ color: daysPending(r.requestDate) >= 5 ? "var(--red)" : "inherit", fontWeight: daysPending(r.requestDate) >= 5 ? 700 : 400 }}>
                    {daysPending(r.requestDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
