import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activeFiscalYear } from "@/lib/pettycash";
import { csvResponse, reportMetaLines } from "@/lib/csv";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const fy = await activeFiscalYear();
  const requests = await prisma.request.findMany({
    where: { fiscalYearId: fy.id, status: { in: ["FINALLY_APPROVED", "PAID", "SETTLED"] } },
    include: { payments: true },
    orderBy: { directorDecisionDate: "desc" },
  });

  const headers = ["Voucher No", "Approved Amount", "Paid Amount", "Difference", "Payment References", "Settlement Status"];
  const rows = requests.map((r) => {
    const paid = r.payments.reduce((s, p) => s + Number(p.paidAmount), 0);
    return [
      r.voucherNo,
      Number(r.requestedAmount),
      paid,
      Number(r.requestedAmount) - paid,
      r.payments.map((p) => p.reference).filter(Boolean).join("; "),
      r.status === "SETTLED" ? "Settled" : r.status === "PAID" ? "Paid, not settled" : "Awaiting payment",
    ];
  });

  return csvResponse(`payment-settlement-${fy.code}.csv`, headers, rows, reportMetaLines(fy.name));
}
