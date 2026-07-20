import { prisma } from "@/lib/prisma";
import { activeFiscalYear, money } from "@/lib/pettycash";
import ReportTabs from "@/components/ReportTabs";
import ReportMeta from "@/components/ReportMeta";

async function findOverdue(fiscalYearId: string) {
  const overdue = await prisma.request.findMany({
    where: { fiscalYearId, status: { in: ["SUBMITTED", "APPROVED_BY_DD"] } },
    include: { requester: true },
  });
  const nowMs = Date.now();
  return overdue.filter((r) => {
    if (!r.requestDate) return false;
    const days = Math.floor((nowMs - new Date(r.requestDate).getTime()) / (1000 * 60 * 60 * 24));
    return days >= 5;
  });
}

export const dynamic = "force-dynamic";

export default async function ExceptionsReport() {
  const fy = await activeFiscalYear();

  const missingEvidence = await prisma.request.findMany({
    where: { fiscalYearId: fy.id, evidenceStatus: "EXCEPTION_REQUESTED" },
    include: { requester: true },
  });

  const rejected = await prisma.request.findMany({
    where: { fiscalYearId: fy.id, status: { in: ["REJECTED_BY_DD", "REJECTED_BY_DIRECTOR"] } },
    include: { requester: true },
  });

  const withDuplicateKey = await prisma.request.findMany({
    where: { fiscalYearId: fy.id, duplicateKey: { not: null }, status: { notIn: ["DRAFT", "REJECTED_BY_DD", "REJECTED_BY_DIRECTOR", "CANCELLED"] } },
    include: { requester: true },
  });
  const keyGroups: Record<string, typeof withDuplicateKey> = {};
  for (const r of withDuplicateKey) {
    if (!r.duplicateKey) continue;
    keyGroups[r.duplicateKey] = keyGroups[r.duplicateKey] || [];
    keyGroups[r.duplicateKey].push(r);
  }
  const duplicateGroups = Object.values(keyGroups).filter((g) => g.length > 1);

  const overdueFiltered = await findOverdue(fy.id);

  return (
    <div>
      <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>Reports</h2>
      <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>Missing evidence, possible duplicates, overdue approvals, and rejections.</p>
      <ReportTabs active="/reports/exceptions" />
      <ReportMeta fyName={fy.name} />

      <div className="flex justify-end mb-3">
        <a className="btn btn-outline btn-small" href="/api/export/exceptions">Export to Excel</a>
      </div>

      <div className="banner banner-warn" style={{ fontSize: 11.5 }}>
        This build doesn&apos;t yet track request amendments, cancellations, or Power-Automate-style
        &quot;failed flow&quot; events (there is no separate workflow engine to fail — actions either
        complete as a database transaction or the person sees an error immediately). Those three
        categories from the original spec are intentionally omitted below rather than shown empty and
        implying coverage that doesn&apos;t exist yet.
      </div>

      <h3 style={{ color: "var(--heading)", marginTop: 20 }}>Missing Evidence ({missingEvidence.length})</h3>
      {missingEvidence.length === 0 ? <div className="empty">None.</div> : (
        <table>
          <thead><tr><th>Voucher</th><th>Requester</th><th>Exception Reason</th></tr></thead>
          <tbody>
            {missingEvidence.map((r) => (
              <tr key={r.id}><td className="voucher">{r.voucherNo || "DRAFT"}</td><td>{r.requester.name}</td><td>{r.exceptionReason || "—"}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ color: "var(--heading)", marginTop: 20 }}>Possible Duplicates ({duplicateGroups.length} groups)</h3>
      {duplicateGroups.length === 0 ? <div className="empty">None.</div> : (
        <table>
          <thead><tr><th>Requester</th><th>Vendor / Date / Amount</th><th>Matching Vouchers</th></tr></thead>
          <tbody>
            {duplicateGroups.map((g, i) => (
              <tr key={i}>
                <td>{g[0].requester.name}</td>
                <td>{g[0].vendorPayee} · {new Date(g[0].expenseDate).toLocaleDateString("en-GB")} · {money(Number(g[0].requestedAmount))}</td>
                <td>{g.map((r) => r.voucherNo).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ color: "var(--heading)", marginTop: 20 }}>Overdue (5+ days pending) ({overdueFiltered.length})</h3>
      {overdueFiltered.length === 0 ? <div className="empty">None.</div> : (
        <table>
          <thead><tr><th>Voucher</th><th>Requester</th><th>Stage</th><th>Submitted</th></tr></thead>
          <tbody>
            {overdueFiltered.map((r) => (
              <tr key={r.id}>
                <td className="voucher">{r.voucherNo}</td>
                <td>{r.requester.name}</td>
                <td>{r.status === "SUBMITTED" ? "Deputy Director" : "Director"}</td>
                <td>{r.requestDate ? new Date(r.requestDate).toLocaleDateString("en-GB") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ color: "var(--heading)", marginTop: 20 }}>Rejected ({rejected.length})</h3>
      {rejected.length === 0 ? <div className="empty">None.</div> : (
        <table>
          <thead><tr><th>Voucher</th><th>Requester</th><th>Rejected At</th></tr></thead>
          <tbody>
            {rejected.map((r) => (
              <tr key={r.id}><td className="voucher">{r.voucherNo}</td><td>{r.requester.name}</td><td>{r.status.replace(/_/g, " ")}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
