export interface WageIntegrityInput {
  l1Annual?: number | null;
  l2Annual?: number | null;
  l3Annual?: number | null;
  l4Annual?: number | null;
  l1Hourly?: number | null;
  l2Hourly?: number | null;
  l3Hourly?: number | null;
  l4Hourly?: number | null;
}

export interface WageIntegrityResult {
  hasIssue: boolean;
  notes: string[];
}

function checkMonotonic(values: Array<number | null | undefined>, label: string): string[] {
  const notes: string[] = [];
  const nums = values.map((value) => (value === null || value === undefined ? null : value));
  for (let i = 0; i < nums.length - 1; i += 1) {
    const current = nums[i];
    const next = nums[i + 1];
    if (current === null || next === null) {
      continue;
    }
    if (current > next) {
      notes.push(`${label} level ${i + 1} exceeds level ${i + 2}.`);
    }
  }
  return notes;
}

export function validateWageIntegrity(input: WageIntegrityInput): WageIntegrityResult {
  const notes = [
    ...checkMonotonic([input.l1Annual, input.l2Annual, input.l3Annual, input.l4Annual], 'Annual'),
    ...checkMonotonic([input.l1Hourly, input.l2Hourly, input.l3Hourly, input.l4Hourly], 'Hourly'),
  ];

  return {
    hasIssue: notes.length > 0,
    notes,
  };
}
