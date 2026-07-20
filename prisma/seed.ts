import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("1234!", 10);

  const [staff01, staff02, dd, dir, accounts, admin] = await Promise.all([
    prisma.user.upsert({
      where: { email: "staff01@nutech.edu.pk" },
      update: {},
      create: { name: "Shakeel", email: "staff01@nutech.edu.pk", passwordHash: password, role: "STAFF", department: "IT" },
    }),
    prisma.user.upsert({
      where: { email: "staff02@nutech.edu.pk" },
      update: {},
      create: { name: "Wahab Malik", email: "staff02@nutech.edu.pk", passwordHash: password, role: "STAFF", department: "IT" },
    }),
    prisma.user.upsert({
      where: { email: "dd@nutech.edu.pk" },
      update: {},
      create: { name: "Engr Faiza Obaid", email: "dd@nutech.edu.pk", passwordHash: password, role: "DEPUTY_DIRECTOR", department: "Office of the Deputy Director" },
    }),
    prisma.user.upsert({
      where: { email: "dir@nutech.edu.pk" },
      update: {},
      create: { name: "Rai Sabir Hussein", email: "dir@nutech.edu.pk", passwordHash: password, role: "DIRECTOR", department: "Director's Office" },
    }),
    prisma.user.upsert({
      where: { email: "accounts@nutech.edu.pk" },
      update: {},
      create: { name: "Liaqat Hussein", email: "accounts@nutech.edu.pk", passwordHash: password, role: "ACCOUNTS", department: "Accounts" },
    }),
    prisma.user.upsert({
      where: { email: "admin@nutech.edu.pk" },
      update: {},
      create: { name: "System Administrator", email: "admin@nutech.edu.pk", passwordHash: password, role: "SYSTEM_OWNER", department: "IT" },
    }),
  ]);

  const fyCode = process.env.SEED_FY_CODE || "2026";
  const opening = Number(process.env.SEED_FY_OPENING || "1000000");

  const fy = await prisma.fiscalYear.upsert({
    where: { code: fyCode },
    update: {},
    create: {
      name: `FY${fyCode}`,
      code: fyCode,
      startDate: new Date(`${fyCode}-07-01`),
      endDate: new Date(`${Number(fyCode) + 1}-06-30`),
      opening,
      status: "OPEN",
    },
  });

  await prisma.voucherSequence.upsert({
    where: { fiscalYearId: fy.id },
    update: {},
    create: { fiscalYearId: fy.id, lastIssued: 0 },
  });

  const heads = [
    { code: "OFC", name: "Office Supplies", annualLimit: 200000 },
    { code: "TRV", name: "Local Travel & Conveyance", annualLimit: 250000 },
    { code: "UTL", name: "Utilities & Communication", annualLimit: 150000 },
    { code: "MNT", name: "Repairs & Maintenance", annualLimit: 200000 },
    { code: "MSC", name: "Miscellaneous", annualLimit: 200000 },
  ];
  for (const h of heads) {
    await prisma.budgetHead.upsert({
      where: { code: h.code },
      update: {},
      create: { ...h, thresholdPercent: 80, active: true },
    });
  }

  await prisma.approverConfig.upsert({
    where: { roleName: "DEPUTY_DIRECTOR" },
    update: { primaryApproverId: dd.id },
    create: { roleName: "DEPUTY_DIRECTOR", primaryApproverId: dd.id },
  });
  await prisma.approverConfig.upsert({
    where: { roleName: "DIRECTOR" },
    update: { primaryApproverId: dir.id },
    create: { roleName: "DIRECTOR", primaryApproverId: dir.id },
  });

  console.log("Seed complete.");
  console.log("Login with any of these emails, password: 1234!");
  [staff01, staff02, dd, dir, accounts, admin].forEach((u) => console.log(" -", u.email, `(${u.role})`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
