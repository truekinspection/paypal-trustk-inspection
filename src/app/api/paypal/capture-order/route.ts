import axios from "axios";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getPayPalAccessToken, paypalApiBase } from "@/lib/paypal-rest";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderID =
      typeof body.orderID === "string"
        ? body.orderID.trim()
        : typeof body.orderId === "string"
          ? body.orderId.trim()
          : "";

    if (!orderID) {
      return NextResponse.json(
        { success: false, message: "Order ID is required." },
        { status: 400 },
      );
    }

    const accessToken = await getPayPalAccessToken();
    const base = paypalApiBase();

    const orderDetailsResponse = await axios.get(
      `${base}/v2/checkout/orders/${orderID}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (orderDetailsResponse.data?.status !== "APPROVED") {
      console.error(
        "[paypal/capture-order] order not approved:",
        orderDetailsResponse.data?.status,
      );
      return NextResponse.json(
        {
          success: false,
          message: "Order is not approved and cannot be captured.",
        },
        { status: 400 },
      );
    }

    const captureResponse = await axios.post(
      `${base}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "PayPal-Request-Id": randomUUID(),
        },
      },
    );

    const data = captureResponse.data as Record<string, unknown>;
    return NextResponse.json(
      {
        success: true,
        status: data.status,
        data,
      },
      { status: captureResponse.status },
    );
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    console.error(
      "[paypal/capture-order]",
      err.response?.data || err.message || error,
    );
    return NextResponse.json(
      {
        success: false,
        message: "Payment capture failed.",
        details: err.response?.data ?? err.message,
      },
      { status: 500 },
    );
  }
}
