import { prisma } from "@/lib/prisma";
import { createUserAction, toggleUserActiveAction, resetUserPasswordAction, bulkImportUsersAction } from "@/lib/actions";
import AdminTabs from "@/components/AdminTabs";

export const dynamic = "force-dynamic";

const ROLE_OPTIONS = ["STAFF", "DEPUTY_DIRECTOR", "DIRECTOR", "ACCOUNTS", "SYSTEM_OWNER"];

export default async function UsersAdminPage() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div>
      <h2 style={{ fontSize: 24, color: "var(--heading)", margin: "0 0 4px" }}>User Management</h2>
      <p style={{ color: "var(--slate)", margin: "0 0 16px", fontSize: 13 }}>
        Create staff accounts, deactivate departures, and reset forgotten passwords.
      </p>
      <AdminTabs active="/admin/users" />

      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Active</th><th>Reset Password</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role.replace(/_/g, " ")}</td>
              <td>{u.department || "—"}</td>
              <td>
                <form action={toggleUserActiveAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={u.id} />
                  <label style={{ textTransform: "none", fontWeight: 400, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" name="active" defaultChecked={u.active} style={{ width: "auto" }} />
                    {u.active ? "Active" : "Inactive"}
                  </label>
                  <button className="btn btn-outline btn-small" type="submit">Save</button>
                </form>
              </td>
              <td>
                <details>
                  <summary style={{ cursor: "pointer", color: "var(--gold)", fontSize: 12 }}>Reset...</summary>
                  <form action={resetUserPasswordAction} className="mt-2 flex gap-2 items-center flex-wrap">
                    <input type="hidden" name="id" value={u.id} />
                    <input type="password" name="newPassword" placeholder="New password (min 8 chars)" minLength={8} required style={{ width: 200 }} />
                    <button className="btn btn-outline btn-small" type="submit">Set Password</button>
                  </form>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card mt-5" style={{ maxWidth: 500 }}>
        <h3 style={{ marginTop: 0, color: "var(--heading)" }}>Add Staff Account</h3>
        <form action={createUserAction}>
          <div className="mb-3">
            <label>Full Name</label>
            <input type="text" name="name" required />
          </div>
          <div className="mb-3">
            <label>Email</label>
            <input type="email" name="email" required />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label>Role</label>
              <select name="role" defaultValue="STAFF">
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Department</label>
              <input type="text" name="department" />
            </div>
          </div>
          <div className="mb-4">
            <label>Initial Password (min 8 characters — share with the user privately)</label>
            <input type="password" name="password" required minLength={8} />
          </div>
          <button className="btn btn-gold" type="submit">Create Account</button>
        </form>
      </div>

      <div className="card mt-5" style={{ maxWidth: 500 }}>
        <h3 style={{ marginTop: 0, color: "var(--heading)" }}>Bulk Import Staff (CSV)</h3>
        <p style={{ color: "var(--slate)", fontSize: 12, marginTop: -6, marginBottom: 10 }}>
          Columns, in order, no header row: <code>name,email,role,department,password</code>. Role must be one of{" "}
          <code>STAFF, DEPUTY_DIRECTOR, DIRECTOR, ACCOUNTS, SYSTEM_OWNER</code>. Existing emails are skipped, not
          overwritten. Example line:
        </p>
        <pre style={{ background: "var(--input-bg)", padding: 10, borderRadius: 3, fontSize: 11.5, marginBottom: 14, overflowX: "auto", color: "var(--slate)" }}>
Ali Raza,ali@example.gov,STAFF,Operations,Passw0rd!
        </pre>
        <form action={bulkImportUsersAction}>
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
