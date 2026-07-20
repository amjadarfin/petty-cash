import { prisma } from "@/lib/prisma";
import { activeFiscalYear } from "@/lib/pettycash";
import ReportTabs from "@/components/ReportTabs";
import ReportMeta from "@/components/ReportMeta";

export const dynamic = "force-dynamic";

export default async function DelegationLogReport() {
  const fy = await activeFiscalYear();
  const configs = await prisma.approverConfig.findMany();
  const userIds = [...new Set(configs.flatMap((c) => [c.primaryApproverId, c.backupApproverId].filter(Boolean)))] as string[];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name || "—";

  const rows = await Promise.all(
    configs.map(async (c) => {
      let activatedBy = "—";
      let itemsDecided = 0;
      if (c.backupApproverId) {
        const lastAudit = await prisma.auditLog.findFirst({
          where: { eventType: "ACCESS_ADMIN", details: { contains: c.roleName } },
          orderBy: { timestamp: "desc" },
          include: { actor: true },
        });
        activatedBy = lastAudit?.actor?.name || "—";

        if (c.delegationStart && c.delegationEnd) {
          itemsDecided = await prisma.approvalAction.count({
            where: {
              actorId: c.backupApproverId,
              stage: c.roleName === "DEPUTY_DIRECTOR" ? "DEPUTY_DIRECTOR" : "DIRECTOR",
              actionDate: { gte: c.delegationStart, lte: c.delegationEnd },
            },
          });
        }
      }
      return { ...c, activatedBy, itemsDecided };
    })
  );

  return (
    <div>
      <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>Reports</h2>
      <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>Backup approver activity by role.</p>
      <ReportTabs active="/reports/delegation" />
      <ReportMeta fyName={fy.name} />

      <div className="flex justify-end mb-3">
        <a className="btn btn-outline btn-small" href="/api/export/delegation">Export to Excel</a>
      </div>

      <table>
        <thead>
          <tr><th>Role</th><th>Primary Approver</th><th>Backup Approver</th><th>Delegation Window</th><th>Currently Active</th><th>Last Configured By</th><th>Items Decided by Backup</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.roleName.replace(/_/g, " ")}</td>
              <td>{userName(c.primaryApproverId)}</td>
              <td>{userName(c.backupApproverId)}</td>
              <td>{c.delegationStart && c.delegationEnd ? `${new Date(c.delegationStart).toLocaleDateString("en-GB")} – ${new Date(c.delegationEnd).toLocaleDateString("en-GB")}` : "—"}</td>
              <td>{c.delegationActive ? "Yes" : "No"}</td>
              <td>{c.activatedBy}</td>
              <td>{c.itemsDecided}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
