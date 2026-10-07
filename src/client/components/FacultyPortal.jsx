import { lazy, Suspense } from 'react';
import { RouteLoading } from './RouteBoundary';
import CreateGroupDialog from './CreateGroupDialog.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardList,
  Download,
  FilePenLine,
  Inbox,
  House,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';

import { apiRequest, getErrorMessage } from '../api.js';
import Modal from './Modal.jsx';
import CampusFeed from './CampusFeed.jsx';
import PortalThemeButton from './PortalThemeButton.jsx';
const Overview = lazy(() => import('./Overview.jsx'));
const Analytics = lazy(() => import('./Analytics.tsx'));
const CircularWorkbench = lazy(() => import('./CircularWorkbench.jsx'));
import PortalNavigation from './PortalNavigation.jsx';
import { PortalTools, AccountSettings, CircularExtras, CampusCalendar } from './PlatformTools.jsx';

const MANAGEABLE_KINDS = new Set(['activity', 'custom']);
const facultyInboxKey = (userId) => ['faculty-inbox', Number(userId)];
const URGENCIES = ['fyi', 'normal', 'urgent'];
const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const MONTH_PATTERN = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'CR';
}

function greetingName(name = '') {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts[0]?.endsWith('.') && parts[1]) return `${parts[0]} ${parts[1]}`;
  return parts[0] || 'Faculty';
}

function formatDate(value) {
  if (!value) return 'Just now';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatEventDate(value) {
  if (!value) return 'None detected';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date);
}

function urgencyValue(value) {
  return URGENCIES.includes(value) ? value : 'normal';
}

function urgencyLabel(value) {
  const normalized = urgencyValue(value);
  return normalized === 'fyi' ? 'FYI' : `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
}

function yearLabel(year) {
  const labels = { 1: 'First year', 2: 'Second year', 3: 'Third year', 4: 'Final year' };
  return labels[Number(year)] || 'Year not assigned';
}

function validIsoDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return '';
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeYear(value, fallback) {
  if (!value) return fallback;
  const year = Number(value);
  return String(value).length === 2 ? (year >= 70 ? 1900 + year : 2000 + year) : year;
}

function detectClientDate(value) {
  const text = String(value || '');
  const now = new Date();
  let match = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (match) return validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/\b(0?[1-9]|[12]\d|3[01])[/.\-](0?[1-9]|1[0-2])(?:[/.\-](\d{2}|\d{4}))?\b/);
  if (match) {
    return validIsoDate(normalizeYear(match[3], now.getFullYear()), Number(match[2]), Number(match[1]));
  }

  match = text.match(new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:[\\s,]+(\\d{2}|\\d{4}))?\\b`, 'i'));
  if (match) {
    return validIsoDate(
      normalizeYear(match[3], now.getFullYear()),
      MONTHS[match[2].toLowerCase()],
      Number(match[1]),
    );
  }

  match = text.match(new RegExp(`\\b(${MONTH_PATTERN})\\s+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:,?\\s+(\\d{2}|\\d{4}))?\\b`, 'i'));
  if (match) {
    return validIsoDate(
      normalizeYear(match[3], now.getFullYear()),
      MONTHS[match[1].toLowerCase()],
      Number(match[2]),
    );
  }

  match = text.match(/\b(today|tomorrow)\b/i);
  if (!match) return '';
  const relative = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (match[1].toLowerCase() === 'tomorrow') relative.setDate(relative.getDate() + 1);
  return validIsoDate(relative.getFullYear(), relative.getMonth() + 1, relative.getDate());
}

function fallbackSummary(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 240) return text;
  const clipped = text.slice(0, 237);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace >= 150 ? lastSpace : clipped.length).trim()}...`;
}

function circularStats(circular) {
  const stats = circular?.stats || {};
  const audience = Number(stats.audience) || 0;
  const read = Number(stats.read) || 0;
  const acknowledged = Number(stats.acknowledged) || 0;
  return {
    audience,
    read,
    acknowledged,
    pendingAcknowledgment: Number.isFinite(Number(stats.pendingAcknowledgment))
      ? Number(stats.pendingAcknowledgment)
      : Math.max(0, audience - acknowledged),
  };
}

function EmptyState({ icon: Icon = Inbox, title, copy }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon /></span>
      <h4>{title}</h4>
      <p>{copy}</p>
    </div>
  );
}

function LoadingCards({ count = 2 }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="skeleton-card" key={index} />)}</>;
}

function currentAcademicYear() {
  const now = new Date();
  const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function AudiencePicker({ open, groups, selectedIds, onChange, onClose }) {
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [department, setDepartment] = useState('');
  const [program, setProgram] = useState('');
  const [section, setSection] = useState('');
  const [academicYear, setAcademicYear] = useState(currentAcademicYear);
  const previewQuery = useQuery({
    queryKey: ['audience-preview', [...selectedIds].sort(), year, department, program, section, academicYear],
    queryFn: () => apiRequest('/api/audience-preview', {
      method: 'POST',
      body: {
        groupIds: [...selectedIds],
        year: year ? Number(year) : undefined,
        department,
        program,
        section,
        academicYear,
      },
    }),
    enabled: open && selectedIds.size > 0,
  });
  const visible = groups.filter((group) => {
    const haystack = `${group.name} ${group.description} ${group.kind}`.toLowerCase();
    const matchesSearch = haystack.includes(search.trim().toLowerCase());
    const matchesYear = !year || !group.year || Number(group.year) === Number(year);
    const matchesDepartment = !department || !group.department || group.department.toLowerCase() === department.toLowerCase();
    return matchesSearch && matchesYear && matchesDepartment;
  });

  function toggle(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <Modal open={open} onClose={onClose} eyebrow="Audience picker" title="Choose student groups">
      <label className="search-field">
        <span className="sr-only">Search groups</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search groups" />
      </label>
      <div className="audience-filters" aria-label="Audience filters">
        <label className="field"><span>Year</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="">All years</option><option value="1">1st year</option><option value="2">2nd year</option><option value="3">3rd year</option><option value="4">Final year</option></select></label>
        <label className="field"><span>Department</span><input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="Mechanical / EEE / IT" /></label>
        <label className="field"><span>Class / program</span><input value={program} onChange={(event) => setProgram(event.target.value)} placeholder="B.Tech / BCA" /></label>
        <label className="field"><span>Section</span><input value={section} onChange={(event) => setSection(event.target.value)} placeholder="A / B" /></label>
        <label className="field"><span>Academic year</span><input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="2026-27" /></label>
      </div>
      <p className="audience-preview" role="status">
        {selectedIds.size === 0 ? 'Select groups to preview recipients.' : previewQuery.isPending ? 'Updating recipients...' : `${previewQuery.data?.count ?? 0} matching students`}
      </p>
      <div className="option-list">
        {visible.map((group) => (
            <label className="option-row" key={group.id}>
              <input
                type="checkbox"
                checked={selectedIds.has(group.id)}
                onChange={() => toggle(group.id)}
              />
              <span className="group-mark">{group.icon}</span>
              <span className="option-copy">
                <strong>{group.name}</strong>
                <small>{group.kind === 'role' ? `${group.memberCount ?? 0} faculty recipients` : `${group.memberCount ?? 0} students`}</small>
              </span>
              <span className="option-check"><Check /></span>
            </label>
          ))}
      </div>
      <button className="primary-button" type="button" onClick={onClose}>
        Use {selectedIds.size || 'no'} group{selectedIds.size === 1 ? '' : 's'}
      </button>
    </Modal>
  );
}

function CircularComposer({ groupsQuery }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [targetIds, setTargetIds] = useState(() => new Set());
  const [suggestedGroups, setSuggestedGroups] = useState([]);
  const [detectedDate, setDetectedDate] = useState('');
  const [urgency, setUrgency] = useState('normal');
  const [summary, setSummary] = useState('');
  const [requiresAcknowledgment, setRequiresAcknowledgment] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('idle');
  const [analysisCopy, setAnalysisCopy] = useState('Start typing to analyze your notice');
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPayload, setReviewPayload] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const editFlagsRef = useRef({ date: false, urgency: false, summary: false, acknowledgment: false });
  const urgencyRef = useRef('normal');
  const suggestedGroupsRef = useRef([]);
  const manualTargetIdsRef = useRef(new Set());
  const dismissedSuggestionIdsRef = useRef(new Set());
  const analysisSequenceRef = useRef(0);

  const groups = useMemo(() => groupsQuery.data?.groups || [], [groupsQuery.data?.groups]);
  const selectedGroups = groups.filter((group) => targetIds.has(group.id));
  const audienceTotal = selectedGroups.reduce((sum, group) => sum + (group.memberCount || 0), 0);
  const availableSuggestions = suggestedGroups.filter((suggestion) => !targetIds.has(suggestion.id));
  const reviewGroups = reviewPayload
    ? groups.filter((group) => reviewPayload.targetGroupIds.includes(group.id))
    : [];
  const reviewAudienceTotal = reviewGroups.reduce((sum, group) => sum + (group.memberCount || 0), 0);

  const typeaheadMutation = useMutation({
    mutationFn: ({ noticeText, signal }) => apiRequest('/api/copilot/typeahead', {
      method: 'POST',
      body: { text: noticeText },
      signal,
    }),
  });

  useEffect(() => {
    const noticeText = text.trim();
    const sequence = ++analysisSequenceRef.current;
    if (noticeText.length < 3) {
      const previousSuggestions = suggestedGroupsRef.current;
      suggestedGroupsRef.current = [];
      setSuggestedGroups([]);
      setAnalysisStatus('idle');
      setAnalysisCopy(noticeText ? 'Keep typing for suggestions' : 'Start typing to analyze your notice');
      setTargetIds((current) => {
        const next = new Set(current);
        previousSuggestions.forEach((suggestion) => {
          if (!manualTargetIdsRef.current.has(suggestion.id)) next.delete(suggestion.id);
        });
        return next;
      });
      return undefined;
    }

    setAnalysisStatus('waiting');
    setAnalysisCopy('Waiting for a natural pause...');
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAnalysisStatus('analyzing');
      setAnalysisCopy('Analyzing audience, priority and summary...');
      try {
        const payload = await typeaheadMutation.mutateAsync({ noticeText, signal: controller.signal });
        if (controller.signal.aborted || sequence !== analysisSequenceRef.current) return;

        const eligibleGroups = new Map(
          groups.filter((group) => group.kind !== 'role').map((group) => [Number(group.id), group]),
        );
        const nextSuggestions = (Array.isArray(payload?.suggestedGroups) ? payload.suggestedGroups : [])
          .map((suggestion) => {
            const id = Number(suggestion?.id);
            const group = eligibleGroups.get(id);
            const confidence = Number(suggestion?.confidence);
            if (!group || !Number.isFinite(confidence)) return null;
            return {
              id,
              name: group.name,
              confidence: Math.max(0, Math.min(1, confidence)),
            };
          })
          .filter(Boolean);
        const previousSuggestions = suggestedGroupsRef.current;
        suggestedGroupsRef.current = nextSuggestions;
        setSuggestedGroups(nextSuggestions);
        setTargetIds((current) => {
          const next = new Set(current);
          previousSuggestions.forEach((suggestion) => {
            if (!manualTargetIdsRef.current.has(suggestion.id)) next.delete(suggestion.id);
          });
          nextSuggestions.forEach((suggestion) => {
            if (!dismissedSuggestionIdsRef.current.has(suggestion.id)) next.add(suggestion.id);
          });
          return next;
        });

        if (!editFlagsRef.current.date) {
          setDetectedDate(payload?.detectedDate || detectClientDate(noticeText));
        }
        if (!editFlagsRef.current.urgency) {
          const nextUrgency = urgencyValue(payload?.urgency);
          urgencyRef.current = nextUrgency;
          setUrgency(nextUrgency);
          if (!editFlagsRef.current.acknowledgment) {
            setRequiresAcknowledgment(nextUrgency === 'urgent');
          }
        }
        if (!editFlagsRef.current.summary && typeof payload?.summary === 'string') {
          setSummary(payload.summary.slice(0, 240));
        }

        const dateCopy = payload?.detectedDateText ? ` - ${payload.detectedDateText}` : '';
        setAnalysisStatus('ready');
        setAnalysisCopy(`${nextSuggestions.length || 'No'} audience suggestion${nextSuggestions.length === 1 ? '' : 's'}${dateCopy}`);
      } catch (error) {
        if (controller.signal.aborted || sequence !== analysisSequenceRef.current) return;
        setAnalysisStatus('error');
        setAnalysisCopy('Suggestions unavailable - choose groups manually');
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [groups, text]);

  const sendMutation = useMutation({
    mutationFn: (payload) => apiRequest('/api/circulars', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: async (payload) => {
      setReceipt(payload.delivery || { audienceCount: payload.circular?.stats?.audience || 0 });
      editFlagsRef.current = { date: false, urgency: false, summary: false, acknowledgment: false };
      urgencyRef.current = 'normal';
      suggestedGroupsRef.current = [];
      manualTargetIdsRef.current = new Set();
      dismissedSuggestionIdsRef.current = new Set();
      setText('');
      setTargetIds(new Set());
      setSuggestedGroups([]);
      setDetectedDate('');
      setUrgency('normal');
      setSummary('');
      setRequiresAcknowledgment(false);
      setReviewPayload(null);
      setReviewOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['faculty-circulars'] });
    },
  });

  function removeTarget(id) {
    manualTargetIdsRef.current.delete(id);
    if (suggestedGroupsRef.current.some((suggestion) => suggestion.id === id)) {
      dismissedSuggestionIdsRef.current.add(id);
    }
    setTargetIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function review(event) {
    event.preventDefault();
    setReceipt(null);
    if (sendMutation.isPending || text.trim().length < 5 || targetIds.size === 0) return;
    const normalizedSummary = summary.trim() || fallbackSummary(text);
    if (normalizedSummary.length < 3) return;
    const payload = {
      text: text.trim(),
      targetGroupIds: [...targetIds],
      detectedDate: detectedDate || null,
      urgency: urgencyValue(urgency),
      summary: normalizedSummary,
      requiresAcknowledgment,
    };
    if (!summary.trim()) setSummary(normalizedSummary);
    setReviewPayload(payload);
    setReviewOpen(true);
  }

  function closeReview() {
    if (!sendMutation.isPending) {
      setReviewOpen(false);
      setReviewPayload(null);
    }
  }

  function updateAudience(nextIds) {
    const next = new Set([...nextIds].map(Number));
    manualTargetIdsRef.current = new Set(next);
    suggestedGroupsRef.current.forEach((suggestion) => {
      if (next.has(suggestion.id)) dismissedSuggestionIdsRef.current.delete(suggestion.id);
      else dismissedSuggestionIdsRef.current.add(suggestion.id);
    });
    setTargetIds(next);
  }

  function addSuggestion(suggestion) {
    manualTargetIdsRef.current.add(suggestion.id);
    dismissedSuggestionIdsRef.current.delete(suggestion.id);
    setTargetIds((current) => new Set(current).add(suggestion.id));
  }

  function chooseUrgency(nextUrgency) {
    const normalized = urgencyValue(nextUrgency);
    editFlagsRef.current.urgency = true;
    const previous = urgencyRef.current;
    urgencyRef.current = normalized;
    setUrgency(normalized);
    if (!editFlagsRef.current.acknowledgment) {
      if (normalized === 'urgent') setRequiresAcknowledgment(true);
      else if (previous === 'urgent') setRequiresAcknowledgment(false);
    }
  }

  return (
    <section className="tab-view" aria-labelledby="compose-heading">
      <div className="status-strip">
        <span><span className="live-dot" /><strong>Membership routing online</strong></span>
        <small>Server-enforced audiences</small>
      </div>
      <div className="section-heading">
        <div><p className="overline">New circular</p><h3 id="compose-heading">Compose an official notice</h3></div>
        <span className="draft-status">Draft</span>
      </div>

      {receipt && (
        <div className="inline-success" role="status">
          <Check />
          <span><strong>Circular sent</strong><small>Routed to {receipt.audienceCount} student{receipt.audienceCount === 1 ? '' : 's'}.</small></span>
        </div>
      )}

      <form onSubmit={review} aria-busy={sendMutation.isPending}>
        <label className="composer">
          <span className="sr-only">Circular message</span>
          <textarea
            maxLength="5000"
            required
            value={text}
            onChange={(event) => {
              const nextText = event.target.value;
              setText(nextText);
              if (!editFlagsRef.current.date) setDetectedDate(detectClientDate(nextText));
            }}
            placeholder="Write the circular students should receive..."
            disabled={sendMutation.isPending}
          />
          <span className="composer-meta"><span><ClipboardList /> Official notice</span><span>{text.length} / 5000</span></span>
        </label>

        <div className={`smart-panel audience-panel${analysisStatus === 'analyzing' ? ' is-analyzing' : ''}`}>
          <div className="smart-header">
            <span className="smart-title"><span className="ai-icon"><Sparkles /></span><span><strong>Smart suggestions</strong><small aria-live="polite">{analysisCopy}</small></span></span>
            <span className="model-badge">{analysisStatus === 'analyzing' ? 'Thinking' : analysisStatus === 'error' ? 'Manual' : 'Local AI'}</span>
          </div>
          <div className="suggestion-block">
            <div className="label-row">
              <span>Audience</span>
              <button className="inline-button" type="button" disabled={sendMutation.isPending} onClick={() => setAudienceOpen(true)}><Plus /> Add group</button>
            </div>
            <div className="chip-row">
              {selectedGroups.length === 0 && <span className="empty-chip-copy">Select at least one student group</span>}
              {selectedGroups.map((group) => {
                const suggestion = suggestedGroups.find((item) => item.id === group.id);
                return (
                  <span className="audience-chip" key={group.id}>
                    <span>{group.name}{suggestion ? ` ${Math.round(suggestion.confidence * 100)}%` : ''}</span>
                    <button type="button" disabled={sendMutation.isPending} aria-label={`Remove ${group.name}`} onClick={() => removeTarget(group.id)}><X /></button>
                  </span>
                );
              })}
            </div>
            {availableSuggestions.length > 0 && (
              <div className="suggested-row" aria-label="Suggested audiences">
                {availableSuggestions.map((suggestion) => (
                  <button
                    className="suggestion-chip"
                    type="button"
                    key={suggestion.id}
                    disabled={sendMutation.isPending}
                    aria-label={`Add suggested group ${suggestion.name}`}
                    onClick={() => addSuggestion(suggestion)}
                  >
                    + {suggestion.name} <b>{Math.round(suggestion.confidence * 100)}%</b>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="analysis-grid">
            <label className="mini-field">
              <span><CalendarDays /> Event date</span>
              <input
                type="date"
                value={detectedDate}
                disabled={sendMutation.isPending}
                onChange={(event) => {
                  editFlagsRef.current.date = true;
                  setDetectedDate(event.target.value);
                }}
              />
            </label>
            <div className="mini-field">
              <span>Priority</span>
              <div className="segmented" aria-label="Circular priority">
                {URGENCIES.map((value) => (
                  <button
                    type="button"
                    data-urgency={value}
                    className={urgency === value ? 'active' : ''}
                    aria-pressed={urgency === value}
                    disabled={sendMutation.isPending}
                    key={value}
                    onClick={() => chooseUrgency(value)}
                  >
                    {urgencyLabel(value)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="summary-field">
            <span>One-line summary <small>Editable</small></span>
            <input
              value={summary}
              maxLength="240"
              disabled={sendMutation.isPending}
              placeholder="A concise preview will appear here"
              onChange={(event) => {
                editFlagsRef.current.summary = true;
                setSummary(event.target.value);
              }}
            />
          </label>
          <label className="toggle-row">
            <span><strong>Require acknowledgment</strong><small>Students must explicitly confirm this notice</small></span>
            <input
              type="checkbox"
              role="switch"
              checked={requiresAcknowledgment}
              disabled={sendMutation.isPending}
              onChange={(event) => {
                editFlagsRef.current.acknowledgment = true;
                setRequiresAcknowledgment(event.target.checked);
              }}
            />
            <span className="toggle-ui" aria-hidden="true" />
          </label>
          <div className="audience-summary">
            <span><strong>{selectedGroups.length}</strong><small>groups selected</small></span>
            <ArrowRight />
            <span><strong>{audienceTotal}</strong><small>membership entries</small></span>
          </div>
        </div>

        {(text.trim().length > 0 && text.trim().length < 5) && <p className="form-error" role="alert">Enter at least five characters.</p>}
        {(text.trim().length >= 5 && targetIds.size === 0) && <p className="form-error" role="alert">Choose at least one audience.</p>}
        {(summary.trim().length > 0 && summary.trim().length < 3) && <p className="form-error" role="alert">Summary must contain at least three characters.</p>}
        {sendMutation.isError && <p className="form-error" role="alert">{getErrorMessage(sendMutation.error)}</p>}
        <button className="primary-button send-button" type="submit" disabled={sendMutation.isPending || text.trim().length < 5 || targetIds.size === 0 || (summary.trim().length > 0 && summary.trim().length < 3)}>
          <span>Review & send</span><Send />
        </button>
      </form>

      <AudiencePicker
        open={audienceOpen}
        groups={groups}
        selectedIds={targetIds}
        onChange={updateAudience}
        onClose={() => setAudienceOpen(false)}
      />

      <Modal open={reviewOpen} onClose={closeReview} dismissible={!sendMutation.isPending} eyebrow="Final check" title="Ready to route this circular?" className="review-dialog">
        <div className="review-card">
          <h4>{reviewPayload?.summary}</h4>
          <p>{reviewPayload?.text}</p>
          <div className="review-facts">
            <div className="review-fact"><span>Priority</span><strong>{urgencyLabel(reviewPayload?.urgency)}</strong></div>
            <div className="review-fact"><span>Event date</span><strong>{formatEventDate(reviewPayload?.detectedDate)}</strong></div>
            <div className="review-fact"><span>Accountability</span><strong>{reviewPayload?.requiresAcknowledgment ? 'Acknowledgment required' : 'Read tracking'}</strong></div>
          </div>
        </div>
        <div className="review-summary">
          <div><span>Audience</span><strong>{reviewGroups.map((group) => group.name).join(', ')}</strong></div>
          <div><span>Estimated reach</span><strong>Up to {reviewAudienceTotal} students</strong></div>
        </div>
        {reviewAudienceTotal === 0 && <p className="inline-warning">No students currently belong to the selected groups. The circular will be stored but no inbox will receive it.</p>}
        {sendMutation.isError && <p className="form-error" role="alert">{getErrorMessage(sendMutation.error)}</p>}
        <div className="review-actions">
          <button className="secondary-button" type="button" disabled={sendMutation.isPending} onClick={closeReview}>Keep editing</button>
          <button
            className="primary-button"
            type="button"
            disabled={sendMutation.isPending || !reviewPayload}
            onClick={() => sendMutation.mutate(reviewPayload)}
          >
            {sendMutation.isPending ? 'Sending...' : 'Send circular'} <Send />
          </button>
        </div>
      </Modal>
    </section>
  );
}

function FacultyReceivedDetail({ circular, user, onClose }) {
  const queryClient = useQueryClient();
  const requestedReadIds = useRef(new Set());
  const readMutation = useMutation({
    mutationFn: (circularId) => apiRequest(`/api/circulars/${circularId}/read`, { method: 'POST' }),
    onSuccess: (payload, circularId) => {
      const status = payload?.status || {};
      queryClient.setQueryData(facultyInboxKey(user.id), (current = []) => current.map((item) => (
        Number(item.id) === Number(circularId) ? { ...item, ...status } : item
      )));
    },
  });
  const acknowledgmentMutation = useMutation({
    mutationFn: (circularId) => apiRequest(`/api/circulars/${circularId}/ack`, { method: 'POST' }),
    onSuccess: (payload, circularId) => {
      const status = payload?.status || {};
      queryClient.setQueryData(facultyInboxKey(user.id), (current = []) => current.map((item) => (
        Number(item.id) === Number(circularId) ? { ...item, ...status } : item
      )));
    },
  });

  useEffect(() => {
    if (!circular?.id || circular.readAt || requestedReadIds.current.has(circular.id)) return;
    requestedReadIds.current.add(circular.id);
    readMutation.mutate(circular.id);
  }, [circular?.id, circular?.readAt]);

  if (!circular) return null;
  const targets = Array.isArray(circular.targets) ? circular.targets : [];

  return (
    <Modal open onClose={onClose} eyebrow="Received" title="Official circular" className="received-circular-dialog">
      <article className="review-card received-circular-detail">
        <div className="card-top">
          <span className={`urgency-pill ${urgencyValue(circular.urgency)}`}>{urgencyLabel(circular.urgency)}</span>
          <time className="card-time" dateTime={circular.createdAt}>{formatDate(circular.createdAt)}</time>
        </div>
        <h4>{circular.summary || 'Official circular'}</h4>
        <p>{circular.text}</p><CircularExtras circular={circular} user={{ role: "faculty" }} />
        <div className="detail-meta">
          <span>From {circular.faculty?.name || 'Faculty'}</span>
          {circular.detectedDate && <span>Event {formatEventDate(circular.detectedDate)}</span>}
        </div>
        <div className="tag-row">
          {targets.map((target) => <span className="target-tag" key={target.id}>{target.name}</span>)}
        </div>
      </article>

      <div className="review-actions received-circular-actions">
        <a className="secondary-button" href={`/api/circulars/${circular.id}/download.txt`} download>
          <Download /> Download .txt
        </a>
        {circular.detectedDate && (
          <a className="secondary-button" href={`/api/circulars/${circular.id}/calendar.ics`} download>
            <CalendarDays /> Add to calendar
          </a>
        )}
      </div>

      {circular.requiresAcknowledgment && !circular.acknowledgedAt && (
        <button
          className="primary-button"
          type="button"
          disabled={acknowledgmentMutation.isPending}
          onClick={() => acknowledgmentMutation.mutate(circular.id)}
        >
          <Check /> {acknowledgmentMutation.isPending ? 'Acknowledging...' : 'Acknowledge circular'}
        </button>
      )}
      {circular.acknowledgedAt && (
        <p className="auth-security" role="status"><Check /> Acknowledged {formatDate(circular.acknowledgedAt)}</p>
      )}
      {readMutation.isError && (
        <p className="form-error" role="alert">
          {getErrorMessage(readMutation.error, 'Could not save read status.')}
          {' '}
          <button className="text-button" type="button" onClick={() => readMutation.mutate(circular.id)}>Try again</button>
        </p>
      )}
      {acknowledgmentMutation.isError && <p className="form-error" role="alert">{getErrorMessage(acknowledgmentMutation.error)}</p>}
    </Modal>
  );
}

function SentCirculars({ user }) {
  const navigate = useNavigate();
  const [view, setView] = useState('sent');
  const [search, setSearch] = useState('');
  const [activeReceivedId, setActiveReceivedId] = useState(null);
  const circularsQuery = useQuery({
    queryKey: ['faculty-circulars', user.id],
    queryFn: () => apiRequest('/api/circulars?limit=100'),
  });
  const receivedQuery = useQuery({
    queryKey: facultyInboxKey(user.id),
    queryFn: async () => {
      const payload = await apiRequest('/api/inbox?limit=100');
      return Array.isArray(payload?.circulars) ? payload.circulars : [];
    },
    enabled: view === 'received',
  });
  const circulars = circularsQuery.data?.circulars || [];
  const receivedCirculars = receivedQuery.data || [];
  const activeReceived = receivedCirculars.find((item) => Number(item.id) === activeReceivedId) || null;
  const totalAudience = circulars.reduce((sum, item) => sum + circularStats(item).audience, 0);
  const totalRead = circulars.reduce((sum, item) => sum + circularStats(item).read, 0);
  const readRate = totalAudience ? `${Math.round((totalRead / totalAudience) * 100)}%` : '-';
  const receivedUnread = receivedCirculars.filter((item) => !item.readAt).length;
  const receivedActions = receivedCirculars.filter((item) => item.requiresAcknowledgment && !item.acknowledgedAt).length;
  const matchesSearch = (circular) => [circular.summary, circular.text, circular.faculty?.name, ...(circular.targets || []).map((group) => group.name)].join(' ').toLowerCase().includes(search.trim().toLowerCase());
  const matchingSent = circulars.filter(matchesSearch);
  const matchingReceived = receivedCirculars.filter(matchesSearch);

  return (
    <section className="tab-view" aria-labelledby="sent-heading">
      <div className="section-heading">
        <div><p className="overline">Communication</p><h3 id="sent-heading">{view === 'sent' ? 'Sent circulars' : 'Received circulars'}</h3></div>
        <button
          className="icon-button"
          type="button"
          aria-label={view === 'sent' ? 'Refresh sent circulars' : 'Refresh received circulars'}
          disabled={view === 'sent' ? circularsQuery.isFetching : receivedQuery.isFetching}
          onClick={() => (view === 'sent' ? circularsQuery.refetch() : receivedQuery.refetch())}
        >
          <RefreshCw />
        </button>
      </div>
      <div className="filter-row communication-tabs" aria-label="Circular mailbox">
        <button className={view === 'sent' ? 'active' : ''} type="button" aria-pressed={view === 'sent'} onClick={() => setView('sent')}>Sent</button>
        <button className={view === 'received' ? 'active' : ''} type="button" aria-pressed={view === 'received'} onClick={() => setView('received')}>
          Received{receivedUnread ? ` (${receivedUnread})` : ''}
        </button>
      </div>
      <label className="discovery-search"><Search aria-hidden="true" /><span className="sr-only">Search recent circulars</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the latest 100 circulars..." /></label>
      {search && <button className="inline-button reset-filters" onClick={() => setSearch('')}>Clear search</button>}
      {search && (view === 'sent' ? circularsQuery.isSuccess && matchingSent.length === 0 : receivedQuery.isSuccess && matchingReceived.length === 0) && <EmptyState title="No matching circulars" copy="Try a notice title, group name, or a different keyword." />}
      <div className="stat-grid">
        {view === 'sent' ? (
          <>
            <div><strong>{circulars.length}</strong><span>Sent</span></div>
            <div><strong>{totalAudience}</strong><span>Delivered</span></div>
            <div><strong>{readRate}</strong><span>Read rate</span></div>
          </>
        ) : (
          <>
            <div><strong>{receivedCirculars.length}</strong><span>Received</span></div>
            <div><strong>{receivedUnread}</strong><span>Unread</span></div>
            <div><strong>{receivedActions}</strong><span>Action needed</span></div>
          </>
        )}
      </div>
      {view === 'sent' ? (
        <div className="card-list sent-circular-list">
          {circularsQuery.isPending && <LoadingCards />}
          {circularsQuery.isError && <EmptyState title="Sent circulars unavailable" copy={getErrorMessage(circularsQuery.error)} />}
          {!circularsQuery.isPending && !circularsQuery.isError && circulars.length === 0 && <EmptyState title="Nothing sent yet" copy="Your first routed circular will appear here." />}
          {matchingSent.map((circular) => {
            const stats = circularStats(circular);
            const targets = Array.isArray(circular.targets) ? circular.targets : [];
            return (
              <button
                className={`circular-card sent-notice${stats.read < stats.audience ? ' has-pending' : ''}`}
                type="button"
                key={circular.id}
                aria-label={`Open delivery report for ${circular.summary || 'circular'}`}
                onClick={() => navigate(`/faculty/sent/${Number(circular.id)}`)}
              >
                <div className="card-top">
                  <span className={`urgency-pill ${urgencyValue(circular.urgency)}`}>{urgencyLabel(circular.urgency)}</span>
                  <time className="card-time" dateTime={circular.createdAt}>{formatDate(circular.createdAt)}</time>
                </div>
                <h4>{circular.summary || circular.text.slice(0, 100)}</h4>
                <p className="body-preview">{circular.text}</p>
                <div className="tag-row">
                  {targets.length
                    ? targets.map((target) => <span className="target-tag" key={target.id}>{target.name}</span>)
                    : <span className="target-tag">Audience unavailable</span>}
                </div>
                <div className="card-footer">
                  <span>{stats.read}/{stats.audience} read</span>
                  <span>{circular.requiresAcknowledgment ? `${stats.acknowledged}/${stats.audience} acknowledged` : 'Read tracking'}</span>
                  <ArrowRight aria-hidden="true" />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="card-list received-circular-list">
          {receivedQuery.isPending && <LoadingCards />}
          {receivedQuery.isError && <EmptyState title="Received circulars unavailable" copy={getErrorMessage(receivedQuery.error)} />}
          {receivedQuery.isSuccess && receivedCirculars.length === 0 && <EmptyState title="Nothing received yet" copy="Circulars addressed to the Faculty Group will appear here." />}
          {matchingReceived.map((circular) => {
            const targets = Array.isArray(circular.targets) ? circular.targets : [];
            return (
              <button
                className={`circular-card received-notice${circular.readAt ? '' : ' is-unread'}`}
                type="button"
                key={circular.id}
                aria-label={`${circular.readAt ? '' : 'Unread: '}Open received circular ${circular.summary || ''}`.trim()}
                onClick={() => setActiveReceivedId(Number(circular.id))}
              >
                <div className="card-top">
                  <span className={`urgency-pill ${urgencyValue(circular.urgency)}`}>{urgencyLabel(circular.urgency)}</span>
                  <time className="card-time" dateTime={circular.createdAt}>{formatDate(circular.createdAt)}</time>
                </div>
                <h4>{circular.summary || circular.text}</h4>
                <p className="body-preview">{circular.text}</p>
                <div className="tag-row">{targets.map((target) => <span className="target-tag" key={target.id}>{target.name}</span>)}</div>
                <div className="card-footer">
                  <span>From {circular.faculty?.name || 'Faculty'}</span>
                  <span>{circular.acknowledgedAt ? 'Acknowledged' : circular.requiresAcknowledgment ? 'Acknowledgment required' : circular.readAt ? 'Read' : 'Unread'}</span>
                  <ArrowRight aria-hidden="true" />
                </div>
              </button>
            );
          })}
        </div>
      )}
      {activeReceived && (
        <FacultyReceivedDetail circular={activeReceived} user={user} onClose={() => setActiveReceivedId(null)} />
      )}
    </section>
  );
}

function SentCircularDetail({ user }) {
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const circularId = Number(routeId);
  const validId = Number.isInteger(circularId) && circularId > 0;
  const detailQuery = useQuery({
    queryKey: ['faculty-circular', 'accountability', circularId, user.id],
    queryFn: () => apiRequest(`/api/circulars/${circularId}/accountability`),
    enabled: validId,
  });

  if (!validId) return <Navigate to="/faculty/sent" replace />;

  const circular = detailQuery.data?.circular;
  const recipients = Array.isArray(circular?.recipients) ? circular.recipients : [];
  const stats = circularStats(circular);
  const audience = stats.audience || recipients.length;
  const read = Number.isFinite(Number(circular?.stats?.read))
    ? Number(circular.stats.read)
    : recipients.filter((recipient) => recipient.readAt).length;
  const acknowledged = Number.isFinite(Number(circular?.stats?.acknowledged))
    ? Number(circular.stats.acknowledged)
    : recipients.filter((recipient) => recipient.acknowledgedAt).length;
  const readPercent = audience ? Math.round((read / audience) * 100) : 0;
  const targets = Array.isArray(circular?.targets) ? circular.targets : [];

  return (
    <section className="tab-view accountability-view" aria-labelledby="accountability-heading">
      <div className="section-heading accountability-heading">
        <div className="group-card-actions">
          <button className="icon-button" type="button" aria-label="Back to sent circulars" onClick={() => navigate('/faculty/sent')}>
            <ArrowLeft />
          </button>
          <div><p className="overline">Accountability</p><h3 id="accountability-heading">Delivery report</h3></div>
        </div>
        <button className="icon-button" type="button" aria-label="Refresh delivery report" disabled={detailQuery.isFetching} onClick={() => detailQuery.refetch()}>
          <RefreshCw />
        </button>
      </div>

      {detailQuery.isPending && <LoadingCards count={3} />}
      {detailQuery.isError && (
        <div className="empty-state" role="alert">
          <span className="empty-icon"><ClipboardList /></span>
          <h4>Could not load the report</h4>
          <p>{getErrorMessage(detailQuery.error)}</p>
          <button className="secondary-button" type="button" onClick={() => detailQuery.refetch()}>Try again</button>
        </div>
      )}

      {circular && (
        <>
          <section className="analytics-summary">
            <span className={`urgency-pill ${urgencyValue(circular.urgency)}`}>{urgencyLabel(circular.urgency)}</span>
            <h3>{circular.summary || 'Circular delivery'}</h3>
            <p>{circular.text}</p><CircularExtras circular={circular} user={{ role: "faculty" }} />
            <div className="tag-row">
              {targets.map((target) => <span className="target-tag" key={target.id}>{target.name}</span>)}
            </div>
            <small>
              Sent {formatDate(circular.createdAt)}
              {circular.detectedDate ? ` - Event ${formatEventDate(circular.detectedDate)}` : ''}
            </small>
          </section>

          <div className="analytics-numbers" aria-label="Delivery totals">
            <div><strong>{read}/{audience}</strong><span>Read</span></div>
            <div><strong>{circular.requiresAcknowledgment ? `${acknowledged}/${audience}` : '-'}</strong><span>Acknowledged</span></div>
            <div><strong>{Math.max(0, audience - read)}</strong><span>Unread</span></div>
          </div>

          <section className="progress-stack" aria-label={`Read progress ${readPercent}%`}>
            <div className="progress-label"><strong>Read progress</strong><span>{readPercent}%</span></div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.max(0, readPercent))}%` }} />
            </div>
          </section>

          <section className="roster-section" aria-labelledby="recipient-status-heading">
            <h4 id="recipient-status-heading">Individual recipient status</h4>
            <div className="roster-list">
              {!recipients.length && (
                <EmptyState title="No recipients" copy="No student currently matches this circular's audience." icon={Users} />
              )}
              {recipients.map((recipient) => {
                const status = circular.requiresAcknowledgment
                  ? recipient.acknowledgedAt
                    ? 'Read / acknowledged'
                    : recipient.readAt
                      ? 'Read / not acknowledged'
                      : 'Unread / not acknowledged'
                  : recipient.readAt ? 'Read' : 'Unread';
                const statusClass = recipient.acknowledgedAt
                  ? 'good'
                  : recipient.readAt ? 'waiting' : 'muted';
                return (
                  <div className="roster-row" key={recipient.id}>
                    <span className="roster-person">
                      <strong>{recipient.name}</strong>
                      <small>{recipient.email} - {yearLabel(recipient.year)}</small>
                    </span>
                    <span className={`delivery-status ${statusClass}`}>{status}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function MemberEditor({ group, open, onClose }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(() => new Set());
  const membersQuery = useQuery({
    queryKey: ['group-members', group?.id],
    queryFn: () => apiRequest(`/api/groups/${group.id}/members`),
    enabled: Boolean(open && group),
  });

  const updateMutation = useMutation({
    mutationFn: ({ groupId, studentIds }) => apiRequest(`/api/groups/${groupId}/members`, {
      method: 'PUT',
      body: { studentIds },
    }),
    onSuccess: async (_payload, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups', 'faculty'] }),
        queryClient.invalidateQueries({ queryKey: ['group-members', variables.groupId] }),
      ]);
      onClose();
    },
  });

  useEffect(() => {
    setSelected(new Set());
    updateMutation.reset();
  }, [group?.id]);

  useEffect(() => {
    if (!open || !group || membersQuery.isError) {
      setSelected(new Set());
      return;
    }
    if (membersQuery.isSuccess) {
      const memberIds = Array.isArray(membersQuery.data?.memberIds)
        ? membersQuery.data.memberIds
        : [];
      setSelected(new Set(memberIds));
    }
  }, [group?.id, membersQuery.data, membersQuery.isError, membersQuery.isSuccess, open]);

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal open={open} onClose={onClose} eyebrow="Memberships" title={group ? `Manage ${group.name}` : 'Manage members'}>
      <div className="option-list member-list">
        {membersQuery.isPending || membersQuery.isFetching ? <LoadingCards count={1} /> : null}
        {membersQuery.data?.students.map((student) => (
          <label className="option-row" key={student.id}>
            <input
              type="checkbox"
              checked={selected.has(student.id)}
              disabled={membersQuery.isFetching || updateMutation.isPending}
              onChange={() => toggle(student.id)}
            />
            <span className="avatar small-avatar">{initials(student.name)}</span>
            <span className="option-copy"><strong>{student.name}</strong><small>Year {student.year} | {student.email}</small></span>
            <span className="option-check"><Check /></span>
          </label>
        ))}
      </div>
      {membersQuery.isError && (
        <div className="form-error" role="alert">
          <span>{getErrorMessage(membersQuery.error, 'Could not load group members.')}</span>
          {' '}
          <button className="text-button" type="button" disabled={membersQuery.isFetching} onClick={() => membersQuery.refetch()}>
            <RefreshCw /> Try again
          </button>
        </div>
      )}
      {updateMutation.isError && <p className="form-error" role="alert">{getErrorMessage(updateMutation.error)}</p>}
      <button
        className="primary-button"
        type="button"
        disabled={!group || !membersQuery.isSuccess || membersQuery.isFetching || updateMutation.isPending}
        onClick={() => updateMutation.mutate({ groupId: group.id, studentIds: [...selected] })}
      >
        {updateMutation.isPending ? 'Saving...' : `Save ${selected.size} member${selected.size === 1 ? '' : 's'}`}
      </button>
    </Modal>
  );
}

function GroupDirectory({ groupsQuery }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(null);
  const groups = groupsQuery.data?.groups || [];

  return (
    <section className="tab-view" aria-labelledby="groups-heading">
      <div className="section-heading">
        <div><p className="overline">Audience directory</p><h3 id="groups-heading">Groups & memberships</h3></div>
        <button className="round-add" type="button" aria-label="Create group" onClick={() => setCreateOpen(true)}><Plus /></button>
      </div>
      <p className="view-intro">Create communities, activity groups, or focused subgroups such as Final Year Mechanical, EEE, and IT.</p>
      <div className="card-list">
        {groupsQuery.isPending && <LoadingCards />}
        {groupsQuery.isError && <EmptyState title="Groups unavailable" copy={getErrorMessage(groupsQuery.error)} />}
        {groups.filter((group) => group.kind !== 'role').map((group) => (
          <article className="group-card" key={group.id}>
            <div className="group-card-main">
              <span className="group-mark">{group.icon}</span>
              <span className="group-card-copy"><strong>{group.name}</strong><small>{group.description}</small>{(group.year || group.department || group.section || group.parentGroupId) && <small className="group-meta">{group.year ? yearLabel(group.year) : 'All years'}{group.department ? ` - ${group.department}` : ''}{group.section ? ` - Section ${group.section}` : ''}{group.parentGroupId ? ' - Subgroup' : ''}</small>}</span>
              <span className="member-count-compact">{group.memberCount ?? 0}</span>
            </div>
            <div className="group-card-footer">
              <span>{group.kind === 'year' || group.kind === 'broadcast' ? 'Automatic membership' : `${group.memberCount ?? 0} student${group.memberCount === 1 ? '' : 's'}`}</span>
              {MANAGEABLE_KINDS.has(group.kind) && (
                <button className="inline-button" type="button" onClick={() => setActiveGroup(group)}>Manage <ArrowRight /></button>
              )}
            </div>
          </article>
        ))}
      </div>
      {createOpen && <CreateGroupDialog role="faculty" onClose={() => setCreateOpen(false)} />}
      <MemberEditor group={activeGroup} open={Boolean(activeGroup)} onClose={() => setActiveGroup(null)} />
    </section>
  );
}

function FacultyAccount({ user, onLogout }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await onLogout();
    } catch (nextError) {
      setError(getErrorMessage(nextError));
      setBusy(false);
    }
  }

  return (
    <section className="tab-view">
      <div className="profile-card">
        <span className="avatar">{initials(user.name)}</span>
        <h3>{user.name}</h3>
        <p>{user.email}</p>
        <span className="soft-badge">Faculty</span>
      </div>
      <div className="settings-list">
        <button className="danger-row" type="button" disabled={busy} onClick={logout}>
          <span className="setting-icon"><LogOut /></span>
          <span><strong>{busy ? 'Signing out...' : 'Sign out'}</strong><small>End this CampusRelay session</small></span>
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="build-note">Signed in as faculty. To use a student account, sign out and choose Student portal.</div>
    </section>
  );
}

export default function FacultyPortal({ user, onLogout }) {
  const navigate = useNavigate();
  const groupsQuery = useQuery({
    queryKey: ['groups', 'faculty', user.id],
    queryFn: () => apiRequest('/api/groups'),
  });

  return (
    <section className="screen app-screen screen-active" aria-label="Faculty portal">
      <header className="app-topbar">
        <div><p className="overline">Faculty portal</p><h2>Hello, {greetingName(user.name)}</h2></div>
        <div className="portal-header-actions"><PortalTools user={user} /><PortalThemeButton /><button className="icon-button" aria-label="Go to home" onClick={() => navigate('/')}><House /></button>
        <button className="avatar-button" type="button" aria-label="Open account" onClick={() => navigate('/faculty/account')}>
          <span className="avatar">{initials(user.name)}</span><span className="online-dot" />
        </button>
        </div>
      </header>
      <div className="view-scroll">
        <Suspense fallback={<RouteLoading />}><Routes>
          <Route index element={<Navigate to="compose" replace />} />
          <Route path="compose" element={<CircularComposer groupsQuery={groupsQuery} />} />
          <Route path="overview" element={<Overview user={user} />} />
          <Route path="workbench" element={<CircularWorkbench user={user} />} />
          <Route path="events" element={<CampusCalendar user={user} />} />
          <Route path="analytics" element={<Analytics user={user} />} />
          <Route path="settings" element={<AccountSettings user={user} />} />
          <Route path="sent/:id" element={<SentCircularDetail user={user} />} />
          <Route path="sent" element={<SentCirculars user={user} />} />
          <Route path="campus" element={<CampusFeed user={user} />} />
          <Route path="groups" element={<GroupDirectory groupsQuery={groupsQuery} />} />
          <Route path="account" element={<FacultyAccount user={user} onLogout={onLogout} />} />
          <Route path="*" element={<Navigate to="compose" replace />} />
        </Routes></Suspense>
      </div>
      <PortalNavigation role="faculty" />
    </section>
  );
}
