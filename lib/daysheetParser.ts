export type ParsedDaysheet = {
    daysheetNumber: string;
    styleReference: string;
    customer: string;
    quantity: number | null;
    warnings: string[];
};

const FIELD_LABEL_PATTERN = /^(CUT\s*SHEET|DAY\s*SHEET|D\/?S|STYLE|RANGE|LABEL|DESCRIPTION\d*|PACKAGING|REMARK|COMPOSITION|STYLE\s*REMARKS|TOTAL|DATE|DELIVERY\s*DATE|MADE\s*IN|VAT\s*NO|FROM\s*IMPC)\b/i;
const TOTAL_LABEL_PATTERN = /^T[O0]TA[L1I]\b/i;
const DELIVERY_DATE_PATTERN = /^DELIVERY\s*DATE\b/i;
const SIZE_LINE_PATTERN = /^(?:\d{1,3}\s*[|/,-]?\s*){3,}$/;
const GARMENT_DESCRIPTION_PATTERN = /\b(?:BLOUSE|SHIRT|GOLF|T-?SHIRT|TEE|TOP|DRESS|SKIRT|SKORT|SHORTS?|TROUSERS?|PANTS?|JACKET|BLAZER|JERSEY|HOODIE|SWEATER|TRACKSUIT|TUNIC|OVERALL|APRON|VEST|CARDIGAN|PULLOVER|SOCKS?|CAP|BEANIE|SCARF|S\/?S|L\/?S|LONG\s*SLEEVE|SHORT\s*SLEEVE)\b/i;
const DESCRIPTION_NOISE_PATTERN = /^(?:ALLWEAR|SLITS?|BADGE|FLAT|PACKAGING|LABEL|REMARK|COMPOSITION)$/i;

function cleanLine(value: string): string {
    return value
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeStyleReference(value: string): string {
    const match = value.match(/\bM[B8]\s*[-:]?\s*(\d{3,})\b/i);

    if (!match) {
        return "";
    }

    return `MB${match[1]}`;
}

function cleanDescription(value: string): string {
    return value
        .replace(/^[\s:,-]+/, "")
        .replace(/[\s,;:.-]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isDescriptionCandidate(value: string): boolean {
    if (!value || FIELD_LABEL_PATTERN.test(value)) {
        return false;
    }

    if (DESCRIPTION_NOISE_PATTERN.test(value)) {
        return false;
    }

    if (!/[A-Z]/i.test(value) || /%/.test(value)) {
        return false;
    }

    if (SIZE_LINE_PATTERN.test(value)) {
        return false;
    }

    if (/^\d+$/.test(value)) {
        return false;
    }

    const digitCount = (value.match(/\d/g) ?? []).length;
    const letterCount = (value.match(/[A-Z]/gi) ?? []).length;

    if (digitCount > letterCount) {
        return false;
    }

    return value.length <= 100;
}

function descriptionScore(value: string): number {
    const words = value
        .split(/\s+/)
        .map((word) => word.trim())
        .filter(Boolean);

    let score = value.length + words.length * 8;

    if (GARMENT_DESCRIPTION_PATTERN.test(value)) {
        score += 160;
    }

    if (words.length === 1) {
        score -= 80;
    }

    if (/[,|]/.test(value) && /\d/.test(value)) {
        score -= 70;
    }

    return score;
}

function findDescription(lines: string[], mbIndex: number): string {
    if (mbIndex < 0) {
        return "";
    }

    const searchStart = mbIndex + 1;
    const searchEnd = Math.min(lines.length, mbIndex + 12);

    const allwearIndex = lines.findIndex(
        (line, index) =>
            index >= searchStart &&
            index < searchEnd &&
            /^ALLWEAR\b/i.test(line),
    );

    if (allwearIndex > searchStart) {
        const beforeAllwear = cleanDescription(lines[allwearIndex - 1]);

        if (isDescriptionCandidate(beforeAllwear)) {
            return beforeAllwear;
        }
    }

    const candidates = lines
        .slice(searchStart, searchEnd)
        .map(cleanDescription)
        .filter(isDescriptionCandidate)
        .map((value) => ({
            value,
            score: descriptionScore(value),
        }))
        .sort((left, right) => right.score - left.score);

    return candidates[0]?.value ?? "";
}

function quantityFromLine(value: string): number | null {
    const line = cleanLine(value);

    if (
        !line ||
        /\b(?:VAT|CUT\s*SHEET|DAY\s*SHEET|COMPOSITION|MB\s*\d+)\b/i.test(line) ||
        /%/.test(line) ||
        /\d{1,4}\s*[\/-]\s*\d{1,4}/.test(line)
    ) {
        return null;
    }

    const sameLineTotal = line.match(
        /^T[O0]TA[L1I]\s*[:=\-]?\s*(\d{1,6})\b/i,
    );

    if (sameLineTotal) {
        const parsed = Number(sameLineTotal[1]);
        return parsed > 0 ? parsed : null;
    }

    // Accept OCR variants such as "79", "79 B" or "79B".
    const standalone = line.match(/^\s*(\d{1,6})\s*[A-Z]?\s*$/i);

    if (!standalone) {
        return null;
    }

    const parsed = Number(standalone[1]);
    return parsed > 0 ? parsed : null;
}

function findQuantity(lines: string[]): number | null {
    const totalIndex = lines.findIndex((line) =>
        TOTAL_LABEL_PATTERN.test(line),
    );

    if (totalIndex >= 0) {
        const sameLine = quantityFromLine(lines[totalIndex]);

        if (sameLine !== null) {
            return sameLine;
        }

        // The quantity is commonly printed below Total, after Date and
        // Delivery date. Scan a wider area and accept OCR forms like "79 B".
        for (
            let index = totalIndex + 1;
            index < Math.min(lines.length, totalIndex + 14);
            index += 1
        ) {
            const candidate = quantityFromLine(lines[index]);

            if (candidate !== null) {
                return candidate;
            }
        }
    }

    // Fallback for cases where OCR misses or misreads the Total label but
    // still recognises Delivery date and the quantity beneath it.
    const deliveryDateIndex = lines.findIndex((line) =>
        DELIVERY_DATE_PATTERN.test(line),
    );

    if (deliveryDateIndex >= 0) {
        for (
            let index = deliveryDateIndex + 1;
            index < Math.min(lines.length, deliveryDateIndex + 7);
            index += 1
        ) {
            const candidate = quantityFromLine(lines[index]);

            if (candidate !== null) {
                return candidate;
            }
        }
    }

    return null;
}

export function parseDaysheetText(rawText: string): ParsedDaysheet {
    const lines = rawText
        .split(/\r?\n/)
        .map(cleanLine)
        .filter(Boolean);

    const warnings: string[] = [];

    const daysheetNumber =
        rawText.match(/\b\d{2}-\d{4}-\d{4}\b/)?.[0] ?? "";

    const styleIndex = lines.findIndex((line) =>
        /\bM[B8]\s*[-:]?\s*\d{3,}\b/i.test(line),
    );

    const styleReference =
        styleIndex >= 0
            ? normalizeStyleReference(lines[styleIndex])
            : "";

    const customer = findDescription(lines, styleIndex);
    const quantity = findQuantity(lines);

    if (!daysheetNumber) {
        warnings.push("D/S number was not detected.");
    }

    if (!styleReference) {
        warnings.push("Range / style reference was not detected.");
    }

    if (!customer) {
        warnings.push("Description was not detected.");
    }

    if (!quantity) {
        warnings.push("Total units were not detected.");
    }

    return {
        daysheetNumber,
        styleReference,
        customer,
        quantity,
        warnings,
    };
}
