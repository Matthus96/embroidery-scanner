import * as SecureStore from "expo-secure-store";

const API_URL_KEY = "embroidery-scanner.api-url";
const TOKEN_KEY = "embroidery-scanner.pairing-token";

export type PlannerConnection = {
    apiUrl: string;
    token: string;
};

export type PlannerHealth = {
    success: boolean;
    databaseReady: boolean;
    referenceCount: number;
    message: string;
};

type PairingCode = {
    version?: number;
    apiUrl?: unknown;
    token?: unknown;
};

export function normalizeApiUrl(value: string): string {
    return value.trim().replace(/\/+$/, "");
}

export function parsePairingCode(value: string): PlannerConnection {
    let parsed: PairingCode;

    try {
        parsed = JSON.parse(value.trim()) as PairingCode;
    } catch {
        throw new Error(
            "The pairing code is not valid JSON. Copy it again from Planner Settings.",
        );
    }

    const apiUrl =
        typeof parsed.apiUrl === "string"
            ? normalizeApiUrl(parsed.apiUrl)
            : "";

    const token =
        typeof parsed.token === "string"
            ? parsed.token.trim()
            : "";

    validateConnection({ apiUrl, token });

    return { apiUrl, token };
}

export function validateConnection(
    connection: PlannerConnection,
): void {
    if (!connection.apiUrl) {
        throw new Error("Enter the planner API address.");
    }

    if (!/^https?:\/\//i.test(connection.apiUrl)) {
        throw new Error(
            "The planner address must begin with http:// or https://.",
        );
    }

    if (!connection.token) {
        throw new Error("Enter the scanner pairing token.");
    }
}

export async function loadPlannerConnection(): Promise<PlannerConnection | null> {
    const [apiUrl, token] = await Promise.all([
        SecureStore.getItemAsync(API_URL_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
    ]);

    if (!apiUrl || !token) {
        return null;
    }

    return {
        apiUrl: normalizeApiUrl(apiUrl),
        token,
    };
}

export async function savePlannerConnection(
    connection: PlannerConnection,
): Promise<void> {
    validateConnection(connection);

    await Promise.all([
        SecureStore.setItemAsync(
            API_URL_KEY,
            normalizeApiUrl(connection.apiUrl),
        ),
        SecureStore.setItemAsync(TOKEN_KEY, connection.token.trim()),
    ]);
}

export async function clearPlannerConnection(): Promise<void> {
    await Promise.all([
        SecureStore.deleteItemAsync(API_URL_KEY),
        SecureStore.deleteItemAsync(TOKEN_KEY),
    ]);
}

export async function checkPlannerHealth(
    apiUrl: string,
): Promise<PlannerHealth> {
    const normalizedUrl = normalizeApiUrl(apiUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
        const response = await fetch(
            `${normalizedUrl}/api/health`,
            {
                method: "GET",
                headers: {
                    Accept: "application/json",
                },
                signal: controller.signal,
            },
        );

        if (!response.ok) {
            throw new Error(
                `Planner connection returned HTTP ${response.status}.`,
            );
        }

        const health = (await response.json()) as PlannerHealth;

        if (!health.success) {
            throw new Error(
                health.message || "The planner API is unavailable.",
            );
        }

        if (!health.databaseReady) {
            throw new Error(
                health.message ||
                    "The planner database has not finished loading.",
            );
        }

        return health;
    } catch (error) {
        if (
            error instanceof Error &&
            error.name === "AbortError"
        ) {
            throw new Error(
                "The planner did not respond. Confirm both devices are on the same Wi-Fi network.",
            );
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
