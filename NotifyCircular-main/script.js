const groups = [
  { id: 'first-year', title: 'First Year', description: 'Circulars for first year students', icon: '1️⃣', messages: [], updated: 0, badge: 0 },
  { id: 'second-year', title: 'Second Year', description: 'Circulars for second year students', icon: '2️⃣', messages: [], updated: 0, badge: 0 },
  { id: 'third-year', title: 'Third Year', description: 'Circulars for third year students', icon: '3️⃣', messages: [], updated: 0, badge: 0 },
  { id: 'final-year', title: 'Final Year', description: 'Circulars for final year students', icon: '4️⃣', messages: [], updated: 0, badge: 0 },
  { id: 'sports', title: 'Sports Group', description: 'Sports teams and activities', icon: '🏅', messages: [], updated: 0, badge: 0 },
  { id: 'faculty', title: 'Faculty Group', description: 'Faculty and staff notices', icon: '👩‍🏫', messages: [], updated: 0, badge: 0 },
  { id: 'whole-college', title: 'Whole College', description: 'All students and staff', icon: '🏫', messages: [], updated: 0, badge: 0 },
];

let currentStudent = null;
let currentGroupId = null;
let lastPageStack = [];

function showPage(pageId) {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.add('hidden');
  });
  const page = document.getElementById(pageId);
  if (page) {
    page.classList.remove('hidden');
    lastPageStack.push(pageId);
  }
  if (pageId === 'studentScreen' && currentStudent) {
    document.getElementById('studentLoginCard').classList.add('hidden');
    document.getElementById('studentGroupsCard').classList.remove('hidden');
    document.getElementById('studentMessagesCard').classList.remove('hidden');
    renderStudentGroups();
  }
}

function goBack() {
  lastPageStack.pop();
  const previous = lastPageStack.pop() || 'startScreen';
  showPage(previous);
}

function renderFacultyGroups() {
  const container = document.getElementById('facultyGroupChips');
  container.innerHTML = '';
  groups.forEach((group) => {
    const chip = document.createElement('div');
    chip.className = 'group-chip';
    chip.innerHTML = `<span>${group.icon} ${group.title}</span><span>${group.badge ? group.badge : ''}</span>`;
    container.appendChild(chip);
  });
}

function getKeywords(message) {
  const text = message.toLowerCase();
  const keywords = {
    'first-year': ['first year', '1st year', '1st-year', 'year 1', 'freshmen', 'fy'],
    'second-year': ['second year', '2nd year', '2nd-year', 'year 2', 'sophomore'],
    'third-year': ['third year', '3rd year', '3rd-year', 'year 3', 'junior'],
    'final-year': ['final year', 'fourth year', '4th year', '4th-year', 'final-year', 'senior', 'last year'],
    'faculty': ['faculty', 'teacher', 'staff', 'professor', 'lecturer', 'admin'],
    'sports': ['sports', 'football', 'cricket', 'basketball', 'volleyball', 'athletics', 'kabaddi', 'tournament', 'match', 'game', 'sports day'],
    'whole-college': ['whole college', 'college wide', 'all students', 'everyone', 'general circular', 'all staff', 'entire college'],
  };

  const found = new Set();
  Object.entries(keywords).forEach(([groupId, phrases]) => {
    phrases.forEach((phrase) => {
      if (text.includes(phrase)) {
        found.add(groupId);
      }
    });
  });
  return Array.from(found);
}

function detectDate(message) {
  const datePattern = /\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{1,2}\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*\d{2,4})?)\b/i;
  const match = message.match(datePattern);
  return match ? match[0] : null;
}

function sendCircular() {
  const message = document.getElementById('facultyMessage').value.trim();
  const resultDiv = document.getElementById('analysisResult');
  if (!message) {
    resultDiv.textContent = 'Please type a circular message before sending.';
    resultDiv.style.color = 'var(--error)';
    return;
  }

  const targets = getKeywords(message);
  if (targets.length === 0) {
    targets.push('whole-college');
  }

  const dateText = detectDate(message);
  const now = Date.now();
  const messageRecord = {
    text: message,
    sentAt: new Date().toLocaleString(),
    dateText,
  };

  targets.forEach((target) => {
    const group = groups.find((g) => g.id === target);
    if (group) {
      group.messages.unshift(messageRecord);
      group.updated = now;
      group.badge += 1;
    }
  });

  if (dateText) {
    document.getElementById('eventReminder').textContent = `Reminder scheduled for event date: ${dateText}. Students and faculty in matched groups will see the notice.`;
  } else {
    document.getElementById('eventReminder').textContent = 'Message has no date, but it was routed to the matched groups.';
  }

  renderFacultyGroups();
  renderStudentGroups();

  resultDiv.innerHTML = `Circular sent to: <strong>${targets.map((id) => groups.find((g) => g.id === id).title).join(', ')}</strong>.`;
  resultDiv.style.color = 'var(--success)';
  document.getElementById('facultyMessage').value = '';
}

function addGroup() {
  const input = document.getElementById('newGroupName');
  const name = input.value.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (groups.some((group) => group.id === id)) {
    alert('This group already exists.');
    return;
  }
  groups.push({ id, title: name, description: 'Custom group created by faculty', icon: '➕', messages: [], updated: 0, badge: 0 });
  input.value = '';
  renderFacultyGroups();
  renderStudentGroups();
}

function loginStudent() {
  const name = document.getElementById('studentName').value.trim();
  const email = document.getElementById('studentEmail').value.trim();
  if (!name || !email) {
    alert('Enter your student name and email.');
    return;
  }
  currentStudent = { name, email };
  document.getElementById('studentLoginCard').classList.add('hidden');
  document.getElementById('studentGroupsCard').classList.remove('hidden');
  document.getElementById('studentMessagesCard').classList.remove('hidden');
  renderStudentGroups();
}

function renderStudentGroups() {
  const list = document.getElementById('studentGroupList');
  list.innerHTML = '';
  const status = document.getElementById('studentStatus');
  if (!currentStudent) {
    status.textContent = 'Login to see your groups and new messages.';
    return;
  }
  status.textContent = `Welcome, ${currentStudent.name}. Your groups appear below, ordered by newest circular.`;

  const sorted = [...groups].sort((a, b) => b.updated - a.updated);
  sorted.forEach((group) => {
    if (group.updated === 0) return;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'group-card';
    card.onclick = () => openGroup(group.id);
    card.innerHTML = `
      <div>
        <h3>${group.icon} ${group.title}</h3>
        <p>${group.description}</p>
      </div>
      <div>${group.badge ? `<span class="badge">${group.badge}</span>` : ''}</div>
    `;
    list.appendChild(card);
  });

  if (!list.hasChildNodes()) {
    list.innerHTML = '<div class="analysis-result">No circulars have arrived yet. Waiting for faculty messages.</div>';
  }
}

function openGroup(groupId) {
  currentGroupId = groupId;
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  group.badge = 0;
  renderStudentGroups();

  const chatList = document.getElementById('studentChatList');
  chatList.innerHTML = `<div class="section-title">${group.icon} ${group.title}</div>`;
  if (group.messages.length === 0) {
    chatList.innerHTML += '<div class="analysis-result">No messages in this group yet.</div>';
    return;
  }
  group.messages.forEach((message) => {
    const card = document.createElement('div');
    card.className = 'message-card';
    card.innerHTML = `
      <h4>${group.title} circular</h4>
      <p>${message.text}</p>
      <div class="message-footer">
        <span>${message.sentAt}</span>
        <button class="secondary-btn" onclick="downloadMessage('${groupId}', ${group.messages.indexOf(message)})">Download</button>
      </div>
    `;
    chatList.appendChild(card);
  });
}

function downloadMessage(groupId, messageIndex) {
  const group = groups.find((g) => g.id === groupId);
  const message = group.messages[messageIndex];
  if (!message) return;
  const element = document.createElement('a');
  const file = new Blob([`Group: ${group.title}\nSent: ${message.sentAt}\n\n${message.text}`], { type: 'text/plain' });
  element.href = URL.createObjectURL(file);
  element.download = `${group.title.replace(/\s+/g, '_')}_circular.txt`;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

renderFacultyGroups();
showPage('startScreen');
