// ============================================================
// Spaced Repetition – shared.js
// GitHub Repo persistence, SM-2 algorithm, toast, modals
// ============================================================

// --- Toast Notifications ---

function showToast(message, type) {
  type = type || 'success';
  var container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(function () { toast.remove(); }, 300);
  }, 3000);
}

// --- GitHub Repo Settings ---

function getGhToken() {
  return localStorage.getItem('sr_gh_token') || '';
}

function getRepoOwner() {
  return localStorage.getItem('sr_repo_owner') || '';
}

function getRepoName() {
  return localStorage.getItem('sr_repo_name') || '';
}

function getRepoBranch() {
  return localStorage.getItem('sr_repo_branch') || 'main';
}

function getRepoPath() {
  return localStorage.getItem('sr_repo_path') || 'spaced_repetition_data.json';
}

function isConfigured() {
  return !!(getGhToken() && getRepoOwner() && getRepoName());
}

function toggleSettingsModal() {
  var modal = document.getElementById('settingsModal');
  if (modal.classList.contains('hidden')) {
    document.getElementById('ghTokenInput').value = getGhToken();
    document.getElementById('repoOwnerInput').value = getRepoOwner();
    document.getElementById('repoNameInput').value = getRepoName();
    document.getElementById('repoBranchInput').value = getRepoBranch();
    document.getElementById('repoPathInput').value = getRepoPath();
    modal.classList.remove('hidden');
    document.getElementById('ghTokenInput').focus();
  } else {
    modal.classList.add('hidden');
  }
}

function toggleTokenVisibility() {
  var input = document.getElementById('ghTokenInput');
  var btn = document.getElementById('toggleVisBtn');
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '&#x1F648;';
  } else {
    input.type = 'password';
    btn.innerHTML = '&#x1F441;';
  }
}

function saveSettings() {
  var fields = {
    sr_gh_token: document.getElementById('ghTokenInput').value.trim(),
    sr_repo_owner: document.getElementById('repoOwnerInput').value.trim(),
    sr_repo_name: document.getElementById('repoNameInput').value.trim(),
    sr_repo_branch: document.getElementById('repoBranchInput').value.trim() || 'main',
    sr_repo_path: document.getElementById('repoPathInput').value.trim() || 'spaced_repetition_data.json'
  };

  Object.keys(fields).forEach(function (key) {
    if (fields[key]) {
      localStorage.setItem(key, fields[key]);
    } else {
      localStorage.removeItem(key);
    }
  });

  // Reset cached SHA since settings changed
  _fileSha = null;

  toggleSettingsModal();
  if (typeof updateBanner === 'function') updateBanner();
  if (typeof onSettingsChanged === 'function') onSettingsChanged();
  showToast('Settings saved', 'success');
}

function clearSettings() {
  ['sr_gh_token', 'sr_repo_owner', 'sr_repo_name', 'sr_repo_branch', 'sr_repo_path'].forEach(function (k) {
    localStorage.removeItem(k);
  });
  document.getElementById('ghTokenInput').value = '';
  document.getElementById('repoOwnerInput').value = '';
  document.getElementById('repoNameInput').value = '';
  document.getElementById('repoBranchInput').value = '';
  document.getElementById('repoPathInput').value = '';
  _fileSha = null;
  toggleSettingsModal();
  if (typeof updateBanner === 'function') updateBanner();
  if (typeof onSettingsChanged === 'function') onSettingsChanged();
  showToast('Settings cleared', 'success');
}

// --- GitHub Contents API ---

var _fileSha = null; // tracks current file SHA for updates

function ghApi(method, path, body) {
  var token = getGhToken();
  if (!token) return Promise.reject(new Error('No GitHub token configured'));

  var headers = {
    'Authorization': 'token ' + token,
    'Accept': 'application/vnd.github.v3+json'
  };
  var opts = { method: method, headers: headers };

  if (body) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  return fetch('https://api.github.com' + path, opts).then(function (res) {
    if (res.status === 404) {
      return null; // file doesn't exist yet
    }
    return res.json().then(function (data) {
      if (!res.ok) {
        throw new Error(data.message || 'GitHub API error ' + res.status);
      }
      return data;
    });
  });
}

// Load deck data from repo file
function loadDeck() {
  if (!isConfigured()) return Promise.reject(new Error('GitHub repo not configured'));

  var owner = getRepoOwner();
  var repo = getRepoName();
  var branch = getRepoBranch();
  var path = getRepoPath();

  return ghApi('GET', '/repos/' + owner + '/' + repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch)).then(function (data) {
    if (!data) {
      // File doesn't exist yet
      _fileSha = null;
      return { cards: [] };
    }
    _fileSha = data.sha;
    try {
      var content = atob(data.content.replace(/\n/g, ''));
      return JSON.parse(content);
    } catch (e) {
      return { cards: [] };
    }
  });
}

// Save deck data to repo file
function saveDeck(data) {
  if (!isConfigured()) return Promise.reject(new Error('GitHub repo not configured'));

  var owner = getRepoOwner();
  var repo = getRepoName();
  var branch = getRepoBranch();
  var path = getRepoPath();

  var body = {
    message: 'Update spaced repetition data',
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    branch: branch
  };

  // Include SHA if updating an existing file
  if (_fileSha) {
    body.sha = _fileSha;
  }

  return ghApi('PUT', '/repos/' + owner + '/' + repo + '/contents/' + path, body).then(function (result) {
    if (result && result.content) {
      _fileSha = result.content.sha;
    }
    return result;
  });
}

// --- Card helpers ---

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function createCard(front, back, tags) {
  return {
    id: generateId(),
    front: front,
    back: back,
    tags: tags || [],
    created: new Date().toISOString(),
    // SM-2 fields
    interval: 0,       // days until next review
    repetitions: 0,    // successful consecutive reviews
    easeFactor: 2.5,   // ease factor
    due: new Date().toISOString(), // next review date
    lastReview: null
  };
}

// --- SM-2 Algorithm ---
// quality: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy

function sm2(card, quality) {
  var ef = card.easeFactor;
  var interval = card.interval;
  var reps = card.repetitions;

  if (quality < 1) {
    // Again — reset
    reps = 0;
    interval = 0;
  } else {
    if (reps === 0) {
      interval = 1;
    } else if (reps === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * ef);
    }
    reps += 1;
  }

  // Adjust ease factor
  // quality mapped: 0->0, 1->2, 2->3, 3->5 for SM-2 formula
  var q = [0, 2, 3, 5][quality];
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < 1.3) ef = 1.3;

  // Apply multipliers for hard/easy
  if (quality === 1) {
    interval = Math.max(1, Math.round(interval * 0.7));
  } else if (quality === 3) {
    interval = Math.round(interval * 1.3);
  }

  var now = new Date();
  var due = new Date(now);
  if (interval === 0) {
    // Again — due in 1 minute (for same-session re-review), but store as today
    due = now;
  } else {
    due.setDate(due.getDate() + interval);
  }

  return {
    interval: interval,
    repetitions: reps,
    easeFactor: Math.round(ef * 100) / 100,
    due: due.toISOString(),
    lastReview: now.toISOString()
  };
}

function formatInterval(days) {
  if (days === 0) return '< 1 min';
  if (days === 1) return '1 day';
  if (days < 30) return days + ' days';
  if (days < 365) return Math.round(days / 30) + ' mo';
  return (days / 365).toFixed(1) + ' yr';
}

// Preview what intervals each rating would produce
function previewIntervals(card) {
  var results = [];
  for (var q = 0; q <= 3; q++) {
    results.push(sm2(card, q).interval);
  }
  return results;
}

// --- Due cards logic ---

function isDue(card) {
  return new Date(card.due) <= new Date();
}

function isNew(card) {
  return card.repetitions === 0 && card.lastReview === null;
}

function getDueCards(cards, tagFilter) {
  return cards.filter(function (c) {
    if (tagFilter && tagFilter.length > 0) {
      var hasTag = tagFilter.some(function (t) { return c.tags.indexOf(t) >= 0; });
      if (!hasTag) return false;
    }
    return isDue(c);
  });
}

function getAllTags(cards) {
  var tagSet = {};
  cards.forEach(function (c) {
    (c.tags || []).forEach(function (t) { tagSet[t] = true; });
  });
  return Object.keys(tagSet).sort();
}

// --- Render markdown ---

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text || '');
  }
  // Fallback: escape HTML and convert newlines
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// --- Keyboard shortcut to close modals ---
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var modal = document.getElementById('settingsModal');
    if (modal && !modal.classList.contains('hidden')) {
      toggleSettingsModal();
    }
  }
});
