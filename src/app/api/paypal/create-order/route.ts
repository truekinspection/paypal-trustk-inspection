import axios from "axios";
import { NextResponse } from "next/server";

import {
  getPayPalAccessToken,
  paypalApiBase,
  PAYPAL_REPORT_CURRENCY,
  PAYPAL_REPORT_UNIT_PRICE,
} from "@/lib/paypal-rest";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const vin = typeof body.vin === "string" ? body.vin.trim() : "";

    if (!firstName || !lastName || !email || !vin) {
      return NextResponse.json(
        { success: false, message: "Missing required fields." },
        { status: 400 },
      );
    }

    const accessToken = await getPayPalAccessToken();
    const base = paypalApiBase();

    const payload = {
      intent: "CAPTURE",
      // Digital good: no shipping — removes ship-to collection and related UI in checkout.
      // Guest card may still show billing address for AVS; that is controlled by PayPal, not optional via API.
      application_context: {
        brand_name: "TrustK Inspection",
        locale: "en-US",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
      },
      purchase_units: [
        {
          amount: {
            currency_code: PAYPAL_REPORT_CURRENCY,
            value: PAYPAL_REPORT_UNIT_PRICE,
            breakdown: {
              item_total: {
                currency_code: PAYPAL_REPORT_CURRENCY,
                value: PAYPAL_REPORT_UNIT_PRICE,
              },
            },
          },
          description: "TrustK Inspection — Full vehicle history report",
          custom_id: vin,
          items: [
            {
              name: "Vehicle history report",
              description: "Digital delivery — full interactive report",
              quantity: "1",
              category: "DIGITAL_GOODS",
              unit_amount: {
                currency_code: PAYPAL_REPORT_CURRENCY,
                value: PAYPAL_REPORT_UNIT_PRICE,
              },
            },
          ],
        },
      ],
    };

    const orderResponse = await axios.post(
      `${base}/v2/checkout/orders`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return NextResponse.json(
      { id: orderResponse.data.id as string },
      { status: orderResponse.status },
    );
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    console.error(
      "[paypal/create-order]",
      err.response?.data || err.message || error,
    );
    return NextResponse.json(
      {
        success: false,
        message: "Could not create PayPal order.",
        details: err.response?.data ?? err.message,
      },
      { status: 500 },
    );
  }
}
