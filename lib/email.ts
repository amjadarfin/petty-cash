import { Resend } from "resend";
import { writeAudit } from "@/lib/pettycash";

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.RESEND_FROM_EMAIL || "Petty Cash System <onboarding@resend.dev>";
const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

const resend = resendApiKey ? new Resend(resendApiKey) : null;

/**
 * Sends an email if RESEND_API_KEY is configured; otherwise logs to the console
 * and does nothing. Never throws: a failed/unconfigured email must never block
 * an approval action. Every outcome (sent, skipped, failed) is written to the
 * Audit Trail so it's visible on screen at /audit, since this runs server-side
 * with no UI of its own to report back to.
 *
 * IMPORTANT: Resend's default sandbox sender (onboarding@resend.dev) can only
 * deliver to the email address your Resend account was signed up with -- it
 * silently rejects everything else until you verify your own sending domain.
 * Resend reports that as a normal response, not a thrown error, so without the
 * explicit result.error check below it would look like nothing went wrong.
 */
async function send(to: string | undefined | null, subject: string, html: string, voucherNo?: string) {
  if (!to) {
    await writeAudit({ eventType: "TECHNICAL", voucherNo, details: `Email NOT sent — no address on file. Subject: "${subject}"` });
    return;
  }
  if (!resend) {
    console.log(`[email disabled — set RESEND_API_KEY to enable] Would send to ${to}: ${subject}`);
    await writeAudit({ eventType: "TECHNICAL", voucherNo, details: `Email NOT sent — RESEND_API_KEY not configured. Would have gone to ${to}: "${subject}"` });
    return;
  }
  try {
    const result = await resend.emails.send({ from: fromEmail, to, subject, html });
    if (result.error) {
      console.error("Resend rejected the email:", result.error);
      await writeAudit({
        eventType: "TECHNICAL",
        voucherNo,
        details: `Email FAILED to ${to}: "${subject}" — ${result.error.message}. If you're using the onboarding@resend.dev sender, it can only deliver to the email address your Resend account was created with — verify your own domain in the Resend dashboard to send to any address.`,
      });
    } else {
      await writeAudit({ eventType: "TECHNICAL", voucherNo, details: `Email sent to ${to}: "${subject}"` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Email send failed (non-fatal):", err);
    await writeAudit({ eventType: "TECHNICAL", voucherNo, details: `Email FAILED to ${to}: "${subject}" — ${message}` });
  }
}

function wrap(title: string, body: string, voucherNo?: string | null) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #16233F;">${title}</h2>
      ${voucherNo ? `<p style="font-family: monospace; font-weight: bold; color: #16233F;">${voucherNo}</p>` : ""}
      <p style="color: #333; font-size: 14px; line-height: 1.5;">${body}</p>
      <p style="margin-top: 24px;">
        <a href="${appUrl}" style="background: #A8792F; color: #fff; padding: 10px 18px; text-decoration: none; border-radius: 3px; font-size: 13px;">Open Petty Cash System</a>
      </p>
    </div>`;
}

export async function notifySubmitted(approverEmail: string, voucherNo: string, requesterName: string, amount: string) {
  await send(
    approverEmail,
    `Petty Cash: ${voucherNo} awaiting your review`,
    wrap("New Request Awaiting Review", `${requesterName} submitted a request for ${amount}. Please review it at your earliest convenience.`, voucherNo),
    voucherNo
  );
}

export async function notifyDDDecision(requesterEmail: string, voucherNo: string, decision: string, comments: string) {
  await send(
    requesterEmail,
    `Petty Cash: ${voucherNo} — ${decision} by Deputy Director`,
    wrap(`Your request was ${decision.toLowerCase()}`, `The Deputy Director's comments: "${comments}"`, voucherNo),
    voucherNo
  );
}

export async function notifyDirectorPending(approverEmail: string, voucherNo: string, amount: string) {
  await send(
    approverEmail,
    `Petty Cash: ${voucherNo} awaiting your final approval`,
    wrap("Awaiting Your Final Approval", `A request for ${amount} has been approved by the Deputy Director and now needs your final decision.`, voucherNo),
    voucherNo
  );
}

export async function notifyDirectorDecision(requesterEmail: string, voucherNo: string, decision: string, comments: string) {
  await send(
    requesterEmail,
    `Petty Cash: ${voucherNo} — ${decision} by Director`,
    wrap(`Your request was ${decision.toLowerCase()}`, `The Director's comments: "${comments}"`, voucherNo),
    voucherNo
  );
}

export async function notifyAccountsReady(accountsEmail: string, voucherNo: string, amount: string) {
  await send(
    accountsEmail,
    `Petty Cash: ${voucherNo} ready for payment`,
    wrap("Ready for Payment", `A finally-approved request for ${amount} is ready for disbursement.`, voucherNo),
    voucherNo
  );
}

export async function notifyPaymentRecorded(requesterEmail: string, voucherNo: string, amount: string, settled: boolean) {
  await send(
    requesterEmail,
    `Petty Cash: ${voucherNo} — payment recorded`,
    wrap("Payment Recorded", `A payment of ${amount} has been recorded against your request.${settled ? " This request is now fully settled." : ""}`, voucherNo),
    voucherNo
  );
}
