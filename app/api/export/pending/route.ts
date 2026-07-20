import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activeFiscalYear } from "@/lib/pettycash";
import { csvResponse, reportMetaLines } from "@/lib/csv";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const fy = await activeFiscalYear();
  const pending = await prisma.request.findMany({
    where: { fiscalYearId: fy.id, status: { in: ["SUBMITTED", "APPROVED_BY_DD"] } },
    include: { requester: true },
    orderBy: { requestDate: "asc" },
  });
  const approverIds = pending.map((r) => r.currentApproverId).filter(Boolean) as string[];
  const approvers = await prisma.user.findMany({ where: { id: { in: approverIds } } });
  const approverName = (id: string | null) => approvers.find((u) => u.id === id)?.name || "";

  const headers = ["Voucher No", "Amount (PKR)", "Current Stage", "Approver", "Submission Date", "Days Pending"];
  const rows = pending.map((r) => [
    r.voucherNo,
    Number(r.requestedAmount),
    r.status === "SUBMITTED" ? "Deputy Director" : "Director",
    approverName(r.currentApproverId),
    r.requestDate ? new Date(r.requestDate).toISOString().slice(0, 10) : "",
    r.requestDate ? Math.floor((Date.now() - new Date(r.requestDate).getTime()) / (1000 * 60 * 60 * 24)) : 0,
  ]);

  return csvResponse(`pending-approvals-${fy.code}.csv`, headers, rows, reportMetaLines(fy.name, "Status: Submitted or Approved by DD"));
}
