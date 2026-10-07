'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { analyzeText } = require('../src/classifier');

const GROUPS = [
  { id: 1, slug: 'sports', name: 'Sports Group', description: 'Teams and athletics', kind: 'activity' },
  { id: 2, slug: 'whole-college', name: 'Whole College', description: 'Campus-wide notices', kind: 'broadcast' },
  { id: 3, slug: 'robotics', name: 'Robotics Club', description: 'Robots, electronics, and automation', kind: 'custom' },
  { id: 4, slug: 'faculty', name: 'Faculty Group', description: 'Faculty and staff notices', kind: 'role' },
];

describe('local few-shot classifier', () => {
  it('generalizes to dynamic custom-group metadata', () => {
    const result = analyzeText('Bring your autonomous bot for the electronics workshop.', GROUPS);
    assert.equal(result.suggestedGroups[0].slug, 'robotics');
    assert(result.suggestedGroups[0].confidence > 0.4);
  });

  it('uses a stable injected date for relative date detection', () => {
    const result = analyzeText('Team practice is tomorrow.', GROUPS, {
      now: new Date('2026-08-29T12:00:00Z'),
    });
    assert.equal(result.detectedDate, '2026-08-30');
    assert.equal(result.detectedDateText.toLowerCase(), 'tomorrow');
  });

  it('suggests the faculty role group and treats mandatory wording as urgent', () => {
    const result = analyzeText(
      'All lecturers must attend the mandatory departmental academic council.',
      GROUPS,
    );
    assert.equal(result.suggestedGroups[0].slug, 'faculty');
    assert.equal(result.urgency, 'urgent');
  });

  it('keeps generated summaries on one line and within the API limit', () => {
    const result = analyzeText(`Important update: ${'attendance confirmation '.repeat(20)}`, GROUPS);
    assert(result.summary.length <= 160);
    assert(!/[\r\n]/.test(result.summary));
  });

  it('returns safe defaults for empty partial text', () => {
    assert.deepEqual(analyzeText('', GROUPS), {
      suggestedGroups: [],
      detectedDate: null,
      detectedDateText: null,
      urgency: 'normal',
      summary: '',
    });
  });
});
