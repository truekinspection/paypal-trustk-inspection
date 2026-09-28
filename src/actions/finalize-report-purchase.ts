"use server";

import { randomBytes } from "crypto";
import db from "@/lib/db";
import { buildReportDeliveryEmailHtml } from "@/lib/emails/templates";
import { createResendClient, getResendFrom } from "@/lib/emails/resend-config";
import { sendOwnerCopy } from "@/lib/emails/send-owner-copy";
import { computeReportPreviewExpiry } from "@/lib/report-preview-access";

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function appOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_URL ||
    "https://www.trustkinspection.com";
  return raw.replace(/\/+$/, "");
}

function splitCustomerName(displayName: string): {
  firstName: string;
  lastName: string;
} {
  const t = displayName.trim();
  if (!t) return { firstName: "Customer", lastName: "" };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

/** Best-effort PayPal Orders capture response parsing. */
function parsePayPalCaptureMeta(data: Record<string, unknown>): {
  transactionId: string | null;
  amountDisplay: string;
  currency: string;
} {
  let transactionId: string | null = null;
  let amountDisplay = "0.10";
  let currency = "USD";

  const units = data.purchase_units;
  if (Array.isArray(units) && units[0] && typeof units[0] === "object") {
    const u = units[0] as Record<string, unknown>;
    const payments = u.payments;
    if (payments && typeof payments === "object") {
      const captures = (payments as Record<string, unknown>).captures;
      if (Array.isArray(captures) && captures[0] && typeof captures[0] === "object") {
        const c = captures[0] as Record<string, unknown>;
        const id = c.id;
        if (typeof id === "string" && id.trim()) transactionId = id.trim();
        const amount = c.amount;
        if (amount && typeof amount === "object") {
          const a = amount as Record<string, unknown>;
          const val = a.value;
          const cur = a.currency_code;
          if (typeof val === "string" && val.trim()) amountDisplay = val.trim();
          else if (typeof val === "number") amountDisplay = val.toFixed(2);
          if (typeof cur === "string" && cur.trim()) currency = cur.trim();
        }
      }
    }
  }

  if (!transactionId && typeof data.id === "string" && data.id.trim()) {
    transactionId = data.id.trim();
  }

  return { transactionId, amountDisplay, currency };
}

export type FinalizeReportPurchaseInput = {
  html: string;
  vin: string;
  clearvinReportId?: string | null;
  customerEmail: string;
  customerDisplayName: string;
  paypalCaptureData: Record<string, unknown>;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
};

/**
 * After successful PayPal capture: persist payment + report token, then send
 * one purchase/report email to the customer and a copy to the owner
 * (DB first — no emails on DB failure).
 */
export async function finalizeReportPurchase(
  input: FinalizeReportPurchaseInput,
): Promise<{ success: true; token: string } | { success: false; error: string }> {
  const email = input.customerEmail.trim();
  if (!email) {
    return { success: false, error: "Customer email is required." };
  }
  if (!input.html?.trim()) {
    return { success: false, error: "Report HTML is missing." };
  }
  if (!input.vin?.trim()) {
    return { success: false, error: "VIN is required." };
  }

  const { firstName, lastName } = splitCustomerName(input.customerDisplayName);
  const { transactionId } = parsePayPalCaptureMeta(input.paypalCaptureData);

  const token = generateToken();
  const expiresAt = computeReportPreviewExpiry();
  const reportIdStr = input.clearvinReportId?.trim() || null;

  try {
    await db.$transaction(
      async (tx) => {
        await tx.reportPreviewToken.create({
          data: {
            token,
            html: input.html,
            vin: input.vin.trim(),
            clearvinReportId: reportIdStr,
            expiresAt,
          },
        });
        await tx.payment.create({
          data: {
            firstName,
            lastName,
            email,
            plan: "Vehicle History Report — $0.10",
            orderID: transactionId ?? undefined,
            status: "COMPLETED",
          },
        });
      },
      {
        maxWait: 20_000,
        timeout: 30_000,
      },
    );
  } catch (e) {
    console.error("[finalizeReportPurchase] DB transaction failed", e);
    return {
      success: false,
      error: "We could not save your order. Please contact support.",
    };
  }

  const origin = appOrigin();
  const reportUrl = `${origin}/report-preview?token=${encodeURIComponent(token)}&vin=${encodeURIComponent(input.vin.trim())}`;
  const resend = createResendClient();
  const from = getResendFrom();

  if (resend) {
    const customerLabel =
      [firstName, lastName].filter(Boolean).join(" ").trim() || "Customer";
    const vinTrimmed = input.vin.trim();
    const emailHtml = buildReportDeliveryEmailHtml({
      customerName: customerLabel,
      reportUrl,
      vin: vinTrimmed,
      reportId: reportIdStr,
      transactionId,
      customerEmail: email,
      vehicleYear: input.vehicleYear,
      vehicleMake: input.vehicleMake,
      vehicleModel: input.vehicleModel,
    });

    try {
      await resend.emails.send({
        from,
        to: email,
        subject: "Your vehicle history report — TrustK Inspection",
        html: emailHtml,
      });
    } catch (e) {
      console.error("[finalizeReportPurchase] customer report email", e);
    }

    await sendOwnerCopy(resend, {
      customerEmail: email,
      subject: `[TrustK] Purchase complete — ${vinTrimmed}`,
      html: buildReportDeliveryEmailHtml({
        customerName: customerLabel,
        reportUrl,
        vin: vinTrimmed,
        reportId: reportIdStr,
        transactionId,
        customerEmail: email,
        vehicleYear: input.vehicleYear,
        vehicleMake: input.vehicleMake,
        vehicleModel: input.vehicleModel,
        forOwner: true,
      }),
      logContext: "finalizeReportPurchase",
    });
  } else {
    console.warn("[finalizeReportPurchase] RESEND_API_KEY not set; skipping emails.");
  }

  void db.reportPreviewToken
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});

  return { success: true, token };
}
