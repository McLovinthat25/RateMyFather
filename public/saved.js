// Saved priests: localStorage-only favorites, plus the /saved page list and
// compare table. No account, no server writes, nothing leaves the browser.
(function () {
  var KEY = 'rmf_saved_priests';
  var MAX = 50;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(v)) return [];
      return v.filter(function (n) { return Number.isSafeInteger(n) && n > 0; }).slice(0, MAX);
    } catch (e) { return []; }
  }
  function store(ids) {
    try { localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX))); } catch (e) {}
  }
  function isSaved(id) { return load().indexOf(id) !== -1; }
  function fmt(v) { return v == null ? null : (Math.round(Number(v) * 10) / 10).toFixed(1); }

  function refreshButtons() {
    document.querySelectorAll('.save-btn').forEach(function (b) {
      var id = Number(b.dataset.priestId);
      var saved = isSaved(id);
      b.setAttribute('aria-pressed', saved ? 'true' : 'false');
      b.classList.toggle('is-saved', saved);
      b.textContent = saved ? '★ Saved' : '☆ ' + (b.dataset.label || 'Save');
    });
  }

  // Client-side card mirroring the server priestCard markup and classes.
  function cardHtml(p) {
    var n = p.n || 0;
    var avg = n ? (Number(p.pace) + Number(p.homily) + Number(p.likability)) / 3 : null;
    var scoreBox = avg == null
      ? '<span class="score-box unrated">Not yet rated</span>'
      : '<span class="score-box"><span class="num">' + avg.toFixed(1) + '</span><span class="lbl">out of 5</span></span>';
    var stars = '';
    if (avg != null) {
      var filled = Math.round(avg);
      for (var i = 1; i <= 5; i++) stars += i <= filled ? '★' : '<span class="empty">★</span>';
      stars = '<span class="stars" aria-label="' + avg.toFixed(1) + ' out of 5">' + stars + '</span>';
    }
    var assign = [];
    if (p.parish) assign.push('Listed at ' + esc(p.parish));
    var loc = [p.city, p.state].filter(Boolean).join(', ');
    if (loc) assign.push(esc(loc));
    var scores = avg == null ? '' :
      '<span class="scores">Pace ' + fmt(p.pace) + ' &middot; Homily ' + fmt(p.homily) + ' &middot; Likability ' + fmt(p.likability) +
      ' <span class="count">(' + n + ' review' + (n === 1 ? '' : 's') + ')</span></span>' +
      (n === 1 ? '<span class="caveat">Based on a single review.</span>' : '');
    return '<div class="card card--ruled card-lift priest-card">' +
      '<a class="priest-link" href="/priest/' + p.id + '">' + scoreBox +
      '<span class="priest-main"><span class="priest-name">' + esc(p.name) + '</span>' +
      '<span class="assign">' + (assign.join(' &middot; ') || 'Listing details not available') + '</span>' +
      stars + (p.user_added ? '<span class="badge">User-added profile</span>' : '') + scores +
      '</span><span class="chevron" aria-hidden="true">&rsaquo;</span></a>' +
      '<button type="button" class="save-btn is-saved" data-priest-id="' + p.id + '" data-priest-name="' + esc(p.name) + '" data-label="Save" aria-pressed="true" aria-label="Save ' + esc(p.name) + '">★ Saved</button>' +
      '</div>';
  }

  // Side-by-side table, shown only with two or more saved priests. Church
  // beauty stays in its own column, labelled as the building, never mixed
  // into the priest's scores.
  function compareHtml(rows) {
    if (rows.length < 2) return '';
    function cell(p, key) { return p.n ? fmt(p[key]) : 'Not rated yet'; }
    var head = '<tr><th>Priest</th><th>Parish</th><th>City, state</th><th>Ordination</th><th>Pace</th><th>Homily</th><th>Likability</th><th>Overall</th><th>Reviews</th><th>Church beauty (building)</th></tr>';
    var body = rows.map(function (p) {
      var avg = p.n ? (Number(p.pace) + Number(p.homily) + Number(p.likability)) / 3 : null;
      return '<tr><td><a href="/priest/' + p.id + '">' + esc(p.name) + '</a></td>' +
        '<td>' + esc(p.parish || '—') + '</td>' +
        '<td>' + esc([p.city, p.state].filter(Boolean).join(', ') || '—') + '</td>' +
        '<td>' + (p.ordination_year ? esc(p.ordination_year) : '—') + '</td>' +
        '<td>' + cell(p, 'pace') + '</td><td>' + cell(p, 'homily') + '</td><td>' + cell(p, 'likability') + '</td>' +
        '<td>' + (avg == null ? 'Not rated yet' : avg.toFixed(1)) + '</td>' +
        '<td>' + p.n + '</td>' +
        '<td>' + (p.church_n ? fmt(p.church_avg) + ' (' + p.church_n + ')' : 'Not rated yet') + '</td></tr>';
    }).join('');
    return '<section class="home-section"><div class="section-head"><p class="eyebrow">Side by side</p><h2>Compare</h2>' +
      '<p class="lede">Your saved priests, side by side. Pace is speed only, not a quality grade. Church beauty rates the building, not the priest.</p></div>' +
      '<div class="table-scroll"><table class="compare-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></section>';
  }

  function renderSaved() {
    var root = document.getElementById('saved-root');
    if (!root) return;
    var ids = load();
    if (!ids.length) {
      root.innerHTML = '<p>You have not saved any priests yet. When you find a priest you want to keep track of, tap <strong>Save</strong> on their card or profile.</p><p><a class="btn btn--gold btn-pill press" href="/browse">Search &amp; browse priests</a></p>';
      return;
    }
    root.innerHTML = '<p>Loading your saved priests…</p><div class="skeleton" style="height:96px;margin-top:12px"></div><div class="skeleton" style="height:96px;margin-top:12px"></div>';
    fetch('/api/priests/batch?ids=' + ids.join(','))
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (!Array.isArray(rows)) rows = [];
        var found = rows.map(function (r) { return r.id; });
        // Prune ids that no longer resolve (e.g. a user-added profile that
        // was rejected), so the list never shows stale entries.
        if (found.length !== ids.length) store(found);
        if (!rows.length) {
          root.innerHTML = '<p>Your saved priests are no longer listed. <a href="/browse">Search &amp; browse priests</a> to save new ones.</p>';
          return;
        }
        root.innerHTML = compareHtml(rows) +
          '<section class="home-section"><div class="section-head"><p class="eyebrow">Your list</p><h2>Saved priests</h2></div>' +
          '<div class="cards">' + rows.map(cardHtml).join('') + '</div>' +
          '<p class="saved-actions"><button type="button" class="btn btn--ghost btn--sm" id="clear-saved">Clear all saved priests</button></p></section>';
        var clear = document.getElementById('clear-saved');
        if (clear) clear.addEventListener('click', function () { store([]); refreshButtons(); renderSaved(); });
        refreshButtons();
      })
      .catch(function () {
        root.innerHTML = '<p>Could not load your saved priests right now. Please try again.</p>';
      });
  }

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.save-btn') : null;
    if (!b) return;
    var id = Number(b.dataset.priestId);
    if (!id) return;
    var ids = load();
    var i = ids.indexOf(id);
    if (i === -1) ids.push(id); else ids.splice(i, 1);
    store(ids);
    refreshButtons();
    if (document.getElementById('saved-root')) renderSaved();
  });

  refreshButtons();
  renderSaved();
})();
