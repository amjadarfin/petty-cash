"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  issueVoucherNumber,
  writeAudit,
  activeFiscalYear,
  budgetHeadSpent,
  availableBalance,
  resolveApprover,
  totalAllocation,
  approvedExpenditure,
} from "@/lib/pettycash";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import { notifySubmitted, notifyDDDecision, notifyDirectorPending, notifyDirectorDecision, notifyAccountsReady, notifyPaymentRecorded } from "@/lib/email";
import { money } from "@/lib/pettycash";

const UPLOAD_DIR = path.join(process.cwd(), "storage", "evidence");
const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png", "heic", "docx", "xlsx"];
const MAX_SIZE = 25 * 1024 * 1024;

async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session.user;
}

async function saveEvidence(requestId: string, file: File): Promise<{ path: string; name: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.includes(ext)) throw new Error("File type not allowed.");
  if (file.size > MAX_SIZE) throw new Error("File exceeds 25MB limit.");

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const safeName = `${requestId}-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(UPLOAD_DIR, safeName), buf);
  return { path: safeName, name: file.name };
}

// ---------- Submit / Save Draft ----------
export async function submitRequestAction(formData: FormData) {
  const user = await requireUser();
  const fy = await activeFiscalYear();

  const doSubmit = formData.get("intent") === "submit";
  const vendorPayee = String(formData.get("vendorPayee") || "").trim();
  const purpose = String(formData.get("purpose") || "").trim();
  const budgetHeadId = String(formData.get("budgetHeadId") || "");
  const requestedAmount = Number(formData.get("requestedAmount") || 0);
  const expenseDate = new Date(String(formData.get("expenseDate")));
  const exceptionReason = String(formData.get("exceptionReason") || "").trim();
  const file = formData.get("evidence") as File | null;

  if (doSubmit) {
    if (!vendorPayee || !purpose || !budgetHeadId || !requestedAmount || requestedAmount <= 0) {
      throw new Error("Please complete all required fields with a positive amount.");
    }
    if ((!file || file.size === 0) && !exceptionReason) {
      throw new Error("Attach a receipt or provide an exception reason.");
    }
    if (fy.status !== "OPEN") throw new Error("The current fiscal year is not open for submissions.");
  }

  const request = await prisma.request.create({
    data: {
      fiscalYearId: fy.id,
      requesterId: user.id!,
      department: user.department,
      expenseDate,
      vendorPayee,
      purpose,
      budgetHeadId: budgetHeadId,
      requestedAmount: requestedAmount || 0,
      exceptionReason: exceptionReason || undefined,
      evidenceStatus: file && file.size > 0 ? "COMPLETE" : "EXCEPTION_REQUESTED",
      status: "DRAFT",
    },
  });

  if (file && file.size > 0) {
    const saved = await saveEvidence(request.id, file);
    await prisma.request.update({
      where: { id: request.id },
      data: { evidencePath: saved.path, evidenceFileName: saved.name },
    });
  }

  if (doSubmit) {
    const voucherNo = await issueVoucherNumber(fy.id, fy.code);
    const ddId = await resolveApprover("DEPUTY_DIRECTOR");
    const duplicateKey = `${user.id}|${vendorPayee.toLowerCase()}|${expenseDate.toISOString().slice(0, 10)}|${requestedAmount}`;
    await prisma.request.update({
      where: { id: request.id },
      data: { voucherNo, status: "SUBMITTED", requestDate: new Date(), currentApproverId: ddId, duplicateKey },
    });
    await prisma.approvalAction.create({
      data: {
        requestId: request.id,
        voucherNo,
        cycleNo: 1,
        stage: "DEPUTY_DIRECTOR",
        decision: "Submitted",
        actorId: user.id!,
        comments: "Submitted by requester.",
      },
    });
    await writeAudit({ requestId: request.id, voucherNo, eventType: "REQUEST_LIFECYCLE", actorId: user.id, details: `Submitted — ${vendorPayee}` });
    const dd = await prisma.user.findUnique({ where: { id: ddId } });
    await notifySubmitted(dd?.email || "", voucherNo, user.name || "A staff member", money(requestedAmount));
  } else {
    await writeAudit({ requestId: request.id, eventType: "REQUEST_LIFECYCLE", actorId: user.id, details: "Draft created" });
  }

  revalidatePath("/requests/mine");
  redirect("/requests/mine");
}

export async function resubmitRequestAction(requestId: string, formData: FormData) {
  const user = await requireUser();
  const existing = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
  if (existing.requesterId !== user.id) throw new Error("Not authorized.");
  if (!["DRAFT", "RETURNED_BY_DD", "RETURNED_BY_DIRECTOR"].includes(existing.status)) {
    throw new Error("This request can no longer be edited.");
  }

  const fy = await activeFiscalYear();
  const doSubmit = formData.get("intent") === "submit";
  const vendorPayee = String(formData.get("vendorPayee") || "").trim();
  const purpose = String(formData.get("purpose") || "").trim();
  const budgetHeadId = String(formData.get("budgetHeadId") || "");
  const requestedAmount = Number(formData.get("requestedAmount") || 0);
  const expenseDate = new Date(String(formData.get("expenseDate")));
  const exceptionReason = String(formData.get("exceptionReason") || "").trim();
  const file = formData.get("evidence") as File | null;

  if (doSubmit && (!vendorPayee || !purpose || !budgetHeadId || !requestedAmount || requestedAmount <= 0)) {
    throw new Error("Please complete all required fields.");
  }

  const wasReturned = existing.status !== "DRAFT";
  const data: Record<string, unknown> = { vendorPayee, purpose, budgetHeadId, requestedAmount, expenseDate, exceptionReason: exceptionReason || null };

  if (file && file.size > 0) {
    const saved = await saveEvidence(requestId, file);
    data.evidencePath = saved.path;
    data.evidenceFileName = saved.name;
    data.evidenceStatus = "COMPLETE";
  }

  if (doSubmit) {
    const cycleNo = wasReturned ? existing.cycleNo + 1 : existing.cycleNo;
    let voucherNo = existing.voucherNo;
    if (!voucherNo) voucherNo = await issueVoucherNumber(fy.id, fy.code);
    const ddId = await resolveApprover("DEPUTY_DIRECTOR");
    data.voucherNo = voucherNo;
    data.status = "SUBMITTED";
    data.requestDate = new Date();
    data.currentApproverId = ddId;
    data.cycleNo = cycleNo;
    data.duplicateKey = `${user.id}|${vendorPayee.toLowerCase()}|${expenseDate.toISOString().slice(0, 10)}|${requestedAmount}`;

    await prisma.request.update({ where: { id: requestId }, data });
    await prisma.approvalAction.create({
      data: {
        requestId,
        voucherNo,
        cycleNo,
        stage: "DEPUTY_DIRECTOR",
        decision: wasReturned ? "Resubmitted" : "Submitted",
        actorId: user.id!,
        comments: wasReturned ? "Resubmitted after return." : "Submitted by requester.",
      },
    });
    await writeAudit({ requestId, voucherNo, eventType: "REQUEST_LIFECYCLE", actorId: user.id, details: `Cycle ${cycleNo}` });
    const dd = await prisma.user.findUnique({ where: { id: ddId } });
    await notifySubmitted(dd?.email || "", voucherNo, user.name || "A staff member", money(requestedAmount));
  } else {
    await prisma.request.update({ where: { id: requestId }, data });
    await writeAudit({ requestId, eventType: "REQUEST_LIFECYCLE", actorId: user.id, details: "Draft updated" });
  }

  revalidatePath("/requests/mine");
  redirect("/requests/mine");
}

// ---------- Deputy Director decision ----------
export async function decideDDAction(requestId: string, decision: "Approve" | "Return" | "Reject", comments: string) {
  const user = await requireUser();
  if (user.role !== "DEPUTY_DIRECTOR" && user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");
  if (!comments.trim()) throw new Error("Comments are mandatory.");

  const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
  if (req.status !== "SUBMITTED") throw new Error("This request is not awaiting Deputy Director review.");

  await prisma.approvalAction.create({
    data: { requestId, voucherNo: req.voucherNo, cycleNo: req.cycleNo, stage: "DEPUTY_DIRECTOR", decision, actorId: user.id!, comments },
  });

  const requester = await prisma.user.findUnique({ where: { id: req.requesterId } });

  if (decision === "Approve") {
    const spent = await budgetHeadSpent(req.budgetHeadId, req.fiscalYearId);
    const head = await prisma.budgetHead.findUniqueOrThrow({ where: { id: req.budgetHeadId } });
    const limit = Number(head.annualLimit);
    const pct = limit > 0 ? ((spent + Number(req.requestedAmount)) / limit) * 100 : 0;
    const flag = pct >= head.thresholdPercent;
    const directorId = await resolveApprover("DIRECTOR");

    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: "APPROVED_BY_DD",
        ddDecision: decision,
        ddComments: comments,
        ddDecisionDate: new Date(),
        currentApproverId: directorId,
        budgetThresholdFlag: flag,
      },
    });
    await writeAudit({ requestId, voucherNo: req.voucherNo, eventType: "APPROVAL", actorId: user.id, details: comments });
    await notifyDDDecision(requester?.email || "", req.voucherNo || "", "Approved", comments);
    const director = await prisma.user.findUnique({ where: { id: directorId } });
    await notifyDirectorPending(director?.email || "", req.voucherNo || "", money(Number(req.requestedAmount)));
  } else if (decision === "Return") {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "RETURNED_BY_DD", ddDecision: decision, ddComments: comments, ddDecisionDate: new Date(), currentApproverId: req.requesterId },
    });
    await writeAudit({ requestId, voucherNo: req.voucherNo, eventType: "APPROVAL", actorId: user.id, details: comments });
    await notifyDDDecision(requester?.email || "", req.voucherNo || "", "Returned", comments);
  } else {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "REJECTED_BY_DD", ddDecision: decision, ddComments: comments, ddDecisionDate: new Date(), recordLocked: true, currentApproverId: null },
    });
    await writeAudit({ requestId, voucherNo: req.voucherNo, eventType: "APPROVAL", actorId: user.id, details: comments });
    await notifyDDDecision(requester?.email || "", req.voucherNo || "", "Rejected", comments);
  }

  revalidatePath("/approvals/dd");
}

// ---------- Director decision ----------
export async function decideDirectorAction(requestId: string, decision: "FinalApprove" | "Return" | "Reject", comments: string) {
  const user = await requireUser();
  if (user.role !== "DIRECTOR" && user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");
  if (!comments.trim()) throw new Error("Comments are mandatory.");

  const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
  if (req.status !== "APPROVED_BY_DD") throw new Error("This request is not awaiting Director review.");

  if (decision === "FinalApprove") {
    const available = await availableBalance(req.fiscalYearId);
    if (Number(req.requestedAmount) > available) {
      throw new Error("Final approval blocked: amount exceeds the available balance.");
    }
  }

  await prisma.approvalAction.create({
    data: { requestId, voucherNo: req.voucherNo, cycleNo: req.cycleNo, stage: "DIRECTOR", decision, actorId: user.id!, comments },
  });

  const requester = await prisma.user.findUnique({ where: { id: req.requesterId } });

  if (decision === "FinalApprove") {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "FINALLY_APPROVED", directorDecision: decision, directorComments: comments, directorDecisionDate: new Date(), recordLocked: true, currentApproverId: null },
    });
    await writeAudit({ requestId, voucherNo: req.voucherNo, eventType: "APPROVAL", actorId: user.id, details: comments });
    await notifyDirectorDecision(requester?.email || "", req.voucherNo || "", "Finally Approved", comments);
    const accountsUsers = await prisma.user.findMany({ where: { role: "ACCOUNTS", active: true } });
    for (const acc of accountsUsers) {
      await notifyAccountsReady(acc.email, req.voucherNo || "", money(Number(req.requestedAmount)));
    }
  } else if (decision === "Return") {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "RETURNED_BY_DIRECTOR", directorDecision: decision, directorComments: comments, directorDecisionDate: new Date(), currentApproverId: req.requesterId },
    });
    await writeAudit({ requestId, voucherNo: req.voucherNo, eventType: "APPROVAL", actorId: user.id, details: comments });
    await notifyDirectorDecision(requester?.email || "", req.voucherNo || "", "Returned", comments);
  } else {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "REJECTED_BY_DIRECTOR", directorDecision: decision, directorComments: comments, directorDecisionDate: new Date(), recordLocked: true, currentApproverId: null },
    });
    await writeAudit({ requestId, voucherNo: req.voucherNo, eventType: "APPROVAL", actorId: user.id, details: comments });
    await notifyDirectorDecision(requester?.email || "", req.voucherNo || "", "Rejected", comments);
  }

  revalidatePath("/approvals/director");
}

// ---------- Payments ----------
export async function recordPaymentAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "ACCOUNTS" && user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");

  const requestId = String(formData.get("requestId"));
  const paidAmount = Number(formData.get("paidAmount") || 0);
  const paymentDate = new Date(String(formData.get("paymentDate")));
  const method = String(formData.get("method"));
  const reference = String(formData.get("reference") || "");
  const settled = formData.get("settled") === "on";

  const req = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
  if (req.status !== "FINALLY_APPROVED" && req.status !== "PAID") throw new Error("Not eligible for payment.");

  const paidSoFar = await prisma.payment.aggregate({ where: { requestId }, _sum: { paidAmount: true } });
  const already = Number(paidSoFar._sum.paidAmount ?? 0);
  if (!paidAmount || paidAmount <= 0) throw new Error("Enter a valid amount.");
  if (already + paidAmount > Number(req.requestedAmount)) throw new Error("Payment total cannot exceed the approved amount.");

  await prisma.payment.create({
    data: {
      requestId,
      voucherNo: req.voucherNo,
      paidAmount,
      paymentDate,
      method,
      reference,
      recordedById: user.id!,
      settlementStatus: settled ? "Settled" : "Recorded",
    },
  });

  const newTotal = already + paidAmount;
  const newPaymentStatus = newTotal >= Number(req.requestedAmount) ? "PAID" : "PART_PAID";
  const newStatus = settled ? "SETTLED" : newTotal >= Number(req.requestedAmount) ? "PAID" : req.status;

  await prisma.request.update({
    where: { id: requestId },
    data: { paymentStatus: settled ? "SETTLED" : newPaymentStatus, status: newStatus },
  });

  await writeAudit({ requestId, voucherNo: req.voucherNo, eventType: "FINANCIAL_CHANGES", actorId: user.id, details: `Payment of ${paidAmount} via ${method}${settled ? " (Settled)" : ""}` });
  const requester = await prisma.user.findUnique({ where: { id: req.requesterId } });
  await notifyPaymentRecorded(requester?.email || "", req.voucherNo || "", money(paidAmount), settled);
  revalidatePath("/payments");
}

export async function markSettledAction(requestId: string) {
  const user = await requireUser();
  if (user.role !== "ACCOUNTS" && user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");
  const req = await prisma.request.update({ where: { id: requestId }, data: { status: "SETTLED", paymentStatus: "SETTLED" } });
  await writeAudit({ requestId, voucherNo: req.voucherNo, eventType: "FINANCIAL_CHANGES", actorId: user.id, details: "Marked settled" });
  revalidatePath("/payments/open");
}

// ---------- Admin ----------
export async function updateBudgetHeadAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");
  const id = String(formData.get("id"));
  const name = String(formData.get("name"));
  const annualLimit = Number(formData.get("annualLimit"));
  const thresholdPercent = Number(formData.get("thresholdPercent"));
  const active = formData.get("active") === "on";

  await prisma.budgetHead.update({ where: { id }, data: { name, annualLimit, thresholdPercent, active } });
  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: `Budget head updated: ${name}` });
  revalidatePath("/admin");
}

export async function addBudgetHeadAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");
  const code = String(formData.get("code")).toUpperCase();
  const name = String(formData.get("name"));
  const annualLimit = Number(formData.get("annualLimit"));
  const thresholdPercent = Number(formData.get("thresholdPercent") || 80);

  await prisma.budgetHead.create({ data: { code, name, annualLimit, thresholdPercent, active: true } });
  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: `Budget head created: ${name}` });
  revalidatePath("/admin");
}

// ---------- User management ----------

export async function createUserAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "STAFF");
  const department = String(formData.get("department") || "").trim();
  const password = String(formData.get("password") || "");

  if (!name || !email || !password) throw new Error("Name, email and password are required.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("A user with this email already exists.");

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name, email, department: department || undefined, role: role as never, passwordHash, active: true },
  });
  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: `User created: ${name} (${email}, ${role})` });
  revalidatePath("/admin/users");
}

export async function toggleUserActiveAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");
  const id = String(formData.get("id"));
  const active = formData.get("active") === "on";
  if (id === user.id && !active) throw new Error("You cannot deactivate your own account.");

  const target = await prisma.user.update({ where: { id }, data: { active } });
  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: `${active ? "Activated" : "Deactivated"} user: ${target.name}` });
  revalidatePath("/admin/users");
}

export async function resetUserPasswordAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");
  const id = String(formData.get("id"));
  const newPassword = String(formData.get("newPassword") || "");
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const target = await prisma.user.update({ where: { id }, data: { passwordHash } });
  // Deliberately do not log the password value itself — only that a reset occurred.
  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: `Password reset by administrator for: ${target.name}` });
  revalidatePath("/admin/users");
}

export async function changeOwnPasswordAction(formData: FormData) {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
  if (newPassword !== confirmPassword) throw new Error("New password and confirmation do not match.");

  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const valid = await bcrypt.compare(currentPassword, record.passwordHash);
  if (!valid) throw new Error("Current password is incorrect.");

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: "User changed their own password" });
  revalidatePath("/account");
}

// ---------- Approver configuration / delegation ----------
export async function updateApproverConfigAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");

  const roleName = String(formData.get("roleName")) as "DEPUTY_DIRECTOR" | "DIRECTOR";
  const primaryApproverId = String(formData.get("primaryApproverId"));
  const backupApproverId = String(formData.get("backupApproverId") || "") || null;
  const delegationActive = formData.get("delegationActive") === "on";
  const delegationStartRaw = String(formData.get("delegationStart") || "");
  const delegationEndRaw = String(formData.get("delegationEnd") || "");

  await prisma.approverConfig.upsert({
    where: { roleName },
    update: {
      primaryApproverId,
      backupApproverId,
      delegationActive,
      delegationStart: delegationStartRaw ? new Date(delegationStartRaw) : null,
      delegationEnd: delegationEndRaw ? new Date(delegationEndRaw) : null,
    },
    create: {
      roleName,
      primaryApproverId,
      backupApproverId,
      delegationActive,
      delegationStart: delegationStartRaw ? new Date(delegationStartRaw) : null,
      delegationEnd: delegationEndRaw ? new Date(delegationEndRaw) : null,
    },
  });
  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: `Approver configuration updated: ${roleName}` });
  revalidatePath("/admin/approvers");
}

// ---------- Direct allocation edit (top-up current year without closing it) ----------
export async function updateFiscalYearAllocationAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");

  const fiscalYearId = String(formData.get("fiscalYearId"));
  const opening = Number(formData.get("opening") || 0);
  const supplementary = Number(formData.get("supplementary") || 0);

  if (opening < 0 || supplementary < 0) throw new Error("Amounts cannot be negative.");

  const fy = await prisma.fiscalYear.update({
    where: { id: fiscalYearId },
    data: { opening, supplementary },
  });
  await writeAudit({
    eventType: "FINANCIAL_CHANGES",
    actorId: user.id,
    details: `Fiscal year allocation updated for ${fy.name}: opening ${opening}, supplementary ${supplementary}`,
  });
  revalidatePath("/admin");
}

// ---------- Create a brand-new fiscal year (first-time setup, or run alongside an existing one) ----------
export async function createFiscalYearAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");

  const name = String(formData.get("name") || "").trim();
  const code = String(formData.get("code") || "").trim();
  const startDate = String(formData.get("startDate") || "");
  const endDate = String(formData.get("endDate") || "");
  const opening = Number(formData.get("opening") || 0);
  const makeOpen = formData.get("makeOpen") === "on";

  if (!name || !code || !startDate || !endDate) throw new Error("Please complete all fields.");

  const existing = await prisma.fiscalYear.findUnique({ where: { code } });
  if (existing) throw new Error("A fiscal year with this code already exists.");

  await prisma.$transaction(async (tx) => {
    if (makeOpen) {
      // Only one fiscal year should be Open at a time so activeFiscalYear() stays unambiguous.
      await tx.fiscalYear.updateMany({ where: { status: "OPEN" }, data: { status: "CLOSED" } });
    }
    const fy = await tx.fiscalYear.create({
      data: { name, code, startDate: new Date(startDate), endDate: new Date(endDate), opening, status: makeOpen ? "OPEN" : "CLOSED" },
    });
    await tx.voucherSequence.create({ data: { fiscalYearId: fy.id, lastIssued: 0 } });
  });

  await writeAudit({ eventType: "FINANCIAL_CHANGES", actorId: user.id, details: `Fiscal year created: ${name} (opening ${opening})` });
  revalidatePath("/admin");
}

// ---------- Fiscal year closure ----------
export async function closeFiscalYearAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");

  const fiscalYearId = String(formData.get("fiscalYearId"));
  const carryForward = formData.get("carryForward") === "on";
  const newName = String(formData.get("newName") || "").trim();
  const newCode = String(formData.get("newCode") || "").trim();
  const newStart = String(formData.get("newStart") || "");
  const newEnd = String(formData.get("newEnd") || "");
  const newOpening = Number(formData.get("newOpening") || 0);

  if (!newName || !newCode || !newStart || !newEnd) throw new Error("Please complete all new fiscal year fields.");

  const openCount = await prisma.request.count({
    where: { fiscalYearId, status: { in: ["SUBMITTED", "APPROVED_BY_DD", "RETURNED_BY_DD", "RETURNED_BY_DIRECTOR"] } },
  });
  if (openCount > 0) {
    throw new Error(`Cannot close: ${openCount} request(s) are still in progress for this fiscal year. Resolve them first.`);
  }

  const total = await totalAllocation(fiscalYearId);
  const approved = await approvedExpenditure(fiscalYearId);
  const unspent = Math.max(0, total - approved);

  await prisma.$transaction(async (tx) => {
    await tx.fiscalYear.update({
      where: { id: fiscalYearId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedBy: user.id,
        carryforwardAmount: unspent,
        carryforwardStatus: carryForward ? "APPLIED" : "LAPSED",
      },
    });

    const newFY = await tx.fiscalYear.create({
      data: {
        name: newName,
        code: newCode,
        startDate: new Date(newStart),
        endDate: new Date(newEnd),
        opening: newOpening,
        carryforwardAmount: carryForward ? unspent : 0,
        carryforwardStatus: carryForward ? "APPLIED" : "NONE",
        status: "OPEN",
      },
    });

    await tx.voucherSequence.create({ data: { fiscalYearId: newFY.id, lastIssued: 0 } });
  });

  await writeAudit({
    eventType: "FINANCIAL_CHANGES",
    actorId: user.id,
    details: `Fiscal year closed. Unspent: ${unspent}. Carryforward ${carryForward ? "applied" : "lapsed"}.`,
  });
  revalidatePath("/admin");
}

// ---------- Bulk CSV import ----------
// Simple, dependency-free CSV line parser. Handles quoted fields with embedded
// commas (RFC 4180 basics) which covers the vast majority of real spreadsheet
// exports without pulling in a parsing library.
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ",") {
        cells.push(current);
        current = "";
      } else current += char;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(parseCsvLine);
}

const VALID_ROLES = ["STAFF", "DEPUTY_DIRECTOR", "DIRECTOR", "ACCOUNTS", "SYSTEM_OWNER"];

export async function bulkImportUsersAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) throw new Error("Please choose a CSV file.");
  const text = await file.text();
  const rows = parseCsv(text);

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [i, row] of rows.entries()) {
    const [name, email, role, department, password] = row;
    if (!name || !email || !password) {
      errors.push(`Row ${i + 1}: missing name, email, or password — skipped.`);
      continue;
    }
    const normalizedRole = (role || "STAFF").trim().toUpperCase();
    if (!VALID_ROLES.includes(normalizedRole)) {
      errors.push(`Row ${i + 1}: invalid role "${role}" — skipped.`);
      continue;
    }
    if (password.length < 8) {
      errors.push(`Row ${i + 1}: password too short (min 8 chars) — skipped.`);
      continue;
    }
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      skipped++;
      continue;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: { name, email: email.toLowerCase(), role: normalizedRole as never, department: department || undefined, passwordHash, active: true },
    });
    created++;
  }

  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: `Bulk user import: ${created} created, ${skipped} skipped (already existed), ${errors.length} errors` });
  revalidatePath("/admin/users");

  if (errors.length > 0) {
    throw new Error(`Imported ${created}, skipped ${skipped} existing. Problems: ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ""}`);
  }
}

export async function bulkImportBudgetHeadsAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SYSTEM_OWNER") throw new Error("Not authorized.");

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) throw new Error("Please choose a CSV file.");
  const text = await file.text();
  const rows = parseCsv(text);

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const [i, row] of rows.entries()) {
    const [code, name, annualLimitRaw, thresholdRaw] = row;
    const annualLimit = Number(annualLimitRaw);
    const thresholdPercent = thresholdRaw ? Number(thresholdRaw) : 80;
    if (!code || !name || !annualLimitRaw || Number.isNaN(annualLimit)) {
      errors.push(`Row ${i + 1}: missing or invalid data — skipped.`);
      continue;
    }
    const existing = await prisma.budgetHead.findUnique({ where: { code: code.toUpperCase() } });
    if (existing) {
      await prisma.budgetHead.update({ where: { id: existing.id }, data: { name, annualLimit, thresholdPercent } });
      updated++;
    } else {
      await prisma.budgetHead.create({ data: { code: code.toUpperCase(), name, annualLimit, thresholdPercent, active: true } });
      created++;
    }
  }

  await writeAudit({ eventType: "ACCESS_ADMIN", actorId: user.id, details: `Bulk budget head import: ${created} created, ${updated} updated, ${errors.length} errors` });
  revalidatePath("/admin");

  if (errors.length > 0) {
    throw new Error(`Created ${created}, updated ${updated}. Problems: ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ""}`);
  }
}
