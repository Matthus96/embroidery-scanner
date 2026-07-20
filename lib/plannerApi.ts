import { loadPlannerConnection } from "./plannerConnection";

export type MasterOrderLookupResponse = {
  success: boolean;
  masterMatched: boolean;
  daysheetNumber: string;
  mbNumber: string;
  customer: string;
  quantity: number;
  stitchCount: number | null;
  designName: string | null;
  ocrMbDetected: boolean;
  duplicateCount: number;
  requiresDuplicateReason: boolean;
  duplicateReason: DuplicateDaysheetReason | null;
  message: string;
};

export type DuplicateDaysheetReason =
  | "split-allocation"
  | "combined-customer-orders"
  | "multiple-garment-panels"
  | "error";

export type SubmitScannedOrderInput = {
  daysheetNumber: string;
  styleReference: string;
  customer: string;
  quantity: number;
  rawOcrText: string;
  sourceImageUri?: string;
  verifiedMbNumber?: string;
  duplicateReason?: DuplicateDaysheetReason;
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
  body?: Record<string, unknown>,
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
      method: body ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-planner-token": connection.token,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const payload = (await response.json()) as T;
    const apiError =
      payload !== null &&
      typeof payload === "object"
        ? (payload as ApiErrorResponse)
        : null;

    if (!response.ok || apiError?.success === false) {
      throw new Error(
        apiError?.message || `Planner request returned HTTP ${response.status}.`,
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

export type OperatorSession = {
  sessionId: string;
  assignmentId: string;
  taskId: string;
  machineId: number;
  machineName: string;
  daysheetNumber: string;
  customer: string;
  garmentType: string;
  mbNumber: string;
  stitchCount: number | null;
  designName: string | null;
  units: number;
  totalRuns: number;
  estimatedSeconds: number | null;
  currentRun: number;
  completedRuns: number;
  status: "loaded" | "running" | "paused" | "between-runs" | "completed" | string;
  pauseReason: string | null;
  pauseNote: string | null;
  runningSeconds: number;
  pausedSeconds: number;
  currentPauseSeconds: number;
  loadedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  stateChangedAt: string;
  message: string;
};

export type OperatorMachine = {
  machineId: number;
  machineName: string;
  workingHeads: number;
  machineStatus: string;
  activeSession: OperatorSession | null;
};

export type OperatorAction =
  | "start"
  | "pause"
  | "resume"
  | "complete-run"
  | "finish";

export function getOperatorMachines(): Promise<OperatorMachine[]> {
  return plannerRequest<OperatorMachine[]>("/api/operator/machines");
}

export function getMachineSession(machineId: number): Promise<OperatorSession | null> {
  return plannerRequest<OperatorSession | null>(
    `/api/operator/machines/${machineId}/session`,
  );
}

export function loadOperatorOrder(input: {
  daysheetNumber: string;
  machineId: number;
  operatorName?: string;
  rawOcrText?: string;
  loadAnyway?: boolean;
}): Promise<OperatorSession> {
  return plannerRequest<OperatorSession>("/api/operator/load", {
    daysheetNumber: input.daysheetNumber,
    machineId: input.machineId,
    operatorName: input.operatorName ?? null,
    rawOcrText: input.rawOcrText ?? null,
    loadAnyway: input.loadAnyway ?? false,
  });
}

export function updateOperatorSession(
  sessionId: string,
  input: {
    action: OperatorAction;
    reason?: string;
    note?: string;
    operatorName?: string;
  },
): Promise<OperatorSession> {
  return plannerRequest<OperatorSession>(
    `/api/operator/sessions/${encodeURIComponent(sessionId)}/action`,
    {
      action: input.action,
      reason: input.reason ?? null,
      note: input.note ?? null,
      operatorName: input.operatorName ?? null,
    },
  );
}

export type CleanerOrder = {
  cleaningOrderId: string;
  assignmentId: string;
  taskId: string;
  machineId: number;
  machineName: string;
  daysheetNumber: string;
  customer: string;
  garmentType: string;
  mbNumber: string;
  stitchCount: number | null;
  units: number;
  runs: number;
  status: "waiting" | "in-progress" | "completed" | string;
  queuedAt: string;
  startedAt: string | null;
  cleanerName: string | null;
};

export function loadCleanerOrder(input: {
  daysheetNumber: string;
  cleanerName?: string;
  rawOcrText?: string;
}): Promise<CleanerOrder> {
  return plannerRequest<CleanerOrder>("/api/cleaner/load", {
    daysheetNumber: input.daysheetNumber,
    cleanerName: input.cleanerName ?? null,
    rawOcrText: input.rawOcrText ?? null,
  });
}

export function finishCleanerOrder(
  cleaningOrderId: string,
  input: { cleanerName?: string; note?: string },
): Promise<CleanerOrder> {
  return plannerRequest<CleanerOrder>(
    `/api/cleaner/orders/${encodeURIComponent(cleaningOrderId)}/finish`,
    {
      cleanerName: input.cleanerName ?? null,
      note: input.note ?? null,
    },
  );
}

export async function lookupMasterOrder(input: {
  daysheetNumber: string;
  quantity: number;
  rawOcrText: string;
  styleReference?: string;
  description?: string;
}): Promise<MasterOrderLookupResponse> {
  return plannerRequest<MasterOrderLookupResponse>("/api/orders/lookup", {
    daysheetNo: input.daysheetNumber,
    total: input.quantity,
    rawOcrText: input.rawOcrText,
    styleReference: input.styleReference ?? null,
    description: input.description ?? null,
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
    duplicateReason: input.duplicateReason ?? null,
  });
}
