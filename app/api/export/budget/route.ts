import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activeFiscalYear, budgetHeadSpent } from "@/lib/pettycash";
import { csvResponse, reportMetaLines } from "@/lib/csv";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const fy = await activeFiscalYear();
  const budgetHeads = await prisma.budgetHead.findMany({ orderBy: { sortOrder: "asc" } });

  const headers = ["Code", "Budget Head", "Annual Limit (PKR)", "Approved Spend (PKR)", "Consumption %", "Threshold %", "Status"];
  const rows = await Promise.all(
    budgetHeads.map(async (bh) => {
      const spent = await budgetHeadSpent(bh.id, fy.id);
      const pct = Number(bh.annualLimit) > 0 ? Math.round((spent / Number(bh.annualLimit)) * 100) : 0;
      return [bh.code, bh.name, Number(bh.annualLimit), spent, pct, bh.thresholdPercent, pct >= bh.thresholdPercent ? "NEAR LIMIT" : "OK"];
    })
  );

  return csvResponse(`budget-utilization-${fy.code}.csv`, headers, rows, reportMetaLines(fy.name));
}
