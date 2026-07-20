import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { csvResponse, reportMetaLines } from "@/lib/csv";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 2000,
    include: { actor: true },
  });

  const headers = ["Timestamp", "Event Type", "Field", "Old Value", "New Value", "Actor", "Request ID", "Voucher No", "Details"];
  const rows = logs.map((a) => [
    new Date(a.timestamp).toISOString(),
    a.eventType.replace(/_/g, " "),
    a.fieldName || "",
    a.oldValue || "",
    a.newValue || "",
    a.actor?.name || "System",
    a.requestId || "",
    a.voucherNo || "",
    a.details || "",
  ]);

  return csvResponse(`audit-extract-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, reportMetaLines("All", "Most recent 2000 entries"));
}
