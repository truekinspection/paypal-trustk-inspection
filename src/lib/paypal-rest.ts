import axios from "axios";

export function paypalApiBase(): string {
  const url =
    process.env.NODE_ENV === "production"
      ? process.env.PAYPAL_API_URL_PRODUCTION
      : process.env.PAYPAL_API_URL_SANDBOX;
  if (!url?.trim()) {
    throw new Error("PayPal API URL is not configured.");
  }
  return url.replace(/\/+$/, "");
}

export async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_SECRET_KEY?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("PayPal client credentials are not configured.");
  }
  const base = paypalApiBase();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenResponse = await axios.post(
    `${base}/v1/oauth2/token`,
    "grant_type=client_credentials",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
      },
    },
  );
  const accessToken = tokenResponse.data?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("No access token received from PayPal.");
  }
  return accessToken;
}

/** Report checkout — price is fixed server-side (do not trust client). */
export const PAYPAL_REPORT_UNIT_PRICE = "0.10";
export const PAYPAL_REPORT_CURRENCY = "USD";
