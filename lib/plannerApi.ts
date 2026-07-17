import { loadPlannerConnection } from "./plannerConnection";

export type MasterOrderLookupResponse = {
  success: boolean;
  daysheetNumber: string;
  mbNumber: string;
  customer: string;
  quantity: number;
  stitchCount: number | null;
  designName: string | null;
  ocrMbDetected: boolean;
  message: string;
};

export type SubmitScannedOrderInput = {
  daysheetNumber: string;
  styleReference: string;
  customer: string;
  quantity: number;
  rawOcrText: string;
  sourceImageUri?: string;
  verifiedMbNumber?: string;
};

export type ScanOrderResponse = {
  success: boolean;
  duplicate: boolean;
  taskId: string;
  daysheetNumber: string;
  mbNumber: string;
  styleReference: string;
  masterMatched: boolean;
  masterCustomer: string | null;
  customer: string;
  quantity: number;
  stitchCount: number | null;
  stitchStatus: "matched" | "missing" | "ambiguous" | string;
  designName: string | null;
  status: string;
  assignedMachineId: number | null;
  assignedMachineName: string | null;
  message: string;
};

type ApiErrorResponse = {
  success?: boolean;
  message?: string;
};

function createScanToken(): string {
  return [
    "mobile-scan",
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
    Math.random().toString(36).slice(2, 10),
  ].join(":");
}

async function plannerRequest<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const connection = await loadPlannerConnection();

  if (!connection) {
    throw new Error(
      "No planner connection is saved. Open the Connect tab and save the planner address and pairing token.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${connection.apiUrl}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-planner-token": connection.token,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = (await response.json()) as T & ApiErrorResponse;

    if (!response.ok || payload.success === false) {
      throw new Error(
        payload.message || `Planner request returned HTTP ${response.status}.`,
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "The planner did not respond. Confirm the planner is running and both devices are on the same Wi-Fi network.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupMasterOrder(input: {
  daysheetNumber: string;
  quantity: number;
  rawOcrText: string;
}): Promise<MasterOrderLookupResponse> {
  return plannerRequest<MasterOrderLookupResponse>("/api/orders/lookup", {
    daysheetNo: input.daysheetNumber,
    total: input.quantity,
    rawOcrText: input.rawOcrText,
  });
}

export async function submitScannedOrder(
  input: SubmitScannedOrderInput,
): Promise<ScanOrderResponse> {
  return plannerRequest<ScanOrderResponse>("/api/orders/scan", {
    daysheetNo: input.daysheetNumber,
    range: input.styleReference,
    description: input.customer,
    total: input.quantity,
    scanToken: createScanToken(),
    submittedBy: "Embroidery Scanner",
    rawOcrText: input.rawOcrText,
    sourceImageUri: input.sourceImageUri ?? null,
    verifiedMbNumber: input.verifiedMbNumber ?? null,
  });
}
