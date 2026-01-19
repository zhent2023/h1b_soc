/**
 * Pure formatting utilities extracted from page.tsx for performance optimization.
 * These functions have no side effects and no state dependencies.
 */

/**
 * Format a decimal value (0-1) as a percentage string with 2 decimal places.
 * Values are clamped to the [0, 1] range. Returns "—" for null/undefined/NaN.
 */
export function formatMatchPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '—';
    }
    const bounded = Math.min(Math.max(value, 0), 1);
    return `${(bounded * 100).toFixed(2)}%`;
}

/**
 * Format an hourly wage value for display.
 * Returns "—" for null/undefined, the original string if not a valid number,
 * or the formatted value with $ prefix.
 * Note: Accepts string | number to handle API response type variations.
 */
export function formatHourlyPreview(
    value: string | number | null | undefined,
    formatter: Intl.NumberFormat,
): string {
    // Handle null/undefined explicitly (not falsy check, to allow "0" and 0)
    if (value === null || value === undefined) return '—';
    // Handle empty string
    if (value === '') return '—';
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return String(value);
    return `$${formatter.format(parsed)}`;
}

/**
 * Format an annual wage value for display.
 * Returns "—" for null/undefined, or the formatted value with $ prefix.
 */
export function formatAnnualPreview(
    value: number | null,
    formatter: Intl.NumberFormat,
): string {
    if (value === null || value === undefined) return '—';
    return `$${formatter.format(value)}`;
}
