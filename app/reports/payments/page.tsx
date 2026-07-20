import { prisma } from "@/lib/prisma";
import { activeFiscalYear, money } from "@/lib/pettycash";
import ReportTabs from "@/components/ReportTabs";
import ReportMeta from "@/components/ReportMeta";

export const dynamic = "force-dynamic";

export default async function PaymentSettlementReport() {
  const fy = await activeFiscalYear();
  const requests = await prisma.request.findMany({
    where: { fiscalYearId: fy.id, status: { in: ["FINALLY_APPROVED", "PAID", "SETTLED"] } },
    include: { payments: true, requester: true },
    orderBy: { directorDecisionDate: "desc" },
  });

  return (
    <div>
      <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>Reports</h2>
      <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>Approved amount versus what&apos;s actually been disbursed.</p>
      <ReportTabs active="/reports/payments" />
      <ReportMeta fyName={fy.name} />

      <div className="flex justify-end mb-3">
        <a className="btn btn-outline btn-small" href="/api/export/payments">Export to Excel</a>
      </div>

      {requests.length === 0 ? (
        <div className="empty">No finally-approved requests yet.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Voucher</th><th>Approved Amount</th><th>Paid Amount</th><th>Difference</th><th>Payment Reference(s)</th><th>Settlement Status</th></tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const paid = r.payments.reduce((s, p) => s + Number(p.paidAmount), 0);
              const diff = Number(r.requestedAmount) - paid;
              const refs = r.payments.map((p) => p.reference).filter(Boolean).join(", ") || "—";
              return (
                <tr key={r.id}>
                  <td className="voucher">{r.voucherNo}</td>
                  <td>{money(Number(r.requestedAmount))}</td>
                  <td>{money(paid)}</td>
                  <td style={{ color: diff > 0 ? "var(--gold)" : "inherit" }}>{money(diff)}</td>
                  <td>{refs}</td>
                  <td>{r.status === "SETTLED" ? "Settled" : r.status === "PAID" ? "Paid, not settled" : "Awaiting payment"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
