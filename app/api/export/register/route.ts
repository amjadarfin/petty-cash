import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { csvResponse, reportMetaLines } from "@/lib/csv";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const list = await prisma.request.findMany({
    where: { status: { in: ["FINALLY_APPROVED", "PAID", "SETTLED"] } },
    include: { requester: true, budgetHead: true, fiscalYear: true },
    orderBy: { directorDecisionDate: "desc" },
  });

  const headers = ["Voucher No", "Fiscal Year", "Expense Date", "Requester", "Department", "Vendor/Payee", "Purpose", "Budget Head", "Amount (PKR)", "Payment Status", "Status"];
  const rows = list.map((r) => [
    r.voucherNo,
    r.fiscalYear.name,
    new Date(r.expenseDate).toISOString().slice(0, 10),
    r.requester.name,
    r.department || "",
    r.vendorPayee,
    r.purpose,
    r.budgetHead?.name || "",
    Number(r.requestedAmount),
    r.paymentStatus.replace(/_/g, " "),
    r.status.replace(/_/g, " "),
  ]);

  return csvResponse(`petty-cash-register-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, reportMetaLines(list[0]?.fiscalYear.name ?? "N/A", "Status: Finally Approved, Paid, or Settled"));
}
