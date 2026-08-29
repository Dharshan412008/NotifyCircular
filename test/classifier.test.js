'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { analyzeText } = require('../src/classifier');

const GROUPS = [
  { id: 1, slug: 'sports', name: 'Sports Group', description: 'Teams and athletics', kind: 'activity' },
  { id: 2, slug: 'whole-college', name: 'Whole College', description: 'Campus-wide notices', kind: 'broadcast' },
  { id: 3, slug: 'robotics', name: 'Robotics Club', description: 'Robots, electronics, and automation', kind: 'custom' },
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
