/**
 * Resets the database to a clean slate WITHOUT deleting user accounts.
 * Deletes: audit logs, payments, approval actions, requests, voucher sequences,
 * approver configuration, budget heads, fiscal years.
 * Keeps: the User table untouched (everyone's login still works).
 *
 * Run with: npm run db:reset-data
 *
 * After running, go to Admin (System Owner login) and use "Create a New Fiscal
 * Year" and "Add Budget Head" to set the system up fresh — those screens
 * already support this, no seed script needed.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Wiping transactional data (users will NOT be touched)...");

  // Delete in FK-safe order: children before parents.
  const auditLogs = await prisma.auditLog.deleteMany({});
  console.log(`  Audit log entries deleted: ${auditLogs.count}`);

  const payments = await prisma.payment.deleteMany({});
  console.log(`  Payments deleted: ${payments.count}`);

  const approvalActions = await prisma.approvalAction.deleteMany({});
  console.log(`  Approval actions deleted: ${approvalActions.count}`);

  const requests = await prisma.request.deleteMany({});
  console.log(`  Requests deleted: ${requests.count}`);

  const voucherSequences = await prisma.voucherSequence.deleteMany({});
  console.log(`  Voucher sequences deleted: ${voucherSequences.count}`);

  const approverConfigs = await prisma.approverConfig.deleteMany({});
  console.log(`  Approver configurations deleted: ${approverConfigs.count}`);

  const budgetHeads = await prisma.budgetHead.deleteMany({});
  console.log(`  Budget heads deleted: ${budgetHeads.count}`);

  const fiscalYears = await prisma.fiscalYear.deleteMany({});
  console.log(`  Fiscal years deleted: ${fiscalYears.count}`);

  const userCount = await prisma.user.count();
  console.log(`\nDone. User accounts preserved: ${userCount}`);
  console.log("Next step: sign in as a System Owner and set up a fiscal year + budget heads under Admin.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
