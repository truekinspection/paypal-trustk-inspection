"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import {
  Loader2,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import { Navbar } from "@/components/navbar";
import { FooterSection } from "@/components/footer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchClearVinReport, verifyClearVinVin } from "@/actions/clearvin";
import { getVinValidationError, normalizeVin } from "@/lib/vin-validation";
import { finalizeReportPurchase } from "@/actions/finalize-report-purchase";
import { paypalScriptOptions } from "@/lib/constants";
import { useUserStore } from "@/store/user-store";

type ReportLoadState = "loading" | "ready" | "error";

type VehicleSummary = {
  year?: string;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  style?: string;
  madeIn?: string;
  msrp?: string;
  previewImageURL?: string;
  imagesAmount?: number;
  auctionHistoryRecords?: number;
  recallCount?: number;
};

function readVinFromClient(): string {
  if (typeof window === "undefined") return "";
  return (
    localStorage.getItem("temp_vin")?.trim() ||
    useUserStore.getState().vnNumber?.trim() ||
    ""
  );
}

function readNameFromClient(): string {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem("temp_name")?.trim();
  if (stored) return stored;
  const { firstName, lastName } = useUserStore.getState();
  return `${firstName} ${lastName}`.trim();
}

function readEmailFromClient(): string {
  return useUserStore.getState().email?.trim() || "";
}

export default function CheckVinPage() {
  const router = useRouter();
  const vinFromStore = useUserStore((s) => s.vnNumber);

  const [reportState, setReportState] = useState<ReportLoadState>("loading");
  const [reportError, setReportError] = useState("");
  const [activeVin, setActiveVin] = useState("");
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payerFirstName, setPayerFirstName] = useState("");
  const [payerLastName, setPayerLastName] = useState("");
  const [payerEmail, setPayerEmail] = useState("");

  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const vehicleRef = useRef<VehicleSummary | null>(null);
  useEffect(() => {
    vehicleRef.current = vehicle;
  }, [vehicle]);

  // ── Verify VIN with ClearVIN (no report HTML on this page) ────────────────
  useEffect(() => {
    const vin = readVinFromClient();
    if (!vin) {
      setReportError(
        "We could not find your VIN. Please go back to the home page and submit the form again.",
      );
      setReportState("error");
      return;
    }

    const normalizedVin = normalizeVin(vin);
    setActiveVin(normalizedVin);
    setReportState("loading");
    setReportError("");
    setVehicle(null);

    const clientVinError = getVinValidationError(normalizedVin);
    if (clientVinError) {
      setReportError(clientVinError);
      setReportState("error");
      return;
    }

    void (async () => {
      const result = await verifyClearVinVin(normalizedVin);
      if (result.success) {
        setVehicle({
          year: result.year,
          make: result.make,
          model: result.model,
          trim: result.trim,
          engine: result.engine,
          style: result.style,
          madeIn: result.madeIn,
          msrp: result.msrp,
          previewImageURL: result.previewImageURL,
          imagesAmount: result.imagesAmount,
          auctionHistoryRecords: result.auctionHistoryRecords,
          recallCount: result.recallCount,
        });
        setReportState("ready");
        return;
      }
      setReportError(
        result.error ||
          "Could not verify this VIN with ClearVIN. Please check your VIN and try again.",
      );
      setReportState("error");
    })();
  }, [vinFromStore]);

  useEffect(() => {
    if (!payModalOpen) return;
    const rawName = readNameFromClient();
    const email = readEmailFromClient();
    const store = useUserStore.getState();
    const parts = rawName.split(/\s+/).filter(Boolean);
    setPayerFirstName(parts[0] || store.firstName || "");
    setPayerLastName(parts.slice(1).join(" ") || store.lastName || "");
    setPayerEmail(email || store.email || "");
  }, [payModalOpen]);

  const completePurchaseAfterPayPal = useCallback(
    async (paypalCaptureData: Record<string, unknown>) => {
      const vinRaw = readVinFromClient();
      const vin = normalizeVin(vinRaw || activeVin);
      const customerEmail = payerEmail.trim() || readEmailFromClient();
      const displayName =
        `${payerFirstName} ${payerLastName}`.trim() ||
        readNameFromClient() ||
        "Customer";

      if (!vin) {
        console.error("[check-vin] PayPal complete but VIN missing");
        toast.error("Something went wrong", {
          description: "Your VIN was lost from this session. Please start again.",
        });
        return;
      }

      const vinValidation = getVinValidationError(vin);
      if (vinValidation) {
        console.error("[check-vin] invalid VIN after PayPal:", vinValidation);
        window.location.href = `/report-preview?error=fetch_failed&vin=${encodeURIComponent(vin)}`;
        return;
      }

      if (!customerEmail) {
        toast.error("Email required", {
          description: "We need your email to deliver the report.",
        });
        return;
      }

      setCheckoutBusy(true);
      setPayModalOpen(false);

      try {
        const result = await fetchClearVinReport(vin);
        if (!result.success || !result.html) {
          console.error("[check-vin] ClearVIN after payment:", result.error);
          window.location.href = `/report-preview?error=fetch_failed&vin=${encodeURIComponent(vin)}`;
          return;
        }

        const vh = vehicleRef.current;
        const finalize = await finalizeReportPurchase({
          html: result.html,
          vin,
          clearvinReportId: result.reportId,
          customerEmail,
          customerDisplayName: displayName,
          paypalCaptureData,
          vehicleYear: vh?.year,
          vehicleMake: vh?.make,
          vehicleModel: vh?.model,
        });

        if (!finalize.success) {
          console.error("[check-vin] finalize purchase:", finalize.error);
          window.location.href = `/report-preview?error=store_failed&vin=${encodeURIComponent(vin)}`;
          return;
        }

        const previewPath = `/report-preview?token=${encodeURIComponent(finalize.token)}&vin=${encodeURIComponent(vin)}`;
        window.location.href = previewPath;
      } catch (e) {
        console.error("[check-vin] post-PayPal", e);
        window.location.href = `/report-preview?error=unexpected&vin=${encodeURIComponent(vin)}`;
      } finally {
        setCheckoutBusy(false);
      }
    },
    [activeVin, payerEmail, payerFirstName, payerLastName],
  );

  const handleCreateOrder = useCallback(async () => {
    const vin = normalizeVin(readVinFromClient() || activeVin);
    const fn = payerFirstName.trim();
    const ln = payerLastName.trim();
    const em = payerEmail.trim();

    if (!fn || !ln || !em) {
      toast.error("Missing information", {
        description: "Please enter your first name, last name, and email.",
      });
      throw new Error("Missing payer fields");
    }
    if (!vin) {
      toast.error("Missing VIN");
      throw new Error("Missing VIN");
    }

    const res = await fetch("/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: fn,
        lastName: ln,
        email: em,
        vin,
      }),
    });

    const json = (await res.json()) as { id?: string; message?: string };
    if (!res.ok || !json.id) {
      toast.error("Could not start checkout", {
        description:
          typeof json.message === "string" ? json.message : "Please try again.",
      });
      throw new Error(json.message || "create-order failed");
    }
    return json.id;
  }, [activeVin, payerEmail, payerFirstName, payerLastName]);

  const handleApprove = useCallback(
    async (data: { orderID?: string }) => {
      const orderID = data.orderID;
      if (!orderID) {
        toast.error("Payment error", { description: "Missing order reference." });
        return;
      }

      const res = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderID }),
      });

      const json = (await res.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
        message?: string;
      };

      if (!res.ok || !json.success || json.data?.status !== "COMPLETED") {
        toast.error("Payment failed", {
          description:
            typeof json.message === "string"
              ? json.message
              : "We could not complete your payment.",
        });
        return;
      }

      await completePurchaseAfterPayPal(json.data);
    },
    [completePurchaseAfterPayPal],
  );

  const handlePayPalError = useCallback((err: Record<string, unknown>) => {
    console.error("[check-vin] PayPal error", err);
    toast.error("Payment error", {
      description: "PayPal could not process this payment. Please try again.",
    });
  }, []);

  const openPaymentModal = () => {
    const vin = normalizeVin(readVinFromClient() || activeVin);
    if (!vin) return;
    if (!paypalScriptOptions.clientId) {
      toast.error("Payments unavailable", {
        description: "PayPal is not configured. Please contact support.",
      });
      return;
    }
    setPayModalOpen(true);
  };

  const noVinError = reportState === "error" && !activeVin;

  const detailRows = [
    { label: "VIN", value: activeVin },
    vehicle?.year ? { label: "Year", value: vehicle.year } : null,
    vehicle?.make ? { label: "Make", value: vehicle.make } : null,
    vehicle?.model ? { label: "Model", value: vehicle.model } : null,
    vehicle?.trim ? { label: "Trim", value: vehicle.trim } : null,
    vehicle?.engine ? { label: "Engine", value: vehicle.engine } : null,
    vehicle?.style ? { label: "Style", value: vehicle.style } : null,
    vehicle?.madeIn ? { label: "Made in", value: vehicle.madeIn } : null,
    vehicle?.msrp ? { label: "MSRP", value: vehicle.msrp } : null,
    typeof vehicle?.auctionHistoryRecords === "number"
      ? {
          label: "Auction records",
          value: String(vehicle.auctionHistoryRecords),
        }
      : null,
    typeof vehicle?.recallCount === "number"
      ? { label: "Active recalls", value: String(vehicle.recallCount) }
      : null,
    typeof vehicle?.imagesAmount === "number"
      ? { label: "Images available", value: String(vehicle.imagesAmount) }
      : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <main className="max-w-[1920px] mx-auto relative overflow-hidden min-h-screen flex flex-col">
      {checkoutBusy && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-6">
          <div className="bg-white rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-5 max-w-sm mx-4">
            <Loader2 className="h-12 w-12 text-custom_red animate-spin" />
            <div className="text-center">
              <p className="text-xl font-bold text-gray-800">
                Preparing your report
              </p>
              <p className="text-gray-500 text-sm mt-1">
                Securing your full vehicle history. Please keep this tab open…
              </p>
            </div>
          </div>
        </div>
      )}

      <Navbar />
      <div className="flex-1 mt-24 max-w-2xl mx-auto px-4 py-10 w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-custom_red font-semibold text-sm uppercase tracking-wide mb-2">
            <ShieldCheck className="h-5 w-5" />
            VIN verification
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900">
            Confirm your vehicle
          </h1>
          <p className="text-gray-600 mt-3 max-w-xl mx-auto text-sm md:text-base">
            We verify your VIN with ClearVIN before checkout. After payment you
            will open the full interactive report on the next page.
          </p>
        </div>

        {noVinError && (
          <div className="max-w-xl mx-auto rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-600 mx-auto mb-3" />
            <p className="text-gray-800 mb-4">{reportError}</p>
            <Button
              className="bg-custom_red hover:bg-red-700 text-white"
              onClick={() => router.push("/")}
            >
              Back to home
            </Button>
          </div>
        )}

        {reportState === "loading" && activeVin && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="h-12 w-12 text-custom_red animate-spin" />
            <p className="text-gray-700 font-medium">
              Verifying VIN {activeVin}…
            </p>
          </div>
        )}

        {reportState === "error" && activeVin && (
          <div className="max-w-xl mx-auto rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-custom_red mx-auto mb-3" />
            <p className="text-gray-800 mb-4">{reportError}</p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  const vin = normalizeVin(readVinFromClient() || activeVin);
                  if (!vin) return;
                  const err = getVinValidationError(vin);
                  if (err) {
                    setReportError(err);
                    setReportState("error");
                    return;
                  }
                  setActiveVin(vin);
                  setReportState("loading");
                  setReportError("");
                  void (async () => {
                    const result = await verifyClearVinVin(vin);
                    if (result.success) {
                      setVehicle({
                        year: result.year,
                        make: result.make,
                        model: result.model,
                        trim: result.trim,
                        engine: result.engine,
                        style: result.style,
                        madeIn: result.madeIn,
                        msrp: result.msrp,
                        previewImageURL: result.previewImageURL,
                        imagesAmount: result.imagesAmount,
                        auctionHistoryRecords: result.auctionHistoryRecords,
                        recallCount: result.recallCount,
                      });
                      setReportState("ready");
                    } else {
                      setReportError(
                        result.error ||
                          "Could not verify this VIN. Please check your VIN and try again.",
                      );
                      setReportState("error");
                    }
                  })();
                }}
              >
                Try again
              </Button>
              <Button
                className="bg-custom_red hover:bg-red-700 text-white"
                onClick={() => router.push("/")}
              >
                Home
              </Button>
            </div>
          </div>
        )}

        {reportState === "ready" && vehicle !== null && (
          <div className="space-y-8">
            <div className="rounded-xl border border-green-200 bg-green-50/90 p-6 md:p-8 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <div className="flex-1 space-y-2 text-left">
                  <p className="text-lg md:text-xl font-semibold text-gray-900">
                    Your VIN is verified. Confirm this is your vehicle.
                  </p>
                  <p className="text-sm text-gray-600">
                    Lightweight summary from ClearVIN preview — not the full
                    history report.
                  </p>

                  {vehicle.previewImageURL ? (
                    <div className="mt-4 overflow-hidden rounded-lg border border-green-100 bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={vehicle.previewImageURL}
                        alt={[
                          vehicle.year,
                          vehicle.make,
                          vehicle.model,
                        ]
                          .filter(Boolean)
                          .join(" ") || "Vehicle preview"}
                        className="h-auto max-h-64 w-full object-contain bg-gray-50"
                      />
                    </div>
                  ) : null}

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    {detailRows.map(({ label, value }) => (
                      <div
                        key={label}
                        className="rounded-lg border border-green-100 bg-white/80 px-4 py-3"
                      >
                        <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {label}
                        </dt>
                        <dd className="mt-1 text-sm font-medium text-gray-900 break-all">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-4 py-2">
              <Button
                size="lg"
                className="w-full max-w-md bg-custom_red/80 hover:bg-custom_red/100 text-white text-lg py-6 rounded-xl shadow-lg"
                onClick={openPaymentModal}
              >
                Get Full Report for $0.10
              </Button>
              <p className="max-w-md text-center text-xs text-gray-500">
                NMVTIS-related records in this report are provided through
                licensed data providers, including ClearVin.{" "}
                <Link href="/terms#nmvtis-disclaimer" className="underline">
                  Read full terms
                </Link>
                .
              </p>
            </div>
          </div>
        )}
      </div>

      <Dialog open={payModalOpen} onOpenChange={setPayModalOpen}>
        <DialogContent className="sm:max-w-[440px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Complete payment — $0.10</DialogTitle>
            <DialogDescription>
              Pay with your PayPal account or a debit/credit card. Your report
              opens on the next page after a successful payment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="payerFirstName">First name</Label>
                <Input
                  id="payerFirstName"
                  value={payerFirstName}
                  onChange={(e) => setPayerFirstName(e.target.value)}
                  autoComplete="given-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="payerLastName">Last name</Label>
                <Input
                  id="payerLastName"
                  value={payerLastName}
                  onChange={(e) => setPayerLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payerEmail">Email</Label>
              <Input
                id="payerEmail"
                type="email"
                value={payerEmail}
                onChange={(e) => setPayerEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            {paypalScriptOptions.clientId ? (
              <PayPalScriptProvider options={paypalScriptOptions}>
                <div className="pt-2">
                  <PayPalButtons
                    style={{ layout: "vertical", color: "silver" }}
                    createOrder={handleCreateOrder}
                    onApprove={handleApprove}
                    onError={handlePayPalError}
                  />
                </div>
              </PayPalScriptProvider>
            ) : (
              <p className="text-sm text-destructive">
                PayPal client ID is not configured.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <FooterSection />
    </main>
  );
}
