export function normalizePackageShirtNumber(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value === "number") {
        if (!Number.isInteger(value) || value < 0 || value > 99) throw new Error("INVALID_SHIRT_NUMBER");
        return String(value);
    }
    if (typeof value !== "string" || !/^(?:0|00|[1-9][0-9]?)$/.test(value)) throw new Error("INVALID_SHIRT_NUMBER");
    return value;
}

function rank(value: string): number {
    if (value === "0") return 0;
    if (value === "00") return 1;
    return Number(value) + 1;
}

export function comparePackageShirtNumbers(left: string | null, right: string | null): number {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return rank(left) - rank(right);
}
