import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activeFiscalYear } from "@/lib/pettycash";
import { csvResponse, reportMetaLines } from "@/lib/csv";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const fy = await activeFiscalYear();
  const approved = await prisma.request.findMany({
    where: { fiscalYearId: fy.id, status: { in: ["FINALLY_APPROVED", "PAID", "SETTLED"] } },
    select: { requestedAmount: true, directorDecisionDate: true },
  });
  const payments = await prisma.payment.findMany({
    where: { request: { fiscalYearId: fy.id } },
    select: { paidAmount: true, paymentDate: true },
  });

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const months: Record<string, { approved: number; paid: number }> = {};
  for (const r of approved) {
    if (!r.directorDecisionDate) continue;
    const key = monthKey(new Date(r.directorDecisionDate));
    months[key] = months[key] || { approved: 0, paid: 0 };
    months[key].approved += Number(r.requestedAmount);
  }
  for (const p of payments) {
    const key = monthKey(new Date(p.paymentDate));
    months[key] = months[key] || { approved: 0, paid: 0 };
    months[key].paid += Number(p.paidAmount);
  }

  let runningBalance = Number(fy.opening) + Number(fy.supplementary);
  const sorted = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
  const headers = ["Month", "Opening Balance", "Approved Expenditure", "Payments", "Closing Balance"];
  const rows = sorted.map(([key, m]) => {
    const opening = runningBalance;
    const closing = opening - m.approved;
    runningBalance = closing;
    return [key, opening, m.approved, m.paid, closing];
  });

  return csvResponse(`monthly-expenditure-${fy.code}.csv`, headers, rows, reportMetaLines(fy.name));
}
