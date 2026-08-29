(() => {
  'use strict';

  const SCREEN_IDS = [
    'landingScreen',
    'authScreen',
    'facultyScreen',
    'studentScreen',
    'noticeScreen',
    'analyticsScreen',
  ];

  const DEMO_ACCOUNTS = {
    faculty: {
      email: 'faculty@demo.edu',
      password: 'Faculty123!',
      name: 'Dr. Meera Shah',
      description: 'Faculty demo · signs in instantly',
    },
    student: {
      email: 'asha@demo.edu',
      password: 'Student123!',
      name: 'Asha Rao',
      description: 'Student demo · signs in instantly',
    },
  };

  const state = {
    user: null,
    authRole: 'faculty',
    screenStack: ['landingScreen'],
    facultyView: 'compose',
    studentView: 'inbox',
    groups: [],
    membershipIds: new Set(),
    inbox: [],
    sentCirculars: [],
    inboxFilter: 'all',
    selectedGroupIds: new Set(),
    manualGroupIds: new Set(),
    pickerGroupIds: new Set(),
    suggestedGroups: [],
    dismissedSuggestionIds: new Set(),
    urgency: 'normal',
    urgencyWasEdited: false,
    dateWasEdited: false,
    summaryWasEdited: false,
    acknowledgmentWasEdited: false,
    clientDetectedDate: '',
    activeNotice: null,
    activeAnalyticsId: null,
    activeMembersGroup: null,
    memberStudents: [],
    typeaheadTimer: null,
    typeaheadController: null,
    typeaheadSequence: 0,
    socket: null,
    socketRefreshTimer: null,
    deferredInstallPrompt: null,
    serviceWorkerRegistration: null,
    initialized: false,
  };

  class ApiError extends Error {
    constructor(message, status = 0, code = 'REQUEST_FAILED', details = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function appendChildren(parent, children) {
    const values = Array.isArray(children) ? children : [children];
    values.flat(Infinity).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return parent;
  }

  function createElement(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = String(options.text);
    if (options.id) element.id = options.id;
    if (options.type) element.type = options.type;
    if (options.title) element.title = options.title;
    if (options.value !== undefined) element.value = String(options.value);
    if (options.name) element.name = options.name;
    if (options.placeholder) element.placeholder = options.placeholder;
    if (options.checked !== undefined) element.checked = Boolean(options.checked);
    if (options.disabled !== undefined) element.disabled = Boolean(options.disabled);
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([name, value]) => {
        if (value !== null && value !== undefined) element.setAttribute(name, String(value));
      });
    }
    if (options.dataset) {
      Object.entries(options.dataset).forEach(([name, value]) => {
        element.dataset[name] = String(value);
      });
    }
    return appendChildren(element, children);
  }

  function icon(symbol, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (className) svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${symbol}`);
    svg.append(use);
    return svg;
  }

  function replaceContent(target, ...children) {
    if (!target) return;
    target.replaceChildren();
    appendChildren(target, children);
  }

  function toNumericId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  function idsEqual(left, right) {
    return Number(left) === Number(right);
  }

  function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
    if (error instanceof ApiError && error.message) return error.message;
    if (error instanceof TypeError && !navigator.onLine) return 'You are offline. Reconnect and try again.';
    return error?.message || fallback;
  }

  async function api(path, options = {}) {
    const request = { credentials: 'same-origin', ...options };
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body !== undefined && options.body !== null && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      request.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    request.headers = headers;

    let response;
    try {
      response = await fetch(path, request);
    } catch (error) {
      throw new ApiError(
        navigator.onLine ? 'The server could not be reached.' : 'You are offline. Reconnect and try again.',
        0,
        'NETWORK_ERROR',
      );
    }

    const contentType = response.headers.get('content-type') || '';
    let payload = null;
    if (response.status !== 204) {
      if (contentType.includes('application/json')) {
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
      } else {
        const text = await response.text();
        payload = text ? { message: text } : null;
      }
    }

    if (!response.ok) {
      const apiError = payload?.error;
      throw new ApiError(
        apiError?.message || payload?.message || `Request failed (${response.status}).`,
        response.status,
        apiError?.code || 'REQUEST_FAILED',
        apiError?.details || null,
      );
    }
    return payload || {};
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = Boolean(busy);
    button.classList.toggle('is-loading', Boolean(busy));
    button.setAttribute('aria-busy', String(Boolean(busy)));
  }

  function setInlineError(element, message = '') {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  function toast(message, tone = 'info') {
    const region = $('#toastRegion');
    if (!region || !message) return;
    const safeTone = ['success', 'error', 'info'].includes(tone) ? tone : 'info';
    const item = createElement('div', {
      className: `toast toast-${safeTone}`,
      attrs: { role: tone === 'error' ? 'alert' : 'status' },
    });
    const dismiss = createElement('button', {
      type: 'button',
      attrs: { 'aria-label': 'Dismiss notification' },
    }, icon('i-close'));
    dismiss.addEventListener('click', () => item.remove());
    appendChildren(item, [
      createElement('span', { className: 'toast-icon' }, icon(safeTone === 'error' ? 'i-alert' : 'i-check')),
      createElement('span', { className: 'toast-copy' }, [
        createElement('strong', { text: safeTone === 'error' ? 'Something needs attention' : safeTone === 'success' ? 'Done' : 'CampusRelay' }),
        createElement('small', { text: message }),
      ]),
      dismiss,
    ]);
    region.append(item);
    requestAnimationFrame(() => item.classList.add('toast-visible'));
    window.setTimeout(() => {
      item.classList.remove('toast-visible');
      window.setTimeout(() => item.remove(), 220);
    }, 3800);
  }

  function emptyState(title, copy, iconSymbol = 'i-inbox') {
    return createElement('div', { className: 'empty-state' }, [
      createElement('span', { className: 'empty-icon' }, icon(iconSymbol)),
      createElement('h4', { text: title }),
      createElement('p', { text: copy }),
    ]);
  }

  function loadingCards(count = 2) {
    return Array.from({ length: count }, () => createElement('div', { className: 'skeleton-card' }));
  }

  function showDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function renderScreen(screenId) {
    if (!SCREEN_IDS.includes(screenId)) return;
    SCREEN_IDS.forEach((id) => {
      const screen = document.getElementById(id);
      if (!screen) return;
      const active = id === screenId;
      screen.classList.toggle('hidden', !active);
      screen.classList.toggle('screen-active', active);
      screen.setAttribute('aria-hidden', String(!active));
    });
    const activeScreen = document.getElementById(screenId);
    const scroller = activeScreen?.querySelector('.view-scroll');
    if (scroller) scroller.scrollTop = 0;
  }

  function navigateTo(screenId) {
    if (!SCREEN_IDS.includes(screenId)) return;
    const current = state.screenStack[state.screenStack.length - 1];
    if (current !== screenId) state.screenStack.push(screenId);
    renderScreen(screenId);
  }

  function resetNavigation(screenId) {
    state.screenStack = [screenId];
    renderScreen(screenId);
  }

  function goBack() {
    if (state.screenStack.length > 1) state.screenStack.pop();
    const fallback = state.user
      ? state.user.role === 'faculty' ? 'facultyScreen' : 'studentScreen'
      : 'landingScreen';
    const destination = state.screenStack[state.screenStack.length - 1] || fallback;
    if (state.screenStack.length === 0) state.screenStack.push(destination);
    renderScreen(destination);
  }

  window.goBack = goBack;

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'CR';
    return `${parts[0][0] || ''}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
  }

  function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || 'there';
  }

  function yearLabel(year) {
    const labels = { 1: 'First year', 2: 'Second year', 3: 'Third year', 4: 'Final year' };
    return labels[Number(year)] || (year ? `Year ${year}` : 'Not assigned');
  }

  function formatDate(value, options = {}) {
    if (!value) return '';
    let date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) date = new Date(`${value}T00:00:00`);
    else date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: options.dateStyle || 'medium',
      ...(options.includeTime ? { timeStyle: 'short' } : {}),
    }).format(date);
  }

  function formatCreatedAt(value) {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const delta = Date.now() - date.getTime();
    if (delta >= 0 && delta < 60_000) return 'Just now';
    if (delta >= 0 && delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m ago`;
    if (delta >= 0 && delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
    return formatDate(value, { includeTime: true });
  }

  function urgencyValue(value) {
    return ['urgent', 'normal', 'fyi'].includes(value) ? value : 'normal';
  }

  function urgencyLabel(value) {
    return urgencyValue(value) === 'fyi' ? 'FYI' : `${urgencyValue(value)[0].toUpperCase()}${urgencyValue(value).slice(1)}`;
  }

  function updateUserUI() {
    if (!state.user) return;
    $$('[data-user-first-name]').forEach((element) => { element.textContent = firstName(state.user.name); });
    $$('[data-user-initials]').forEach((element) => { element.textContent = initials(state.user.name); });
    renderProfile($('#facultyProfile'));
    renderProfile($('#studentProfile'));
  }

  function renderProfile(container) {
    if (!container || !state.user) return;
    const role = state.user.role === 'faculty' ? 'Faculty account' : 'Student account';
    const meta = state.user.role === 'student' ? `${role} · ${yearLabel(state.user.year)}` : role;
    replaceContent(container,
      createElement('span', { className: 'avatar', text: initials(state.user.name) }),
      createElement('h3', { text: state.user.name }),
      createElement('p', { text: state.user.email }),
      createElement('span', { className: 'soft-badge', text: meta }),
    );
  }

  function setAuthRole(role) {
    state.authRole = role === 'student' ? 'student' : 'faculty';
    const student = state.authRole === 'student';
    $('#authRoleBadge').textContent = student ? 'Student portal' : 'Faculty portal';
    $('#authTitle').textContent = student ? 'Your notices, in one place' : 'Welcome back';
    $('#authSubtitle').textContent = student
      ? 'Sign in to see only the circulars addressed to your groups.'
      : 'Sign in to compose and track official circulars.';
    $('#showRegisterButton').classList.toggle('hidden', !student);
    const demo = DEMO_ACCOUNTS[state.authRole];
    $('#demoAvatar').textContent = initials(demo.name);
    $('#demoName').textContent = demo.name;
    $('#demoDescription').textContent = demo.description;
    setInlineError($('#loginError'));
    showLoginPanel();
  }

  function showLoginPanel() {
    $('#loginPanel').classList.remove('hidden');
    $('#registerPanel').classList.add('hidden');
  }

  function showRegisterPanel() {
    $('#loginPanel').classList.add('hidden');
    $('#registerPanel').classList.remove('hidden');
    setInlineError($('#registerError'));
    renderRegisterActivities();
    if (!state.groups.length) loadGroups({ publicRequest: true }).catch(() => {});
  }

  async function handleLogin(email, password, sourceButton) {
    setInlineError($('#loginError'));
    setBusy(sourceButton, true);
    try {
      const { user } = await api('/api/auth/login', {
        method: 'POST',
        body: { email: String(email).trim(), password: String(password) },
      });
      if (!user?.id || !['faculty', 'student'].includes(user.role)) {
        throw new ApiError('The server returned an invalid account.', 500, 'INVALID_USER');
      }
      await enterAuthenticatedApp(user);
      toast(`Welcome back, ${firstName(user.name)}.`, 'success');
    } catch (error) {
      setInlineError($('#loginError'), errorMessage(error, 'Sign-in failed.'));
    } finally {
      setBusy(sourceButton, false);
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    await handleLogin($('#loginEmail').value, $('#loginPassword').value, $('#loginButton'));
  }

  async function quickDemoLogin() {
    const account = DEMO_ACCOUNTS[state.authRole];
    $('#loginEmail').value = account.email;
    $('#loginPassword').value = account.password;
    await handleLogin(account.email, account.password, $('#demoLoginButton'));
  }

  async function submitRegistration(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorElement = $('#registerError');
    setInlineError(errorElement);
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const formData = new FormData(form);
    const activityGroupIds = formData.getAll('activityGroupIds')
      .map(toNumericId)
      .filter(Boolean);
    const submitButton = form.querySelector('[type="submit"]');
    setBusy(submitButton, true);
    try {
      const { user } = await api('/api/auth/register', {
        method: 'POST',
        body: {
          name: String(formData.get('name') || '').trim(),
          email: String(formData.get('email') || '').trim(),
          password: String(formData.get('password') || ''),
          year: Number(formData.get('year')),
          activityGroupIds,
        },
      });
      if (!user?.id) throw new ApiError('Account created, but sign-in could not be completed.', 500);
      form.reset();
      await enterAuthenticatedApp(user);
      toast('Your student account is ready.', 'success');
    } catch (error) {
      setInlineError(errorElement, errorMessage(error, 'Account creation failed.'));
    } finally {
      setBusy(submitButton, false);
    }
  }

  function resetAppState() {
    state.user = null;
    state.groups = [];
    state.membershipIds = new Set();
    state.inbox = [];
    state.sentCirculars = [];
    state.activeNotice = null;
    state.activeAnalyticsId = null;
    state.selectedGroupIds = new Set();
    state.manualGroupIds = new Set();
    state.suggestedGroups = [];
    state.dismissedSuggestionIds = new Set();
    state.urgency = 'normal';
    state.urgencyWasEdited = false;
    state.dateWasEdited = false;
    state.summaryWasEdited = false;
    state.acknowledgmentWasEdited = false;
    if (state.typeaheadController) state.typeaheadController.abort();
    if (state.typeaheadTimer) window.clearTimeout(state.typeaheadTimer);
    if (state.socket) state.socket.disconnect();
    state.socket = null;
    closeDialog($('#audienceDialog'));
    closeDialog($('#reviewDialog'));
    closeDialog($('#createGroupDialog'));
    closeDialog($('#membersDialog'));
    $('#composerForm')?.reset();
    updateCharacterCount();
    setUrgency('normal', { userEdited: false });
    renderSelectedTargets();
    replaceContent($('#noticeDetail'));
    replaceContent($('#analyticsDetail'));
    $('#acknowledgmentBar')?.classList.add('hidden');
  }

  async function logout() {
    const buttons = $$('[data-logout]');
    buttons.forEach((button) => setBusy(button, true));
    try {
      await api('/api/auth/logout', { method: 'POST' });
      const priorUserId = state.user?.id;
      if (priorUserId) {
        try {
          localStorage.removeItem(`campusrelay:draft:${priorUserId}`);
          localStorage.removeItem(`campusrelay:inbox:${priorUserId}`);
        } catch { /* storage is optional */ }
      }
      resetAppState();
      resetNavigation('landingScreen');
      $('#loginForm').reset();
      showLoginPanel();
      toast('You have been signed out.', 'success');
    } catch (error) {
      toast(errorMessage(error, 'Could not sign out.'), 'error');
    } finally {
      buttons.forEach((button) => setBusy(button, false));
    }
  }

  async function enterAuthenticatedApp(user) {
    state.user = user;
    updateUserUI();
    connectRealtime();
    if (user.role === 'faculty') {
      resetNavigation('facultyScreen');
      setFacultyView('compose', { load: false });
      renderLoadingFacultyGroups();
      try {
        await loadGroups();
      } catch (error) {
        replaceContent($('#facultyGroupList'), emptyState('Could not load groups', errorMessage(error), 'i-alert'));
        toast(errorMessage(error, 'The group directory is unavailable.'), 'error');
      }
      restoreDraft();
      loadSentCirculars().catch((error) => toast(errorMessage(error), 'error'));
    } else {
      resetNavigation('studentScreen');
      setStudentView('inbox', { load: false });
      replaceContent($('#inboxList'), loadingCards(2));
      replaceContent($('#studentGroupList'), loadingCards(2));
      const [groupsResult, membershipsResult, inboxResult] = await Promise.allSettled([
        loadGroups(),
        loadMemberships(),
        loadInbox(),
      ]);
      if (groupsResult.status === 'rejected' || membershipsResult.status === 'rejected') {
        const cause = groupsResult.status === 'rejected' ? groupsResult.reason : membershipsResult.reason;
        replaceContent($('#studentGroupList'), emptyState('Could not load memberships', errorMessage(cause), 'i-alert'));
      } else renderStudentGroups();
      if (inboxResult.status === 'rejected' && !state.inbox.length) {
        replaceContent($('#inboxList'), emptyState('Could not load your inbox', errorMessage(inboxResult.reason), 'i-alert'));
      } else renderInbox();
      updatePushUI();
    }
  }

  async function restoreSession() {
    try {
      const { user } = await api('/api/auth/me');
      if (user?.id) await enterAuthenticatedApp(user);
      else resetNavigation('landingScreen');
    } catch (error) {
      resetNavigation('landingScreen');
      if (error.status !== 401 && error.code !== 'NETWORK_ERROR') toast(errorMessage(error), 'error');
    }
  }

  async function loadGroups({ publicRequest = false } = {}) {
    const { groups } = await api('/api/groups');
    if (!Array.isArray(groups)) throw new ApiError('The group directory response was invalid.', 500);
    state.groups = groups.filter((group) => toNumericId(group?.id));
    const validIds = new Set(state.groups.map((group) => Number(group.id)));
    state.selectedGroupIds = new Set([...state.selectedGroupIds].filter((id) => validIds.has(Number(id))));
    state.manualGroupIds = new Set([...state.manualGroupIds].filter((id) => validIds.has(Number(id))));
    renderRegisterActivities();
    renderSelectedTargets();
    if (!publicRequest && state.user?.role === 'faculty') renderFacultyGroups();
    if (!publicRequest && state.user?.role === 'student') renderStudentGroups();
    return state.groups;
  }

  function renderRegisterActivities() {
    const container = $('#registerActivities');
    if (!container) return;
    const activities = state.groups.filter((group) => group.kind === 'activity' && group.joinable !== false);
    if (!activities.length) {
      replaceContent(container, createElement('small', { text: 'No optional activity groups are available yet.' }));
      return;
    }
    replaceContent(container, activities.map((group) => {
      const checkbox = createElement('input', {
        type: 'checkbox',
        name: 'activityGroupIds',
        value: group.id,
      });
      return createElement('label', { className: 'check-option' }, [
        checkbox,
        createElement('span', { text: `${group.icon || 'CR'} ${group.name}` }),
      ]);
    }));
  }

  function setFacultyView(view, { load = true } = {}) {
    const allowed = ['compose', 'sent', 'groups', 'account'];
    state.facultyView = allowed.includes(view) ? view : 'compose';
    allowed.forEach((name) => {
      $(`#faculty${name[0].toUpperCase()}${name.slice(1)}View`)?.classList.toggle('hidden', name !== state.facultyView);
    });
    $$('[data-faculty-view]').forEach((button) => {
      const active = button.dataset.facultyView === state.facultyView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (load && state.facultyView === 'sent') loadSentCirculars().catch((error) => toast(errorMessage(error), 'error'));
    if (load && state.facultyView === 'groups') loadGroups().catch((error) => {
      replaceContent($('#facultyGroupList'), emptyState('Could not load groups', errorMessage(error), 'i-alert'));
    });
    if (state.facultyView === 'account') renderProfile($('#facultyProfile'));
  }

  function setStudentView(view, { load = true } = {}) {
    const allowed = ['inbox', 'groups', 'account'];
    state.studentView = allowed.includes(view) ? view : 'inbox';
    allowed.forEach((name) => {
      $(`#student${name[0].toUpperCase()}${name.slice(1)}View`)?.classList.toggle('hidden', name !== state.studentView);
    });
    $$('[data-student-view]').forEach((button) => {
      const active = button.dataset.studentView === state.studentView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (load && state.studentView === 'inbox') loadInbox().catch((error) => toast(errorMessage(error), 'error'));
    if (load && state.studentView === 'groups') {
      Promise.allSettled([loadGroups(), loadMemberships()]).then(() => renderStudentGroups());
    }
    if (state.studentView === 'account') {
      renderProfile($('#studentProfile'));
      updatePushUI();
    }
  }

  function renderLoadingFacultyGroups() {
    replaceContent($('#facultyGroupList'), loadingCards(2));
    replaceContent($('#audienceOptions'), loadingCards(2));
  }

  function groupById(id) {
    return state.groups.find((group) => idsEqual(group.id, id)) || null;
  }

  function groupKindLabel(kind) {
    const labels = {
      year: 'Automatic year group',
      activity: 'Activity group',
      role: 'Role group',
      broadcast: 'College-wide group',
      custom: 'Custom group',
    };
    return labels[kind] || 'Group';
  }

  function renderFacultyGroups() {
    const container = $('#facultyGroupList');
    if (!container) return;
    if (!state.groups.length) {
      replaceContent(container, emptyState('No groups yet', 'Create a custom audience to get started.', 'i-users'));
      return;
    }
    replaceContent(container, state.groups.map((group) => {
      const card = createElement('article', { className: 'group-card' });
      const copy = createElement('div', { className: 'group-card-copy' }, [
        createElement('strong', { text: group.name }),
        createElement('small', { text: group.description || groupKindLabel(group.kind) }),
      ]);
      const aside = createElement('div', { className: 'group-card-actions' },
        createElement('span', { className: 'kind-pill', text: group.kind || 'group' }));
      if (group.kind === 'custom') {
        const manageButton = createElement('button', {
          className: 'manage-button',
          type: 'button',
          text: 'Manage',
          attrs: { 'aria-label': `Manage members of ${group.name}` },
        });
        manageButton.addEventListener('click', () => openMembersDialog(group));
        aside.append(manageButton);
      }
      appendChildren(card, [
        createElement('div', { className: 'group-card-main' }, [
          createElement('span', { className: 'group-monogram', text: group.icon || initials(group.name) }),
          copy,
          aside,
        ]),
        createElement('p', {
          className: 'member-count',
          text: Number.isFinite(Number(group.memberCount)) ? `${Number(group.memberCount)} members` : groupKindLabel(group.kind),
        }),
      ]);
      return card;
    }));
  }

  async function submitCreateGroup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorElement = $('#createGroupError');
    setInlineError(errorElement);
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const data = new FormData(form);
    const submitButton = form.querySelector('[type="submit"]');
    setBusy(submitButton, true);
    try {
      const { group } = await api('/api/groups', {
        method: 'POST',
        body: {
          name: String(data.get('name') || '').trim(),
          description: String(data.get('description') || '').trim(),
          icon: String(data.get('icon') || 'CR').trim().slice(0, 4) || 'CR',
        },
      });
      form.reset();
      const iconInput = form.elements.namedItem('icon');
      if (iconInput) iconInput.value = 'CR';
      closeDialog($('#createGroupDialog'));
      await loadGroups();
      const id = toNumericId(group?.id);
      if (id) {
        state.selectedGroupIds.add(id);
        state.manualGroupIds.add(id);
      }
      renderSelectedTargets();
      saveDraft();
      toast(`${group?.name || 'Group'} created.`, 'success');
    } catch (error) {
      setInlineError(errorElement, errorMessage(error, 'Could not create the group.'));
    } finally {
      setBusy(submitButton, false);
    }
  }

  async function openMembersDialog(group) {
    state.activeMembersGroup = group;
    state.memberStudents = [];
    $('#membersDialogTitle').textContent = `Manage ${group.name}`;
    replaceContent($('#memberOptions'), loadingCards(2));
    showDialog($('#membersDialog'));
    try {
      const payload = await api(`/api/groups/${Number(group.id)}/members`);
      const members = Array.isArray(payload.members) ? payload.members : [];
      const students = Array.isArray(payload.students)
        ? payload.students
        : Array.isArray(payload.availableStudents) ? payload.availableStudents : members;
      const memberIds = new Set(members.map((user) => Number(user.id)));
      state.memberStudents = students.map((student) => ({
        ...student,
        isMember: student.isMember === true || memberIds.has(Number(student.id)),
      }));
      renderMemberOptions();
      if (!Array.isArray(payload.students) && !Array.isArray(payload.availableStudents)) {
        toast('This server can remove current members but does not expose students to add.', 'info');
      }
    } catch (error) {
      if ([404, 405].includes(error.status)) {
        replaceContent($('#memberOptions'), emptyState('Member management unavailable', 'This backend does not expose the optional member-management endpoint.', 'i-users'));
      } else {
        replaceContent($('#memberOptions'), emptyState('Could not load members', errorMessage(error), 'i-alert'));
      }
    }
  }

  function renderMemberOptions() {
    const container = $('#memberOptions');
    if (!state.memberStudents.length) {
      replaceContent(container, emptyState('No student accounts yet', 'Students will appear here after they register.', 'i-user'));
      return;
    }
    replaceContent(container, state.memberStudents.map((student) => {
      const checkbox = createElement('input', {
        type: 'checkbox',
        value: student.id,
        checked: student.isMember,
      });
      checkbox.dataset.studentId = String(student.id);
      return createElement('label', { className: 'option-row' }, [
        createElement('span', { className: 'group-monogram', text: initials(student.name) }),
        createElement('span', { className: 'option-row-copy' }, [
          createElement('strong', { text: student.name }),
          createElement('small', { text: `${student.email} · ${yearLabel(student.year)}` }),
        ]),
        checkbox,
      ]);
    }));
  }

  async function submitMembers(event) {
    event.preventDefault();
    const group = state.activeMembersGroup;
    if (!group) return;
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    const studentIds = $$('#memberOptions input[type="checkbox"]:checked')
      .map((input) => toNumericId(input.dataset.studentId || input.value))
      .filter(Boolean);
    setBusy(submitButton, true);
    try {
      await api(`/api/groups/${Number(group.id)}/members`, {
        method: 'PUT',
        body: { studentIds },
      });
      closeDialog($('#membersDialog'));
      await loadGroups();
      toast(`${group.name} memberships saved.`, 'success');
    } catch (error) {
      toast(errorMessage(error, 'Could not save members.'), 'error');
    } finally {
      setBusy(submitButton, false);
    }
  }

  function renderSelectedTargets() {
    const container = $('#selectedTargets');
    if (!container) return;
    const groups = [...state.selectedGroupIds].map(groupById).filter(Boolean);
    if (!groups.length) {
      replaceContent(container, createElement('span', { className: 'empty-chip-copy', text: 'No audience selected yet' }));
    } else {
      replaceContent(container, groups.map((group) => {
        const suggestion = state.suggestedGroups.find((item) => idsEqual(item.id, group.id));
        const confidence = Number(suggestion?.confidence);
        const label = Number.isFinite(confidence)
          ? `${group.name} ${Math.round(confidence * 100)}%`
          : group.name;
        const chip = createElement('span', { className: 'audience-chip' }, [
          createElement('span', { text: label }),
        ]);
        const removeButton = createElement('button', {
          type: 'button',
          attrs: { 'aria-label': `Remove ${group.name}` },
        }, icon('i-close'));
        removeButton.addEventListener('click', () => {
          state.selectedGroupIds.delete(Number(group.id));
          state.manualGroupIds.delete(Number(group.id));
          if (suggestion) state.dismissedSuggestionIds.add(Number(group.id));
          renderSelectedTargets();
          renderSuggestedTargets();
          saveDraft();
        });
        chip.append(removeButton);
        return chip;
      }));
    }
    renderSuggestedTargets();
  }

  function renderSuggestedTargets() {
    const container = $('#suggestedTargets');
    if (!container) return;
    const suggestions = state.suggestedGroups.filter((suggestion) => {
      const id = toNumericId(suggestion.id);
      return id && !state.selectedGroupIds.has(id) && groupById(id);
    });
    container.classList.toggle('hidden', !suggestions.length);
    replaceContent(container, suggestions.map((suggestion) => {
      const group = groupById(suggestion.id);
      const confidence = Number(suggestion.confidence);
      const label = Number.isFinite(confidence)
        ? `+ ${group.name} · ${Math.round(confidence * 100)}%`
        : `+ ${group.name}`;
      const button = createElement('button', {
        className: 'suggestion-chip',
        type: 'button',
        text: label,
        attrs: { 'aria-label': `Add suggested group ${group.name}` },
      });
      button.addEventListener('click', () => {
        state.selectedGroupIds.add(Number(group.id));
        state.manualGroupIds.add(Number(group.id));
        state.dismissedSuggestionIds.delete(Number(group.id));
        renderSelectedTargets();
        saveDraft();
      });
      return button;
    }));
  }

  function openAudiencePicker() {
    state.pickerGroupIds = new Set(state.selectedGroupIds);
    $('#audienceSearch').value = '';
    renderAudienceOptions();
    showDialog($('#audienceDialog'));
    window.setTimeout(() => $('#audienceSearch')?.focus(), 30);
  }

  function renderAudienceOptions() {
    const container = $('#audienceOptions');
    const query = String($('#audienceSearch')?.value || '').trim().toLowerCase();
    const matches = state.groups.filter((group) => {
      const haystack = `${group.name || ''} ${group.description || ''} ${group.kind || ''}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    if (!matches.length) {
      replaceContent(container, emptyState('No matching groups', 'Try a different search.', 'i-users'));
      return;
    }
    replaceContent(container, matches.map((group) => {
      const checkbox = createElement('input', {
        type: 'checkbox',
        value: group.id,
        checked: state.pickerGroupIds.has(Number(group.id)),
      });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.pickerGroupIds.add(Number(group.id));
        else state.pickerGroupIds.delete(Number(group.id));
      });
      return createElement('label', { className: 'option-row' }, [
        createElement('span', { className: 'group-monogram', text: group.icon || initials(group.name) }),
        createElement('span', { className: 'option-row-copy' }, [
          createElement('strong', { text: group.name }),
          createElement('small', { text: group.description || groupKindLabel(group.kind) }),
        ]),
        checkbox,
      ]);
    }));
  }

  function applyAudiencePicker() {
    state.selectedGroupIds = new Set(state.pickerGroupIds);
    state.manualGroupIds = new Set(state.pickerGroupIds);
    state.selectedGroupIds.forEach((id) => state.dismissedSuggestionIds.delete(Number(id)));
    renderSelectedTargets();
    saveDraft();
    closeDialog($('#audienceDialog'));
  }

  const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9,
    october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function validCalendarDate(year, monthIndex, day) {
    const date = new Date(year, monthIndex, day);
    return date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day;
  }

  function detectClientDate(text) {
    const source = String(text || '');
    const now = new Date();
    let year;
    let monthIndex;
    let day;
    let explicitYear = false;

    const iso = source.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
    const numeric = source.match(/\b(0?[1-9]|[12]\d|3[01])[/-](0?[1-9]|1[0-2])(?:[/-](\d{2}|20\d{2}))?\b/);
    const dayMonth = source.match(/\b(0?[1-9]|[12]\d|3[01])\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*(\d{2}|20\d{2}))?\b/i);
    const monthDay = source.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:\s*,?\s*(\d{2}|20\d{2}))?\b/i);

    if (iso) {
      year = Number(iso[1]);
      monthIndex = Number(iso[2]) - 1;
      day = Number(iso[3]);
      explicitYear = true;
    } else if (numeric) {
      day = Number(numeric[1]);
      monthIndex = Number(numeric[2]) - 1;
      if (numeric[3]) {
        year = Number(numeric[3]);
        if (year < 100) year += 2000;
        explicitYear = true;
      } else year = now.getFullYear();
    } else if (dayMonth) {
      day = Number(dayMonth[1]);
      monthIndex = MONTHS[dayMonth[2].toLowerCase()];
      if (dayMonth[3]) {
        year = Number(dayMonth[3]);
        if (year < 100) year += 2000;
        explicitYear = true;
      } else year = now.getFullYear();
    } else if (monthDay) {
      monthIndex = MONTHS[monthDay[1].toLowerCase()];
      day = Number(monthDay[2]);
      if (monthDay[3]) {
        year = Number(monthDay[3]);
        if (year < 100) year += 2000;
        explicitYear = true;
      } else year = now.getFullYear();
    } else {
      const relative = source.match(/\b(today|tomorrow)\b/i);
      if (!relative) return '';
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (relative[1].toLowerCase() === 'tomorrow' ? 1 : 0));
      year = date.getFullYear();
      monthIndex = date.getMonth();
      day = date.getDate();
      explicitYear = true;
    }

    if (!explicitYear && validCalendarDate(year, monthIndex, day)) {
      const candidate = new Date(year, monthIndex, day, 23, 59);
      if (candidate.getTime() < now.getTime() - 86_400_000) year += 1;
    }
    if (!validCalendarDate(year, monthIndex, day)) return '';

    let hours = 9;
    let minutes = 0;
    const time = source.match(/\b(?:at\s+)?(1[0-2]|0?\d)(?::([0-5]\d))?\s*(am|pm)\b/i)
      || source.match(/\b(?:at\s+)([01]?\d|2[0-3]):([0-5]\d)\b/i);
    if (time) {
      hours = Number(time[1]);
      minutes = Number(time[2] || 0);
      if (time[3]) {
        if (time[3].toLowerCase() === 'pm' && hours !== 12) hours += 12;
        if (time[3].toLowerCase() === 'am' && hours === 12) hours = 0;
      }
    }
    return `${year}-${pad(monthIndex + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}`;
  }

  function normalizeDateForInput(value, preserveTime = '') {
    if (!value) return '';
    const stringValue = String(value);
    const match = stringValue.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (!match) return '';
    if (match[2]) return `${match[1]}T${match[2]}:${match[3]}`;
    if (preserveTime.startsWith(`${match[1]}T`)) return preserveTime;
    return `${match[1]}T09:00`;
  }

  function updateCharacterCount() {
    const length = $('#circularText').value.length;
    $('#characterCount').textContent = `${length} / 1600`;
    $('#draftStatus').textContent = length ? 'Editing' : 'Draft';
  }

  function handleCircularInput() {
    updateCharacterCount();
    setInlineError($('#composeError'));
    const text = $('#circularText').value;
    const instantDate = detectClientDate(text);
    state.clientDetectedDate = instantDate;
    if (!state.dateWasEdited) $('#detectedDate').value = instantDate;
    saveDraft();
    scheduleTypeahead();
  }

  function scheduleTypeahead() {
    if (state.typeaheadTimer) window.clearTimeout(state.typeaheadTimer);
    if (state.typeaheadController) state.typeaheadController.abort();
    const text = $('#circularText').value.trim();
    if (text.length < 3) {
      $('#smartStatus').textContent = text ? 'Keep typing for suggestions' : 'Start typing to analyze your notice';
      $('#aiModeBadge').textContent = 'Local';
      state.suggestedGroups = [];
      renderSuggestedTargets();
      return;
    }
    $('#smartStatus').textContent = 'Waiting for a natural pause…';
    state.typeaheadTimer = window.setTimeout(() => analyzeDraft(), 300);
  }

  async function analyzeDraft({ force = false } = {}) {
    if (state.typeaheadTimer) window.clearTimeout(state.typeaheadTimer);
    const text = $('#circularText').value.trim();
    if (text.length < 3) return null;
    if (state.typeaheadController) state.typeaheadController.abort();
    const controller = new AbortController();
    state.typeaheadController = controller;
    const sequence = ++state.typeaheadSequence;
    $('#smartStatus').textContent = force ? 'Finishing analysis…' : 'Analyzing audience, priority and summary…';
    $('#aiModeBadge').textContent = 'Thinking';
    try {
      const payload = await api('/api/copilot/typeahead', {
        method: 'POST',
        body: { text },
        signal: controller.signal,
      });
      if (sequence !== state.typeaheadSequence || text !== $('#circularText').value.trim()) return null;
      const previousSuggestedIds = new Set(state.suggestedGroups.map((item) => Number(item.id)));
      previousSuggestedIds.forEach((id) => {
        if (!state.manualGroupIds.has(id)) state.selectedGroupIds.delete(id);
      });
      const suggestions = Array.isArray(payload.suggestedGroups) ? payload.suggestedGroups : [];
      state.suggestedGroups = suggestions
        .map((item) => ({
          id: toNumericId(item?.id),
          name: String(item?.name || ''),
          confidence: Number(item?.confidence),
        }))
        .filter((item) => item.id && groupById(item.id));

      state.suggestedGroups.forEach((suggestion) => {
        if (!state.dismissedSuggestionIds.has(suggestion.id)) state.selectedGroupIds.add(suggestion.id);
      });
      if (!state.dateWasEdited && payload.detectedDate) {
        $('#detectedDate').value = normalizeDateForInput(payload.detectedDate, state.clientDetectedDate);
      }
      if (!state.urgencyWasEdited && payload.urgency) setUrgency(payload.urgency, { userEdited: false });
      if (!state.summaryWasEdited && typeof payload.summary === 'string') {
        $('#circularSummary').value = payload.summary.slice(0, 160);
      }
      const dateCopy = payload.detectedDateText ? ` · ${payload.detectedDateText}` : '';
      $('#smartStatus').textContent = `${state.suggestedGroups.length || 'No'} audience suggestion${state.suggestedGroups.length === 1 ? '' : 's'}${dateCopy}`;
      $('#aiModeBadge').textContent = 'Local AI';
      renderSelectedTargets();
      saveDraft();
      return payload;
    } catch (error) {
      if (error.name === 'AbortError' || controller.signal.aborted) return null;
      $('#smartStatus').textContent = navigator.onLine ? 'Suggestions unavailable — choose groups manually' : 'Offline — instant date detection is still active';
      $('#aiModeBadge').textContent = navigator.onLine ? 'Manual' : 'Offline';
      return null;
    }
  }

  function setUrgency(value, { userEdited = true } = {}) {
    const previousUrgency = state.urgency;
    state.urgency = urgencyValue(value);
    if (userEdited) state.urgencyWasEdited = true;
    const acknowledgment = $('#requiresAck');
    if (acknowledgment && !state.acknowledgmentWasEdited) {
      if (state.urgency === 'urgent') acknowledgment.checked = true;
      else if (previousUrgency === 'urgent') acknowledgment.checked = false;
    }
    $$('#urgencyControl [data-urgency]').forEach((button) => {
      const active = button.dataset.urgency === state.urgency;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    saveDraft();
  }

  function draftStorageKey() {
    return state.user?.id ? `campusrelay:draft:${state.user.id}` : '';
  }

  function saveDraft() {
    const key = draftStorageKey();
    if (!key || state.user?.role !== 'faculty') return;
    const draft = {
      text: $('#circularText')?.value || '',
      groupIds: [...state.selectedGroupIds],
      detectedDate: $('#detectedDate')?.value || '',
      urgency: state.urgency,
      summary: $('#circularSummary')?.value || '',
      requiresAcknowledgment: Boolean($('#requiresAck')?.checked),
      acknowledgmentWasEdited: state.acknowledgmentWasEdited,
    };
    try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* storage is optional */ }
  }

  function restoreDraft() {
    const key = draftStorageKey();
    if (!key) return;
    let draft;
    try { draft = JSON.parse(localStorage.getItem(key) || 'null'); } catch { draft = null; }
    if (!draft || typeof draft !== 'object') return;
    $('#circularText').value = typeof draft.text === 'string' ? draft.text.slice(0, 1600) : '';
    const validIds = new Set(state.groups.map((group) => Number(group.id)));
    state.selectedGroupIds = new Set(
      (Array.isArray(draft.groupIds) ? draft.groupIds : []).map(toNumericId).filter((id) => id && validIds.has(id)),
    );
    state.manualGroupIds = new Set(state.selectedGroupIds);
    $('#detectedDate').value = normalizeDateForInput(draft.detectedDate);
    $('#circularSummary').value = typeof draft.summary === 'string' ? draft.summary.slice(0, 160) : '';
    $('#requiresAck').checked = Boolean(draft.requiresAcknowledgment);
    state.dateWasEdited = Boolean(draft.detectedDate);
    state.summaryWasEdited = Boolean(draft.summary);
    state.acknowledgmentWasEdited = Boolean(draft.acknowledgmentWasEdited);
    state.urgencyWasEdited = Boolean(draft.urgency);
    setUrgency(draft.urgency || 'normal', { userEdited: state.urgencyWasEdited });
    updateCharacterCount();
    renderSelectedTargets();
    if ($('#circularText').value.trim().length >= 3) scheduleTypeahead();
  }

  function clearComposer() {
    $('#composerForm').reset();
    state.selectedGroupIds = new Set();
    state.manualGroupIds = new Set();
    state.suggestedGroups = [];
    state.dismissedSuggestionIds = new Set();
    state.urgencyWasEdited = false;
    state.dateWasEdited = false;
    state.summaryWasEdited = false;
    state.acknowledgmentWasEdited = false;
    state.clientDetectedDate = '';
    setUrgency('normal', { userEdited: false });
    updateCharacterCount();
    renderSelectedTargets();
    $('#smartStatus').textContent = 'Start typing to analyze your notice';
    $('#aiModeBadge').textContent = 'Local';
    $('#draftStatus').textContent = 'Draft';
    const key = draftStorageKey();
    if (key) {
      try { localStorage.removeItem(key); } catch { /* storage is optional */ }
    }
  }

  function draftPayload() {
    const dateValue = $('#detectedDate').value;
    return {
      text: $('#circularText').value.trim(),
      targetGroupIds: [...state.selectedGroupIds].map(Number),
      detectedDate: dateValue ? dateValue.slice(0, 10) : null,
      urgency: state.urgency,
      summary: $('#circularSummary').value.trim(),
      requiresAcknowledgment: $('#requiresAck').checked,
    };
  }

  async function reviewCircular(event) {
    event.preventDefault();
    const text = $('#circularText').value.trim();
    setInlineError($('#composeError'));
    if (!text) {
      setInlineError($('#composeError'), 'Write the circular before reviewing it.');
      $('#circularText').focus();
      return;
    }
    if (!state.selectedGroupIds.size || !$('#circularSummary').value.trim()) {
      setBusy($('#reviewCircularButton'), true);
      await analyzeDraft({ force: true });
      setBusy($('#reviewCircularButton'), false);
    }
    if (!state.selectedGroupIds.size) {
      setInlineError($('#composeError'), 'Choose at least one audience group.');
      openAudiencePicker();
      return;
    }
    if (!$('#circularSummary').value.trim()) {
      $('#circularSummary').value = text.length > 157 ? `${text.slice(0, 157).trim()}…` : text;
    }
    renderReview();
    showDialog($('#reviewDialog'));
  }

  function renderReview() {
    const payload = draftPayload();
    const targets = payload.targetGroupIds.map(groupById).filter(Boolean);
    const meta = createElement('div', { className: 'detail-meta' }, [
      createElement('span', { className: `urgency-pill ${payload.urgency}`, text: urgencyLabel(payload.urgency) }),
      payload.detectedDate ? createElement('span', { text: formatDate(payload.detectedDate) }) : null,
      createElement('span', { text: payload.requiresAcknowledgment ? 'Acknowledgment required' : 'Read tracking only' }),
    ]);
    const chips = createElement('div', { className: 'chip-row' }, targets.map((group) =>
      createElement('span', { className: 'target-tag', text: group.name })));
    replaceContent($('#reviewContent'),
      createElement('div', { className: 'review-card' }, [
        createElement('h4', { text: payload.summary }),
        createElement('p', { text: payload.text }),
        createElement('div', { className: 'review-facts' }, [
          createElement('div', { className: 'review-fact' }, [
            createElement('span', { text: 'Priority' }),
            createElement('strong', { text: urgencyLabel(payload.urgency) }),
          ]),
          createElement('div', { className: 'review-fact' }, [
            createElement('span', { text: 'Event date' }),
            createElement('strong', { text: payload.detectedDate ? formatDate(payload.detectedDate) : 'None detected' }),
          ]),
          createElement('div', { className: 'review-fact' }, [
            createElement('span', { text: 'Accountability' }),
            createElement('strong', { text: payload.requiresAcknowledgment ? 'Acknowledgment required' : 'Read tracking' }),
          ]),
        ]),
      ]),
      meta,
      createElement('div', { className: 'review-audience tag-row' }, [
        createElement('small', { className: 'overline', text: 'Audience' }),
        chips,
      ]),
    );
  }

  async function sendCircular() {
    const button = $('#confirmSendButton');
    setBusy(button, true);
    try {
      const { circular, delivery } = await api('/api/circulars', {
        method: 'POST',
        body: draftPayload(),
      });
      closeDialog($('#reviewDialog'));
      clearComposer();
      await loadSentCirculars();
      setFacultyView('sent', { load: false });
      const audienceCount = Number(delivery?.audienceCount);
      toast(
        Number.isFinite(audienceCount)
          ? `Circular sent to ${audienceCount} recipient${audienceCount === 1 ? '' : 's'}.`
          : `${circular?.summary || 'Circular'} sent.`,
        'success',
      );
    } catch (error) {
      toast(errorMessage(error, 'Could not send the circular.'), 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function loadSentCirculars() {
    if (state.user?.role !== 'faculty') return [];
    const button = $('#refreshSentButton');
    setBusy(button, true);
    try {
      const { circulars } = await api('/api/circulars');
      if (!Array.isArray(circulars)) throw new ApiError('The sent-circular response was invalid.', 500);
      state.sentCirculars = circulars;
      renderSentCirculars();
      return circulars;
    } finally {
      setBusy(button, false);
    }
  }

  function statCard(value, label) {
    return createElement('div', {}, [
      createElement('strong', { className: 'stat-value', text: value }),
      createElement('span', { className: 'stat-label', text: label }),
    ]);
  }

  function circularStats(circular) {
    const stats = circular?.stats || {};
    const audience = Number(stats.audience) || 0;
    const read = Number(stats.read) || 0;
    const acknowledged = Number(stats.acknowledged) || 0;
    const pendingAcknowledgment = Number.isFinite(Number(stats.pendingAcknowledgment))
      ? Number(stats.pendingAcknowledgment)
      : Math.max(0, audience - acknowledged);
    return { audience, read, acknowledged, pendingAcknowledgment };
  }

  function renderSentCirculars() {
    const list = $('#sentCircularList');
    const totalAudience = state.sentCirculars.reduce((sum, circular) => sum + circularStats(circular).audience, 0);
    const totalRead = state.sentCirculars.reduce((sum, circular) => sum + circularStats(circular).read, 0);
    replaceContent($('#facultyStats'), [
      statCard(state.sentCirculars.length, 'Sent'),
      statCard(totalAudience, 'Delivered'),
      statCard(totalAudience ? `${Math.round((totalRead / totalAudience) * 100)}%` : '—', 'Read rate'),
    ]);
    if (!state.sentCirculars.length) {
      replaceContent(list, emptyState('Nothing sent yet', 'Your first circular will appear here with delivery tracking.', 'i-send'));
      return;
    }
    replaceContent(list, state.sentCirculars.map((circular) => {
      const stats = circularStats(circular);
      const targets = Array.isArray(circular.targets) ? circular.targets : [];
      const card = createElement('button', {
        className: `circular-card sent-notice ${stats.read < stats.audience ? 'has-pending' : ''}`,
        type: 'button',
        attrs: { 'aria-label': `Open delivery report for ${circular.summary || 'circular'}` },
      });
      card.addEventListener('click', () => openAnalytics(circular.id));
      appendChildren(card, [
        createElement('div', { className: 'card-top' }, [
          createElement('span', { className: `urgency-pill ${urgencyValue(circular.urgency)}`, text: urgencyLabel(circular.urgency) }),
          createElement('span', { className: 'card-time', text: formatCreatedAt(circular.createdAt) }),
        ]),
        createElement('h4', { text: circular.summary || circular.text }),
        createElement('p', { className: 'body-preview', text: circular.text }),
        createElement('div', { className: 'tag-row' }, targets.length
          ? targets.map((group) => createElement('span', { className: 'target-tag', text: group.name }))
          : createElement('span', { className: 'target-tag', text: 'Audience unavailable' })),
        createElement('div', { className: 'card-footer' }, [
          createElement('span', { text: `${stats.read}/${stats.audience} read` }),
          circular.requiresAcknowledgment
            ? createElement('span', { text: `${stats.acknowledged}/${stats.audience} acknowledged` })
            : createElement('span', { text: 'Read tracking' }),
          icon('i-chevron'),
        ]),
      ]);
      return card;
    }));
  }

  async function openAnalytics(circularId) {
    const id = toNumericId(circularId);
    if (!id) return;
    state.activeAnalyticsId = id;
    navigateTo('analyticsScreen');
    replaceContent($('#analyticsDetail'), loadingCards(3));
    await loadAnalytics();
  }

  async function loadAnalytics() {
    const id = state.activeAnalyticsId;
    if (!id) return;
    const button = $('#refreshAnalyticsButton');
    setBusy(button, true);
    try {
      const { circular } = await api(`/api/circulars/${id}/accountability`);
      if (!circular?.id) throw new ApiError('The delivery report response was invalid.', 500);
      renderAnalytics(circular);
    } catch (error) {
      replaceContent($('#analyticsDetail'), emptyState('Could not load the report', errorMessage(error), 'i-alert'));
    } finally {
      setBusy(button, false);
    }
  }

  function renderAnalytics(circular) {
    $('#analyticsTitle').textContent = 'Delivery report';
    const recipients = Array.isArray(circular.recipients) ? circular.recipients : [];
    const stats = circularStats(circular);
    const audience = stats.audience || recipients.length;
    const read = Number(circular.stats?.read) || recipients.filter((recipient) => recipient.readAt).length;
    const acknowledged = Number(circular.stats?.acknowledged) || recipients.filter((recipient) => recipient.acknowledgedAt).length;
    const readPercent = audience ? Math.round((read / audience) * 100) : 0;
    const targets = Array.isArray(circular.targets) ? circular.targets : [];
    const summary = createElement('section', { className: 'analytics-summary' }, [
      createElement('span', { className: `urgency-pill ${urgencyValue(circular.urgency)}`, text: urgencyLabel(circular.urgency) }),
      createElement('h3', { text: circular.summary || 'Circular delivery' }),
      createElement('p', { text: targets.map((group) => group.name).join(' · ') || 'Audience unavailable' }),
      createElement('small', { text: `Sent ${formatCreatedAt(circular.createdAt)}${circular.detectedDate ? ` · Event ${formatDate(circular.detectedDate)}` : ''}` }),
    ]);
    const statsGrid = createElement('div', { className: 'analytics-numbers' }, [
      statCard(`${read}/${audience}`, 'Read'),
      statCard(circular.requiresAcknowledgment ? `${acknowledged}/${audience}` : '—', 'Acknowledged'),
      statCard(`${Math.max(0, audience - read)}`, 'Unread'),
    ]);
    const progress = createElement('section', { className: 'progress-stack' }, [
      createElement('div', { className: 'progress-label' }, [
        createElement('strong', { text: 'Read progress' }),
        createElement('span', { text: `${readPercent}%` }),
      ]),
      createElement('div', { className: 'progress-track' },
        createElement('span', { className: 'progress-fill', attrs: { style: `width:${Math.min(100, Math.max(0, readPercent))}%` } })),
    ]);
    const recipientList = createElement('section', { className: 'roster-section' }, [
      createElement('h4', { text: 'Individual recipient status' }),
    ]);
    const list = createElement('div', { className: 'roster-list' });
    if (!recipients.length) {
      list.append(emptyState('No recipients', 'No student matched the selected groups when this circular was sent.', 'i-users'));
    } else {
      recipients.forEach((recipient) => {
        const status = recipient.acknowledgedAt ? 'Acknowledged' : recipient.readAt ? 'Read' : 'Unread';
        const statusClass = recipient.acknowledgedAt ? 'acknowledged' : recipient.readAt ? 'read' : 'unread';
        list.append(createElement('div', { className: 'roster-row' }, [
          createElement('span', { className: 'roster-person' }, [
            createElement('strong', { text: recipient.name }),
            createElement('small', { text: `${recipient.email} · ${yearLabel(recipient.year)}` }),
          ]),
          createElement('span', {
            className: `delivery-status ${statusClass === 'acknowledged' ? 'good' : statusClass === 'read' ? 'waiting' : 'muted'}`,
            text: status,
          }),
        ]));
      });
    }
    recipientList.append(list);
    replaceContent($('#analyticsDetail'), summary, statsGrid, progress, recipientList);
  }

  async function loadMemberships() {
    if (state.user?.role !== 'student') return [];
    const payload = await api('/api/memberships');
    const ids = Array.isArray(payload.groupIds)
      ? payload.groupIds
      : Array.isArray(payload.memberships)
        ? payload.memberships.map((membership) => membership.groupId ?? membership.id)
        : [];
    state.membershipIds = new Set(ids.map(toNumericId).filter(Boolean));
    if (!ids.length) {
      state.groups.filter((group) => group.isMember).forEach((group) => state.membershipIds.add(Number(group.id)));
    }
    renderStudentGroups();
    return [...state.membershipIds];
  }

  function renderStudentGroups() {
    const container = $('#studentGroupList');
    if (!container) return;
    const joinable = state.groups.filter((group) => group.joinable === true);
    if (!joinable.length) {
      replaceContent(container, emptyState('No optional groups', 'Your automatic year and college groups are already active.', 'i-users'));
      return;
    }
    replaceContent(container, joinable.map((group) => {
      const checkbox = createElement('input', {
        type: 'checkbox',
        value: group.id,
        name: 'groupIds',
        checked: state.membershipIds.has(Number(group.id)) || group.isMember === true,
      });
      return createElement('label', { className: 'membership-switch' }, [
        createElement('span', { className: 'group-monogram', text: group.icon || initials(group.name) }),
        createElement('span', { className: 'group-card-copy' }, [
          createElement('strong', { text: group.name }),
          createElement('small', { text: group.description || groupKindLabel(group.kind) }),
        ]),
        checkbox,
      ]);
    }));
  }

  async function submitMemberships(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const groupIds = $$('input[name="groupIds"]:checked', form).map((input) => Number(input.value));
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    try {
      const payload = await api('/api/memberships', { method: 'PUT', body: { groupIds } });
      const returnedIds = Array.isArray(payload.groupIds) ? payload.groupIds : groupIds;
      state.membershipIds = new Set(returnedIds.map(toNumericId).filter(Boolean));
      await Promise.allSettled([loadGroups(), loadInbox()]);
      renderStudentGroups();
      toast('Activity groups updated.', 'success');
    } catch (error) {
      toast(errorMessage(error, 'Could not save memberships.'), 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function inboxCacheKey() {
    return state.user?.id ? `campusrelay:inbox:${state.user.id}` : '';
  }

  function cacheInbox(circulars) {
    const key = inboxCacheKey();
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), circulars })); } catch { /* storage is optional */ }
  }

  function readCachedInbox() {
    const key = inboxCacheKey();
    if (!key) return null;
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return Array.isArray(value?.circulars) ? value.circulars : null;
    } catch {
      return null;
    }
  }

  async function loadInbox({ quiet = false } = {}) {
    if (state.user?.role !== 'student') return [];
    try {
      const { circulars } = await api('/api/inbox');
      if (!Array.isArray(circulars)) throw new ApiError('The inbox response was invalid.', 500);
      state.inbox = circulars;
      cacheInbox(circulars);
      renderInbox();
      return circulars;
    } catch (error) {
      if (!navigator.onLine) {
        const cached = readCachedInbox();
        if (cached) {
          state.inbox = cached;
          renderInbox();
          $('#inboxSubtitle').textContent = 'Offline · showing your last saved server inbox.';
          return cached;
        }
      }
      if (!quiet) replaceContent($('#inboxList'), emptyState('Could not load your inbox', errorMessage(error), 'i-alert'));
      throw error;
    }
  }

  function filteredInbox() {
    if (state.inboxFilter === 'unread') return state.inbox.filter((circular) => !circular.readAt);
    if (state.inboxFilter === 'urgent') return state.inbox.filter((circular) => urgencyValue(circular.urgency) === 'urgent');
    return state.inbox;
  }

  function updateUnreadBadges() {
    const unread = state.inbox.filter((circular) => !circular.readAt).length;
    ['#unreadBadge', '#bottomUnreadBadge'].forEach((selector) => {
      const badge = $(selector);
      if (!badge) return;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
    });
    $('#inboxSubtitle').textContent = unread
      ? `${unread} unread notice${unread === 1 ? '' : 's'} for your groups.`
      : 'You are caught up. Only notices for your groups appear here.';
  }

  function renderInbox() {
    const container = $('#inboxList');
    if (!container) return;
    updateUnreadBadges();
    const circulars = filteredInbox();
    if (!circulars.length) {
      const filtered = state.inboxFilter !== 'all';
      replaceContent(container, emptyState(
        filtered ? `No ${state.inboxFilter} notices` : 'Your inbox is clear',
        filtered ? 'Try another filter.' : 'New circulars for your memberships will appear here in realtime.',
        filtered ? 'i-check' : 'i-inbox',
      ));
      return;
    }
    replaceContent(container, circulars.map((circular) => {
      const targets = Array.isArray(circular.targets) ? circular.targets : [];
      const unread = !circular.readAt;
      const card = createElement('button', {
        className: `circular-card inbox-card ${unread ? 'is-unread' : 'is-read'}`,
        type: 'button',
        attrs: { 'aria-label': `${unread ? 'Unread: ' : ''}${circular.summary || 'Open circular'}` },
      });
      card.addEventListener('click', () => openNotice(circular.id));
      appendChildren(card, [
        createElement('div', { className: 'card-top' }, [
          createElement('span', { className: `urgency-pill ${urgencyValue(circular.urgency)}`, text: urgencyLabel(circular.urgency) }),
          createElement('span', { className: 'card-time', text: formatCreatedAt(circular.createdAt) }),
        ]),
        createElement('h4', { text: circular.summary || circular.text }),
        createElement('p', { className: 'body-preview', text: circular.text }),
        createElement('div', { className: 'tag-row' }, targets.length
          ? targets.map((group) => createElement('span', { className: 'target-tag', text: group.name }))
          : createElement('span', { className: 'target-tag', text: 'Your audience' })),
        createElement('div', { className: 'card-footer' }, [
          circular.detectedDate
            ? createElement('span', {}, [icon('i-calendar'), createElement('span', { text: formatDate(circular.detectedDate) })])
            : createElement('span', { text: circular.faculty?.name || 'Faculty' }),
          circular.acknowledgedAt
            ? createElement('span', { className: 'ack-state complete', text: 'Acknowledged' })
            : circular.requiresAcknowledgment
              ? createElement('span', { className: 'ack-state required', text: 'Action required' })
              : unread ? createElement('span', { className: 'unread-label', text: 'New' }) : null,
          icon('i-chevron'),
        ]),
      ]);
      return card;
    }));
  }

  function setInboxFilter(filter) {
    state.inboxFilter = ['all', 'unread', 'urgent'].includes(filter) ? filter : 'all';
    $$('#inboxFilters [data-filter]').forEach((button) => {
      const active = button.dataset.filter === state.inboxFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderInbox();
  }

  async function openNotice(circularId) {
    const id = toNumericId(circularId);
    const circular = state.inbox.find((item) => idsEqual(item.id, id));
    if (!id || !circular) return;
    state.activeNotice = circular;
    renderNoticeDetail();
    navigateTo('noticeScreen');
    if (!circular.readAt) {
      try {
        const { status } = await api(`/api/circulars/${id}/read`, { method: 'POST' });
        circular.readAt = status?.readAt || new Date().toISOString();
        if (status?.acknowledgedAt) circular.acknowledgedAt = status.acknowledgedAt;
        state.activeNotice = circular;
        cacheInbox(state.inbox);
        renderNoticeDetail();
        renderInbox();
      } catch (error) {
        toast(errorMessage(error, 'The notice opened, but read status was not saved.'), 'error');
      }
    }
  }

  function renderNoticeDetail() {
    const circular = state.activeNotice;
    const container = $('#noticeDetail');
    if (!circular || !container) return;
    const targets = Array.isArray(circular.targets) ? circular.targets : [];
    const title = createElement('h1', { id: 'noticeTitle', text: circular.summary || 'Official circular' });
    const hero = createElement('section', { className: 'detail-hero' }, [
      createElement('div', { className: 'card-top' }, [
        createElement('span', { className: `urgency-pill ${urgencyValue(circular.urgency)}`, text: urgencyLabel(circular.urgency) }),
        createElement('span', { className: 'card-time', text: formatCreatedAt(circular.createdAt) }),
      ]),
      title,
      createElement('div', { className: 'detail-meta' }, [
        createElement('span', { text: `From ${circular.faculty?.name || 'Faculty'}` }),
        createElement('span', { text: targets.map((group) => group.name).join(' · ') || 'Your group' }),
      ]),
    ]);
    const body = createElement('p', { className: 'notice-body', text: circular.text });
    const statusCards = [];
    if (circular.detectedDate) {
      statusCards.push(createElement('div', { className: 'event-card' }, [
        icon('i-calendar'),
        createElement('span', {}, [
          createElement('strong', { text: formatDate(circular.detectedDate) }),
          createElement('small', { text: 'Event date · calendar export available' }),
        ]),
      ]));
    }
    if (circular.acknowledgedAt) {
      statusCards.push(createElement('div', { className: 'acknowledged-card' }, [
        icon('i-check'),
        createElement('span', {}, [
          createElement('strong', { text: 'Acknowledgment recorded' }),
          createElement('small', { text: formatCreatedAt(circular.acknowledgedAt) }),
        ]),
      ]));
    }
    const actions = createElement('div', { className: 'detail-actions' });
    const downloadButton = createElement('button', { className: 'secondary-button', type: 'button' }, [icon('i-download'), ' Download .txt']);
    downloadButton.addEventListener('click', () => downloadCircular(circular.id, 'txt'));
    actions.append(downloadButton);
    if (circular.detectedDate) {
      const calendarButton = createElement('button', { className: 'secondary-button', type: 'button' }, [icon('i-calendar'), ' Add to calendar']);
      calendarButton.addEventListener('click', () => downloadCircular(circular.id, 'ics'));
      actions.append(calendarButton);
    }
    replaceContent(container, hero, body, statusCards, actions);
    const acknowledgmentBar = $('#acknowledgmentBar');
    acknowledgmentBar.classList.toggle('hidden', !circular.requiresAcknowledgment || Boolean(circular.acknowledgedAt));
    const acknowledgeButton = $('#acknowledgeButton');
    acknowledgeButton.disabled = Boolean(circular.acknowledgedAt);
  }

  async function acknowledgeNotice() {
    const circular = state.activeNotice;
    if (!circular?.id || circular.acknowledgedAt) return;
    const button = $('#acknowledgeButton');
    setBusy(button, true);
    try {
      const { status } = await api(`/api/circulars/${Number(circular.id)}/ack`, { method: 'POST' });
      circular.readAt = status?.readAt || circular.readAt || new Date().toISOString();
      circular.acknowledgedAt = status?.acknowledgedAt || new Date().toISOString();
      const inboxCircular = state.inbox.find((item) => idsEqual(item.id, circular.id));
      if (inboxCircular) Object.assign(inboxCircular, {
        readAt: circular.readAt,
        acknowledgedAt: circular.acknowledgedAt,
      });
      cacheInbox(state.inbox);
      renderNoticeDetail();
      renderInbox();
      toast('Acknowledgment recorded.', 'success');
    } catch (error) {
      toast(errorMessage(error, 'Could not record acknowledgment.'), 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function downloadCircular(circularId, format = 'txt') {
    const id = toNumericId(circularId);
    if (!id) return;
    const extension = format === 'ics' ? 'ics' : 'txt';
    const path = extension === 'ics'
      ? `/api/circulars/${id}/calendar.ics`
      : `/api/circulars/${id}/download.txt`;
    try {
      const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: extension === 'ics' ? 'text/calendar' : 'text/plain' } });
      if (!response.ok) {
        let payload = null;
        try { payload = await response.json(); } catch { /* response may not be JSON */ }
        throw new ApiError(payload?.error?.message || 'Download failed.', response.status, payload?.error?.code);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      let filename = `campusrelay-circular-${id}.${extension}`;
      try { filename = encodedName ? decodeURIComponent(encodedName) : plainName || filename; } catch { /* use safe fallback */ }
      filename = filename.replace(/[\\/:*?"<>|]/g, '-');
      const url = URL.createObjectURL(blob);
      const link = createElement('a', { attrs: { href: url, download: filename } });
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(extension === 'ics' ? 'Calendar file downloaded.' : 'Circular downloaded.', 'success');
    } catch (error) {
      toast(errorMessage(error, 'Download failed.'), 'error');
    }
  }

  function updateOnlineStatus() {
    const offline = !navigator.onLine;
    $('#offlineBanner')?.classList.toggle('hidden', !offline);
    if (offline) $('#realtimeStatus').textContent = 'Offline · changes will need a connection';
    else if (!state.socket?.connected) $('#realtimeStatus').textContent = 'Connecting realtime…';
    if (!offline && state.user?.role === 'student') loadInbox({ quiet: true }).catch(() => {});
  }

  function connectRealtime() {
    if (state.socket) state.socket.disconnect();
    if (typeof window.io !== 'function' || !state.user) {
      $('#realtimeStatus').textContent = 'Realtime unavailable';
      return;
    }
    const socket = window.io({ transports: ['websocket', 'polling'] });
    state.socket = socket;
    socket.on('connect', () => { $('#realtimeStatus').textContent = 'Realtime connected'; });
    socket.on('disconnect', () => { $('#realtimeStatus').textContent = navigator.onLine ? 'Realtime reconnecting…' : 'Offline'; });
    socket.on('connect_error', () => { $('#realtimeStatus').textContent = 'Realtime reconnecting…'; });
    socket.on('circular:new', () => {
      if (state.user?.role !== 'student') return;
      if (state.socketRefreshTimer) window.clearTimeout(state.socketRefreshTimer);
      state.socketRefreshTimer = window.setTimeout(async () => {
        const before = new Set(state.inbox.map((item) => Number(item.id)));
        try {
          await loadInbox({ quiet: true });
          const arrived = state.inbox.some((item) => !before.has(Number(item.id)));
          if (arrived) toast('A new circular just arrived.', 'success');
        } catch { /* reconnect will retry */ }
      }, 120);
    });
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  function updatePushUI() {
    const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    let label = 'Turn on delivery while the app is closed';
    if (!supported) label = 'Notifications are not supported in this browser';
    else if (Notification.permission === 'granted') label = 'Browser notifications are enabled';
    else if (Notification.permission === 'denied') label = 'Notifications are blocked in browser settings';
    $('#pushPermissionLabel').textContent = label;
    const enableButton = $('#enablePushButton');
    if (enableButton) {
      enableButton.classList.toggle('enabled', supported && Notification.permission === 'granted');
      enableButton.title = label;
    }
  }

  async function enablePushNotifications() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast('This browser does not support push notifications.', 'error');
      return;
    }
    if (!window.isSecureContext) {
      toast('Push notifications require HTTPS or localhost.', 'error');
      return;
    }
    if (Notification.permission === 'denied') {
      toast('Notifications are blocked. Allow them in your browser’s site settings.', 'error');
      updatePushUI();
      return;
    }
    const buttons = [$('#enablePushButton'), $('#accountPushButton')].filter(Boolean);
    buttons.forEach((button) => setBusy(button, true));
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        updatePushUI();
        toast('Notification permission was not granted.', 'info');
        return;
      }
      const registration = state.serviceWorkerRegistration || await navigator.serviceWorker.ready;
      const { publicKey } = await api('/api/push/key');
      if (!publicKey) throw new ApiError('Push delivery is not configured on this server.', 503, 'PUSH_NOT_CONFIGURED');
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      await api('/api/push/subscribe', {
        method: 'POST',
        body: { subscription: subscription.toJSON() },
      });
      updatePushUI();
      toast('Browser notifications are on.', 'success');
    } catch (error) {
      toast(errorMessage(error, 'Could not enable notifications.'), 'error');
      updatePushUI();
    } finally {
      buttons.forEach((button) => setBusy(button, false));
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      state.serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js');
    } catch {
      state.serviceWorkerRegistration = null;
    }
  }

  function applyTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = selected;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = selected === 'dark' ? '#07111f' : '#f4f7fb';
    try { localStorage.setItem('campusrelay:theme', selected); } catch { /* storage is optional */ }
  }

  function initializeTheme() {
    let saved = '';
    try { saved = localStorage.getItem('campusrelay:theme') || ''; } catch { /* storage is optional */ }
    applyTheme(saved || 'dark');
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    toast(`${document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark'} theme enabled.`, 'success');
  }

  function revealInstallButtons(show) {
    $$('[data-install-app]').forEach((button) => button.classList.toggle('hidden', !show));
  }

  async function installApp() {
    if (!state.deferredInstallPrompt) {
      toast('Use your browser menu to install CampusRelay.', 'info');
      return;
    }
    state.deferredInstallPrompt.prompt();
    const choice = await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    revealInstallButtons(false);
    if (choice?.outcome === 'accepted') toast('CampusRelay installation started.', 'success');
  }

  function bindEvents() {
    $$('[data-enter-role]').forEach((button) => button.addEventListener('click', () => {
      setAuthRole(button.dataset.enterRole);
      navigateTo('authScreen');
      loadGroups({ publicRequest: true }).catch(() => renderRegisterActivities());
    }));
    $$('[data-back]').forEach((button) => button.addEventListener('click', goBack));
    $('.wordmark')?.addEventListener('click', (event) => {
      event.preventDefault();
      if (!state.user) resetNavigation('landingScreen');
    });
    $('#loginForm').addEventListener('submit', submitLogin);
    $('#demoLoginButton').addEventListener('click', quickDemoLogin);
    $('#showRegisterButton').addEventListener('click', showRegisterPanel);
    $('#backToLoginButton').addEventListener('click', showLoginPanel);
    $('#registerPanel').addEventListener('submit', submitRegistration);
    $$('[data-logout]').forEach((button) => button.addEventListener('click', logout));

    $$('[data-faculty-view]').forEach((button) => button.addEventListener('click', () => setFacultyView(button.dataset.facultyView)));
    $$('[data-student-view]').forEach((button) => button.addEventListener('click', () => setStudentView(button.dataset.studentView)));
    $('#refreshSentButton').addEventListener('click', () => loadSentCirculars().catch((error) => toast(errorMessage(error), 'error')));
    $('#refreshAnalyticsButton').addEventListener('click', loadAnalytics);

    $('#circularText').addEventListener('input', handleCircularInput);
    $('#circularSummary').addEventListener('input', () => { state.summaryWasEdited = true; saveDraft(); });
    $('#detectedDate').addEventListener('input', () => { state.dateWasEdited = true; saveDraft(); });
    $('#requiresAck').addEventListener('change', () => {
      state.acknowledgmentWasEdited = true;
      saveDraft();
    });
    $$('#urgencyControl [data-urgency]').forEach((button) => button.addEventListener('click', () => setUrgency(button.dataset.urgency)));
    $('#composerForm').addEventListener('submit', reviewCircular);
    $('#openAudienceButton').addEventListener('click', openAudiencePicker);
    $('#audienceSearch').addEventListener('input', renderAudienceOptions);
    $('#applyAudienceButton').addEventListener('click', applyAudiencePicker);
    $('#closeReviewButton').addEventListener('click', () => closeDialog($('#reviewDialog')));
    $('#editDraftButton').addEventListener('click', () => closeDialog($('#reviewDialog')));
    $('#confirmSendButton').addEventListener('click', sendCircular);

    $('#createGroupButton').addEventListener('click', () => {
      setInlineError($('#createGroupError'));
      showDialog($('#createGroupDialog'));
    });
    $('#createGroupForm').addEventListener('submit', submitCreateGroup);
    $('#membersForm').addEventListener('submit', submitMembers);
    $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.closeDialog))));
    $$('.sheet-dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    }));

    $('#membershipForm').addEventListener('submit', submitMemberships);
    $$('#inboxFilters [data-filter]').forEach((button) => button.addEventListener('click', () => setInboxFilter(button.dataset.filter)));
    $('#acknowledgeButton').addEventListener('click', acknowledgeNotice);
    $('#detailDownloadButton').addEventListener('click', () => {
      if (state.activeNotice?.id) downloadCircular(state.activeNotice.id, 'txt');
    });
    $('#enablePushButton').addEventListener('click', enablePushNotifications);
    $('#accountPushButton').addEventListener('click', enablePushNotifications);

    $('#landingThemeButton').addEventListener('click', toggleTheme);
    $$('[data-theme-toggle]').forEach((button) => button.addEventListener('click', toggleTheme));
    $$('[data-install-app]').forEach((button) => button.addEventListener('click', installApp));
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      revealInstallButtons(true);
    });
    window.addEventListener('appinstalled', () => {
      state.deferredInstallPrompt = null;
      revealInstallButtons(false);
      toast('CampusRelay is installed.', 'success');
    });
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine && state.user?.role === 'student') loadInbox({ quiet: true }).catch(() => {});
    });
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    initializeTheme();
    bindEvents();
    updateCharacterCount();
    setUrgency('normal', { userEdited: false });
    renderSelectedTargets();
    updateOnlineStatus();
    updatePushUI();
    registerServiceWorker();
    await restoreSession();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
