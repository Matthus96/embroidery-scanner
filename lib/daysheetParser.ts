export type ParsedDaysheet = {
    daysheetNumber: string;
    styleReference: string;
    customer: string;
    quantity: number | null;
    warnings: string[];
};

export type OcrTextLine = {
    text: string;
    frame: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
};

const FIELD_LABEL_PATTERN = /^(CUT\s*SHEET|DAY\s*SHEET|D\/?S|STYLE|RANGE|LABEL|DESCRIPTION\d*|PACKAGING|REMARK|COMPOSITION|STYLE\s*REMARKS|TOTAL|DATE|DELIVERY\s*DATE|MADE\s*IN|VAT\s*NO|FROM\s*IMPC)\b/i;
const DESCRIPTION_LABEL_PATTERN = /\bDESCR[I1L]PT[I1L][O0]N\d*\s*[:\-]?\s*/i;
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

function frameCenterX(line: OcrTextLine): number {
    return (line.frame.left + line.frame.right) / 2;
}

function frameCenterY(line: OcrTextLine): number {
    return (line.frame.top + line.frame.bottom) / 2;
}

function frameHeight(line: OcrTextLine): number {
    return Math.max(1, line.frame.bottom - line.frame.top);
}

function descriptionAfterLabel(value: string): string {
    const match = value.match(DESCRIPTION_LABEL_PATTERN);

    if (!match || match.index === undefined) {
        return "";
    }

    const description = cleanDescription(
        value.slice(match.index + match[0].length),
    );

    return isDescriptionCandidate(description) ? description : "";
}

function findLayoutDescription(ocrLines: OcrTextLine[]): string {
    const normalizedLines = ocrLines.map((line) => ({
        ...line,
        text: cleanLine(line.text),
    }));

    for (const label of normalizedLines) {
        if (!DESCRIPTION_LABEL_PATTERN.test(label.text)) {
            continue;
        }

        const sameLineDescription = descriptionAfterLabel(label.text);

        if (sameLineDescription) {
            return sameLineDescription;
        }

        const labelHeight = frameHeight(label);
        const candidate = normalizedLines
            .filter((line) => line !== label)
            .map((line) => ({
                line,
                value: cleanDescription(line.text),
            }))
            .filter(({ line, value }) => {
                const verticalDistance = Math.abs(
                    frameCenterY(line) - frameCenterY(label),
                );

                return (
                    isDescriptionCandidate(value) &&
                    line.frame.left >= label.frame.left &&
                    verticalDistance <=
                        Math.max(labelHeight, frameHeight(line)) * 0.85
                );
            })
            .sort((left, right) => {
                const leftGap = Math.max(
                    0,
                    left.line.frame.left - label.frame.right,
                );
                const rightGap = Math.max(
                    0,
                    right.line.frame.left - label.frame.right,
                );

                return (
                    leftGap - rightGap ||
                    Math.abs(
                        frameCenterY(left.line) - frameCenterY(label),
                    ) -
                        Math.abs(
                            frameCenterY(right.line) - frameCenterY(label),
                        )
                );
            })[0];

        if (candidate) {
            return candidate.value;
        }
    }

    return "";
}

function findDescription(
    lines: string[],
    mbIndex: number,
    ocrLines: OcrTextLine[],
): string {
    for (const line of lines) {
        const sameLineDescription = descriptionAfterLabel(line);

        if (sameLineDescription) {
            return sameLineDescription;
        }
    }

    const layoutDescription = findLayoutDescription(ocrLines);

    if (layoutDescription) {
        return layoutDescription;
    }

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

function findLayoutQuantity(ocrLines: OcrTextLine[]): number | null {
    const normalizedLines = ocrLines.map((line) => ({
        ...line,
        text: cleanLine(line.text),
    }));

    for (const label of normalizedLines) {
        if (!TOTAL_LABEL_PATTERN.test(label.text)) {
            continue;
        }

        const sameLine = quantityFromLine(label.text);

        if (sameLine !== null) {
            return sameLine;
        }

        const labelHeight = frameHeight(label);
        const labelWidth = Math.max(
            1,
            label.frame.right - label.frame.left,
        );
        const candidate = normalizedLines
            .filter((line) => line !== label)
            .map((line) => ({
                line,
                quantity: quantityFromLine(line.text),
            }))
            .filter(({ line, quantity }) => {
                const verticalGap = line.frame.top - label.frame.bottom;
                const horizontalDistance = Math.abs(
                    frameCenterX(line) - frameCenterX(label),
                );

                return (
                    quantity !== null &&
                    verticalGap >= -labelHeight * 0.2 &&
                    verticalGap <= labelHeight * 8 &&
                    horizontalDistance <= labelWidth * 1.25
                );
            })
            .sort((left, right) => {
                const leftGap = Math.max(
                    0,
                    left.line.frame.top - label.frame.bottom,
                );
                const rightGap = Math.max(
                    0,
                    right.line.frame.top - label.frame.bottom,
                );

                return (
                    leftGap - rightGap ||
                    Math.abs(
                        frameCenterX(left.line) - frameCenterX(label),
                    ) -
                        Math.abs(
                            frameCenterX(right.line) - frameCenterX(label),
                        )
                );
            })[0];

        if (candidate?.quantity !== null && candidate) {
            return candidate.quantity;
        }
    }

    return null;
}

function findQuantity(
    lines: string[],
    ocrLines: OcrTextLine[],
): number | null {
    const layoutQuantity = findLayoutQuantity(ocrLines);

    if (layoutQuantity !== null) {
        return layoutQuantity;
    }

    const totalIndex = lines.findIndex((line) =>
        TOTAL_LABEL_PATTERN.test(line),
    );

    if (totalIndex >= 0) {
        const sameLine = quantityFromLine(lines[totalIndex]);

        if (sameLine !== null) {
            return sameLine;
        }

        // Prefer the first numeric line immediately below Total. A narrow
        // window avoids selecting unrelated size, date or order numbers.
        for (
            let index = totalIndex + 1;
            index < Math.min(lines.length, totalIndex + 5);
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

export function parseDaysheetText(
    rawText: string,
    ocrLines: OcrTextLine[] = [],
): ParsedDaysheet {
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

    const customer = findDescription(lines, styleIndex, ocrLines);
    const quantity = findQuantity(lines, ocrLines);

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
