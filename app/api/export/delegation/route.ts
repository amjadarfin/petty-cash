import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activeFiscalYear } from "@/lib/pettycash";
import { csvResponse, reportMetaLines } from "@/lib/csv";
import { NextResponse } from "next/server";
import { ApprovalStage, Role } from "@prisma/client";

const roleToStage: Partial<Record<Role, ApprovalStage>> = {
  DEPUTY_DIRECTOR: ApprovalStage.DEPUTY_DIRECTOR,
  DIRECTOR: ApprovalStage.DIRECTOR,
};
export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const fy = await activeFiscalYear();
  const configs = await prisma.approverConfig.findMany();
  const userIds = [...new Set(configs.flatMap((c) => [c.primaryApproverId, c.backupApproverId].filter(Boolean)))] as string[];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name || "";

  const rows = await Promise.all(
    configs.map(async (c) => {
      let itemsDecided = 0;
      if (c.backupApproverId && c.delegationStart && c.delegationEnd) {
        const stage = roleToStage[c.roleName];

if (
  stage &&
  c.backupApproverId &&
  c.delegationStart &&
  c.delegationEnd
) {
  itemsDecided = await prisma.approvalAction.count({
    where: {
      actorId: c.backupApproverId,
      stage,
      actionDate: {
        gte: c.delegationStart,
        lte: c.delegationEnd,
      },
    },
  });
}
      }
      return [
        c.roleName.replace(/_/g, " "),
        userName(c.primaryApproverId),
        userName(c.backupApproverId),
        c.delegationStart ? new Date(c.delegationStart).toISOString().slice(0, 10) : "",
        c.delegationEnd ? new Date(c.delegationEnd).toISOString().slice(0, 10) : "",
        c.delegationActive ? "Yes" : "No",
        itemsDecided,
      ];
    })
  );

  const headers = ["Role", "Primary Approver", "Backup Approver", "Delegation Start", "Delegation End", "Currently Active", "Items Decided by Backup"];
  return csvResponse(`delegation-log-${fy.code}.csv`, headers, rows, reportMetaLines(fy.name));
}
