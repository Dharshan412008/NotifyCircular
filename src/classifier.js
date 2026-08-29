"use strict";

/**
 * A deliberately small, deterministic local classifier.  It uses sparse
 * vectors made from words, sub-word n-grams and semantic concept features,
 * then compares them with few-shot examples.  There is no network/model
 * download and, importantly, no `text.includes(keyword) -> group` routing.
 */

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for",
  "from", "has", "have", "in", "into", "is", "it", "its", "of", "on", "or",
  "our", "that", "the", "their", "this", "to", "was", "were", "will", "with",
  "you", "your"
]);

// These families provide a tiny, transparent semantic layer.  Terms never map
// directly to a group: they become vector dimensions shared by circular text,
// dynamic group metadata and the few-shot examples below.
const SEMANTIC_FAMILIES = {
  sports: [
    "sport", "athletic", "match", "fixture", "game", "tournament", "team",
    "player", "coach", "ground", "stadium", "jersey", "practice", "training",
    "football", "cricket", "basketball", "volleyball", "badminton", "hockey",
    "chess", "race", "relay", "final", "semifinal", "opponent", "rival"
  ],
  faculty: [
    "faculty", "teacher", "professor", "lecturer", "staff", "department",
    "instructor", "academic", "dean", "hod", "mentor"
  ],
  broadcast: [
    "whole", "entire", "everyone", "everybody", "campuswide", "collegewide", "institutionwide",
    "community", "college", "campus", "university", "institution"
  ],
  first_year: ["first", "1st", "freshman", "fresher", "fy", "semester1", "semester2"],
  second_year: ["second", "2nd", "sophomore", "sy", "semester3", "semester4"],
  third_year: ["third", "3rd", "junior", "ty", "semester5", "semester6"],
  final_year: ["fourth", "4th", "finalyear", "senior", "graduating", "semester7", "semester8"],
  placement: [
    "placement", "career", "recruiter", "recruitment", "company", "interview",
    "resume", "cv", "internship", "employer", "hiring", "aptitude", "job"
  ],
  examination: [
    "exam", "examination", "test", "assessment", "quiz", "viva", "marks",
    "result", "hallticket", "admitcard", "invigilation"
  ],
  culture: [
    "cultural", "culture", "music", "dance", "drama", "theatre", "art",
    "festival", "fest", "performance", "audition", "rehearsal", "singing"
  ],
  technology: [
    "technology", "technical", "coding", "programming", "developer", "robotics",
    "robot", "hackathon", "computer", "software", "electronics", "workshop"
  ],
  library: ["library", "book", "journal", "reading", "librarian", "borrow", "return"],
  finance: ["fee", "fees", "payment", "dues", "scholarship", "accounts", "tuition", "receipt"],
  urgency: [
    "urgent", "immediately", "immediate", "mandatory", "compulsory", "critical",
    "emergency", "deadline", "overdue", "must", "required", "asap", "action"
  ],
  fyi: ["fyi", "information", "informational", "optional", "notice", "update", "awareness"]
};

function stemWord(word) {
  let value = word.toLowerCase().replace(/^'+|'+$/g, "").replace(/'s$/u, "");
  if (value.length > 6 && value.endsWith("ingly")) value = value.slice(0, -5);
  else if (value.length > 5 && value.endsWith("ing")) value = value.slice(0, -3);
  else if (value.length > 4 && value.endsWith("ied")) value = `${value.slice(0, -3)}y`;
  else if (value.length > 4 && value.endsWith("ed")) value = value.slice(0, -2);
  else if (value.length > 4 && value.endsWith("ies")) value = `${value.slice(0, -3)}y`;
  else if (value.length > 4 && value.endsWith("es")) value = value.slice(0, -2);
  else if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) value = value.slice(0, -1);
  return value;
}

const CONCEPT_BY_TERM = new Map();
for (const [concept, terms] of Object.entries(SEMANTIC_FAMILIES)) {
  for (const term of terms) {
    const normalized = stemWord(term.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""));
    const existing = CONCEPT_BY_TERM.get(normalized) || [];
    existing.push(concept);
    CONCEPT_BY_TERM.set(normalized, existing);
  }
}

function tokenize(value) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([a-z])[-\s]+(year|wide)\b/g, "$1$2");

  return (normalized.match(/[a-z0-9]+(?:'[a-z]+)?/g) || [])
    .map(stemWord)
    .filter((token) => token && !STOP_WORDS.has(token));
}

function addFeature(vector, key, amount) {
  vector.set(key, (vector.get(key) || 0) + amount);
}

function vectorize(value) {
  const tokens = tokenize(value);
  const raw = new Map();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    addFeature(raw, `w:${token}`, 1);

    // Sub-word features make variants such as "athlete"/"athletics" and
    // unseen custom-group vocabulary less brittle than exact word matching.
    const padded = `^${token}$`;
    if (token.length >= 4) {
      for (let offset = 0; offset <= padded.length - 3; offset += 1) {
        addFeature(raw, `g:${padded.slice(offset, offset + 3)}`, 0.13);
      }
    }

    if (index > 0) addFeature(raw, `b:${tokens[index - 1]}_${token}`, 0.4);
    for (const concept of CONCEPT_BY_TERM.get(token) || []) {
      addFeature(raw, `c:${concept}`, 1.7);
    }
  }

  // Log-scaled term frequency keeps repeated boilerplate from dominating while
  // preserving the deliberately smaller weights of sub-word features.
  const vector = new Map();
  let lengthSquared = 0;
  for (const [key, amount] of raw) {
    const weight = Math.log1p(amount);
    vector.set(key, weight);
    lengthSquared += weight * weight;
  }
  return { values: vector, magnitude: Math.sqrt(lengthSquared), tokens };
}

const AUDIENCE_NOISE = new Set([
  "action", "attend", "college", "complete", "critical", "deadline", "emergency", "fyi",
  "immediate", "immediately", "information", "mandatory", "must", "normal",
  "notice", "optional", "please", "required", "submit", "student", "today",
  "tomorrow", "urgent", "update"
].map(stemWord));

function audienceVectorize(value) {
  const audienceTokens = tokenize(value).filter((token) => (
    !AUDIENCE_NOISE.has(token) && !/^\d+$/.test(token)
  ));
  return vectorize(audienceTokens.join(" "));
}

function cosine(left, right) {
  if (!left.magnitude || !right.magnitude) return 0;
  const [small, large] = left.values.size < right.values.size
    ? [left.values, right.values]
    : [right.values, left.values];
  let dot = 0;
  for (const [key, weight] of small) dot += weight * (large.get(key) || 0);
  return dot / (left.magnitude * right.magnitude);
}

const GROUP_SHOTS = {
  sports: [
    "Sports athletics and college teams",
    "Players selected for the match against St Xavier's should report at the ground",
    "The team fixture has moved and the coach will hold practice before the game",
    "Intercollege tournament participants must collect their jerseys"
  ],
  faculty: [
    "Faculty and teaching staff",
    "All lecturers should attend the departmental academic meeting",
    "Professors and mentors are invited to the staff development session"
  ],
  broadcast: [
    "Whole college campus wide announcements for everyone",
    "The entire college will remain closed for the public holiday",
    "Everyone in our campus community is invited to the annual celebration"
  ],
  first_year: [
    "First year FY freshers semester one and two",
    "Orientation for newly admitted students begins next week"
  ],
  second_year: [
    "Second year SY students semester three and four",
    "Sophomore class registration meeting"
  ],
  third_year: [
    "Third year TY students semester five and six",
    "Junior class project review"
  ],
  final_year: [
    "Final year fourth year graduating seniors semester seven and eight",
    "Graduating students must submit clearance forms"
  ],
  placement: [
    "Placement career and internship group",
    "A recruiter is conducting interviews and an aptitude round",
    "Bring your resume for the campus hiring drive"
  ],
  examination: [
    "Examination and assessment notices",
    "The semester test timetable and hall tickets are available",
    "Viva results and marks will be published"
  ],
  culture: [
    "Cultural arts music dance and drama club",
    "Auditions and rehearsal for the college festival performance"
  ],
  technology: [
    "Technical coding robotics and innovation club",
    "Developers should register their teams for the hackathon workshop"
  ],
  library: [
    "Library readers and book notices",
    "Borrowed books must be returned to the librarian"
  ],
  finance: [
    "Fees accounts scholarship and payment notices",
    "Students with outstanding tuition dues should collect a receipt"
  ]
};

const GROUP_SHOT_VECTORS = Object.fromEntries(
  Object.entries(GROUP_SHOTS).map(([label, examples]) => [label, examples.map(vectorize)])
);

// Compact label anchors identify what a dynamic group's metadata means before
// its few-shot message examples are used. Keeping year ordinals distinct avoids
// generic words such as "students" making every year group look alike.
const GROUP_LABELS = {
  sports: "sports athletics team players games",
  faculty: "faculty teachers professors lecturers staff",
  broadcast: "broadcast wholecollege collegewide campuswide everyone",
  first_year: "firstyear 1st fy freshman fresher",
  second_year: "secondyear 2nd sy sophomore",
  third_year: "thirdyear 3rd ty junior",
  final_year: "finalyear fourthyear 4th senior graduating",
  placement: "placement careers recruitment hiring internship",
  examination: "exams examination assessment tests",
  culture: "cultural arts music dance drama",
  technology: "technical technology coding robotics",
  library: "library books reading",
  finance: "fees finance accounts payment scholarship"
};

const GROUP_LABEL_VECTORS = Object.fromEntries(
  Object.entries(GROUP_LABELS).map(([label, value]) => [label, vectorize(value)])
);

const URGENCY_SHOTS = {
  urgent: [
    "Urgent: immediate action is required",
    "This is mandatory and must be completed before the deadline",
    "Emergency change: report immediately",
    "Final reminder, overdue forms must be submitted today"
  ],
  fyi: [
    "FYI only, no action is needed",
    "For your information, sharing an optional update",
    "A general notice for awareness"
  ],
  normal: [
    "The regular meeting is scheduled for next week",
    "Registration is open for the upcoming workshop",
    "Please attend the event at the announced time"
  ]
};

const URGENCY_VECTORS = Object.fromEntries(
  Object.entries(URGENCY_SHOTS).map(([label, examples]) => [label, examples.map(vectorize)])
);

function maxSimilarity(vector, candidates) {
  let maximum = 0;
  for (const candidate of candidates) maximum = Math.max(maximum, cosine(vector, candidate));
  return maximum;
}

function groupName(group) {
  return String(group && (group.name || group.label || group.title) || "").trim();
}

function groupDescription(group) {
  return String(group && (group.description || group.details || group.summary) || "").trim();
}

function groupMetadata(group) {
  return [groupName(group), groupDescription(group), group && group.kind]
    .filter(Boolean)
    .join(". ");
}

function categoryForGroup(groupVector) {
  let bestCategory = null;
  let bestScore = 0;
  for (const [category, labelVector] of Object.entries(GROUP_LABEL_VECTORS)) {
    const labelScore = cosine(groupVector, labelVector);
    const exampleScore = maxSimilarity(groupVector, GROUP_SHOT_VECTORS[category]);
    const score = Math.max(labelScore, exampleScore * 0.72);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  return bestScore >= 0.14 ? { category: bestCategory, score: bestScore } : null;
}

function calibrateConfidence(similarity, metadataStrength, tokenCount) {
  // Short partial compose text deserves a modest confidence ceiling.
  const evidence = Math.max(0, similarity - 0.055) / 0.48;
  const lengthFactor = tokenCount < 2 ? 0.72 : tokenCount < 4 ? 0.88 : 1;
  const metadataFactor = 0.88 + Math.min(0.12, metadataStrength * 0.15);
  return Math.max(0, Math.min(1, evidence * lengthFactor * metadataFactor));
}

function suggestGroups(textVector, groups, options) {
  if (!textVector.tokens.length || !Array.isArray(groups)) return [];
  const minConfidence = Number.isFinite(options.minConfidence)
    ? Math.max(0, Math.min(1, options.minConfidence))
    : 0.38;
  const maxGroups = Number.isInteger(options.maxGroups)
    ? Math.max(0, options.maxGroups)
    : 4;

  const scored = groups.map((group, originalIndex) => {
    const metadata = groupMetadata(group);
    const metadataVector = vectorize(metadata);
    const inferred = categoryForGroup(metadataVector);
    const directSimilarity = cosine(textVector, metadataVector);
    const exampleSimilarity = inferred
      ? maxSimilarity(textVector, GROUP_SHOT_VECTORS[inferred.category])
      : 0;

    // A category match only contributes in proportion to how clearly the
    // group's own name/description belongs to that category. This lets newly
    // created groups work without a hard-coded group-name table.
    const categorySimilarity = inferred
      ? exampleSimilarity * Math.min(1, 0.5 + inferred.score)
      : 0;
    const similarity = Math.max(directSimilarity, categorySimilarity);
    const confidence = calibrateConfidence(
      similarity,
      inferred ? inferred.score : directSimilarity,
      textVector.tokens.length
    );

    return { group, name: groupName(group), confidence, originalIndex };
  });

  return scored
    .filter((item) => item.name && item.confidence >= minConfidence)
    .sort((left, right) => right.confidence - left.confidence || left.originalIndex - right.originalIndex)
    .slice(0, maxGroups)
    .map(({ group, name, confidence }) => {
      const suggestion = {
        id: group.id == null ? null : group.id,
        slug: group.slug || undefined,
        name,
        confidence: Number(confidence.toFixed(2))
      };
      if (suggestion.id == null) delete suggestion.id;
      if (!suggestion.slug) delete suggestion.slug;
      return suggestion;
    });
}

function resolveNow(value) {
  const candidate = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  return Number.isNaN(candidate.getTime()) ? new Date() : candidate;
}

function normalizedYear(value, fallback) {
  if (value == null || value === "") return fallback;
  const year = Number(value);
  if (String(value).length <= 2) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function validDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3], ["apr", 4], ["april", 4],
  ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10], ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12]
]);

const MONTH_PATTERN = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

function monthNumber(value) {
  return MONTHS.get(String(value).toLowerCase()) || null;
}

function extractDate(text, options) {
  const source = String(text || "");
  const now = resolveNow(options.now);
  const currentYear = now.getFullYear();
  const candidates = [];

  function collect(regex, parser, priority) {
    for (const match of source.matchAll(regex)) {
      const date = parser(match);
      if (date) candidates.push({ index: match.index, raw: match[0], date, priority });
    }
  }

  collect(/\b(20\d{2}|19\d{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b/g, (match) => (
    validDate(Number(match[1]), Number(match[2]), Number(match[3]))
  ), 0);

  collect(/(?<!\d)(0?[1-9]|[12]\d|3[01])[\/.\-](0?[1-9]|1[0-2])(?:[\/.\-](\d{2}|\d{4}))?(?!\d)/g, (match) => (
    validDate(normalizedYear(match[3], currentYear), Number(match[2]), Number(match[1]))
  ), 1);

  collect(new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:[\\s,]+(\\d{2}|\\d{4}))?\\b`, "gi"), (match) => (
    validDate(normalizedYear(match[3], currentYear), monthNumber(match[2]), Number(match[1]))
  ), 1);

  collect(new RegExp(`\\b(${MONTH_PATTERN})\\s+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:,?\\s+(\\d{2}|\\d{4}))?\\b`, "gi"), (match) => (
    validDate(normalizedYear(match[3], currentYear), monthNumber(match[1]), Number(match[2]))
  ), 1);

  collect(/\b(today|tomorrow)\b/gi, (match) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (match[1].toLowerCase() === "tomorrow") date.setDate(date.getDate() + 1);
    return validDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }, 2);

  candidates.sort((left, right) => left.index - right.index || left.priority - right.priority);
  const first = candidates[0];
  return first
    ? { detectedDate: first.date, detectedDateText: first.raw }
    : { detectedDate: null, detectedDateText: null };
}

function classifyUrgency(textVector) {
  if (!textVector.tokens.length) return "normal";
  const hasUrgentSignal = textVector.values.has("c:urgency");
  const hasFyiSignal = textVector.values.has("c:fyi");
  if (!hasUrgentSignal && !hasFyiSignal) return "normal";
  const scores = {};
  for (const [label, examples] of Object.entries(URGENCY_VECTORS)) {
    scores[label] = maxSimilarity(textVector, examples);
  }

  // Normal is the conservative default; FYI/urgent must beat it with actual
  // few-shot similarity rather than being inferred from an absent signal.
  scores.normal += 0.035;
  if (!hasUrgentSignal) scores.urgent = 0;
  if (!hasFyiSignal) scores.fyi = 0;
  return Object.entries(scores).sort((left, right) => right[1] - left[1])[0][0];
}

function extractSummary(text, maximumLength) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  const limit = Number.isInteger(maximumLength) && maximumLength >= 40 ? maximumLength : 160;
  const abbreviations = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "dept", "no"]);
  let sentenceEnd = oneLine.length;
  for (let index = 0; index < oneLine.length; index += 1) {
    const character = oneLine[index];
    if ((character !== "." && character !== "!" && character !== "?") || (oneLine[index + 1] && oneLine[index + 1] !== " ")) continue;
    const preceding = oneLine.slice(0, index).match(/([A-Za-z]+)$/);
    if (character === "." && preceding && abbreviations.has(preceding[1].toLowerCase())) continue;
    sentenceEnd = index + 1;
    break;
  }
  const sentence = oneLine.slice(0, sentenceEnd).trim();
  if (sentence.length <= limit) return sentence;

  const clipped = sentence.slice(0, limit - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace >= Math.floor(limit * 0.6) ? lastSpace : clipped.length).trimEnd()}…`;
}

/**
 * @param {string} text Circular text (partial or complete).
 * @param {Array<object>} groups Dynamic groups with at least a name/label/title.
 * @param {object} [options]
 * @param {Date|string|number} [options.now] Reference time for today/tomorrow.
 * @param {number} [options.maxGroups=4] Maximum number of suggestions.
 * @param {number} [options.minConfidence=0.38] Confidence threshold, 0..1.
 * @param {number} [options.summaryMaxLength=160] Summary character limit (min 40).
 */
function analyzeText(text, groups, options = {}) {
  const safeText = typeof text === "string" ? text : String(text || "");
  const safeOptions = options && typeof options === "object" ? options : {};
  const textVector = vectorize(safeText);
  const audienceVector = audienceVectorize(safeText);
  const date = extractDate(safeText, safeOptions);

  return {
    suggestedGroups: suggestGroups(audienceVector, groups, safeOptions),
    detectedDate: date.detectedDate,
    detectedDateText: date.detectedDateText,
    urgency: classifyUrgency(textVector),
    summary: extractSummary(safeText, safeOptions.summaryMaxLength)
  };
}

module.exports = { analyzeText };
