import { prisma } from "@/lib/prisma";
import { money } from "@/lib/pettycash";
import { updateBudgetHeadAction, addBudgetHeadAction, closeFiscalYearAction, updateFiscalYearAllocationAction, createFiscalYearAction, bulkImportBudgetHeadsAction } from "@/lib/actions";
import AdminTabs from "@/components/AdminTabs";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [fiscalYears, budgetHeads] = await Promise.all([
    prisma.fiscalYear.findMany({ orderBy: { startDate: "desc" } }),
    prisma.budgetHead.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const openFY = fiscalYears.find((f) => f.status === "OPEN");

  return (
    <div>
      <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>Admin</h2>
      <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>System owner configuration.</p>
      <AdminTabs active="/admin" />

      <h3 style={{ color: "var(--heading)" }}>Fiscal Years</h3>
      <table>
        <thead><tr><th>Name</th><th>Period</th><th>Opening Allocation</th><th>Status</th></tr></thead>
        <tbody>
          {fiscalYears.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{new Date(f.startDate).toLocaleDateString("en-GB")} – {new Date(f.endDate).toLocaleDateString("en-GB")}</td>
              <td>{money(Number(f.opening))}</td>
              <td>{f.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {openFY && (
        <div className="card mt-5" style={{ maxWidth: 460 }}>
          <h3 style={{ marginTop: 0, color: "var(--heading)" }}>Edit {openFY.name} Allocation</h3>
          <p style={{ color: "var(--slate)", fontSize: 12, marginTop: -6, marginBottom: 14 }}>
            Adjust the opening or supplementary budget for the current year directly — use this for a mid-year
            top-up. This does not close or roll over the fiscal year.
          </p>
          <form action={updateFiscalYearAllocationAction}>
            <input type="hidden" name="fiscalYearId" value={openFY.id} />
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label>Opening Allocation (PKR)</label>
                <input type="number" name="opening" defaultValue={Number(openFY.opening)} required />
              </div>
              <div>
                <label>Supplementary Allocation (PKR)</label>
                <input type="number" name="supplementary" defaultValue={Number(openFY.supplementary)} />
              </div>
            </div>
            <button className="btn btn-gold btn-small" type="submit">Save Allocation</button>
          </form>
        </div>
      )}

      <div className="card mt-5" style={{ maxWidth: 460 }}>
        <h3 style={{ marginTop: 0, color: "var(--heading)" }}>Create a New Fiscal Year</h3>
        <p style={{ color: "var(--slate)", fontSize: 12, marginTop: -6, marginBottom: 14 }}>
          For first-time setup, or to add a fiscal year without closing the current one. Checking &quot;make this
          the active year&quot; will close any other open year automatically (only one can be active at a time).
        </p>
        <form action={createFiscalYearAction}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label>Name</label><input type="text" name="name" placeholder="e.g. FY2027" required /></div>
            <div><label>Code</label><input type="text" name="code" placeholder="e.g. 2027" required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label>Start Date</label><input type="date" name="startDate" required /></div>
            <div><label>End Date</label><input type="date" name="endDate" required /></div>
          </div>
          <div className="mb-3">
            <label>Opening Allocation (PKR)</label>
            <input type="number" name="opening" required />
          </div>
          <label style={{ textTransform: "none", fontWeight: 400, display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
            <input type="checkbox" name="makeOpen" style={{ width: "auto" }} />
            Make this the active fiscal year
          </label>
          <button className="btn btn-gold btn-small" type="submit">Create Fiscal Year</button>
        </form>
      </div>

      {openFY && (
        <div className="card mt-5" style={{ maxWidth: 620 }}>
          <h3 style={{ marginTop: 0, color: "var(--heading)" }}>Close {openFY.name} &amp; Open Next Fiscal Year</h3>
          <div className="banner banner-warn">
            Blocked automatically if any requests for {openFY.name} are still Submitted, Approved by DD, or Returned —
            resolve those first. Unspent balance is calculated as allocation minus approved expenditure.
          </div>
          <form action={closeFiscalYearAction}>
            <input type="hidden" name="fiscalYearId" value={openFY.id} />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><label>New Fiscal Year Name</label><input type="text" name="newName" placeholder="e.g. FY2027" required /></div>
              <div><label>New Fiscal Year Code</label><input type="text" name="newCode" placeholder="e.g. 2027" required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><label>Start Date</label><input type="date" name="newStart" required /></div>
              <div><label>End Date</label><input type="date" name="newEnd" required /></div>
            </div>
            <div className="mb-3">
              <label>New Opening Allocation (PKR)</label>
              <input type="number" name="newOpening" required />
            </div>
            <label style={{ textTransform: "none", fontWeight: 400, display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
              <input type="checkbox" name="carryForward" style={{ width: "auto" }} />
              Carry forward {openFY.name}&apos;s unspent balance into the new year&apos;s available balance
            </label>
            <button className="btn btn-red btn-small" type="submit">Close {openFY.name} &amp; Open New Year</button>
          </form>
        </div>
      )}

      <h3 style={{ color: "var(--heading)", marginTop: 22 }}>Budget Heads</h3>
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Annual Limit</th><th>Threshold %</th><th>Active</th></tr></thead>
        <tbody>
          {budgetHeads.map((bh) => (
            <tr key={bh.id}>
              <td colSpan={5} style={{ padding: 0 }}>
                <form action={updateBudgetHeadAction} className="grid gap-2 items-center py-2 px-2" style={{ gridTemplateColumns: "70px 1.5fr 1fr 90px 70px 90px" }}>
                  <input type="hidden" name="id" value={bh.id} />
                  <span>{bh.code}</span>
                  <input type="text" name="name" defaultValue={bh.name} />
                  <input type="number" name="annualLimit" defaultValue={Number(bh.annualLimit)} />
                  <input type="number" name="thresholdPercent" defaultValue={bh.thresholdPercent} />
                  <label style={{ textTransform: "none", fontWeight: 400 }}>
                    <input type="checkbox" name="active" defaultChecked={bh.active} style={{ width: "auto" }} />
                  </label>
                  <button className="btn btn-outline btn-small" type="submit">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card mt-5" style={{ maxWidth: 500 }}>
        <h3 style={{ marginTop: 0, color: "var(--heading)" }}>Add Budget Head</h3>
        <form action={addBudgetHeadAction}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label>Code</label><input type="text" name="code" required /></div>
            <div><label>Name</label><input type="text" name="name" required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label>Annual Limit (PKR)</label><input type="number" name="annualLimit" defaultValue={100000} required /></div>
            <div><label>Threshold %</label><input type="number" name="thresholdPercent" defaultValue={80} /></div>
          </div>
          <button className="btn btn-gold" type="submit">Add</button>
        </form>
      </div>

      <div className="card mt-5" style={{ maxWidth: 500 }}>
        <h3 style={{ marginTop: 0, color: "var(--heading)" }}>Bulk Import Budget Heads (CSV)</h3>
        <p style={{ color: "var(--slate)", fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          Columns, in order, no header row: <code>code,name,annualLimit,thresholdPercent</code>. Existing codes are
          updated in place; new codes are created. Example line:
        </p>
        <pre style={{ background: "var(--input-bg)", padding: 10, borderRadius: 3, fontSize: 11.5, marginBottom: 14, overflowX: "auto", color: "var(--slate)" }}>
OFC,Office Supplies,200000,80{"\n"}TRV,Local Travel &amp; Conveyance,250000,80
        </pre>
        <form action={bulkImportBudgetHeadsAction}>
          <div className="mb-4">
            <label>CSV File</label>
            <input type="file" name="file" accept=".csv,text/csv" required />
          </div>
          <button className="btn btn-gold btn-small" type="submit">Import</button>
        </form>
      </div>
    </div>
  );
}
