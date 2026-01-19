import { describe, expect, test } from 'vitest';
import {
    formatMatchPercent,
    formatHourlyPreview,
    formatAnnualPreview,
} from '../../app/helpers/formatters';

describe('formatMatchPercent', () => {
    test('formats 0.5 as 50.00%', () => {
        expect(formatMatchPercent(0.5)).toBe('50.00%');
    });

    test('formats 0 as 0.00%', () => {
        expect(formatMatchPercent(0)).toBe('0.00%');
    });

    test('formats 1 as 100.00%', () => {
        expect(formatMatchPercent(1)).toBe('100.00%');
    });

    test('formats 0.1234 with 2 decimal places', () => {
        expect(formatMatchPercent(0.1234)).toBe('12.34%');
    });

    test('clamps values > 1 to 100.00%', () => {
        expect(formatMatchPercent(1.5)).toBe('100.00%');
        expect(formatMatchPercent(999)).toBe('100.00%');
    });

    test('clamps values < 0 to 0.00%', () => {
        expect(formatMatchPercent(-0.5)).toBe('0.00%');
        expect(formatMatchPercent(-100)).toBe('0.00%');
    });

    test('returns — for null', () => {
        expect(formatMatchPercent(null)).toBe('—');
    });

    test('returns — for undefined', () => {
        expect(formatMatchPercent(undefined)).toBe('—');
    });

    test('returns — for NaN', () => {
        expect(formatMatchPercent(NaN)).toBe('—');
    });

    test('returns — for Infinity', () => {
        expect(formatMatchPercent(Infinity)).toBe('—');
        expect(formatMatchPercent(-Infinity)).toBe('—');
    });
});

describe('formatHourlyPreview', () => {
    const formatter = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    test('returns — for null', () => {
        expect(formatHourlyPreview(null, formatter)).toBe('—');
    });

    test('returns — for empty string', () => {
        expect(formatHourlyPreview('', formatter)).toBe('—');
    });

    test('formats valid number string with $', () => {
        expect(formatHourlyPreview('25.50', formatter)).toBe('$25.50');
    });

    test('formats integer string with 2 decimal places', () => {
        expect(formatHourlyPreview('100', formatter)).toBe('$100.00');
    });

    test('returns original string if not a valid number', () => {
        expect(formatHourlyPreview('N/A', formatter)).toBe('N/A');
        expect(formatHourlyPreview('abc', formatter)).toBe('abc');
    });

    test('handles string with leading/trailing spaces as non-number', () => {
        // Number(' 25 ') is 25, so this should format correctly
        expect(formatHourlyPreview(' 25 ', formatter)).toBe('$25.00');
    });

    test('returns — for undefined', () => {
        expect(formatHourlyPreview(undefined, formatter)).toBe('—');
    });

    test('formats numeric 0 correctly (not as —)', () => {
        expect(formatHourlyPreview(0, formatter)).toBe('$0.00');
    });

    test('formats string "0" correctly (not as —)', () => {
        expect(formatHourlyPreview('0', formatter)).toBe('$0.00');
    });
});

describe('formatAnnualPreview', () => {
    const formatter = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    test('returns — for null', () => {
        expect(formatAnnualPreview(null, formatter)).toBe('—');
    });

    test('formats number with $ and commas', () => {
        expect(formatAnnualPreview(75000, formatter)).toBe('$75,000.00');
    });

    test('formats small numbers correctly', () => {
        expect(formatAnnualPreview(100, formatter)).toBe('$100.00');
    });

    test('formats large numbers with commas', () => {
        expect(formatAnnualPreview(1234567.89, formatter)).toBe('$1,234,567.89');
    });

    test('formats zero correctly', () => {
        expect(formatAnnualPreview(0, formatter)).toBe('$0.00');
    });

    test('formats negative numbers', () => {
        // Intl.NumberFormat places $ before the negative sign
        expect(formatAnnualPreview(-5000, formatter)).toBe('$-5,000.00');
    });
});
