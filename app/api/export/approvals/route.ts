import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activeFiscalYear } from "@/lib/pettycash";
import { csvResponse, reportMetaLines } from "@/lib/csv";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const fy = await activeFiscalYear();
  const actions = await prisma.approvalAction.findMany({
    where: { request: { fiscalYearId: fy.id } },
    include: { actor: true },
    orderBy: { actionDate: "desc" },
  });

  const headers = ["Voucher No", "Cycle", "Stage", "Decision", "Actor", "Timestamp", "Comments"];
  const rows = actions.map((a) => [
    a.voucherNo || "",
    a.cycleNo,
    a.stage.replace(/_/g, " "),
    a.decision,
    a.actor.name,
    new Date(a.actionDate).toISOString(),
    a.comments,
  ]);

  return csvResponse(`approval-history-${fy.code}.csv`, headers, rows, reportMetaLines(fy.name));
}
