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
    where: {
      fiscalYearId: fy.id,
      OR: [
        { evidenceStatus: "EXCEPTION_REQUESTED" },
        { status: { in: ["REJECTED_BY_DD", "REJECTED_BY_DIRECTOR"] } },
      ],
    },
    include: { requester: true },
  });

  const headers = ["Voucher No", "Requester", "Type", "Detail"];
  const rows = requests.map((r) => [
    r.voucherNo || "DRAFT",
    r.requester.name,
    r.evidenceStatus === "EXCEPTION_REQUESTED" ? "Missing Evidence" : "Rejected",
    r.evidenceStatus === "EXCEPTION_REQUESTED" ? (r.exceptionReason || "") : r.status.replace(/_/g, " "),
  ]);

  return csvResponse(`exceptions-${fy.code}.csv`, headers, rows, reportMetaLines(fy.name, "Missing evidence OR rejected"));
}
