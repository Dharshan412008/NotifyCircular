'use strict';

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldIcsLine(line) {
  const output = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const character of String(line)) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > limit && current) {
      output.push(current);
      current = ` ${character}`;
      bytes = 1 + size;
      limit = 75;
    } else {
      current += character;
      bytes += size;
    }
  }
  output.push(current);
  return output.join('\r\n');
}

function compactUtcTimestamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function dateAfter(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function compactDate(isoDate) {
  return isoDate.replace(/-/g, '');
}

function circularToIcs(circular) {
  if (!circular.detectedDate) return null;
  const targetNames = circular.targets.map((target) => target.name).join(', ');
  const description = `${circular.text}\n\nAudience: ${targetNames}`;
  const rawLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NotifyCircular//College Circulars//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:circular-${circular.id}@notifycircular.local`,
    `DTSTAMP:${compactUtcTimestamp(circular.createdAt)}`,
    `DTSTART;VALUE=DATE:${compactDate(circular.detectedDate)}`,
    `DTEND;VALUE=DATE:${compactDate(dateAfter(circular.detectedDate))}`,
    `SUMMARY:${escapeIcs(circular.summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `CATEGORIES:${escapeIcs(circular.urgency.toUpperCase())}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${rawLines.map(foldIcsLine).join('\r\n')}\r\n`;
}

function circularToText(circular) {
  const targetNames = circular.targets.map((target) => target.name).join(', ');
  return [
    'NOTIFYCIRCULAR - OFFICIAL COLLEGE NOTICE',
    '',
    `Circular: #${circular.id}`,
    `Sent: ${circular.createdAt}`,
    `From: ${circular.faculty.name} <${circular.faculty.email}>`,
    `Audience: ${targetNames}`,
    `Urgency: ${circular.urgency.toUpperCase()}`,
    `Event date: ${circular.detectedDate || 'Not specified'}`,
    `Acknowledgment required: ${circular.requiresAcknowledgment ? 'Yes' : 'No'}`,
    '',
    circular.summary,
    '',
    circular.text,
    '',
  ].join('\r\n');
}

module.exports = { escapeIcs, foldIcsLine, circularToIcs, circularToText };
