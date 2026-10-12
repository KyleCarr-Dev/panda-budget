import { describe, it, expect } from 'vitest';
import { startOfWeek } from './BudgetApp';
// Add more imports from './BudgetApp' as you need them, e.g.
// import { budgetFor, sumRange, computeWeek, computeVault, freshData, isAppData } from './BudgetApp';
// import type { Expense } from './BudgetApp';

// Run with:  npm test          (once)
//            npm run test:watch (re-runs every time you save)
//
// Each `it.todo(...)` below is a test waiting to be written.
// Replace `it.todo('...')` with `it('...', () => { ... })` and fill it in.
// The first test is a worked example to copy the pattern from.

describe('startOfWeek', () => {
  // Worked example: Wednesday 8 Oct 2025 should give Monday 6 Oct 2025.
  it('returns the Monday of the same week for a mid-week date', () => {
    const wednesday = new Date(2025, 9, 8, 15, 30); // months are 0-based, so 9 = October
    const result = startOfWeek(wednesday);
    expect(result.getDay()).toBe(1);   // 1 = Monday
    expect(result.getDate()).toBe(6);
    expect(result.getHours()).toBe(0); // starts at midnight
  });

  it.todo('returns the same day when the date is already a Monday');
  it.todo('returns the previous Monday when the date is a Sunday');
});

describe('budgetFor', () => {
  it.todo('returns the only budget when there is one entry');
  it.todo('keeps the old budget for a week before the budget was changed');
  it.todo('uses the new budget for weeks on or after the change');
});

describe('sumRange', () => {
  it.todo('adds up expenses inside the date range');
  it.todo('ignores expenses outside the range');
  it.todo('ignores expenses paid from the stash (fromStash: true)');
});

describe('computeWeek', () => {
  it.todo('shows the full budget left when nothing has been spent');
  it.todo('subtracts this week\'s spending from the budget');
});

describe('computeVault (the Bamboo Stash)', () => {
  it.todo('adds last week\'s unspent budget to the stash');
  it.todo('does not earn anything during the mid-week warm-up week');
  it.todo('takes stash spending away from the stash balance');
});

describe('isAppData', () => {
  it.todo('accepts data created by freshData()');
  it.todo('rejects null, a string, or an object missing fields');
});

