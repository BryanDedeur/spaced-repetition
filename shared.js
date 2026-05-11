// ============================================================
// Spaced Repetition – shared.js
// GitHub Repo persistence, SM-2+ algorithm with learning steps,
// session builder, durable batched save, toast, modals.
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

  // Reset cached SHAs since settings changed
  _fileSha = null;
  _sketchShas = {};

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
  _sketchShas = {};
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
        var err = new Error(data.message || 'GitHub API error ' + res.status);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    });
  });
}

// --- Pending-changes backup (durability across crashes / network failures) ---
// Mirror in-flight ratings to localStorage so we never lose data even if a
// debounced save dies, the tab is force-closed before flush, or sendBeacon
// can't carry auth headers. On loadDeck we merge any pending overlay back in.

function _pendingKey() {
  return 'sr_pending_' + getRepoOwner() + '/' + getRepoName() + '/' + getRepoBranch() + '/' + getRepoPath();
}

function _writePending(data) {
  try { localStorage.setItem(_pendingKey(), JSON.stringify(data)); } catch (e) { /* quota */ }
}

function _readPending() {
  try {
    var raw = localStorage.getItem(_pendingKey());
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _clearPending() {
  try { localStorage.removeItem(_pendingKey()); } catch (e) {}
}

// Merge two decks by card id; prefer whichever side has the later lastReview.
// Meta is union-with-local-wins because meta carries this-tab's daily counters.
function mergeDecks(local, remote) {
  local = local || { cards: [] };
  remote = remote || { cards: [] };
  var byId = {};
  (remote.cards || []).forEach(function (c) { byId[c.id] = c; });
  (local.cards || []).forEach(function (c) {
    var existing = byId[c.id];
    if (!existing) { byId[c.id] = c; return; }
    var lr = c.lastReview ? new Date(c.lastReview).getTime() : 0;
    var er = existing.lastReview ? new Date(existing.lastReview).getTime() : 0;
    byId[c.id] = lr >= er ? c : existing;
  });
  var merged = {
    cards: Object.keys(byId).map(function (k) { return byId[k]; }),
    meta: Object.assign({}, remote.meta || {}, local.meta || {})
  };
  return merged;
}

// Load deck data from repo file
function loadDeck() {
  if (!isConfigured()) return Promise.reject(new Error('GitHub repo not configured'));

  var owner = getRepoOwner();
  var repo = getRepoName();
  var branch = getRepoBranch();
  var path = getRepoPath();

  return ghApi('GET', '/repos/' + owner + '/' + repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch)).then(function (data) {
    var remote;
    if (!data) {
      _fileSha = null;
      remote = { cards: [] };
    } else {
      _fileSha = data.sha;
      try {
        var content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
        remote = JSON.parse(content);
      } catch (e) {
        remote = { cards: [] };
      }
    }
    if (!remote.cards) remote.cards = [];

    // Replay any pending local changes the last session never flushed.
    // We use scheduleSave (rather than flushing inline) so that the 409
    // retry path can't recurse back through loadDeck during this call.
    var pending = _readPending();
    if (pending && pending.cards) {
      var merged = mergeDecks(pending, remote);
      scheduleSave(merged);
      return merged;
    }
    return remote;
  });
}

// Save deck data to repo file. On 409 conflict, fetch latest, merge, retry.
function saveDeck(data, _retries) {
  if (!isConfigured()) return Promise.reject(new Error('GitHub repo not configured'));
  if (_retries == null) _retries = 2;

  var owner = getRepoOwner();
  var repo = getRepoName();
  var branch = getRepoBranch();
  var path = getRepoPath();

  var body = {
    message: 'Update spaced repetition data',
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    branch: branch
  };

  if (_fileSha) body.sha = _fileSha;

  return ghApi('PUT', '/repos/' + owner + '/' + repo + '/contents/' + path, body).then(function (result) {
    if (result && result.content) _fileSha = result.content.sha;
    return result;
  }).catch(function (err) {
    if ((err.status === 409 || err.status === 422) && _retries > 0) {
      // SHA conflict — another writer beat us. Pull, merge, retry.
      _fileSha = null;
      return loadDeck().then(function (remote) {
        var merged = mergeDecks(data, remote);
        return saveDeck(merged, _retries - 1);
      });
    }
    throw err;
  });
}

// --- Sketch (per-card PNG) persistence ---
// Sketches live next to the deck JSON in a `sketches/` folder so a single
// repo holds the full study state. Each card's drawing is one PNG keyed by
// card id. We cache the file SHA per path so subsequent updates don't have
// to re-GET; on conflict we drop the cache and refetch.

var _sketchShas = {}; // path -> sha

function getSketchDir() {
  var path = getRepoPath() || 'spaced_repetition_data.json';
  var idx = path.lastIndexOf('/');
  var dir = idx >= 0 ? path.substring(0, idx) : '';
  return (dir ? dir + '/' : '') + 'sketches';
}

function getSketchPath(cardId) {
  return getSketchDir() + '/' + cardId + '.png';
}

// Returns a data: URL for the existing sketch, or null if there isn't one.
function loadSketch(cardId) {
  if (!isConfigured()) return Promise.resolve(null);
  var path = getSketchPath(cardId);
  return ghApi(
    'GET',
    '/repos/' + getRepoOwner() + '/' + getRepoName() + '/contents/' +
      path + '?ref=' + encodeURIComponent(getRepoBranch())
  ).then(function (data) {
    if (!data) { delete _sketchShas[path]; return null; }
    _sketchShas[path] = data.sha;
    return 'data:image/png;base64,' + (data.content || '').replace(/\n/g, '');
  });
}

// base64Png must be the raw base64 payload (no data: prefix).
function saveSketch(cardId, base64Png, _retries) {
  if (!isConfigured()) return Promise.reject(new Error('GitHub repo not configured'));
  if (_retries == null) _retries = 2;

  var path = getSketchPath(cardId);
  var body = {
    message: 'Update sketch for card ' + cardId,
    content: base64Png,
    branch: getRepoBranch()
  };
  if (_sketchShas[path]) body.sha = _sketchShas[path];

  return ghApi(
    'PUT',
    '/repos/' + getRepoOwner() + '/' + getRepoName() + '/contents/' + path,
    body
  ).then(function (result) {
    if (result && result.content) _sketchShas[path] = result.content.sha;
    return result;
  }).catch(function (err) {
    // 409 / 422 = stale SHA — drop cache, refetch, try once more.
    if ((err.status === 409 || err.status === 422) && _retries > 0) {
      delete _sketchShas[path];
      return loadSketch(cardId).then(function () {
        return saveSketch(cardId, base64Png, _retries - 1);
      });
    }
    throw err;
  });
}

// --- Batched / Debounced Save ---
// Coalesces rapid ratings into a single commit. Every scheduleSave also writes
// a localStorage mirror so a crash or unclean unload doesn't lose anything —
// the next loadDeck will replay it.

var _saveDirty = false;
var _saveTimer = null;
var _pendingData = null;
var _SAVE_DEBOUNCE_MS = 15 * 1000; // 15 seconds

function scheduleSave(data) {
  _pendingData = data;
  _saveDirty = true;
  _writePending(data); // durable mirror — survives crash / aborted unload

  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function () {
    _flushSaveInternal();
  }, _SAVE_DEBOUNCE_MS);
}

function flushSave() {
  if (!_saveDirty) return Promise.resolve();
  return _flushSaveInternal();
}

function _flushSaveInternal() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (!_saveDirty || !_pendingData) return Promise.resolve();

  _saveDirty = false;
  var data = _pendingData;

  return saveDeck(data).then(function (res) {
    _clearPending();
    return res;
  }).catch(function (err) {
    _saveDirty = true;
    _pendingData = data;
    console.error('Batched save failed:', err);
    showToast('Failed to save — will retry', 'error');
  });
}

// Flush pending saves when leaving / hiding the page. The localStorage mirror
// is our safety net if the fetch is aborted.
window.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('beforeunload', function () { flushSave(); });

// --- SRS settings (per-deck, stored in deckData.meta.srs) ---

var DEFAULT_SRS_SETTINGS = {
  newPerDay: 20,
  learningSteps: [1, 10],          // minutes for brand-new cards
  relearningSteps: [10],           // minutes for lapsed cards
  graduatingInterval: 1,           // days when Good-graduating from learning
  easyGraduatingInterval: 4,       // days when Easy-graduating from learning
  easyBonus: 1.3,                  // Easy multiplier on graduated intervals
  hardMultiplier: 1.2,             // Hard multiplier on graduated intervals
  easeOnHard: -0.15,
  easeOnGood: 0,
  easeOnEasy: 0.15,
  easeOnLapse: -0.2,
  minEase: 1.3,
  lapseNewIntervalFactor: 0.5,     // re-graduation interval = prev * this
  leechThreshold: 8,               // lapses before card is flagged a leech
  fuzzEnabled: true
};

function getSrsSettings(deckData) {
  var saved = (deckData && deckData.meta && deckData.meta.srs) || {};
  return Object.assign({}, DEFAULT_SRS_SETTINGS, saved);
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
    interval: 0,            // days until next review (graduated state)
    repetitions: 0,         // successful consecutive graduated reviews
    easeFactor: 2.5,
    due: new Date().toISOString(),
    lastReview: null,
    // Learning-step fields
    learningStep: 0,        // null = graduated; 0..N = position in steps array
    lapses: 0               // count of graduated -> failed transitions
  };
}

// State helpers. A card has three meaningful states:
//   new       — never reviewed (counts against daily new-card budget)
//   learning  — in step ladder (brand-new card mid-ladder, or lapsed card relearning)
//   graduated — on an interval-based schedule
function isNew(card) {
  return (card.repetitions || 0) === 0 && card.lastReview == null;
}
function isLearning(card) {
  return card.learningStep != null;
}
function isGraduated(card) {
  return !isLearning(card);
}
function isLapsedRelearning(card) {
  return isLearning(card) && card.lastReview != null && (card.lapses || 0) > 0;
}

function isDue(card) {
  return new Date(card.due) <= new Date();
}

// --- SM-2+ Algorithm (with learning steps, lapse handling, fuzz) ---
// quality: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy
//
// Three regimes:
//   Brand-new card  -> learning steps (minutes), then graduates to `graduatingInterval` days.
//   Lapsed card     -> relearning steps (minutes), then re-graduates to prev * `lapseNewIntervalFactor`.
//   Graduated card  -> standard SM-2 interval growth with fuzz; failure sends it to relearning.
//
// EF is only adjusted in the graduated regime — learning rebuilds confidence without
// punishing the ease further than the initial lapse penalty.

function sm2(card, quality, settings, now) {
  settings = settings || DEFAULT_SRS_SETTINGS;
  now = now || new Date();

  var ef = card.easeFactor || 2.5;
  var interval = card.interval || 0;
  var reps = card.repetitions || 0;
  var lapses = card.lapses || 0;
  var learningStep = card.learningStep;

  // Treat a brand-new card (never reviewed, no explicit step) as learning step 0.
  if (learningStep == null && isNew(card)) learningStep = 0;

  var inLearning = learningStep != null;
  // Pick which step ladder applies. A card is "relearning" if it ever graduated
  // (lastReview set, lapses > 0) — otherwise it's an untouched new card on the
  // initial ladder.
  function pickSteps() {
    var isRel = card.lastReview != null && lapses > 0;
    return isRel ? settings.relearningSteps : settings.learningSteps;
  }

  if (inLearning) {
    var steps = pickSteps();
    if (quality === 0) {
      learningStep = 0;
    } else if (quality === 1) {
      if (learningStep >= steps.length) learningStep = steps.length - 1;
      // stay on the current step
    } else if (quality === 2) {
      var next = (learningStep || 0) + 1;
      if (next >= steps.length) {
        // Graduate
        learningStep = null;
        if (lapses > 0 && interval > 0) {
          interval = Math.max(1, Math.round(interval * settings.lapseNewIntervalFactor));
        } else {
          interval = settings.graduatingInterval;
        }
        reps = 1;
      } else {
        learningStep = next;
      }
    } else { // Easy
      learningStep = null;
      if (lapses > 0 && interval > 0) {
        interval = Math.max(settings.easyGraduatingInterval, Math.round(interval * settings.lapseNewIntervalFactor));
      } else {
        interval = settings.easyGraduatingInterval;
      }
      reps = 1;
    }
  } else {
    // Graduated regime
    if (quality === 0) {
      // Lapse — drop into relearning, keep `interval` as memory of where we were
      lapses += 1;
      learningStep = 0;
      reps = 0;
      ef = Math.max(settings.minEase, ef + settings.easeOnLapse);
      // `interval` is preserved (will guide re-graduation) — `due` is recomputed below
    } else {
      if (quality === 1) {
        interval = Math.max(1, Math.round(interval * settings.hardMultiplier));
        ef += settings.easeOnHard;
      } else if (quality === 2) {
        if (reps === 1) interval = 6;
        else interval = Math.max(1, Math.round(interval * ef));
        ef += settings.easeOnGood;
      } else { // Easy
        if (reps === 1) interval = Math.round(6 * settings.easyBonus);
        else interval = Math.max(1, Math.round(interval * ef * settings.easyBonus));
        ef += settings.easeOnEasy;
      }
      reps += 1;
      if (ef < settings.minEase) ef = settings.minEase;
    }
  }

  // Compute next due date.
  var due;
  if (learningStep != null) {
    var stepsArr = pickSteps();
    var mins = stepsArr[Math.min(learningStep, stepsArr.length - 1)];
    due = new Date(now.getTime() + mins * 60 * 1000);
  } else {
    var finalInterval = settings.fuzzEnabled ? fuzzInterval(interval) : interval;
    interval = finalInterval;
    due = new Date(now);
    due.setHours(0, 0, 0, 0);            // start of today
    due.setDate(due.getDate() + interval); // + N days → start of day N
  }

  return {
    interval: interval,
    repetitions: reps,
    easeFactor: Math.round(ef * 100) / 100,
    due: due.toISOString(),
    lastReview: now.toISOString(),
    learningStep: learningStep,
    lapses: lapses,
    isLeech: lapses >= settings.leechThreshold
  };
}

// Random ±fuzz on intervals ≥ 3 days; keeps cards from clumping on the same future day.
function fuzzInterval(interval) {
  if (interval < 3) return interval;
  var pct;
  if (interval < 7) pct = 0.25;
  else if (interval < 30) pct = 0.15;
  else pct = 0.05;
  var range = Math.max(1, Math.round(interval * pct));
  var delta = Math.floor(Math.random() * (2 * range + 1)) - range;
  return Math.max(1, interval + delta);
}

function formatInterval(days) {
  if (days <= 0) return '< 1 day';
  if (days === 1) return '1 day';
  if (days < 30) return days + ' days';
  if (days < 365) return Math.round(days / 30) + ' mo';
  return (days / 365).toFixed(1) + ' yr';
}

// Friendly label for what the next review delay actually is, regardless of
// learning vs graduated state. Used in the rating-button previews.
function previewLabels(card, settings) {
  // Disable fuzz for previews so the displayed number matches what the user
  // expects to happen if they pick that button.
  settings = Object.assign({}, settings || DEFAULT_SRS_SETTINGS, { fuzzEnabled: false });
  var now = new Date();
  var out = [];
  for (var q = 0; q <= 3; q++) {
    var r = sm2(card, q, settings, now);
    if (r.learningStep != null) {
      var mins = Math.max(1, Math.round((new Date(r.due) - now) / 60000));
      out.push(mins < 60 ? mins + ' min' : Math.round(mins / 60) + ' h');
    } else {
      out.push(formatInterval(r.interval));
    }
  }
  return out;
}

// --- Session construction ---
// Partition due cards into [relearning, reviews, new], apply daily new-card
// budget, shuffle each bucket, then interleave reviews and new so new cards
// don't clump at the start or end of the session.

function _shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function _interleave(big, small) {
  if (small.length === 0) return big.slice();
  if (big.length === 0) return small.slice();
  var out = [];
  var stride = (big.length + small.length) / small.length; // float
  var nextSmallAt = stride / 2;
  var si = 0, bi = 0, idx = 0;
  while (bi < big.length || si < small.length) {
    if (si < small.length && idx >= nextSmallAt) {
      out.push(small[si++]);
      nextSmallAt += stride;
    } else if (bi < big.length) {
      out.push(big[bi++]);
    } else {
      out.push(small[si++]);
    }
    idx++;
  }
  return out;
}

function getDueCards(cards, tagFilter) {
  return cards.filter(function (c) {
    if (tagFilter && tagFilter.length > 0) {
      if (!tagFilter.some(function (t) { return c.tags.indexOf(t) >= 0; })) return false;
    }
    return isDue(c);
  });
}

// --- Daily new-card budget ---

function _todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function getNewBudget(deckData) {
  var s = getSrsSettings(deckData);
  var meta = deckData.meta = deckData.meta || {};
  if (meta.newDate !== _todayKey()) {
    meta.newDate = _todayKey();
    meta.newCount = 0;
  }
  return Math.max(0, s.newPerDay - (meta.newCount || 0));
}

function recordNewIntroduced(deckData) {
  var meta = deckData.meta = deckData.meta || {};
  if (meta.newDate !== _todayKey()) {
    meta.newDate = _todayKey();
    meta.newCount = 0;
  }
  meta.newCount = (meta.newCount || 0) + 1;
}

// Build the session queue. Returns a flat array; the caller should freeze its
// length as the progress denominator before requeues mutate it.
function buildSession(deckData, tagFilter) {
  var cards = deckData.cards || [];
  var due = getDueCards(cards, tagFilter);

  var relearning = [];
  var reviews = [];
  var fresh = [];
  due.forEach(function (c) {
    if (isNew(c)) fresh.push(c);
    else if (isLearning(c)) relearning.push(c);
    else reviews.push(c);
  });

  var budget = getNewBudget(deckData);
  _shuffle(fresh);
  fresh = fresh.slice(0, budget);

  _shuffle(relearning);
  _shuffle(reviews);

  // Reviews are usually the bigger pile; interleave new into them evenly.
  var mixed = reviews.length >= fresh.length
    ? _interleave(reviews, fresh)
    : _interleave(fresh, reviews);

  return relearning.concat(mixed);
}

// Counts for the setup screen.
function getDeckCounts(deckData, tagFilter) {
  var cards = deckData.cards || [];
  var due = getDueCards(cards, tagFilter);
  var counts = { total: cards.length, due: due.length, newDue: 0, learningDue: 0, reviewDue: 0, newRemaining: 0 };
  due.forEach(function (c) {
    if (isNew(c)) counts.newDue++;
    else if (isLearning(c)) counts.learningDue++;
    else counts.reviewDue++;
  });
  counts.newRemaining = Math.min(counts.newDue, getNewBudget(deckData));
  counts.sessionSize = counts.learningDue + counts.reviewDue + counts.newRemaining;
  return counts;
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
