// RateMyFather Arcade: eight games, vanilla canvas JS. Best scores live only in
// the visitor's browser (localStorage). Games never auto-play: every game starts
// on a start overlay and waits for a tap or click.
(function () {
  'use strict';
  var root = document.getElementById('arcade-root');
  if (!root) return;

  var GAME_W = 480, GAME_H = 320;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }

  // ---- best scores (localStorage only) ----
  function bestKey(id) { return id === 'rungun' ? 'rmf-parish-bowl-best' : 'rmf-arcade-best-' + id; }
  function readBest(id) { try { var v = parseInt(localStorage.getItem(bestKey(id)) || '0', 10); return isNaN(v) ? 0 : v; } catch (e) { return 0; } }
  function writeBest(id, score) { try { var b = readBest(id); if (score > b) { localStorage.setItem(bestKey(id), String(score)); return score; } return b; } catch (e) { return score; } }
  function gameMark(id) { var b = readBest(id); return b > 0 ? '<span class="trophy">★</span> Best: ' + b : 'Not yet played'; }

  // ---- difficulty: Easy / Medium / Hard ----
  // One picker, shared by every game that offers it. Medium is the
  // tuned default: the game exactly as it plays today. Easy forgives
  // a new player, Hard is a real challenge. The choice is remembered
  // per game in the browser, so a player who picks Hard keeps Hard.
  var DIFFS = ['easy', 'medium', 'hard'];
  var DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  function readDiff(id) { var v = storeGet('rmf-arcade-diff-' + id); return v === 'easy' || v === 'hard' ? v : 'medium'; }
  function writeDiff(id, v) { storeSet('rmf-arcade-diff-' + id, v); }
  // Three buttons for the start screen. The current one reads burgundy.
  function diffPickerHtml(id, cur) {
    return '<div class="diff-row" data-diff-for="' + id + '" style="margin:0 0 14px;">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#6b5636;margin-bottom:6px;">Difficulty</div>' +
      DIFFS.map(function (d) {
        var on = d === cur;
        return '<button type="button" class="press diff-btn" data-diff="' + d + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="margin:0 4px;padding:8px 16px;' + (on ? 'background:#6e1a26;color:#f7ecd4;' : '') + '">' + DIFF_LABEL[d] + '</button>';
      }).join('') + '</div>';
  }
  // Wire the picker inside a container (a stage overlay, or the Pastor
  // card). get() reads the current choice, set(d) stores it and retunes.
  function wireDiffButtons(root, id, get, set) {
    if (!root) return;
    var btns = root.querySelectorAll('.diff-btn');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        set(b.getAttribute('data-diff'));
        btns.forEach(function (x) {
          var on = x.getAttribute('data-diff') === get();
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
          x.style.background = on ? '#6e1a26' : '';
          x.style.color = on ? '#f7ecd4' : '';
        });
      });
    });
  }
  // The difficulty tag for a HUD or stats line. Medium shows nothing:
  // it is the default game, so only Easy and Hard need saying.
  function diffTag(d) { return d === 'medium' ? '' : '<span>' + DIFF_LABEL[d] + '</span>'; }
  function storeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function storeSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function storeDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

  // ---- home parish (optional) ----
  // A player may pick a home parish from the site's parish data. It lives
  // only in their own browser, it is never required, and it can be cleared
  // at any time. When one is set, finished-game scores count toward that
  // parish on the country leaderboard; without one, nothing is submitted
  // and the games play exactly as before.
  var HOME_PARISH_KEY = 'rmf-home-parish';
  function readHomeParish() { try { var v = storeGet(HOME_PARISH_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeHomeParish(p) { try { storeSet(HOME_PARISH_KEY, JSON.stringify(p)); } catch (e) {} }
  function clearHomeParish() { storeDel(HOME_PARISH_KEY); }
  function homeParishLabel(p) { return p ? p.parish + (p.city ? ', ' + p.city : '') + (p.state ? ', ' + p.state : '') : ''; }
  function homeParishKey(p) { return p ? [p.parish, p.city, p.state].map(function (s) { return String(s || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim(); }).join('|') : ''; }

  // ---- parish leaderboard: one score per finished game ----
  // Fire-and-forget: the game-over screen never waits on it, and a failed
  // post is silently dropped — the local best score is the record that
  // matters to the player. The per-game flag stops a double submit for
  // one finished game; each game's start function clears it for the
  // next game.
  var parishSubmitted = {};
  function submitParishScore(gameId, score, onResult) {
    var hp = readHomeParish();
    if (!hp || !hp.parish || !(score > 0)) return;
    if (parishSubmitted[gameId]) return;
    parishSubmitted[gameId] = true;
    if (typeof fetch !== 'function') return;
    try {
      fetch('/api/leaderboard/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: gameId, parish: hp.parish, city: hp.city || '', state: hp.state || '', score: Math.round(score) }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (typeof onResult === 'function') { try { onResult(data); } catch (e) {} }
      }).catch(function () {});
    } catch (e) {}
  }

  // Canvas point: converts a pointer event on a game canvas to canvas
  // coordinates, accounting for the canvas being scaled by CSS on a phone.
  // Shared by the direct-touch controls: the player touches the play area
  // itself instead of hunting for buttons. Arrow keys and the on-screen
  // buttons keep working exactly as before; touch is an added input, not
  // a replacement.
  function canvasPoint(canvas, e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  }

  // ---- shared stage ----
  function createStage(parent, opts) {
    var stage = el('div', 'game-stage');
    var head = el('div', 'stage-head');
    var back = el('button', 'press', '← Back to arcade'); back.type = 'button';
    var title = el('h2', '', esc(opts.title));
    var pauseBtn = el('button', 'press', 'Pause'); pauseBtn.type = 'button';
    head.appendChild(back); head.appendChild(title); head.appendChild(pauseBtn);
    var wrap = el('div', 'game-canvas-wrap');
    var canvas = document.createElement('canvas');
    canvas.width = GAME_W; canvas.height = GAME_H;
    canvas.setAttribute('aria-label', opts.title);
    // Dragging on the field must move the player, not scroll the page.
    canvas.style.touchAction = 'none';
    var overlay = el('div', 'game-overlay'); overlay.style.display = 'none';
    var banner = el('div', 'game-banner'); banner.style.display = 'none';
    wrap.appendChild(canvas); wrap.appendChild(overlay); wrap.appendChild(banner);
    var hud = el('div', 'game-hud');
    var actions = el('div', 'game-actions');
    stage.appendChild(head); stage.appendChild(wrap); stage.appendChild(hud); stage.appendChild(actions);
    parent.appendChild(stage);
    // The overlay is absolutely positioned over the fixed 480x320 canvas, so
    // on a phone it is only ~240px tall while a menu card (intro, choose,
    // customize) is far taller. Left alone the card is clipped mid-sentence
    // at the canvas edge. Grow the wrap to fit the card so every word is
    // visible on load; the wrap shrinks back when the overlay closes.
    function fitOverlay() {
      var natural = canvas.clientHeight; // wrap height with no growth
      wrap.style.minHeight = '';
      var need = overlay.scrollHeight;
      if (need > natural) wrap.style.minHeight = Math.min(need, window.innerHeight) + 'px';
    }
    function onResize() {
      if (!document.contains(stage)) { window.removeEventListener('resize', onResize); return; }
      if (overlay.style.display !== 'none') fitOverlay();
    }
    window.addEventListener('resize', onResize);
    var api = {
      stage: stage, canvas: canvas, ctx: canvas.getContext('2d'), overlay: overlay,
      hud: hud, banner: banner, actions: actions, pauseBtn: pauseBtn, _bannerT: null,
      showOverlay: function (html) { overlay.innerHTML = html; overlay.style.display = 'flex'; fitOverlay(); },
      hideOverlay: function () { overlay.style.display = 'none'; overlay.innerHTML = ''; wrap.style.minHeight = ''; },
      setHud: function (html) { if (html !== api._lastHud) { api._lastHud = html; hud.innerHTML = html; } },
      showBanner: function (text, ms) {
        banner.textContent = text; banner.style.display = 'block';
        clearTimeout(api._bannerT);
        api._bannerT = setTimeout(function () { banner.style.display = 'none'; }, ms || 1600);
      },
    };
    back.addEventListener('click', function () { if (opts.onBack) opts.onBack(); });
    return api;
  }

  // Pause: P / Esc toggles, Pause button toggles, tab hide auto-pauses.
  function wirePause(api, isPaused, doPause, doResume) {
    function toggle() { if (isPaused()) doResume(); else doPause(); }
    api.pauseBtn.addEventListener('click', toggle);
    function onKey(e) {
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); toggle(); }
    }
    document.addEventListener('keydown', onKey);
    function onVis() { if (document.hidden && !isPaused()) doPause(); }
    document.addEventListener('visibilitychange', onVis);
    return function cleanup() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
    };
  }

  // Direction pad (touch + mouse hold). Calls onMove(dx, dy, active).
  // It sits directly under the canvas (before the HUD), so on a phone it
  // is reachable without scrolling past the score and action buttons, and
  // it stays clear of the fixed chat toggle at the bottom of the screen.
  function makeDpad(parent, onMove) {
    var dpad = el('div', 'dpad');
    var defs = [
      { label: '↑', dx: 0, dy: -1, col: '2', row: '1' },
      { label: '←', dx: -1, dy: 0, col: '1', row: '2' },
      { label: '↓', dx: 0, dy: 1, col: '2', row: '2' },
      { label: '→', dx: 1, dy: 0, col: '3', row: '2' },
    ];
    defs.forEach(function (d) {
      var b = el('button', 'press', d.label); b.type = 'button';
      b.style.gridColumn = d.col; b.style.gridRow = d.row;
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); onMove(d.dx, d.dy, true); });
      var end = function (e) { e.preventDefault(); onMove(d.dx, d.dy, false); };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointerleave', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      dpad.appendChild(b);
    });
    var hud = parent.querySelector('.game-hud');
    if (hud) parent.insertBefore(dpad, hud);
    else parent.appendChild(dpad);
    return dpad;
  }

  // Touch control button. Tap fires once; holding repeats after a short
  // delay (move/drop buttons). Pass { repeat: false } for one-shot
  // buttons such as rotate or slam. Works with touch, pen, and mouse.
  function makeTouchButton(label, onPress, opts) {
    var b = el('button', 'press touch-btn' + (opts && opts.wide ? ' wide' : '') + (opts && opts.cls ? ' ' + opts.cls : ''), label);
    b.type = 'button';
    var t1 = null, t2 = null;
    function stop() {
      if (t1) { clearTimeout(t1); t1 = null; }
      if (t2) { clearInterval(t2); t2 = null; }
      b.classList.remove('held');
    }
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      onPress();
      b.classList.add('held');
      if (!opts || opts.repeat !== false) {
        t1 = setTimeout(function () { t2 = setInterval(onPress, 90); }, 220);
      }
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      b.addEventListener(ev, function (e) { e.preventDefault(); stop(); });
    });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return b;
  }

  // Hold-state button: onDown while the finger is down, onUp on release.
  // For charge/fire and for held movement keys.
  function makeHoldButton(label, onDown, onUp, opts) {
    var b = el('button', 'press touch-btn' + (opts && opts.wide ? ' wide' : '') + (opts && opts.cls ? ' ' + opts.cls : ''), label);
    b.type = 'button';
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); b.classList.add('held'); onDown(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      b.addEventListener(ev, function (e) { e.preventDefault(); b.classList.remove('held'); onUp(); });
    });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return b;
  }

  // Touch control row, placed directly under the canvas (before the HUD).
  function makeTouchRow(api) {
    var row = el('div', 'touch-row');
    api.stage.insertBefore(row, api.hud);
    return row;
  }

  // Keyboard arrows/WASD state.
  function makeKeys() {
    var keys = {};
    function down(e) {
      var k = e.key.toLowerCase();
      // Never swallow keys while the player is typing in a text field:
      // the customise screen's name fields need their spaces and arrows.
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!typing && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
      keys[k] = true;
    }
    function up(e) { keys[e.key.toLowerCase()] = false; }
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    return {
      keys: keys,
      axis: function () {
        var x = 0, y = 0;
        if (keys['arrowleft'] || keys['a']) x -= 1;
        if (keys['arrowright'] || keys['d']) x += 1;
        if (keys['arrowup'] || keys['w']) y -= 1;
        if (keys['arrowdown'] || keys['s']) y += 1;
        return { x: x, y: y };
      },
      pressed: function (k) { return !!keys[k]; },
      cleanup: function () { document.removeEventListener('keydown', down); document.removeEventListener('keyup', up); },
    };
  }

  // ---- shared keyboard helpers ----
  // A key shown on the button itself, so a keyboard player sees at a
  // glance which key picks it — the same pattern the Bowl uses on its
  // Run / Pass buttons. Styled for the gold overlay buttons and the
  // Pastor choice buttons (dark text on light); the Bowl's burgundy
  // buttons carry their own chip.
  // Devices with a real keyboard get the keyboard hints; phones and
  // tablets get only the touch controls. The check is the standard
  // fine-pointer-plus-hover one: a touchscreen laptop still has a
  // keyboard, so its hints stay. Where matchMedia is missing (old
  // browsers, the test harness) the hints show, as before. Read once
  // and remembered: the canvas hints call this every frame.
  var _hasKeyboard = null;
  function hasKeyboard() {
    if (_hasKeyboard === null) {
      try {
        _hasKeyboard = (typeof matchMedia === 'function') ? matchMedia('(pointer: fine) and (hover: hover)').matches : true;
      } catch (e) { _hasKeyboard = true; }
    }
    return _hasKeyboard;
  }
  // One line of instructions with a desktop version (keyboard + touch)
  // and a touch-only version. Phones and tablets see only the touch
  // controls; computers see the full line.
  function gameNote(desktop, touch) { return hasKeyboard() ? desktop : touch; }
  function kbdChip(key) {
    if (!hasKeyboard()) return '';
    return '<span style="display:inline-block;min-width:20px;padding:2px 7px;margin-left:10px;border:1.5px solid rgba(46,34,5,.55);border-radius:5px;font-size:11px;font-weight:700;letter-spacing:.08em;vertical-align:2px;">' + key + '</span>';
  }
  // One line under a big button, naming the keyboard way to press it.
  function kbdHint(text) {
    if (!hasKeyboard()) return '';
    return '<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#6b5636;">' + text + '</p>';
  }
  // Never swallow keys while the player is typing in a text field, and
  // never double-fire a key that would also activate a focused button:
  // a focused button answers Space / Enter itself, so the game-level
  // shortcut stands aside and lets the click do it. The event target
  // is the focused element for a real key press; activeElement covers
  // the same ground for a dispatched event.
  function kbdTyping(e) {
    var t = (e && e.target) || document.activeElement;
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  }
  function kbdOnButton(e) {
    var t = (e && e.target) || document.activeElement;
    return !!(t && t.tagName === 'BUTTON');
  }

  // ---- game registry ----
  var ARCADE_GAMES = [
    { id: 'rungun', title: 'The Parish Bowl', blurb: 'Father carries the ball for Your Parish against St Swithin\u2019s. Run or pass your way down the field.', verdict: 'Best for a quick kickabout.', how: 'Arrows or WASD to move, or touch and drag on the field. R runs, T throws, Space kicks off. Choose RUN or PASS, then be in the gold circle as the ball arrives to catch it. The ball arcs in slowly enough to track, so watch it and time your run — the defence will hold you up on the way.', howTouch: 'Touch and drag on the field to move. Choose RUN or PASS, then be in the gold circle as the ball arrives to catch it. The ball arcs in slowly enough to track, so watch it and time your run — the defence will hold you up on the way.', mount: mountBowl },
    { id: 'stack', title: 'Stained-Glass Blocks', blurb: 'Fit the falling panes into the window before it fills up.', verdict: 'Best for puzzle lovers.', how: 'Left and right to move, Up to turn a pane, Down to drop it faster. On a phone, drag on the window to slide a pane, tap to turn it, or use the buttons below.', howTouch: 'Drag on the window to slide a pane, tap to turn it, or use the buttons below.', mount: mountStack },
    { id: 'maze', title: 'Candle Maze', blurb: 'Light 110 candles to complete the vigil while four sins hunt you. Holy water turns the tables.', verdict: 'Best for steady nerves.', how: 'Arrows or WASD to steer, or swipe and drag on the field. Father walks on his own. Once per life, grace shields you from a catch.', howTouch: 'Swipe and drag on the field to steer. Father walks on his own. Once per life, grace shields you from a catch.', mount: mountMaze },
    { id: 'steeple', title: 'Steeple Stack', blurb: 'Stack the stones into the tallest steeple. Mind the wind after stone fifteen.', verdict: 'Best for patient builders.', how: 'Tap or press Space to drop a stone on the tower. Once per run the buttress catches a clean miss.', howTouch: 'Tap to drop a stone on the tower. Once per run the buttress catches a clean miss.', mount: mountSteeple },
    { id: 'dash', title: 'Sanctuary Dash', blurb: 'The golden cube never stops. Jump the thorns, ride the pews, and reach the sanctuary 9,200px down the nave.', verdict: 'Best for quick reflexes.', how: 'Space, Up, W, click or tap to jump. Hold to keep hopping. Once per run, grace forgives a fall.', howTouch: 'Tap to jump. Hold to keep hopping. Once per run, grace forgives a fall.', mount: mountDash },
    { id: 'flee', title: 'Flee the Sins', blurb: 'Outrun the seven sins. Grab halos, dash with grace, and mind the confession bell.', verdict: 'Best for a chase.', how: 'Arrows to move, Space for a grace-dash. On a phone, drag on the floor to run, tap to dash. Halos earn guardian halos that turn one catch aside — each new one takes more halos than the last.', howTouch: 'Drag on the floor to run, tap to dash. Halos earn guardian halos that turn one catch aside — each new one takes more halos than the last.', mount: mountFlee },
    { id: 'cross', title: 'Father\u2019s Crossing', blurb: 'Cross the road and the river to reach the church doors before the bell.', verdict: 'Best for careful crossers.', how: 'Arrows or WASD to move, Space or Enter starts, or touch and hold the field to walk toward your finger. Follow the moth to the right door. A golden candle waits on the road: +50 and +8s on the bell.', howTouch: 'Touch and hold the field to walk toward your finger. Follow the moth to the right door. A golden candle waits on the road: +50 and +8s on the bell.', mount: mountCross },
    { id: 'pastor', title: 'Parish Pastor', blurb: 'Run the parish for 16 weeks. Balance the congregation, the funds, and everyone\u2019s happiness.', verdict: 'Best for planners.', how: 'Press 1, 2 or 3 to pick a choice each week, or click one. Space or Enter begins the season. Watch the ledger. Once per season you may take back a week.', howTouch: 'Tap a choice each week. Watch the ledger. Once per season you may take back a week.', mount: mountPastor },
    { id: 'defence', title: 'Cathedral Defence', blurb: 'The seven sins are marching on the cathedral. Raise bell, candle, font and choir along the path and turn them back.', verdict: 'Best for strategists.', how: 'Pick a tower (keys 1 to 4 or tap its button), then tap a grass plot to place it. Tap a placed tower to see its damage, range and rate and to upgrade it along one of two paths. B or the Begin wave button sends the next wave; the preview names what is coming.', howTouch: 'Tap a tower button, then tap a grass plot to place it. Tap a placed tower to see its numbers and upgrade it. Tap Begin wave when you are ready; the preview names what is coming.', mount: mountDefence },
    { id: 'pilgrim', title: 'The Pilgrim Path', blurb: 'One stick figure, one calling. Pray, study, serve and work, and rise from seminarian to bishop, one day at a time.', verdict: 'Best for dreamers.', how: 'Press 1 to 4 to choose a place each day, or click one: chapel, library, parish hall or town. Space or Enter rests and ends the day. Every rank asks for a mix of Faith, Wisdom and Charity, and Reputation besides.', howTouch: 'Tap a place each day: chapel, library, parish hall or town. Tap Rest to end the day. Every rank asks for a mix of Faith, Wisdom and Charity, and Reputation besides.', mount: mountPilgrim },
  ];

  // ---- arcade shelf ----
  var currentCleanup = null;
  var currentFilter = 'all';
  // The fixed "Ask about a priest" pill sits at the bottom of the screen and
  // covers the game instructions as they scroll past it. While a game is
  // open the chat is not needed, so hide it; it comes back on the shelf.
  function setChatVisible(v) {
    var w = document.getElementById('chat-widget');
    if (w) w.style.display = v ? '' : 'none';
  }

  // ---- home parish panel (optional) ----
  // Search the site's parish data by name or city, pick one, and finished
  // game scores count toward it on the leaderboard. Entirely optional:
  // nothing is set until the player picks, and Clear removes it.
  function homeParishPanel() {
    var hp = readHomeParish();
    var panel = el('div', 'game-card home-parish');
    panel.style.marginBottom = '14px';
    panel.appendChild(el('h3', '', 'Your home parish'));
    if (hp) {
      var line = el('p', 'blurb', 'Playing for <strong>' + esc(homeParishLabel(hp)) + '</strong>. Your scores count toward your parish on the leaderboard below.');
      panel.appendChild(line);
      var row = el('div', 'play-row');
      var change = el('button', 'press', 'Change'); change.type = 'button';
      change.addEventListener('click', function () { showParishSearch(panel, true); });
      var clear = el('button', 'press', 'Clear'); clear.type = 'button';
      clear.addEventListener('click', function () { clearHomeParish(); renderShelf(); });
      row.appendChild(change); row.appendChild(clear);
      panel.appendChild(row);
    } else {
      panel.appendChild(el('p', 'blurb', 'Optional: pick your home parish and your scores count toward it on the country leaderboard. Nothing is set until you pick one.'));
      showParishSearch(panel, false);
    }
    return panel;
  }
  function showParishSearch(panel, changing) {
    var old = panel.querySelector('.parish-search');
    if (old) old.parentNode.removeChild(old);
    var wrap = el('div', 'parish-search');
    wrap.style.marginTop = '10px';
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search parish name or city';
    input.setAttribute('aria-label', 'Search for your home parish');
    input.style.cssText = 'display:block;width:100%;box-sizing:border-box;padding:10px 12px;border:2px solid #6e1a26;border-radius:8px;background:#fff;font-family:Georgia,serif;font-size:15px;';
    var results = el('div', 'parish-results');
    wrap.appendChild(input); wrap.appendChild(results);
    panel.appendChild(wrap);
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ''; return; }
      timer = setTimeout(function () { parishSearch(q, results, panel); }, 250);
    });
    if (input.focus) input.focus();
    if (changing) {
      var cancel = el('button', 'press', 'Cancel'); cancel.type = 'button';
      cancel.style.marginTop = '8px';
      cancel.addEventListener('click', function () { renderShelf(); });
      wrap.appendChild(cancel);
    }
  }
  function parishSearch(q, results, panel) {
    if (typeof fetch !== 'function') { results.innerHTML = '<p class="small">Search needs a connection.</p>'; return; }
    fetch('/api/parishes/search?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (rows) {
      results.innerHTML = '';
      if (!rows || !rows.length) { results.appendChild(el('p', 'small', 'No parish found by that name or city. Try a shorter search.')); return; }
      rows.forEach(function (r) {
        var b = el('button', 'chip', esc(r.parish) + ', ' + esc(r.city) + (r.state ? ', ' + esc(r.state) : '') + ' <span class="small">(' + r.n + ' priest' + (r.n === 1 ? '' : 's') + ')</span>');
        b.type = 'button';
        b.style.cssText = 'display:block;width:100%;text-align:left;margin-top:6px;';
        b.addEventListener('click', function () {
          writeHomeParish({ parish: r.parish, city: r.city || '', state: r.state || '' });
          renderShelf();
        });
        results.appendChild(b);
      });
    }).catch(function () { results.innerHTML = '<p class="small">Search did not load. Try again.</p>'; });
  }

  // ---- parish leaderboard panel ----
  // Top parishes across the country, per game. The player's home parish
  // row is marked when it is on the board.
  var currentBoardGame = 'rungun';
  var BOARD_GAME_LABELS = { rungun: 'Parish Bowl', stack: 'Blocks', maze: 'Candle Maze', steeple: 'Steeple Stack', dash: 'Sanctuary Dash', flee: 'Flee the Sins', cross: 'Crossing', pastor: 'Parish Pastor', defence: 'Defence', pilgrim: 'Pilgrim', trivia: 'Trivia' };
  function leaderboardPanel() {
    var panel = el('div', 'game-card');
    panel.style.marginTop = '14px';
    panel.appendChild(el('h3', '', 'Parish leaderboard'));
    panel.appendChild(el('p', 'blurb', 'Top parishes across the country, by game. Set a home parish above and your scores count toward it.'));
    var chips = el('div', 'chip-row');
    chips.style.marginTop = '4px';
    ARCADE_GAMES.forEach(function (g) {
      var chip = el('button', 'chip', BOARD_GAME_LABELS[g.id] || g.title); chip.type = 'button';
      chip.setAttribute('aria-pressed', currentBoardGame === g.id ? 'true' : 'false');
      chip.addEventListener('click', function () { currentBoardGame = g.id; renderShelf(); });
      chips.appendChild(chip);
    });
    panel.appendChild(chips);
    var list = el('div', 'board-list');
    list.style.marginTop = '10px';
    list.appendChild(el('p', 'small', 'Loading the board…'));
    panel.appendChild(list);
    loadBoard(list);
    return panel;
  }
  function loadBoard(list) {
    if (typeof fetch !== 'function') { list.innerHTML = '<p class="small">The leaderboard needs a connection.</p>'; return; }
    var hp = readHomeParish();
    var url = '/api/leaderboard/' + currentBoardGame + (hp ? '?parish=' + encodeURIComponent(homeParishKey(hp)) : '');
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      list.innerHTML = '';
      // Daily cap, per game: how much of today's limit this visitor has
      // used. Only shown to a player with a home parish set, since only
      // they contribute scores. The limit resets tomorrow.
      if (hp && data && data.daily) {
        var used = Number(data.daily.contributed) || 0, capN = Number(data.daily.cap) || 5000;
        var capLine = el('p', 'small');
        capLine.style.margin = '0 0 10px';
        capLine.textContent = used >= capN
          ? 'You have reached today\u2019s ' + capN.toLocaleString() + '-point limit for this game. It resets tomorrow.'
          : 'Today you have added ' + used.toLocaleString() + ' of ' + capN.toLocaleString() + ' points for this game. The limit resets tomorrow.';
        list.appendChild(capLine);
      }
      var rows = (data && data.top) || [];
      if (!rows.length) {
        list.appendChild(el('p', 'small', 'No scores yet for this game — set a home parish above and be the first.'));
        return;
      }
      var hpKey = homeParishKey(hp);
      rows.forEach(function (r, i) {
        var mine = hpKey && [r.parish, r.city, r.state].map(function (s) { return String(s || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim(); }).join('|') === hpKey;
        var row = el('p', 'board-row');
        row.style.cssText = 'margin:0 0 6px;font-size:15px;' + (mine ? 'font-weight:700;' : '');
        row.innerHTML = '<strong>#' + (i + 1) + '</strong> ' + esc(r.parish) + ', ' + esc(r.city) + (r.state ? ', ' + esc(r.state) : '') +
          ' — <strong>' + Number(r.total_score).toLocaleString() + ' pts</strong> <span class="small">· ' + r.games_played + ' game' + (r.games_played === 1 ? '' : 's') + ' · best ' + Number(r.best_score).toLocaleString() + '</span>' +
          (mine ? ' <span class="small" style="color:#6e1a26;font-weight:700;">Your parish</span>' : '');
        list.appendChild(row);
      });
      if (data.yours && data.yours.rank > rows.length) {
        var y = data.yours;
        var yours = el('p', 'board-row');
        yours.style.cssText = 'margin:10px 0 0;font-size:15px;font-weight:700;';
        yours.innerHTML = '<strong>#' + y.rank + '</strong> ' + esc(y.parish) + ', ' + esc(y.city) + (y.state ? ', ' + esc(y.state) : '') +
          ' — <strong>' + Number(y.total_score).toLocaleString() + ' pts</strong> <span class="small">· ' + y.games_played + ' game' + (y.games_played === 1 ? '' : 's') + ' · best ' + Number(y.best_score).toLocaleString() + '</span> <span class="small" style="color:#6e1a26;font-weight:700;">Your parish</span>';
        list.appendChild(yours);
      }
    }).catch(function () { list.innerHTML = '<p class="small">The board did not load. Try again.</p>'; });
  }

  function renderShelf() {
    if (currentCleanup) { currentCleanup(); currentCleanup = null; }
    setChatVisible(true);
    window.scrollTo(0, 0);
    root.innerHTML = '';
    var head = el('div', 'arcade-head');
    head.appendChild(el('h2', '', 'The Arcade'));
    head.appendChild(el('p', 'small', 'Ten little games. Best scores live only in your browser.'));
    var tools = el('div', 'arcade-tools');
    var surprise = el('button', 'press', 'Surprise me'); surprise.type = 'button';
    surprise.addEventListener('click', function () {
      var g = ARCADE_GAMES[randInt(0, ARCADE_GAMES.length - 1)];
      openGame(g.id);
    });
    tools.appendChild(surprise);
    [['all', 'All'], ['unplayed', 'Not yet played'], ['trophies', 'My trophy shelf']].forEach(function (entry) {
      var chip = el('button', 'chip', entry[1]); chip.type = 'button';
      chip.setAttribute('aria-pressed', currentFilter === entry[0] ? 'true' : 'false');
      chip.addEventListener('click', function () { currentFilter = entry[0]; renderShelf(); });
      tools.appendChild(chip);
    });
    var shelf = el('div', 'arcade-shelf');
    ARCADE_GAMES.forEach(function (g) {
      var best = readBest(g.id);
      if (currentFilter === 'unplayed' && best > 0) return;
      if (currentFilter === 'trophies' && best <= 0) return;
      var card = el('article', 'game-card card-lift');
      card.appendChild(el('h3', '', esc(g.title)));
      card.appendChild(el('p', 'blurb', esc(g.blurb)));
      // Play sits right under the blurb, before the verdict/how-to paragraph,
      // so it is reachable on a phone without scrolling past a long paragraph.
      var row = el('div', 'play-row');
      row.appendChild(el('span', 'best', gameMark(g.id)));
      // The card names the difficulty the game will open at, so every
      // card carries the same three facts: name, description, level.
      row.appendChild(el('span', 'diff-tag', DIFF_LABEL[readDiff(g.id)]));
      var play = el('button', 'press', 'Play'); play.type = 'button';
      play.addEventListener('click', function () { openGame(g.id); });
      row.appendChild(play);
      card.appendChild(row);
      card.appendChild(el('p', 'meta', '<strong>' + esc(g.verdict) + '</strong> ' + esc(hasKeyboard() ? g.how : (g.howTouch || g.how))));
      shelf.appendChild(card);
    });
    if (!shelf.children.length) {
      shelf.appendChild(el('p', 'small', currentFilter === 'trophies' ? 'No trophies yet. Play a game to earn your first best score.' : 'You have played them all.'));
    }
    root.appendChild(head); root.appendChild(tools);
    root.appendChild(homeParishPanel());
    root.appendChild(shelf);
    root.appendChild(leaderboardPanel());
  }

  function openGame(id) {
    var def = null;
    ARCADE_GAMES.forEach(function (g) { if (g.id === id) def = g; });
    if (!def) return;
    if (currentCleanup) { currentCleanup(); currentCleanup = null; }
    root.innerHTML = '';
    currentCleanup = def.mount(root, function () { renderShelf(); }) || null;
    setChatVisible(false);
    // The shelf is long; swapping it for the stage keeps the old scroll
    // offset, which left the arcade intro clipped under the sticky header
    // (only "in your browser." visible). Start at the top so every line
    // of text is visible when the game loads.
    window.scrollTo(0, 0);
  }

  // ================= The Parish Bowl =================
  // Your Parish vs St Swithin's. Four downs to gain ten yards, four quarters
  // of 45 seconds. Run it or pass it: on a pass, be in the gold circle
  // as the ball arrives to catch it, then run it in — the ball takes its
  // time arcing in, so watch it and time your run, and the defence holds
  // you up on the way, so getting to the spot is the fight, not a free
  // run. A touchdown is the yards gained plus a bonus.
  // Half time comes after Q2, and St Swithin's are a step quicker in the
  // second half. Their drive after each quarter starts from your field
  // position: a turnover hands them a short field, a touchdown leaves
  // them starting deep.
  // The defence spawns randomly (Nov 10, Mikey): the line covers a
  // random sub-span of the field at a random offset, each man takes a
  // jittered slot and a depth from a wide band, and every man varies
  // in pace, lane room, shade and break timing, so the coverage looks
  // and feels different every snap. The line still holds its lanes:
  // on a pass each man shuffles inside his own zone, and on a run
  // each man closes upfield inside his lane corridor, so the defence
  // reads as organised even while it is unpredictable. A tackle
  // before the catch is pass interference:
  // +10 yards (or the yards already gained, whichever is more, capped at
  // the 1) and an automatic first down — the drive does not end.
  //
  // ---- The Parish Bowl: demo-matched geometry and rules ----
  // The demo plays on a scrolling 940px world (RUNGUN_WORLD_H 940,
  // start 868, end zone 84), not a fixed 320px field: the camera follows
  // the runner down the field, so a drive meets defenders in sequence
  // instead of one wall across a squeezed field. Yards are world pixels
  // per yard: (868 - 84) / 80 = 9.8. Touchdown: yards + 100 points and
  // +7 team points, per the demo; St Swithin's drives after each quarter.
  var RUNGUN_WORLD_H = 940;
  var RUNGUN_START_Y = 868;
  var RUNGUN_END_Y = 84;
  var RUNGUN_QUARTER_SECONDS = 45;
  var RUNGUN_PASS_BONUS_YARDS = 0; // No free yards for a catch: the catch is
  // worth the position it puts you in, and the yards after it are earned by
  // running, exactly like a run play. A completed pass is no windfall.
  var RUNGUN_PASS_STUN_SECONDS = 0; // No free step after the catch: the
  // defence is already closing, so the catch is immediately contested.
  var BOWL_PASS_TIME_LIMIT = 3.0; // Seconds to reach the gold X once the
  // pass is thrown (Medium): get to the spot before the clock runs out,
  // or the pass fails. The countdown is on the scoreboard and the X.
  // Once the receiver reaches the X, the clock stops. Easy gives 3.4s,
  // Hard 2.6s. The clock is a backstop — the ball landing is the real
  // deadline (see the flight times below), so the limit always clears
  // the longest throw plus the grace window.
  var BOWL_IMPEDE_RADIUS = 36; // A defender this close holds the runner up
  // on a pass: the route to the X is a fight through bodies, not a free run.
  var BOWL_IMPEDE_SLOW = 0.4; // Runner's pace while held up.
  var PX_PER_YARD = (RUNGUN_START_Y - RUNGUN_END_Y) / 80; // 9.8
  // The catch rule (Nov 10, Mikey: if you are in the circle when the
  // ball is arriving, you catch the ball — no dwell, no standing in
  // the circle for a set time). The ball flies slowly enough to track
  // and to run to: short 1.0s, medium 1.5s, deep 2.0s in the air, so
  // the receiver and the ball converge on the X together. Once the ball
  // lands it sits at the X for a short grace window, and arriving in
  // the circle inside that window still catches it. After the grace
  // the ball is dead and the pass is incomplete.
  var BOWL_FLIGHT_SHORT = 1.0;
  var BOWL_FLIGHT_MEDIUM = 1.5;
  var BOWL_FLIGHT_DEEP = 2.0;
  var BOWL_CATCH_GRACE = 0.6; // Seconds the landed ball waits at the X.
  var BOWL_CATCH_RADIUS = 26;
  var RUNGUN_TOUCHDOWN_BONUS = 100; // demo: yards + 100 points on a touchdown
  var BOWL_TACKLE_RADIUS = 20; // was 21: a tackle has to actually reach the runner
  var BOWL_BLOCK_RADIUS = 26; // a blocker this close to a defender ties him up
  var BOWL_BLOCK_SECONDS = 1.6; // how long a tied-up defender stays out of the play
  var BOWL_BLOCKER_SPEED = 150; // blockers run ahead at a steady clip, slower than Father
  var BOWL_PLAY_MAX_SECONDS = 9; // whistle: no play runs forever, no stall at 0:00
  // Pass-defence convergence (Nov 9, third pass): Mikey played the live
  // Bowl again and the defence was still nowhere near the receiver on a
  // pass. Measured on the previous build, the nearest man was 61-74px
  // from the runner when he reached the X, and the catch mostly failed
  // while the defence closed from a distance — it read as the catch
  // being stolen, not contested. So the coverage now holds its ground
  // ON the receiver (a man on the spot 43-54px from the X, a shadow
  // 60-75px off the route) and breaks on him at full pace the instant
  // he reaches the X. The catch itself is instant on arrival (Nov 10:
  // no dwell), so the contest is the route to the X and the tackle
  // after the catch, not a hold at the spot. The pass is a gamble now,
  // not a free score, and a defender is right there on it.
  // Human-first defence tuning (Nov 9, second pass): Mikey played the live
  // Bowl again and the defence was still far too fast. The bots scored
  // easily, but a human reacts in 600-800ms and plays on a dpad, so the
  // defence must be clearly slower than the runner (208) in a way a human
  // feels: defenders at well under half the runner's pace, a slow turn so
  // a sharp cut genuinely leaves them wrong-footed, slow pre-catch
  // coverage, and wide gaps between reinforcement waves. Fair, not trivial.
  // Final numbers (verified with human-like drivers that re-plan every
  // 700-900ms and steer by the canvas, plus a dpad-only driver that holds
  // one direction at a time like a phone thumb): defender speed 95-120
  // (was 110-135), turn 2.6 rad/s (was 3.0), pre-catch chase 0.15
  // (was 0.3), waves every 4s (was 4.5) or 15 yards (was 18) arriving in
  // pairs that bracket the runner's lane, spawning 120-180px ahead (was
  // 150-240), cap 7, opening line 3 + quarter, tackle radius 20 (was 21),
  // lead pursuit of 0.3s so defenders cut off the run instead of trailing
  // it, and a 1.15x goal-line stand inside twenty yards. A perfect player
  // still scores; a casual player gains steadily without feeling swarmed.
  // Passes were verified separately with a human-like driver: the catch
  // registers the frame the receiver reaches the circle as the ball
  // arrives, on every difficulty, so the pass game is intact.
  var BOWL_WAVE_SECONDS = 3; // was 4: fresh legs arrive sooner on a breakaway, so a long run meets reinforcements
  var BOWL_DEFENDER_CAP = 11; // was 7: at 7 the cap left no room for a wave
  // in Q3/Q4 on Medium and Hard (the opening line alone fills it), so
  // the bigger 3- and 4-man waves never fired late. At 11 every quarter
  // on Medium has room for a full 2-4 wave, and Hard has room for 2-4
  // through Q3 and 2-3 in Q4. The wave still only fires when room is
  // at least 2, and the fair-spawn checks (45px apart, 100px off the
  // runner) keep a full field from stacking into a wall.
  var BOWL_TURN_RATE = 2.6; // rad/s, was 3.0: a cut beats the chase; a 180 takes ~1.2s
  var BOWL_BURGUNDY = '#6e1a26', BOWL_BURGUNDY_DEEP = '#521219', BOWL_BURGUNDY_BRIGHT = '#a02c3c';
  var BOWL_GOLD = '#b28a2e', BOWL_GOLD_BRIGHT = '#d9b45a', BOWL_GOLD_PALE = '#f0d48a';
  var BOWL_PARCHMENT = '#f7ecd4', BOWL_INK = '#2b1d12';
  // Uniforms (Nov 10, Mikey: let the player change the kits). One scheme
  // is a home kit (Father, Your Parish) and an away kit (St Swithin's).
  // Every disc stays dark enough for the white F/S letter, and every kit
  // stays clear of the green field and of the other kit, so the two teams
  // always read apart on the pitch. Only the on-field discs change: the
  // end zone, scoreboard, cards and buttons keep the brand burgundy and
  // gold, so a kit can never make the game itself confusing.
  var BOWL_UNIFORMS = [
    { id: 'classic', name: 'Classic', home: { bright: '#8a2a38', deep: '#6e1a26', ring: '#b28a2e' }, away: { bright: '#4a3826', deep: '#241a10', ring: '#f7ecd4' } },
    { id: 'navy', name: 'Navy', home: { bright: '#2e4a7d', deep: '#1e3257', ring: '#d9b45a' }, away: { bright: '#8a2a38', deep: '#6e1a26', ring: '#f7ecd4' } },
    { id: 'royal', name: 'Royal', home: { bright: '#2f5aa8', deep: '#1e3f7d', ring: '#ffffff' }, away: { bright: '#3d3d3d', deep: '#1c1c1c', ring: '#f7ecd4' } },
    { id: 'purple', name: 'Purple', home: { bright: '#5b3a7a', deep: '#3f2a57', ring: '#d9b45a' }, away: { bright: '#9a4a16', deep: '#6e3410', ring: '#f7ecd4' } },
    { id: 'teal', name: 'Teal', home: { bright: '#17706a', deep: '#0f4a46', ring: '#d9b45a' }, away: { bright: '#7d2430', deep: '#521219', ring: '#f7ecd4' } },
  ];
  function bowlUniform(id) { for (var i = 0; i < BOWL_UNIFORMS.length; i++) if (BOWL_UNIFORMS[i].id === id) return BOWL_UNIFORMS[i]; return BOWL_UNIFORMS[0]; }
  function readBowlUniform() { return bowlUniform(storeGet('rmf-parish-bowl-uniform')); }
  // Swatch picker for the Bowl start screen: each button shows the home
  // and away discs side by side, so the pair reads at a glance. The
  // current one reads burgundy with a gold outline.
  // Segmented one-row pickers for the Bowl start card (Nov 25, Mikey:
  // the uniform pills wrapped onto two clunky rows). Every picker is a
  // single flex row of equal segments, so it fits the card on one line
  // on desktop and phone alike, with the current choice in burgundy.
  var BOWL_SEG_STYLE = 'flex:1 1 0;min-width:0;margin:0;padding:6px 2px;';
  var BOWL_SEG_ON = 'background:#6e1a26;color:#f7ecd4;box-shadow:0 0 0 2px #b28a2e;';
  function bowlSegLabel(text) {
    return '<div style="font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#6b5636;margin-bottom:4px;">' + text + '</div>';
  }
  function bowlSegRow(inner) { return '<div style="display:flex;gap:4px;">' + inner + '</div>'; }
  function uniformPickerHtml(cur) {
    return '<div class="uniform-row" style="margin:0 0 9px;">' + bowlSegLabel('Uniforms') + bowlSegRow(
      BOWL_UNIFORMS.map(function (u) {
        var on = u.id === cur;
        return '<button type="button" class="press uniform-btn" data-uniform="' + u.id + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="' + BOWL_SEG_STYLE + (on ? BOWL_SEG_ON : '') + '">' +
          '<span style="display:block;margin-bottom:3px;">' +
          '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + u.home.bright + ';border:2px solid ' + u.home.ring + ';vertical-align:middle;"></span>' +
          '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + u.away.bright + ';border:2px solid ' + u.away.ring + ';vertical-align:middle;margin-left:3px;"></span></span>' +
          '<span style="display:block;font-size:10px;letter-spacing:.03em;">' + u.name + '</span></button>';
      }).join('')) + '</div>';
  }
  // The Bowl's own compact difficulty row: same .diff-btn wiring as the
  // shared picker, but segmented to match the other start-card rows.
  // (No gold ring in the on-style: wireDiffButtons resets background
  // and colour only, so a ring would never clear.)
  function bowlDiffRowHtml(cur) {
    return '<div class="diff-row" style="margin:0 0 9px;">' + bowlSegLabel('Difficulty') + bowlSegRow(
      DIFFS.map(function (d) {
        var on = d === cur;
        return '<button type="button" class="press diff-btn" data-diff="' + d + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="' + BOWL_SEG_STYLE + 'font-size:12px;' + (on ? 'background:#6e1a26;color:#f7ecd4;' : '') + '">' + DIFF_LABEL[d] + '</button>';
      }).join('')) + '</div>';
  }
  // Field surfaces (Nov 25, Mikey: a field colour choice, with a
  // stained-glass option). Classic is the mown green the game has
  // always had; Stained Glass lays the pitch out in jewel-tone panes
  // with dark leading, in burgundy, amber and deep blue; Midnight is a
  // deep blue night pitch. The choice is remembered like the uniforms,
  // and the yard lines and numbers brighten on the dark surfaces so
  // the markings read on every field.
  var BOWL_FIELDS = [
    { id: 'classic', name: 'Classic', swatch: 'linear-gradient(180deg,#21543a,#1a4230)' },
    { id: 'stained', name: 'Stained Glass', swatch: 'repeating-linear-gradient(90deg,#5e1a24 0 6px,#7a5a17 6px 12px,#1d3557 12px 18px,#3d2a57 18px 24px)' },
    { id: 'midnight', name: 'Midnight', swatch: 'linear-gradient(180deg,#26304f,#171f36)' },
  ];
  var BOWL_STAINED_TONES = ['#5e1a24', '#7a5a17', '#1d3557', '#3d2a57'];
  function bowlField(id) { for (var i = 0; i < BOWL_FIELDS.length; i++) if (BOWL_FIELDS[i].id === id) return BOWL_FIELDS[i]; return BOWL_FIELDS[0]; }
  function readBowlField() { return bowlField(storeGet('rmf-parish-bowl-field')); }
  function fieldPickerHtml(cur) {
    return '<div class="field-row" style="margin:0 0 9px;">' + bowlSegLabel('Field') + bowlSegRow(
      BOWL_FIELDS.map(function (f) {
        var on = f.id === cur;
        return '<button type="button" class="press field-btn" data-field="' + f.id + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="' + BOWL_SEG_STYLE + (on ? BOWL_SEG_ON : '') + '">' +
          '<span style="display:inline-block;width:22px;height:12px;border-radius:3px;border:1px solid rgba(43,29,18,.5);background:' + f.swatch + ';vertical-align:-2px;margin-right:5px;"></span>' +
          '<span style="font-size:11px;">' + f.name + '</span></button>';
      }).join('')) + '</div>';
  }
  function wireFieldButtons(root, get, set) {
    if (!root) return;
    var btns = root.querySelectorAll('.field-btn');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        set(b.getAttribute('data-field'));
        btns.forEach(function (x) {
          var on = x.getAttribute('data-field') === get();
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
          x.style.background = on ? '#6e1a26' : '';
          x.style.color = on ? '#f7ecd4' : '';
          x.style.boxShadow = on ? '0 0 0 2px #b28a2e' : '';
        });
      });
    });
  }
  function wireUniformButtons(root, get, set) {
    if (!root) return;
    var btns = root.querySelectorAll('.uniform-btn');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        set(b.getAttribute('data-uniform'));
        btns.forEach(function (x) {
          var on = x.getAttribute('data-uniform') === get();
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
          x.style.background = on ? '#6e1a26' : '';
          x.style.color = on ? '#f7ecd4' : '';
          x.style.boxShadow = on ? '0 0 0 2px #b28a2e' : '';
        });
      });
    });
  }

  function mountBowl(parent, onBack) {
    var api = createStage(parent, { title: 'The Parish Bowl', onBack: onBack });
    api.overlay.style.overflowY = 'auto';
    var priestName = storeGet('rmf-parish-bowl-priest') || 'Father';
    var diff = readDiff('rungun'); // Easy / Medium / Hard; Medium is the tuned default
    var uniform = readBowlUniform(); // kit choice, remembered in the browser
    var field = readBowlField(); // field surface choice, remembered the same way
    var defLo = 100, defHi = 125, covLo = 110, covHi = 130, defBase = 3;
    var passLimit = BOWL_PASS_TIME_LIMIT, oppChance = 0.5, waveSecs = BOWL_WAVE_SECONDS;
    var blockerChance = 0.35, blockerCount = 2; // how often blockers line up, and how many
    function applyBowlDiff() {
      // Easy: slower defence, more time to reach the spot, a kinder opponent —
      // and blockers always in front of you, so the easy game reads as the
      // friendly one. Hard: faster defence, less time, a sharper opponent,
      // and blockers are rare and only one man. Medium sits between.
      if (diff === 'easy') { defLo = 80; defHi = 100; covLo = 90; covHi = 105; defBase = 2; passLimit = 3.4; oppChance = 0.35; waveSecs = 5; blockerChance = 1; blockerCount = 2; }
      else if (diff === 'hard') { defLo = 120; defHi = 150; covLo = 130; covHi = 155; defBase = 4; passLimit = 2.6; oppChance = 0.65; waveSecs = 3; blockerChance = 0.2; blockerCount = 1; }
      else { defLo = 100; defHi = 125; covLo = 110; covHi = 130; defBase = 3; passLimit = BOWL_PASS_TIME_LIMIT; oppChance = 0.5; waveSecs = BOWL_WAVE_SECONDS; blockerChance = 0.35; blockerCount = 2; }
    }
    applyBowlDiff();
    var _homeParish0 = readHomeParish();
    var parishName = storeGet('rmf-parish-bowl-parish') || (_homeParish0 ? _homeParish0.parish : '') || 'Your Parish';
    var opponent = 'St Swithin\u2019s';
    var state = 'ready'; // ready | choose | run | pass | result | over
    var customizing = false; // the name screen is up: keyboard play must not fire while it is
    var paused = false;
    var quarter = 1, clock = RUNGUN_QUARTER_SECONDS;
    var score = 0, best = readBest('rungun'), tds = 0, oppTds = 0, totalYards = 0;
    var bestPlay = 0, drivePlays = 0; // best single-play gain; plays in the current drive
    var driveYards = 0, qTurnover = false, qScored = false; // yards in the current drive; whether this quarter ended in a turnover or a score, for the opponent's field position
    var down = 1, seriesStart = 80, seriesGain = 0; // four downs, ten yards for a first
    var px = GAME_W / 2, py = RUNGUN_START_Y;
    var camY = RUNGUN_WORLD_H - GAME_H; // camera: follows the runner down the world
    function screenY(wy) { return wy - camY; }
    function updateCam() { camY = clamp(py - 190, 0, RUNGUN_WORLD_H - GAME_H); }
    var defenders = [];
    var blockers = []; // teammates who run ahead and tie up a defender each
    var waveT = 0, yardsAtWave = 80, playStartYards = 80, playStartPy = RUNGUN_START_Y, playT = 0;
    var passTarget = null, caught = false, hasBall = false, freezeT = 0;
  var ballFlight = null; // the throw in the air: launch spot, target, flight time, arrived
  var passTimeLeft = 0, passTimeMax = 0, impeded = false, reachedX = false, reachedXT = 0, graceT = 0; // countdown to the catch spot and its full length; held-up flag; reached the X; time since reaching it (coverage breaks then); time left in the grace window after the ball lands
  var passRoute = null; // what kind of throw this is (depth + direction), for the HUD
  var playKind = 'run'; // the current play, so spawn fairness can differ run vs pass
  var coverBurstT = 0; // seconds left of the coverage break burst after a catch
    var pvx = 0, pvy = 0; // runner's velocity, for the defence's lead
    var resultMain = '', resultSub = '', resultT = 0, timeGoneShown = false, hudT = 0;
    var popYards = 0, popT = 0; // floating "+N yards" after a play, display only
    var coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
    var keys = makeKeys();
    var dpadVec = { x: 0, y: 0 };
    var raf = 0, last = 0, destroyed = false;

    function yardsToGo() { return Math.max(0, Math.round((py - RUNGUN_END_Y) / PX_PER_YARD)); }
    function downWord() { return down === 1 ? '1ST' : down === 2 ? '2ND' : down === 3 ? '3RD' : '4TH'; }
    function toGoLabel() { return seriesStart <= 10 ? 'GOAL' : String(10 - seriesGain); }
    function downLabel() { return downWord() + ' & ' + toGoLabel(); }
    function defenderCount() { return defBase + quarter; } // opening line: four in Q1 on Medium, one more each quarter
    // The defence lines up ahead of the runner in the scrolling world, so
    // the play is about reading the field as it scrolls and cutting past
    // defenders in sequence — not about one wall across a squeezed field.
    // Wave reinforcements keep coming to the ball, near the runner's lane,
    // so beating the line is not a free touchdown.
    // Wave reinforcements arrive in a varying number (2 to 4) and in a
    // varying entry pattern, so a breakaway meets a different second
    // line every time instead of the same pair at the same spot. The
    // men still turn slowly, so a sharp cut beats them — the wave is
    // a choice to thread, not a wall.
    function spawnDefenders(n, upfield, line, lineDepth, bracket) {
      // Second-half adjustment: from Q3 the defence is a step quicker,
      // so a game tightens after half time instead of playing the same
      // all four quarters.
      var spd = function () { return rand(defLo, defHi) * (quarter >= 3 ? 1.08 : 1); };
      // Random front (Nov 10, Mikey: more randomness on the defence):
      // the line covers a random sub-span of the field at a random
      // offset, so the shape is different every snap instead of the
      // same neat row. The span stays wide enough for the men to keep
      // their distance from each other, and the jitter shrinks with
      // the slot width, so a snap never loses a man to the spacing check.
      var spanW = GAME_W - 100, spanX0 = 50, jit = 65;
      if (line) {
        var spanFrac = rand(Math.min(1, Math.max(0.7, (n * 50) / (GAME_W - 100))), 1);
        spanW = (GAME_W - 100) * spanFrac;
        spanX0 = 50 + rand(0, (GAME_W - 100) - spanW);
        jit = Math.min(65, (spanW / Math.max(1, n)) * 0.8);
      }
      // Wave entry (Nov 10, Mikey: the second line always came in at the
      // same spot): each wave rolls one entry pattern, so the fresh
      // defenders arrive differently every time. Bracket is the old
      // symmetric pair; stagger puts each man at his own depth; spread
      // draws the men across a wide band around the runner; flank
      // brings them in from the sidelines. The depth band is rolled
      // per wave too, so the line can sit close or deep.
      var waveGap = rand(60, 85);
      var wavePattern = null, waveDepthLo = 110, waveDepthHi = 200;
      if (bracket === 'wave') {
        var wavePatterns = ['bracket', 'stagger', 'spread', 'flank'];
        wavePattern = wavePatterns[Math.floor(Math.random() * wavePatterns.length)];
        waveDepthLo = rand(90, 135);
        waveDepthHi = waveDepthLo + rand(70, 150);
      }
      for (var i = 0; i < n; i++) {
        var d = null;
        for (var tries = 0; tries < 8; tries++) {
          var cand;
          if (line) {
            var slot = (i + 0.5) / Math.max(1, n);
            var lo = lineDepth ? lineDepth[0] : 170, hi = lineDepth ? lineDepth[1] : 230;
            cand = {
              x: clamp(spanX0 + slot * spanW + rand(-jit, jit), 40, GAME_W - 40),
              y: clamp(py - rand(lo, hi), RUNGUN_END_Y + 10, RUNGUN_START_Y - 20),
              speed: spd(),
              heading: 0,
            };
          } else if (upfield) {
            var wx, wy;
            // Every wave plugs the runner's lane with its first man (a
            // random side, a random depth in the wave band), so the fresh
            // line always contests the run; the rest of the wave follows
            // the rolled pattern, so the line still reads differently
            // every time instead of the same pair at the same spot.
            var plugSide = Math.random() < 0.5 ? -1 : 1;
            if (wavePattern === 'bracket') {
              wx = px + (i === 0 ? -waveGap : waveGap) + rand(-20, 20);
              wy = py - rand(waveDepthLo, waveDepthHi);
            } else if (wavePattern === 'stagger') {
              // Each man at his own depth, lateral offset drawn wide,
              // so the wave reads as a staggered second line, not a pair.
              if (i === 0) { wx = px + plugSide * rand(50, 95); wy = py - rand(waveDepthLo, waveDepthHi); }
              else { wx = px + rand(-200, 200); wy = py - rand(waveDepthLo + i * 55, waveDepthHi + i * 55); }
            } else if (wavePattern === 'spread') {
              // Men spread across a wide band around the runner.
              if (i === 0) { wx = px + plugSide * rand(50, 95); wy = py - rand(waveDepthLo, waveDepthHi); }
              else { wx = px + rand(-190, 190); wy = py - rand(waveDepthLo, waveDepthHi); }
            } else if (wavePattern === 'flank') {
              // From the sidelines: alternate sides, varied depth.
              if (i === 0) { wx = px + plugSide * rand(50, 95); wy = py - rand(waveDepthLo, waveDepthHi); }
              else { var flankSide = (i % 2 === 0) ? -1 : 1; wx = px + flankSide * rand(140, 210); wy = py - rand(waveDepthLo, waveDepthHi); }
            } else {
              wx = bracket ? px + (i === 0 ? -waveGap : waveGap) + rand(-20, 20) : px + rand(-140, 140);
              wy = py - rand(110, 200);
            }
            cand = {
              x: clamp(wx, 40, GAME_W - 40),
              y: clamp(wy, RUNGUN_END_Y + 10, RUNGUN_START_Y - 20),
              speed: spd(),
              heading: 0,
            };
          } else {
            cand = {
              x: rand(40, GAME_W - 40),
              y: rand(RUNGUN_END_Y + 10, RUNGUN_START_Y - 20),
              speed: spd(),
              heading: 0,
            };
          }
          // Fair spawn: never on top of the runner, never on the catch spot.
          // On a run the front may set up closer (60px): at 100px no
          // defender could ever reach the runner near the line, so a
          // stuffed run was impossible and every carry gained 4+ yards
          // before contact. 60px still gives the runner a beat to read
          // the front and pick a gap.
          var minSpawn = (line && playKind === 'run') ? 60 : 100;
          if (Math.hypot(cand.x - px, cand.y - py) < minSpawn) continue;
          if (passTarget && Math.hypot(cand.x - passTarget.x, cand.y - passTarget.y) < 70) continue;
          // Random spawn: keep the line from stacking two men on one spot,
          // so the randomised positions still read as a spread-out defence.
          var tooClose = false;
          for (var j = 0; j < defenders.length; j++) {
            if (Math.hypot(defenders[j].x - cand.x, defenders[j].y - cand.y) < 45) { tooClose = true; break; }
          }
          if (tooClose) continue;
          d = cand; break;
        }
        if (!d) continue;
        // Per-man traits (Nov 10, Mikey: more randomness): every
        // defender varies a little in pace, in how far he shades toward
        // the ball inside his lane, in how much lateral room his lane
        // gives him, and in how quickly he breaks once the receiver
        // reaches the X. The averages are unchanged, so the difficulty
        // stays where it was tuned — the variation is in the feel.
        d.aggr = rand(0.9, 1.1);
        d.laneGive = rand(0.3, 0.5);
        d.laneWidth = rand(40, 55);
        d.breakDelay = rand(0, 0.05);
        d.heading = Math.atan2(py - d.y, px - d.x);
        d.lane = d.x; // assigned lane: the defender's zone to hold on a pass
        defenders.push(d);
      }
    }
    function pickPassTarget() {
      // Throws vary from play to play: short, medium and deep routes,
      // landing left, centre or right, so the receiver reads the gold X
      // each time instead of running the same line every pass. (Nov 9,
      // Mikey: mix up the distance of the throw and where it lands.)
      // Depth classes in yards: short 5-9, medium 10-17, deep 18-27.
      // Deep only when there is room: the route cannot run past the end
      // zone, so the depth is capped by the yards still to go.
      var roll = Math.random();
      var lo, hi;
      if (roll < 0.35) { lo = 5; hi = 9; }
      else if (roll < 0.75) { lo = 10; hi = 17; }
      else { lo = 18; hi = 27; }
      var room = Math.max(3, playStartYards - 2);
      var depth = Math.max(3, Math.min(rand(lo, hi), room));
      // Lateral lane: spread the landing spot across the width of the
      // field instead of always straight upfield from the snap.
      var lanes = [-170, -120, -75, -35, 0, 35, 75, 120, 170];
      var lat = lanes[Math.floor(Math.random() * lanes.length)];
      var baseX = clamp(px + lat, 36, GAME_W - 36);
      // The catch spot may sit just off the goal line (a fade to the end
      // zone) when the drive is inside the five, so the route label never
      // reads negative and a catch there scores.
      var baseY = Math.max(RUNGUN_END_Y + 4, py - depth * PX_PER_YARD);
      // Then pick the most open nearby spot, as before, so the X lands
      // in space rather than on a defender.
      var bestSpot = null, bestScore = -1e9;
      var offsets = [[0, 0], [-25, 0], [25, 0], [0, -15], [0, 15], [-25, -15], [25, -15]];
      offsets.forEach(function (o) {
        var tx = clamp(baseX + o[0], 30, GAME_W - 30);
        var ty = clamp(baseY + o[1], RUNGUN_END_Y + 4, RUNGUN_START_Y - 10);
        var minD = 999;
        defenders.forEach(function (dd) { minD = Math.min(minD, Math.hypot(dd.x - tx, dd.y - ty)); });
        var s = minD - Math.hypot(tx - baseX, ty - baseY) * 0.4;
        if (s > bestScore) { bestScore = s; bestSpot = { x: tx, y: ty }; }
      });
      // Reachability: the receiver has passLimit seconds at 208px/s, and
      // the defence holds him up near the spot, so cap the straight-line
      // run to the X at the distance covered at an effective 160px/s —
      // full pace minus room to be held up. The cap scales with the
      // difficulty's time limit, so a deep throw stays fair on Hard too.
      // Pull the spot back toward the runner along the same line if it
      // is beyond that, so the direction still reads but the catch
      // stays fair.
      var dx = bestSpot.x - px, dy = bestSpot.y - py;
      var dist = Math.hypot(dx, dy);
      // The countdown is the flight plus the grace window (capped by the
      // difficulty limit), so the reach cap uses that same time: a spot
      // the receiver cannot reach before the ball is gone is never fair,
      // whatever the difficulty's headline limit.
      var flightDur = depth < 10 ? BOWL_FLIGHT_SHORT : depth < 18 ? BOWL_FLIGHT_MEDIUM : BOWL_FLIGHT_DEEP;
      var MAX_REACH = Math.min(passLimit, flightDur + BOWL_CATCH_GRACE) * 160;
      if (dist > MAX_REACH) {
        var k = MAX_REACH / dist;
        bestSpot = { x: px + dx * k, y: py + dy * k };
      }
      return bestSpot;
    }
    // Two men on the receiver, and they are ON the receiver: one shadows
    // the route, one sits on the catch spot. They hold their ground near
    // the route and the X instead of running the receiver down on the way,
    // so the receiver can reach the spot — and the contest happens there,
    // with a man right on him, instead of the defence tackling him before
    // he arrives. They play the ball, not the man: they break only once
    // the ball is down and the receiver is at the X, so the contest is
    // the catch itself and the tackle right after it, not a tackle
    // before the catch (pass interference). The shadow sits wide of the
    // route, the man on the spot sits beside the X, never on it.
    // Both men work the same side of the route: the shadow guards the
    // approach and the man sits on the X, so the contest is a fight on
    // one side and the receiver can beat it with a cut to the open side.
    // Their offsets are perpendicular to the route (snap to X), not just
    // sideways in x: throws now vary from short to deep and left to
    // right, so a purely lateral offset could land a man on a shallow
    // diagonal route and tackle the receiver before he arrives. Off the
    // route line, the contest stays at the X whatever the throw.
    function spawnCoverage() {
      var dx = passTarget.x - px, dy = passTarget.y - py;
      var dl = Math.hypot(dx, dy) || 1;
      var ux = dx / dl, uy = dy / dl; // route direction, snap to X
      var perpX = -uy, perpY = ux; // perpendicular to the route
      var mx = (px + passTarget.x) / 2, my = (py + passTarget.y) / 2;
      var side = Math.random() < 0.5 ? -1 : 1;
      var offShadow = side * rand(55, 80);
      var offMan = side * rand(42, 58); // same side as the shadow: the
      // bracket (opposite sides) squeezed the approach and dropped the
      // catch rate across the board in playtesting, so the contest
      // geometry stays as it was tuned. Lane discipline lives in the
      // line holding its zones, not in the coverage pair. The offsets
      // are drawn a little wider than before (Nov 10, Mikey: vary the
      // defence from play to play), so the contest sits a different
      // distance off the route each snap.
      var spots = [
        { x: mx + perpX * offShadow, y: my + perpY * offShadow },
        { x: passTarget.x + perpX * offMan, y: passTarget.y + perpY * offMan, spot: true },
      ];
      spots.forEach(function (s) {
        var x = clamp(s.x, 40, GAME_W - 40);
        var y = clamp(s.y, RUNGUN_END_Y + 10, RUNGUN_START_Y - 20);
        if (Math.hypot(x - px, y - py) < 45) return;
        if (Math.hypot(x - passTarget.x, y - passTarget.y) < 35) return;
        // The man on the spot eases toward a ring 44px off the X as the
        // ball flies (see moveDefenders), so he is on the spot when the
        // ball lands. The ring stays outside tackle reach of the X's
        // centre, so closing never gifts pass interference by itself.
        var ringX, ringY;
        if (s.spot) {
          var rx = x - passTarget.x, ry = y - passTarget.y, rl = Math.hypot(rx, ry) || 1;
          ringX = clamp(passTarget.x + rx / rl * 44, 40, GAME_W - 40);
          ringY = clamp(passTarget.y + ry / rl * 44, RUNGUN_END_Y + 10, RUNGUN_START_Y - 20);
        }
        defenders.push({ x: x, y: y, speed: rand(covLo, covHi), heading: Math.atan2(py - y, px - x), cover: true, spotCover: !!s.spot, ringX: ringX, ringY: ringY, hx: x, hy: y, lane: x, aggr: rand(0.9, 1.1), laneGive: rand(0.3, 0.5), laneWidth: rand(40, 55), breakDelay: rand(0, 0.05) });
      });
    }
    function startPlay(kind) {
      playKind = kind;
      if (paused) doResume();
      playStartYards = yardsToGo();
      playStartPy = py;
      playT = 0;
      caught = false; graceT = 0; reachedXT = 0; freezeT = 0; coverBurstT = 0;
      defenders = [];
      // On a pass the deep line drops beyond the catch spot, and two men
      // cover the receiver, so reaching the gold X is a fight through
      // bodies under a countdown, not a free run. On a run the line sits
      // just ahead of the runner, as usual.
      // On a run the line sits closer than it used to (120-170px ahead
      // instead of the default), so the runner meets it sooner instead of
      // building a head of steam untouched — a first down has to be
      // earned, and a stuffed run can actually happen.
      // The line spawns randomly (Nov 10, Mikey: vary the defence from
      // play to play). The front covers a random sub-span of the field
      // at a random offset, each man takes a jittered slot and a depth
      // drawn from a wide band, and every man carries his own pace,
      // lane room, shade and break timing, so the coverage looks
      // different every snap instead of the same neat row. The band is
      // anchored beyond the deepest possible catch spot (the
      // reachability cap), so a line man can never sit on the gold X
      // itself; the fair-spawn checks keep men off the runner and off
      // each other.
      var maxReach = passLimit * 160; // deepest the gold X can sit
      spawnDefenders(defenderCount(), true, true, kind === 'pass' ? [maxReach + 35, maxReach + 155] : [55, 120]);
      // Blockers (Nov 10, Mikey: every once in a while, two men in front
      // of you to clear a lane — on Easy they are always there). A blocker
      // runs ahead of Father and ties up the nearest defender in his
      // way, so the defence has a hole in it for a beat. They only engage
      // the line, never the coverage pair, so the contest at the catch
      // spot stays honest.
      blockers = [];
      if (Math.random() < blockerChance) {
        for (var bi = 0; bi < blockerCount; bi++) {
          blockers.push({
            x: clamp(px + (bi === 0 ? -45 : 45) + rand(-15, 15), 40, GAME_W - 40),
            y: clamp(py - rand(50, 85), RUNGUN_END_Y + 10, RUNGUN_START_Y - 20),
            speed: BOWL_BLOCKER_SPEED, target: null, engaged: null, spent: false,
          });
        }
        blockers.forEach(function (b) {
          var bestD = null, bestDist = 1e9;
          defenders.forEach(function (d) {
            if (d.cover) return;
            var taken = false;
            blockers.forEach(function (o) { if (o !== b && o.target === d) taken = true; });
            if (taken) return;
            var dd = Math.hypot(d.x - b.x, d.y - b.y);
            if (dd < bestDist) { bestDist = dd; bestD = d; }
          });
          b.target = bestD;
        });
        api.showBanner('Blockers in!', 1600);
      }
      waveT = 0; yardsAtWave = playStartYards;
      if (kind === 'pass') {
        passTarget = pickPassTarget();
        // Route label for the HUD: what kind of throw this is, so the
        // receiver can read it at the snap even when the X sits near the
        // top of the screen. Depth in yards, direction across the field.
        var rDepth = Math.round((py - passTarget.y) / PX_PER_YARD);
        var rLat = passTarget.x - px;
        passRoute = {
          yards: Math.max(1, rDepth), // never negative: the spot can sit on the goal line
          dir: rLat < -25 ? 'left' : rLat > 25 ? 'right' : 'middle',
          kind: rDepth < 10 ? 'Short' : rDepth < 18 ? 'Medium' : 'Deep',
        };
        spawnCoverage();
        // Run and gun: the ball leaves Father's hands on an arc to the X,
        // so the receiver watches it coming and times the catch. Flight
        // time scales with the throw and is long enough to run to: short
        // 1.0s, medium 1.5s, deep 2.0s, so the ball and the receiver
        // converge on the X together. The countdown is the time until the
        // ball is gone (flight plus the grace window), capped by the
        // difficulty's pass limit.
        ballFlight = { x0: px, y0: py, x1: passTarget.x, y1: passTarget.y, t: 0, dur: passRoute.kind === 'Short' ? BOWL_FLIGHT_SHORT : passRoute.kind === 'Deep' ? BOWL_FLIGHT_DEEP : BOWL_FLIGHT_MEDIUM, arrived: false };
        passTimeLeft = Math.min(passLimit, ballFlight.dur + BOWL_CATCH_GRACE);
        passTimeMax = passTimeLeft;
        impeded = false; reachedX = false; reachedXT = 0; graceT = 0;
        hasBall = false;
        state = 'pass';
      } else {
        passTarget = null; passRoute = null; ballFlight = null;
        hasBall = true;
        state = 'run';
      }
      api.hideOverlay();
      updateHud();
    }
    // One place where a play is scored and the downs are booked, so the
    // result slab, the coach line and the HUD always agree.
    function endPlay(gained, main, sub, flags) {
      flags = flags || {};
      gained = Math.max(0, Math.round(gained));
      score += gained;
      // Best single play, in yards (a touchdown counts its yardage, not
      // the bonus), and the drive's play count, for the full-time summary.
      var playYards = flags.touchdown ? playStartYards : gained;
      if (playYards > bestPlay) bestPlay = playYards;
      totalYards += playYards; // true yards gained, for the summaries (the score also carries bonuses)
      drivePlays += 1;
      // Floating "+N yards" above the runner when the play ends, so the
      // gain reads on the field as well as in the result slab. Display only:
      // it does not touch the play, the pass, or the score.
      if (playYards > 0) { popYards = playYards; popT = 1.4; }
      var note = '';
      var turnoverOnDowns = false;
      if (flags.touchdown) {
        tds += 1;
        py = RUNGUN_START_Y; px = GAME_W / 2;
        down = 1; seriesStart = 80; seriesGain = 0;
        drivePlays = 0; driveYards = 0; qScored = true;
      } else if (flags.incomplete) {
        py = playStartPy;
        down += 1;
        if (down > 4) {
          note = ' Turnover on downs — back to the 80.';
          turnoverOnDowns = true;
          py = RUNGUN_START_Y; px = GAME_W / 2;
          down = 1; seriesStart = 80; seriesGain = 0;
          drivePlays = 0; driveYards = 0; qTurnover = true;
        }
      } else {
        seriesGain += gained;
        driveYards += gained;
        if (seriesGain >= 10 || flags.pi) {
          // A first down pays +10: a sustained drive is worth more than
          // the same yards scattered across turnovers. Pass interference
          // is an automatic first down, whatever the yardage.
          score += 10;
          note = flags.pi ? ' Automatic first down!' : ' First down! +10';
          down = 1; seriesStart = yardsToGo(); seriesGain = 0;
        } else {
          down += 1;
          if (down > 4) {
            note = ' Turnover on downs — back to the 80.';
            turnoverOnDowns = true;
            py = RUNGUN_START_Y; px = GAME_W / 2;
            down = 1; seriesStart = 80; seriesGain = 0;
            drivePlays = 0; driveYards = 0; qTurnover = true;
          }
        }
      }
      resultMain = main; resultSub = sub + note;
      coachLine = main + ' ' + sub + note;
      // A failed fourth down gets its own screen, not just a suffix on
      // the 1.6-second result slab: the end of a drive was easy to miss
      // entirely, and the game simply reappeared at the 80 with a fresh
      // 1ST & 10 as if nothing had happened.
      if (turnoverOnDowns) { showTurnoverOnDowns(main, sub); }
      else { resultT = 1.6; state = 'result'; }
      updateHud();
    }
    // The turnover-on-downs screen, in the same card style as half time
    // and full time. The booking is already done by endPlay: the ball is
    // back at the 80 with a fresh set of downs, and qTurnover is set, so
    // St Swithin's take their field-position edge when the quarter turns
    // — the game's standing way of booking the change of possession,
    // since their drives resolve at the quarter break. This screen just
    // makes the moment land before the next drive is chosen.
    function showTurnoverOnDowns(main, sub) {
      state = 'turnover';
      api.showOverlay(bowlCard('Quarter ' + quarter + ' · ' + esc(parishName), 'Turnover on downs',
        '<p style="margin:0 0 4px;font-size:15px;">' + esc(main) + ' ' + esc(sub) + '</p>' +
        '<p style="margin:0 0 16px;font-size:15px;line-height:1.45;">Four downs and the line to gain was not made, so the drive is over and St Swithin\u2019s take over. Your next drive starts back at the 80.</p>',
        bowlBtn('bowl-turnover-next', 'Next drive') + keyHint('Keyboard: Space or Enter starts the next drive.')));
      var nx = document.getElementById('bowl-turnover-next');
      if (nx) nx.addEventListener('click', continueAfterTurnover);
    }
    function continueAfterTurnover() {
      if (clock <= 0) { endQuarter(); } else { showChoose(); }
    }
    function endQuarter() {
      // St Swithin's drive after every quarter, per the demo: the Monsignor
      // Coach sums it up and the match score moves, so the game is a match
      // against an opponent, not a solo points tally. The drive starts from
      // your field position: a turnover on downs hands them a short field,
      // a touchdown leaves them starting deep, so your quarter shapes
      // theirs instead of a flat coin flip.
      var chance = oppChance;
      if (qTurnover) chance += 0.2; else if (qScored) chance -= 0.15;
      chance = Math.max(0.15, Math.min(0.85, chance));
      var oppScored = Math.random() < chance;
      if (oppScored) oppTds += 1;
      qTurnover = false; qScored = false;
      if (quarter >= 4) { gameOver(); return; }
      quarter += 1; clock = RUNGUN_QUARTER_SECONDS; timeGoneShown = false;
      py = RUNGUN_START_Y; px = GAME_W / 2;
      down = 1; seriesStart = 80; seriesGain = 0;
      drivePlays = 0; driveYards = 0;
      var matchLine = 'Match ' + (tds * 7) + '–' + (oppTds * 7) + '.';
      var oppLine = oppScored
        ? 'St Swithin\u2019s drove down and scored.'
        : 'St Swithin\u2019s drive stalled.';
      if (quarter === 3) {
        // Half time: the match so far, and the warning that St Swithin's
        // have made their adjustments — the defence is a step quicker in
        // the second half.
        state = 'half';
        var halfYards = totalYards;
        coachLine = 'Monsignor Coach: Second half — St Swithin\u2019s have tightened up. Your ball.';
        api.showOverlay(bowlCard('Half time', esc(parishName) + ' ' + (tds * 7) + ' — ' + esc(opponent) + ' ' + (oppTds * 7),
          '<p style="margin:0 0 4px;font-size:15px;">' + oppLine + ' ' + matchLine + '</p>' +
          '<p style="margin:0 0 4px;font-size:15px;">' + tds + (tds === 1 ? ' touchdown' : ' touchdowns') + ' · ' + halfYards + ' yards gained · ' + score + ' points.</p>' +
          (bestPlay > 0 ? '<p style="margin:0 0 4px;font-size:15px;">Best play: +' + bestPlay + ' yards.</p>' : '') +
          '<p style="margin:0 0 16px;font-size:14px;line-height:1.45;">Second half: St Swithin\u2019s have made their adjustments, so the defence is a step quicker from here.</p>',
          bowlBtn('bowl-second-half', 'Second half') + keyHint('Keyboard: Space or Enter starts the second half.')));
        var sh = document.getElementById('bowl-second-half');
        if (sh) sh.addEventListener('click', function () { state = 'choose'; showChoose(); });
        updateHud();
        return;
      }
      coachLine = oppScored
        ? 'Monsignor Coach: ' + oppLine + ' ' + matchLine + ' Your ball — answer them.'
        : 'Monsignor Coach: ' + oppLine + ' ' + matchLine + ' Your ball — keep it rolling.';
      state = 'choose'; showChoose();
    }
    function gameOver() {
      state = 'over';
      var finalBest = writeBest('rungun', score);
      submitParishScore('rungun', score);
      best = finalBest;
      var yardsGained = totalYards;
      api.showOverlay(bowlCard('Full time', esc(parishName) + ' ' + (tds * 7) + ' — ' + esc(opponent) + ' ' + (oppTds * 7),
        '<p style="margin:0 0 4px;font-size:15px;">' + tds + (tds === 1 ? ' touchdown' : ' touchdowns') + ' · ' + yardsGained + ' yards gained · ' + score + ' points.</p>' +
        (bestPlay > 0 ? '<p style="margin:0 0 4px;font-size:15px;">Best play: +' + bestPlay + ' yards.</p>' : '') +
        '<p style="margin:0 0 16px;font-size:14px;">Best: ' + finalBest + '</p>',
        '<button type="button" class="big-btn press" id="bowl-again" style="background:' + BOWL_BURGUNDY + ';color:' + BOWL_PARCHMENT + ';letter-spacing:.14em;text-transform:uppercase;">Play again</button>' +
        '<button type="button" class="linklike" id="bowl-back">Back to arcade</button>' +
        keyHint('Keyboard: Space or Enter plays again.')));
      var again = document.getElementById('bowl-again');
      if (again) again.addEventListener('click', function () { resetGame(); });
      var back = document.getElementById('bowl-back');
      if (back) back.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function resetGame() {
      parishSubmitted['rungun'] = false;
      quarter = 1; clock = RUNGUN_QUARTER_SECONDS; score = 0; tds = 0; oppTds = 0; totalYards = 0;
      bestPlay = 0; drivePlays = 0; driveYards = 0; popYards = 0; popT = 0;
      qTurnover = false; qScored = false;
      px = GAME_W / 2; py = RUNGUN_START_Y; timeGoneShown = false;
      down = 1; seriesStart = 80; seriesGain = 0;
      coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
      defenders = []; blockers = []; passTarget = null; caught = false; hasBall = false; freezeT = 0; playT = 0; ballFlight = null; coverBurstT = 0;
      state = 'choose'; showChoose();
    }
    // ---- designed overlay card: parchment panel, burgundy frame, gold rule ----
    function bowlCard(eyebrow, title, body, extra, slim) {
      // Slim is the start card only (Nov 25, Mikey: the start screen
      // scrolled internally and cut the button off): tighter padding,
      // title and rule spacing so the whole card fits on one page.
      return '<div style="background:' + BOWL_PARCHMENT + ';border:3px solid ' + BOWL_BURGUNDY + ';border-radius:16px;padding:' + (slim ? '15px 16px 12px' : '24px 22px 20px') + ';max-width:430px;margin:0 auto;text-align:center;box-shadow:0 14px 34px rgba(20,8,6,.45);color:' + BOWL_INK + ';font-family:Georgia,serif;">' +
        '<div style="font-size:' + (slim ? '10px' : '11px') + ';font-weight:700;letter-spacing:.34em;text-transform:uppercase;color:' + BOWL_BURGUNDY_BRIGHT + '">' + eyebrow + '</div>' +
        '<div style="font-size:' + (slim ? '25px' : '32px') + ';font-weight:700;line-height:1.05;margin:' + (slim ? '6px 0 1px' : '10px 0 2px') + ';letter-spacing:.01em;">' + title + '</div>' +
        '<div style="width:64px;height:3px;background:' + BOWL_GOLD + ';margin:' + (slim ? '7px auto' : '12px auto') + ';"></div>' +
        body + (extra || '') + '</div>';
    }
    function bowlBtn(id, label) {
      return '<button type="button" class="big-btn press" id="' + id + '" style="background:' + BOWL_BURGUNDY + ';color:' + BOWL_PARCHMENT + ';letter-spacing:.14em;text-transform:uppercase;">' + label + '</button>';
    }
    // A key shown on the button itself, so a keyboard player sees at a
    // glance which key picks it — no hunting through the fine print.
    function keyChip(key) {
      if (!hasKeyboard()) return '';
      return '<span style="display:inline-block;min-width:20px;padding:2px 7px;margin-left:10px;border:1.5px solid rgba(255,244,214,.7);border-radius:5px;font-size:11px;font-weight:700;letter-spacing:.08em;vertical-align:2px;">' + key + '</span>';
    }
    // One line under a big button, naming the keyboard way to press it.
    function keyHint(text) {
      if (!hasKeyboard()) return '';
      return '<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#6b5636;">' + text + '</p>';
    }
    function showStart() {
      state = 'ready';
      customizing = false;
      api.showOverlay(bowlCard(esc(parishName) + ' vs ' + esc(opponent), 'The Parish Bowl',
        '<p style="margin:0 0 10px;font-size:13.5px;line-height:1.4;max-width:none;">Four 45-second quarters. Run or pass: four downs to gain ten yards, a touchdown worth the yards plus a hundred. St Swithin\u2019s drive after every quarter. Two blockers sometimes clear your lane \u2014 always, on Easy. <span style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b5636;">' + gameMark('rungun') + '</span></p>',
        bowlDiffRowHtml(diff) +
        uniformPickerHtml(uniform.id) +
        fieldPickerHtml(field.id) +
        bowlBtn('bowl-kickoff', 'Kick off for ' + esc(parishName)) +
        keyHint('Keyboard: Space or Enter kicks off · R runs, T throws.') +
        '<button type="button" class="linklike" id="bowl-custom">Play as your home parish priest</button>', true));
      wireDiffButtons(api.overlay, 'rungun', function () { return diff; }, function (d) { diff = d; writeDiff('rungun', d); applyBowlDiff(); });
      wireUniformButtons(api.overlay, function () { return uniform.id; }, function (u) { uniform = bowlUniform(u); storeSet('rmf-parish-bowl-uniform', u); });
      wireFieldButtons(api.overlay, function () { return field.id; }, function (f) { field = bowlField(f); storeSet('rmf-parish-bowl-field', f); });
      var kick = document.getElementById('bowl-kickoff');
      if (kick) {
        // A touch smaller than the shared big button and kept to one
        // line, so the start card stays on one screen.
        kick.style.fontSize = '15px';
        kick.style.padding = '11px 12px';
        kick.style.maxWidth = '100%';
        kick.style.whiteSpace = 'nowrap';
        kick.addEventListener('click', function () { state = 'choose'; showChoose(); });
      }
      var custom = document.getElementById('bowl-custom');
      if (custom) custom.addEventListener('click', showCustomize);
      updateHud();
    }
    function showCustomize() {
      customizing = true;
      api.showOverlay(bowlCard('Your home parish priest', 'Who\u2019s carrying it?',
        '<p style="margin:0 0 14px;font-size:14px;line-height:1.45;">Your priest and parish run through the game: the scoreboard, the coach, and the results.</p>' +
        '<label style="display:block;text-align:left;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;margin-bottom:12px;">Priest name<input id="rungun-priest-name" placeholder="Father" value="' + esc(storeGet('rmf-parish-bowl-priest') || '') + '" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px 12px;border:2px solid ' + BOWL_BURGUNDY + ';border-radius:8px;background:#fff;font-family:Georgia,serif;font-size:15px;letter-spacing:0;text-transform:none;font-weight:400;"></label>' +
        '<label style="display:block;text-align:left;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;margin-bottom:16px;">Parish name<input id="rungun-parish-name" placeholder="St Patrick\u2019s" value="' + esc(storeGet('rmf-parish-bowl-parish') || (readHomeParish() || {}).parish || '') + '" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px 12px;border:2px solid ' + BOWL_BURGUNDY + ';border-radius:8px;background:#fff;font-family:Georgia,serif;font-size:15px;letter-spacing:0;text-transform:none;font-weight:400;"></label>',
        '<button type="button" class="big-btn press" id="bowl-save-names" style="background:' + BOWL_BURGUNDY + ';color:' + BOWL_PARCHMENT + ';letter-spacing:.14em;text-transform:uppercase;">Save</button>' +
        '<button type="button" class="linklike" id="bowl-forget-names">Forget my names</button>' +
        '<button type="button" class="linklike" id="bowl-custom-back">Back</button>'));
      var save = document.getElementById('bowl-save-names');
      if (save) save.addEventListener('click', function () {
        var pn = (document.getElementById('rungun-priest-name').value || '').trim();
        var pp = (document.getElementById('rungun-parish-name').value || '').trim();
        if (pn) storeSet('rmf-parish-bowl-priest', pn); else storeDel('rmf-parish-bowl-priest');
        if (pp) storeSet('rmf-parish-bowl-parish', pp); else storeDel('rmf-parish-bowl-parish');
        priestName = pn || 'Father';
        parishName = pp || 'Your Parish';
        coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
        showStart();
      });
      var forget = document.getElementById('bowl-forget-names');
      if (forget) forget.addEventListener('click', function () {
        storeDel('rmf-parish-bowl-priest'); storeDel('rmf-parish-bowl-parish');
        priestName = 'Father'; parishName = 'Your Parish';
        coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
        showStart();
      });
      var back = document.getElementById('bowl-custom-back');
      if (back) back.addEventListener('click', showStart);
    }
    function showChoose() {
      state = 'choose';
      api.showOverlay(bowlCard('Quarter ' + quarter + ' · ' + esc(parishName), esc(downLabel()),
        '<p style="margin:0 0 4px;font-size:15px;">' + yardsToGo() + ' yards to the end zone.</p>' +
        '<p style="margin:0 0 4px;font-size:14px;line-height:1.45;">Coach: ' + esc(coachLine) + '</p>' +
        (drivePlays > 0 ? '<p style="margin:0 0 16px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b5636;">Drive: ' + drivePlays + (drivePlays === 1 ? ' play' : ' plays') + ' · +' + driveYards + ' yards</p>' : '<p style="margin:0 0 16px;font-size:14px;line-height:1.45;">&nbsp;</p>'),
        bowlBtn('bowl-run', 'Run' + keyChip('R')) + bowlBtn('bowl-pass', 'Pass' + keyChip('T')) +
        '<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#6b5636;">Clock stops while you choose. Pass: you have ' + passLimit.toFixed(1) + ' seconds to reach the gold X, and the defence will hold you up on the way, so beat them to the spot and be in the gold circle as the ball arrives, then run it in. A tackle before the catch is pass interference — +10 yards and a first down. The clock running out is incomplete.' + (hasKeyboard() ? ' Keys: R runs, T throws.' : '') + '</p>'));
      var run = document.getElementById('bowl-run');
      if (run) run.addEventListener('click', function () { startPlay('run'); });
      var pass = document.getElementById('bowl-pass');
      if (pass) pass.addEventListener('click', function () { startPlay('pass'); });
      updateHud();
    }
    // ---- the scoreboard strip: burgundy band, gold numerals ----
    function updateHud() {
      api.setHud('<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;background:' + BOWL_BURGUNDY + ';border-radius:10px;padding:9px 16px;color:' + BOWL_PARCHMENT + ';font-family:Georgia,serif;">' +
        '<span style="font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:' + BOWL_GOLD_PALE + '">Q' + quarter + '</span>' +
        '<span style="font-size:20px;font-weight:700;line-height:1;color:#fff">' + Math.ceil(clock) + '<span style="font-size:11px;color:' + BOWL_GOLD_PALE + '">s</span></span>' +
        '<span style="font-size:14px;font-weight:700;letter-spacing:.1em;color:' + BOWL_GOLD_BRIGHT + '">' + esc(downLabel()) + '</span>' +
        '<span style="font-size:12px;letter-spacing:.14em;text-transform:uppercase">' + yardsToGo() + ' to go</span>' +
        (state === 'pass' && !caught && passRoute ? '<span style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:' + BOWL_GOLD_PALE + '">' + passRoute.kind + ' ' + passRoute.dir + ' · ' + passRoute.yards + ' yds</span>' : '') +
        (state === 'pass' && !caught && !reachedX ? '<span style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:' + (passTimeLeft <= 1 ? '#ff8a7a' : BOWL_GOLD_BRIGHT) + '">Catch ' + Math.max(0, passTimeLeft).toFixed(1) + 's</span>' : '') +
        '<span style="margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase">' + esc(parishName) + ' <b style="font-size:22px;color:' + BOWL_GOLD_BRIGHT + '">' + score + '</b></span>' +
        '<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:' + BOWL_GOLD_PALE + '">Match ' + (tds * 7) + '–' + (oppTds * 7) + '</span>' +
        (diff !== 'medium' ? '<span style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:' + BOWL_GOLD_PALE + '">' + DIFF_LABEL[diff] + '</span>' : '') +
        '<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:' + BOWL_GOLD_PALE + '">Best ' + best + '</span>' +
        '</div>');
    }
    function movePlayer(dt) {
      var ax = keys.axis();
      var dx = ax.x + dpadVec.x, dy = ax.y + dpadVec.y;
      // Direct touch: while a finger is on the field, the player runs
      // toward it. Arrow keys and the pad feed the same vector, so every
      // input works together and none is removed.
      if (touchTarget) {
        var tdx = touchTarget.x - px, tdy = touchTarget.y - py;
        var tl = Math.hypot(tdx, tdy);
        if (tl > 10) { dx += tdx / tl; dy += tdy / tl; }
      }
      var len = Math.hypot(dx, dy);
      if (len > 0) { dx /= len; dy /= len; }
      // Held up: on a pass, a defender in your face slows you down, so the
      // route to the X is a fight through bodies. After the catch, and on
      // a run, the runner is never held up, only tackled.
      impeded = false;
      if (state === 'pass' && !caught) {
        for (var i = 0; i < defenders.length; i++) {
          if (defenders[i].blockedT > 0) continue; // tied up: cannot hold the runner up
          if (Math.hypot(defenders[i].x - px, defenders[i].y - py) < BOWL_IMPEDE_RADIUS) { impeded = true; break; }
        }
      }
      // A pure run play is a step slower (182 vs 208); a caught pass still
      // runs at full pace. The hold-up already slows a pass, so the run
      // slowdown only applies to a run play before the catch.
      var speed = ((state === 'run' && !caught) ? 182 : 208) * (impeded ? BOWL_IMPEDE_SLOW : 1); // Same pace with or without the ball: a caught pass
      // gives no speed edge. The catch buys field position, not a faster run.
      px = clamp(px + dx * speed * dt, 16, GAME_W - 16);
      // The goal line is the floor: reaching it scores. The start line is
      // the ceiling: no running backwards past your own 80, no negative yards.
      py = clamp(py + dy * speed * dt, RUNGUN_END_Y, RUNGUN_START_Y);
      updateCam();
    }
    function moveDefenders(dt) {
      if (freezeT > 0) return;
      // Before the catch the men on the receiver hold their ground near
      // the route and the spot, and the deep line closes at three-fifths
      // pace, so the defence is set around the ball while the clock runs
      // and a man is right there when the receiver reaches the spot. The
      // coverage breaks only once the ball is down and the receiver is
      // at the X: breaking earlier tackled waiting receivers before the
      // ball arrived, which is pass interference. The runner is still the
      // faster man in
      // open space, so the coverage has to hold him up and arrive with
      // him, not run him down from behind. After the catch (or on a run)
      // everyone hunts at full pace, but every defender steers with a
      // limited turn rate, so a sharp cut leaves them wrong-footed instead
      // of glued to the runner.
      // Goal-line stand: inside twenty yards the defence digs in and moves
      // a little faster, so breaking the line is the easy part and scoring
      // is the hard part. The tension rises as the end zone gets closer.
      var goalBoost = yardsToGo() <= 20 ? 1.15 : 1;
      defenders.forEach(function (d) {
        // Tied up by a blocker: out of the play for a beat — no chase,
        // no tackle, no holding the runner up.
        if (d.blockedT > 0) return;
        // Coverage men on a pass hold their ground until the ball is down
        // and the receiver has reached the X, then break on him at full
        // pace. Holding means the receiver can actually reach the spot
        // instead of being run down on the way. The coverage plays the
        // ball, not the man: breaking on the spot alone tackled waiting
        // receivers before the ball arrived, which is pass interference
        // and gifted the offence yards for the defence's mistake. The
        // contest is the catch itself and the tackle right after it.
        // The man on the spot does not stand still while the ball flies:
        // he eases from his holding spot toward the ring off the X, so he
        // arrives on the spot with the ball instead of standing 50px off
        // it. The shadow keeps guarding the approach from his spot.
        var ballDown = !!(ballFlight && ballFlight.arrived);
        var coverBreak = state === 'pass' && !caught && d.cover && reachedX && ballDown && reachedXT >= (d.breakDelay || 0);
        var holdX = null, holdY = null;
        if (state === 'pass' && !caught && d.cover && !coverBreak && d.hx !== undefined) {
          holdX = d.hx; holdY = d.hy;
          if (d.spotCover && d.ringX !== undefined && ballFlight) {
            var prog = clamp(ballFlight.t / ballFlight.dur, 0, 1);
            holdX = d.hx + (d.ringX - d.hx) * prog;
            holdY = d.hy + (d.ringY - d.hy) * prog;
          }
          if (Math.hypot(holdX - d.x, holdY - d.y) < 10) return; // holding: stay put
        }
        var chase = (state === 'pass' && !caught) ? (d.cover ? (coverBreak ? 1 : 0.75) : 0.6) : 1;
        // Lead pursuit: aim at where the runner will be in a third of a
        // second, not where he is, so the defence cuts off the run instead
        // of trailing a faster man. A sharp cut still beats it, because
        // the defender commits to the lead point and turns slowly.
        // A holding coverage man drifts back to his spot instead.
        var tx = px + pvx * 0.3, ty = py + pvy * 0.3;
        if (holdX !== null) { tx = holdX; ty = holdY; }
        else if (state === 'pass' && !caught && !d.cover && d.lane !== undefined) {
          // Lane discipline: on a pass, the line holds its zones instead
          // of collapsing on the runner. Each man shuffles laterally
          // within his own lane, shading toward the ball but never
          // abandoning the lane, and holds his depth — the line is the
          // second level, already beyond the catch spot. The room and
          // the shade vary man to man, and both are tighter than before
          // (Nov 10, Mikey: keep more lane discipline), so the field
          // stays structured and the passing lanes read. Once the ball
          // is caught the state flips to run and everyone hunts at full
          // pace, as before.
          var laneX = d.lane;
          tx = clamp(laneX + (px - laneX) * (d.laneGive || 0.4), laneX - (d.laneWidth || 48), laneX + (d.laneWidth || 48));
          // The line also drifts slowly toward a depth just beyond the
          // catch spot while the ball is in the air, instead of standing
          // frozen at its snap depth: the second level closes on the play
          // as it develops, so a caught pass meets men nearer the spot.
          ty = passTarget ? d.y + clamp((passTarget.y - 40) - d.y, -55, 55) : d.y;
          chase = 0.55;
        }
        else if (state === 'run' && !caught && !d.cover && d.lane !== undefined && py >= d.y) {
          // Gap discipline on a run: while the runner is still coming
          // at him, the line man closes upfield but stays in his lane
          // corridor, so the defence holds its shape instead of every
          // man piling onto the runner's exact spot. The runner has to
          // beat the man in his gap, not outrun a collapsing wall. Once
          // the runner is past him he turns and pursues freely, so a
          // beaten man still chases instead of standing in his lane.
          // After a catch the state is run too, but caught is set, so
          // the post-catch chase is untouched.
          // Close quarters change it: once the runner is within 70px
          // of the man's depth, the lane gives way and he takes the
          // runner directly. Playtests showed every run gaining 5+
          // yards (mean 8.3, none stuffed) because a runner could
          // simply run past a man frozen in his corridor; now the man
          // in the gap actually contests the carry at the point of
          // attack, so stuffed runs and short gains exist.
          tx = Math.abs(py - d.y) < 70 ? (px + pvx * 0.3) : clamp(px + pvx * 0.3, d.lane - 70, d.lane + 70);
          ty = py + pvy * 0.3;
        }
        var want = Math.atan2(ty - d.y, tx - d.x);
        var diff = want - d.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        d.heading += clamp(diff, -BOWL_TURN_RATE * dt, BOWL_TURN_RATE * dt);
        // Break burst: for a beat after the catch the coverage men, already
        // breaking on the receiver, run a step quicker, so the catch is
        // contested at once instead of the pair trailing in from afar.
        var sp = d.speed * chase * goalBoost * (d.aggr || 1) * ((d.cover && coverBurstT > 0) ? 1.15 : 1);
        d.x += Math.cos(d.heading) * sp * dt;
        d.y += Math.sin(d.heading) * sp * dt;
      });
    }
    function checkTackle() {
      for (var i = 0; i < defenders.length; i++) {
        var d = defenders[i];
        if (d.blockedT > 0) continue; // tied up: cannot tackle
        if (Math.hypot(d.x - px, d.y - py) < BOWL_TACKLE_RADIUS) return true;
      }
      return false;
    }
    function moveBlockers(dt) {
      // Blockers run at their assigned defender and tie him up on contact.
      // While tied up the defender does not move, tackle, or hold the
      // runner up. The blocker sticks to him for the length of the block,
      // then jogs on upfield, spent, and cannot block again this play.
      blockers.forEach(function (b) {
        if (b.engaged) {
          var d = b.engaged;
          if (d.blockedT > 0) { b.x = d.x; b.y = d.y + 14; return; }
          b.engaged = null; b.spent = true;
          return;
        }
        if (b.spent) { b.y = Math.max(RUNGUN_END_Y, b.y - 60 * dt); return; }
        var t = b.target;
        if (!t) { b.spent = true; return; }
        var dx = t.x - b.x, dy = t.y - b.y;
        var dl = Math.hypot(dx, dy);
        if (dl < BOWL_BLOCK_RADIUS) {
          t.blockedT = BOWL_BLOCK_SECONDS;
          b.engaged = t;
          return;
        }
        if (dl > 0) {
          b.x = clamp(b.x + dx / dl * b.speed * dt, 16, GAME_W - 16);
          b.y = clamp(b.y + dy / dl * b.speed * dt, RUNGUN_END_Y, RUNGUN_START_Y);
        }
      });
    }
    function tick(dt) {
      if (paused || destroyed) return;
      if (popT > 0) popT -= dt;
      if (state === 'run' || state === 'pass' || state === 'result') {
        clock -= dt;
        if (clock <= 0) {
          clock = 0;
          if (!timeGoneShown) { timeGoneShown = true; api.showBanner('Time — finish the play!', 2000); }
        }
      }
      // Live scoreboard: the clock and the yards update while the play is
      // happening, not only when it ends, so the HUD never looks frozen.
      hudT -= dt;
      if ((state === 'run' || state === 'pass') && hudT <= 0) { hudT = 0.25; updateHud(); }
      if (freezeT > 0) freezeT -= dt;
      if (coverBurstT > 0) coverBurstT -= dt;
      if (state === 'run' || state === 'pass') {
        playT += dt;
        var opx = px, opy = py;
        movePlayer(dt);
        pvx = dt > 0 ? (px - opx) / dt : 0;
        pvy = dt > 0 ? (py - opy) / dt : 0;
        // Block timers tick down first, so a man whose block just ended
        // can move again on this frame.
        defenders.forEach(function (d) { if (d.blockedT > 0) d.blockedT -= dt; });
        moveDefenders(dt);
        moveBlockers(dt);
        // Fresh legs: one defender at a time, never a wall of them. Only
        // once the runner has the ball — no reinforcements dropping on the
        // receiver while a pass is in the air.
        waveT += dt;
        if (state === 'run' && (waveT >= waveSecs || (yardsAtWave - yardsToGo()) >= 12)) {
          waveT = 0; yardsAtWave = yardsToGo();
          // Wave reinforcements (Nov 10, Mikey: the second line always
          // came in at the same spot, always the same two men): the count
          // varies from wave to wave, 2 to 4, weighted by difficulty so
          // Easy stays friendlier, and the entry pattern is rolled per
          // wave inside spawnDefenders. The cap still bounds the field.
          var waveRoom = BOWL_DEFENDER_CAP - defenders.length;
          if (waveRoom >= 2) {
            var wr = Math.random();
            var waveWant = diff === 'easy' ? (wr < 0.6 ? 2 : wr < 0.85 ? 3 : 4) : diff === 'hard' ? (wr < 0.4 ? 2 : wr < 0.75 ? 3 : 4) : (wr < 0.55 ? 2 : wr < 0.85 ? 3 : 4);
            spawnDefenders(Math.min(waveWant, waveRoom), true, false, null, 'wave');
          }
        }
        if (state === 'pass' && passTarget && !caught) {
          // The catch rule (Nov 10, Mikey): if you are in the circle
          // when the ball is arriving, you catch the ball. No dwell,
          // no standing in the circle for a set time. The ball flies
          // while the receiver runs, so the two converge on the X; a
          // receiver who beats the throw to the spot waits for the ball
          // instead of catching air, and one who arrives just after it
          // lands still catches it inside the grace window.
          if (ballFlight && !ballFlight.arrived) {
            ballFlight.t += dt;
            if (ballFlight.t >= ballFlight.dur) { ballFlight.arrived = true; graceT = BOWL_CATCH_GRACE; }
          }
          var dist = Math.hypot(passTarget.x - px, passTarget.y - py);
          if (dist <= BOWL_CATCH_RADIUS) {
            reachedX = true; // made the spot: the clock stops
            reachedXT += dt;
            if (!ballFlight || ballFlight.arrived) {
              caught = true; hasBall = true; freezeT = RUNGUN_PASS_STUN_SECONDS;
              coverBurstT = 0.75; // the coverage pair breaks at once
              ballFlight = null;
              api.showBanner('Caught!', 1600);
              state = 'run'; // carry on running with the ball
            }
          } else if (reachedX) {
            reachedXT += dt;
          }
          // The landed ball waits at the X for the grace window, then
          // it is dead: a receiver who never got to the spot in time
          // watches it hit the ground.
          if (ballFlight && ballFlight.arrived && !caught) {
            graceT -= dt;
            if (graceT <= 0) {
              endPlay(0, 'Incomplete.', 'The ball hit the ground — no one was there to catch it. No gain, next down.', { incomplete: true });
              return;
            }
          }
        }
        // The clock on the catch spot: once the pass is thrown, the receiver
        // has until the ball is gone to reach the X. If the defence holds
        // him up until the clock runs out, the pass fails. Once he reaches
        // the X, the clock stops.
        if (state === 'pass' && !caught && !reachedX) {
          passTimeLeft -= dt;
          if (passTimeLeft <= 0) {
            passTimeLeft = 0;
            endPlay(0, 'Incomplete.', 'Out of time — the defence held you up. No gain, next down.', { incomplete: true });
            return;
          }
        }
        if (state === 'run' && yardsToGo() <= 0) {
          // Touchdown: the yards gained, plus a bonus for reaching the end
          // zone, so a scoring drive is worth more than the same yards
          // gained on a tackle.
          var gained = playStartYards + RUNGUN_TOUCHDOWN_BONUS;
          api.showBanner('Touchdown, ' + priestName + '!', 2000);
          endPlay(gained, 'Touchdown, ' + priestName + '!', parishName + ' score. +' + playStartYards + ' yards, +' + RUNGUN_TOUCHDOWN_BONUS + ' bonus.', { touchdown: true });
          return;
        }
        if (checkTackle()) {
          if (state === 'pass' && !caught) {
            // Pass interference (Nov 10, Mikey: the defence may not tackle
            // the receiver before the catch). The offence is awarded yards
            // and the drive continues — a few free yards and a first down,
            // not a dead drive. The spot is the greater of the yards
            // already gained and ten free yards from the line, capped at
            // the 1 so a penalty never scores by itself.
            var alreadyGained = Math.max(0, playStartYards - yardsToGo());
            var piGained = Math.max(10, alreadyGained);
            if (playStartYards > 1) piGained = Math.min(piGained, playStartYards - 1);
            else piGained = 0;
            py = clamp(playStartPy - piGained * PX_PER_YARD, RUNGUN_END_Y, RUNGUN_START_Y);
            api.showBanner('Pass interference! +' + piGained + ' yards', 2000);
            endPlay(piGained, 'Pass interference!', '+' + piGained + ' yards — the defence tackled the receiver before the catch.', { pi: true });
          } else {
            var spotYards = Math.max(1, yardsToGo() - (caught ? RUNGUN_PASS_BONUS_YARDS : 0));
            var g = Math.max(0, playStartYards - spotYards);
            py = RUNGUN_END_Y + spotYards * PX_PER_YARD;
            endPlay(g, caught ? 'Caught!' : 'Tackled.', '+' + g + ' yards.', {});
          }
          return;
        }
        if (playT >= BOWL_PLAY_MAX_SECONDS) {
          // The whistle: a play cannot run forever, so the quarter can never
          // stall at 0:00. Dead at the spot, or incomplete on an uncaught pass.
          if (state === 'pass' && !caught) {
            endPlay(0, 'Incomplete.', 'Whistle — the pass is dead. No gain, next down.', { incomplete: true });
          } else {
            var wg = Math.max(0, playStartYards - yardsToGo());
            endPlay(wg, 'Whistle — play dead.', '+' + wg + ' yards at the whistle.', {});
          }
          return;
        }
      } else if (state === 'result') {
        resultT -= dt;
        if (resultT <= 0) {
          if (clock <= 0) { endQuarter(); } else { showChoose(); }
        }
      }
    }
    var bowlFieldGrad = null, bowlLightGrad = null, bowlGradField = null;
    function draw() {
      var ctx = api.ctx;
      updateCam();
      // Field: the chosen surface (see BOWL_FIELDS). Classic is a soft
      // vertical gradient over the mown stripes, so the pitch reads as a
      // lit surface, not a flat green board; Midnight is the same shape
      // in deep blue; Stained Glass lays jewel-tone panes with dark
      // leading where the panes meet, instead of stripes. The gradients
      // are built once per surface instead of every frame, and the yard
      // lines and numbers brighten on the dark surfaces so the markings
      // read on every field.
      if (!bowlFieldGrad || bowlGradField !== field.id) {
        bowlGradField = field.id;
        bowlFieldGrad = ctx.createLinearGradient(0, 0, 0, GAME_H);
        if (field.id === 'midnight') {
          bowlFieldGrad.addColorStop(0, '#26304f');
          bowlFieldGrad.addColorStop(1, '#171f36');
        } else {
          bowlFieldGrad.addColorStop(0, '#21543a');
          bowlFieldGrad.addColorStop(1, '#1a4230');
        }
        if (!bowlLightGrad) {
          bowlLightGrad = ctx.createLinearGradient(0, 0, 0, GAME_H);
          bowlLightGrad.addColorStop(0, 'rgba(255,246,220,0.10)');
          bowlLightGrad.addColorStop(0.5, 'rgba(255,246,220,0.0)');
          bowlLightGrad.addColorStop(1, 'rgba(0,0,0,0.10)');
        }
      }
      if (field.id === 'stained') {
        // Base coat first: the panes only cover the marked field, so the
        // ground behind the start line needs its own deep tone.
        ctx.fillStyle = '#241118'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        for (var pane = 0; pane < 10; pane++) {
          ctx.fillStyle = BOWL_STAINED_TONES[pane % BOWL_STAINED_TONES.length];
          ctx.fillRect(0, screenY(RUNGUN_END_Y + pane * 78.4), GAME_W, 79.4);
        }
        ctx.strokeStyle = 'rgba(12,7,4,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (var lead = 1; lead < 10; lead++) {
          var leadY = screenY(RUNGUN_END_Y + lead * 78.4);
          ctx.moveTo(0, leadY); ctx.lineTo(GAME_W, leadY);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = bowlFieldGrad; ctx.fillRect(0, 0, GAME_W, GAME_H);
        for (var band = 0; band < 10; band++) {
          ctx.fillStyle = band % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
          ctx.fillRect(0, screenY(RUNGUN_END_Y + band * 78.4), GAME_W, 79.4);
        }
      }
      // A soft light from above, fading toward the goal, for depth.
      ctx.fillStyle = bowlLightGrad; ctx.fillRect(0, 0, GAME_W, GAME_H);
      var darkField = field.id !== 'classic';
      ctx.strokeStyle = darkField ? 'rgba(255,255,255,0.52)' : 'rgba(255,255,255,0.38)'; ctx.lineWidth = 1;
      ctx.fillStyle = darkField ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.62)'; ctx.font = '11px Georgia';
      for (var y = 10; y <= 80; y += 10) {
        var fy = screenY(RUNGUN_END_Y + y * PX_PER_YARD);
        ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(GAME_W, fy); ctx.stroke();
        // Field numbers count up from the offence's own goal line to 50
        // at midfield, then back down toward the far goal line. Here y is
        // yards still to go to the far goal: before midfield (y >= 50) the
        // number is 100 - y, and past midfield it is y.
        var yardLabel = String(y >= 50 ? 100 - y : y);
        ctx.fillText(yardLabel, 8, fy - 5);
        ctx.textAlign = 'right';
        ctx.fillText(yardLabel, GAME_W - 8, fy - 5);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = darkField ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.62)';
      // First-down line: gold, dashed, so the target is visible on the field.
      var lineToGain = seriesStart - 10;
      if (lineToGain > 0 && lineToGain < 80) {
        var ly = screenY(RUNGUN_END_Y + lineToGain * PX_PER_YARD);
        ctx.strokeStyle = BOWL_GOLD_BRIGHT; ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]);
        ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(GAME_W, ly); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = BOWL_GOLD_BRIGHT; ctx.font = 'bold 10px Georgia';
        ctx.fillText('1ST DOWN', 8, ly - 5);
      }
      // End zone: a deep burgundy gradient, gold goal line, parish name in gold caps.
      var ez = ctx.createLinearGradient(0, screenY(0), 0, screenY(RUNGUN_END_Y));
      ez.addColorStop(0, '#7d2430');
      ez.addColorStop(1, BOWL_BURGUNDY);
      ctx.fillStyle = ez; ctx.fillRect(0, screenY(0), GAME_W, RUNGUN_END_Y);
      ctx.fillStyle = BOWL_GOLD; ctx.fillRect(0, screenY(RUNGUN_END_Y) - 2, GAME_W, 3);
      ctx.fillStyle = BOWL_GOLD_BRIGHT; ctx.font = 'bold 15px Georgia'; ctx.textAlign = 'center';
      ctx.fillText(parishName.toUpperCase(), GAME_W / 2, screenY(52));
      ctx.textAlign = 'left';
      // Gold X (pass target): a soft halo, a rounded X, a refined label.
      // The ball has landed: the X lights up so the catch window reads
      // at a glance — the ball is here, be in the circle to catch it.
      if (state === 'pass' && passTarget && !caught) {
        var tx = passTarget.x, ty = screenY(passTarget.y);
        var ballHere = !!(ballFlight && ballFlight.arrived);
        var halo = ctx.createRadialGradient(tx, ty, 4, tx, ty, BOWL_CATCH_RADIUS + 14);
        halo.addColorStop(0, ballHere ? 'rgba(178,138,46,0.55)' : 'rgba(178,138,46,0.34)');
        halo.addColorStop(1, 'rgba(178,138,46,0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(tx, ty, BOWL_CATCH_RADIUS + 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ballHere ? 'rgba(178,138,46,0.45)' : 'rgba(178,138,46,0.22)';
        ctx.beginPath(); ctx.arc(tx, ty, BOWL_CATCH_RADIUS, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = BOWL_GOLD; ctx.lineWidth = ballHere ? 6 : 4; ctx.lineCap = 'round';
        var s = 10;
        ctx.beginPath();
        ctx.moveTo(tx - s, ty - s); ctx.lineTo(tx + s, ty + s);
        ctx.moveTo(tx + s, ty - s); ctx.lineTo(tx - s, ty + s);
        ctx.stroke();
        ctx.fillStyle = BOWL_GOLD_BRIGHT; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(ballHere ? 'CATCH IT!' : 'CATCH HERE', tx, ty - 22);
        ctx.textAlign = 'left';
        // Grace window: once the ball has landed, the circle drains as
        // the grace runs out — get there before it is empty.
        if (ballFlight && ballFlight.arrived && !caught) {
          ctx.fillStyle = 'rgba(217,180,90,0.55)';
          ctx.beginPath(); ctx.arc(tx, ty, BOWL_CATCH_RADIUS * Math.max(0, graceT / BOWL_CATCH_GRACE), 0, Math.PI * 2); ctx.fill();
        }
        // Countdown ring: the time left to reach the X, shrinking as it
        // runs out, red in the last second. The seconds sit under it. Once
        // the receiver reaches the X the ring is gone.
        if (!reachedX) {
          var frac = Math.max(0, passTimeLeft / Math.max(passTimeMax, 0.01));
          ctx.strokeStyle = passTimeLeft <= 1 ? '#ff6b5e' : BOWL_GOLD_BRIGHT;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(tx, ty, BOWL_CATCH_RADIUS + 8, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = passTimeLeft <= 1 ? '#ff6b5e' : BOWL_GOLD_BRIGHT;
          ctx.font = 'bold 13px Georgia'; ctx.textAlign = 'center';
          ctx.fillText(passTimeLeft.toFixed(1) + 's', tx, ty + BOWL_CATCH_RADIUS + 20);
          ctx.textAlign = 'left';
        }
      }
      // Defenders: soft shadow, a radial umber disc, a fine parchment ring.
      defenders.forEach(function (d) {
        var dy = screenY(d.y);
        // Tied up by a blocker: dimmed with a gold ring, so the player
        // reads him as out of the play and runs through the gap instead
        // of around him. He cannot tackle or hold the runner up while
        // the block lasts.
        var tiedUp = d.blockedT > 0;
        if (tiedUp) ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(d.x, dy + 9, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
        var dg = ctx.createRadialGradient(d.x - 3, dy - 4, 2, d.x, dy, 12);
        dg.addColorStop(0, uniform.away.bright);
        dg.addColorStop(1, uniform.away.deep);
        ctx.fillStyle = dg;
        ctx.beginPath(); ctx.arc(d.x, dy, 11, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = freezeT > 0 ? '#8a8a8a' : (tiedUp ? BOWL_GOLD_BRIGHT : uniform.away.ring); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('S', d.x, dy + 3); ctx.textAlign = 'left';
        if (tiedUp) ctx.globalAlpha = 1;
      });
      // Blockers: home-kit discs with a B, a beat smaller than Father,
      // so they read as teammates clearing a lane, not a second ball
      // carrier. A spent blocker jogs on faded, out of the play.
      blockers.forEach(function (b) {
        var by = screenY(b.y);
        if (b.spent && !b.engaged) ctx.globalAlpha = 0.45;
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(b.x, by + 8, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        var bg = ctx.createRadialGradient(b.x - 3, by - 4, 2, b.x, by, 10);
        bg.addColorStop(0, uniform.home.bright);
        bg.addColorStop(1, uniform.home.deep);
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(b.x, by, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = uniform.home.ring; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('B', b.x, by + 3); ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      });
      // Player (Father): soft shadow, a radial burgundy disc, a gold ring,
      // and the ball only when carrying.
      var pyS = screenY(py);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath(); ctx.ellipse(px, pyS + 10, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      var pg = ctx.createRadialGradient(px - 4, pyS - 5, 2, px, pyS, 13);
      pg.addColorStop(0, uniform.home.bright);
      pg.addColorStop(1, uniform.home.deep);
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(px, pyS, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = uniform.home.ring; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('F', px, pyS + 4); ctx.textAlign = 'left';
      if (hasBall) {
        ctx.fillStyle = BOWL_GOLD;
        ctx.beginPath(); ctx.arc(px + 10, pyS - 6, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(46,34,5,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      }
      // The ball in the air: on a pass the throw arcs from Father to the
      // gold X, so the receiver watches it coming and times the catch.
      // The dotted arc shows where it is going, the shadow tracks its
      // ground position, and the ball itself rides the arc, growing as
      // it climbs. Once it lands it sits at the X until the catch.
      if (state === 'pass' && ballFlight && !caught) {
        var bp = clamp(ballFlight.t / ballFlight.dur, 0, 1);
        var bGX = ballFlight.x0 + (ballFlight.x1 - ballFlight.x0) * bp;
        var bGY = ballFlight.y0 + (ballFlight.y1 - ballFlight.y0) * bp;
        var bDist = Math.hypot(ballFlight.x1 - ballFlight.x0, ballFlight.y1 - ballFlight.y0);
        var bPeak = 26 + bDist * 0.09;
        var bH = 4 * bPeak * bp * (1 - bp);
        var bSX = bGX, bSY = screenY(bGY);
        if (!ballFlight.arrived) {
          ctx.strokeStyle = 'rgba(217,180,90,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
          ctx.beginPath();
          for (var bi = 0; bi <= 16; bi++) {
            var bq = bi / 16;
            var aqx = ballFlight.x0 + (ballFlight.x1 - ballFlight.x0) * bq;
            var aqy = ballFlight.y0 + (ballFlight.y1 - ballFlight.y0) * bq;
            var aqh = 4 * bPeak * bq * (1 - bq);
            if (bi === 0) ctx.moveTo(aqx, screenY(aqy) - aqh); else ctx.lineTo(aqx, screenY(aqy) - aqh);
          }
          ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath(); ctx.ellipse(bSX, bSY + 8, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
        var bR = 5 + bH * 0.03;
        ctx.fillStyle = '#8a5a2b';
        ctx.beginPath(); ctx.ellipse(bSX, bSY - bH, bR + 2, bR, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#f0d48a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(bSX, bSY - bH, bR + 2, bR, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bSX - 3, bSY - bH); ctx.lineTo(bSX + 3, bSY - bH); ctx.stroke();
      }
      // Held up: a defender in your face, so the player can see why the
      // run to the X has gone slow.
      if (impeded) {
        ctx.fillStyle = '#ff8a5c'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('HELD UP!', px, pyS - 22); ctx.textAlign = 'left';
      }
      // Result slab: burgundy band with a soft shadow, gold rules, what the
      // play earned and why.
      if (state === 'result') {
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.fillRect(0, GAME_H / 2 - 28, GAME_W, 64);
        var rg = ctx.createLinearGradient(0, GAME_H / 2 - 32, 0, GAME_H / 2 + 32);
        rg.addColorStop(0, '#7d2430');
        rg.addColorStop(1, BOWL_BURGUNDY);
        ctx.fillStyle = rg; ctx.fillRect(0, GAME_H / 2 - 32, GAME_W, 64);
        ctx.fillStyle = BOWL_GOLD; ctx.fillRect(0, GAME_H / 2 - 32, GAME_W, 3);
        ctx.fillRect(0, GAME_H / 2 + 29, GAME_W, 3);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(resultMain, GAME_W / 2, GAME_H / 2 - 2);
        ctx.fillStyle = BOWL_GOLD_BRIGHT; ctx.font = 'bold 13px Georgia';
        ctx.fillText(resultSub, GAME_W / 2, GAME_H / 2 + 20);
        ctx.textAlign = 'left';
      }
      // Floating gain: the yards from the play just ended, rising and
      // fading above the runner. Drawn after the result slab, so it stays
      // visible even when the runner is near the middle of the screen.
      if (popT > 0) {
        ctx.globalAlpha = Math.max(0, Math.min(1, popT / 1.4));
        ctx.fillStyle = BOWL_GOLD_BRIGHT; ctx.font = 'bold 16px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('+' + popYards, px, pyS - 26 - (1.4 - popT) * 28);
        ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      }
      // Paused veil
      if (paused) {
        ctx.fillStyle = 'rgba(82,18,25,0.88)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = BOWL_PARCHMENT; ctx.font = 'bold 18px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(hasKeyboard() ? 'Paused \u2014 press P to resume' : 'Paused \u2014 tap Resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function loop(t) {
      if (destroyed) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0);
      last = t;
      tick(dt);
      draw();
      raf = requestAnimationFrame(loop);
    }
    function doPause() { if (state === 'run' || state === 'pass' || state === 'result' || state === 'choose') { paused = true; api.pauseBtn.textContent = 'Resume'; } }
    function doResume() { paused = false; api.pauseBtn.textContent = 'Pause'; }
    var cleanupPause = wirePause(api, function () { return paused; }, doPause, doResume);
    var dpadHeld = {};
    makeDpad(api.stage, function (dx, dy, active) {
      var key = dx + ',' + dy;
      if (active) dpadHeld[key] = [dx, dy]; else delete dpadHeld[key];
      var hx = 0, hy = 0, ks = Object.keys(dpadHeld);
      for (var hi = 0; hi < ks.length; hi++) { hx += dpadHeld[ks[hi]][0]; hy += dpadHeld[ks[hi]][1]; }
      dpadVec.x = hx; dpadVec.y = hy;
    });
    // Direct touch on the field: touch and drag, and the player runs toward
    // your finger; drag to the gold X and be there as the ball arrives.
    // The touch point is in world coordinates (the field scrolls under the
    // camera), so the finger stays on the spot it touched.
    var touchTarget = null;
    api.canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'run' && state !== 'pass') return;
      e.preventDefault();
      var p = canvasPoint(api.canvas, e);
      touchTarget = { x: p.x, y: p.y + camY };
    });
    api.canvas.addEventListener('pointermove', function (e) {
      if (!touchTarget) return;
      e.preventDefault();
      var p = canvasPoint(api.canvas, e);
      touchTarget = { x: p.x, y: p.y + camY };
    });
    function endBowlTouch() { touchTarget = null; }
    api.canvas.addEventListener('pointerup', endBowlTouch);
    api.canvas.addEventListener('pointerleave', endBowlTouch);
    api.canvas.addEventListener('pointercancel', endBowlTouch);
    // Keyboard play for the whole loop, so a desktop player never has to
    // reach for the mouse mid game: Space or Enter kicks off, continues
    // from half time, skips the result slab and plays again at full time;
    // R runs and T throws on the choose screen. P stays the pause key, so
    // it is deliberately not the pass key. Keys never fire while the player
    // is typing in a text field, or while the name screen is up.
    function onBowlKey(e) {
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (customizing || paused) return;
      var k = e.key.toLowerCase();
      var go = (k === ' ' || k === 'enter');
      if (state === 'choose') {
        if (k === 'r') startPlay('run');
        else if (k === 't') startPlay('pass');
      } else if (state === 'ready') {
        if (go) { state = 'choose'; showChoose(); }
      } else if (state === 'half') {
        if (go) { state = 'choose'; showChoose(); }
      } else if (state === 'over') {
        if (go) resetGame();
      } else if (state === 'result') {
        if (go) { if (clock <= 0) endQuarter(); else showChoose(); }
      } else if (state === 'turnover') {
        if (go) continueAfterTurnover();
      }
    }
    document.addEventListener('keydown', onBowlKey);
    api.actions.appendChild(el('p', 'game-note', gameNote('Arrows or WASD to move. Space or Enter kicks off, continues and plays again. R runs, T throws, P or Esc pauses. The clock stops while you choose a play. Four downs to gain ten yards. On a pass, reach the gold X before the clock runs out, and defenders in your face slow you down, so beat them to the spot and be in the gold circle as the ball arrives. Every once in a while two blockers line up in front of you to clear a lane; on Easy they are always there. On a phone, touch and drag on the field to run; drag to the gold X and be there as the ball arrives.', 'Touch and drag on the field to run; drag to the gold X and be there as the ball arrives. The clock stops while you choose a play. Four downs to gain ten yards. On a pass, reach the gold X before the clock runs out, and defenders in your face slow you down, so beat them to the spot and be in the gold circle as the ball arrives. Every once in a while two blockers line up in front of you to clear a lane; on Easy they are always there.')));
    showStart();
    updateHud();
    last = performance.now();
    raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true;
      cancelAnimationFrame(raf);
      keys.cleanup();
      cleanupPause();
      document.removeEventListener('keydown', onBowlKey);
    };
  }

  // ================= Stained-Glass Blocks =================
  // Falling panes, 7-piece bag, ghost pane, guideline scoring.
  var STACK_SHAPES = {
    I: [[1, 1, 1, 1]], O: [[1, 1], [1, 1]], T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]], Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]], L: [[0, 0, 1], [1, 1, 1]],
  };
  var STACK_COLORS = { I: '#3a6ea5', O: '#b28a2e', T: '#5b2a4a', S: '#2e5e4e', Z: '#b8452a', J: '#2f7f8f', L: '#8a6d3b' };
  var STACK_POINTS = [0, 100, 300, 500, 800];
  function mountStack(parent, onBack) {
    var api = createStage(parent, { title: 'Stained-Glass Blocks', onBack: onBack });
    var COLS = 10, ROWS = 20, CELL = 15, OX = (GAME_W - COLS * CELL) / 2, OY = 10;
    var grid = [], bag = [], peekBag = null, cur = null, score = 0, lines = 0, level = 1, combo = 0;
    var held = null, canHold = true; // held pane (C key or Hold button), one swap per pane
    var best = readBest('stack');
    var diff = readDiff('stack'); // Easy / Medium / Hard; Medium is the tuned default
    var dropBase = 0.7, dropStep = 0.06, linesPerLevel = 10;
    function applyStackDiff() {
      // Easy: the panes fall slower and a level lasts longer. Hard:
      // faster from the start and quicker to speed up. Medium is the
      // current game.
      if (diff === 'easy') { dropBase = 0.9; dropStep = 0.045; linesPerLevel = 12; }
      else if (diff === 'hard') { dropBase = 0.55; dropStep = 0.08; linesPerLevel = 8; }
      else { dropBase = 0.7; dropStep = 0.06; linesPerLevel = 10; }
    }
    applyStackDiff();
    var state = 'ready', paused = false, dropT = 0, raf = 0, last = 0, destroyed = false;
    var lockT = 0, lockResets = 0, stackRun = 0; // lock delay at the floor; run id, so a level-up banner from an old game never fires into a new one
    var clearingRows = null, clearT = 0; // rows flashing before they collapse; the next pane waits for the flash
    var LOCK_DELAY = 0.45, MAX_LOCK_RESETS = 12; // a pane resting on the floor (or the stack) waits this long before it locks, and a nudge or turn restarts the wait (up to 12 times), so a pane can still be slid into place at speed instead of locking the instant it touches down
    function resetGrid() { grid = []; for (var y = 0; y < ROWS; y++) { grid.push(new Array(COLS).fill(null)); } }
    function shuffledBag() {
      var b = Object.keys(STACK_SHAPES).slice();
      for (var i = b.length - 1; i > 0; i--) { var j = randInt(0, i); var t = b[i]; b[i] = b[j]; b[j] = t; }
      return b;
    }
    function spawn(fromHold) {
      if (!bag.length) { bag = peekBag || shuffledBag(); peekBag = null; }
      var type = bag.pop();
      if (!bag.length) { bag = peekBag || shuffledBag(); peekBag = null; }
      if (bag.length === 1 && !peekBag) peekBag = shuffledBag(); // Then preview: peek the next bag now, so it never blanks for a whole pane; the peeked bag becomes the real next bag, so the previewed piece is the one that comes
      cur = { type: type, shape: STACK_SHAPES[type].map(function (r) { return r.slice(); }), x: 3, y: 0 };
      dropT = 0; lockT = 0; lockResets = 0; // a fresh pane falls on its own clock, with a fresh lock wait
      if (!fromHold) canHold = true; // a fresh pane brings a fresh hold; a held swap does not
      if (collides(cur.shape, cur.x, cur.y)) { gameOver(); }
    }
    // Hold: swap the falling pane with the held one (or hold it and take
    // the next pane). One swap per pane, so it plans the window instead of
    // stalling it.
    function holdCur() {
      if (state !== 'playing' || paused || !cur || !canHold) return;
      canHold = false;
      if (!held) { held = cur.type; spawn(true); return; }
      var t = held; held = cur.type;
      cur = { type: t, shape: STACK_SHAPES[t].map(function (r) { return r.slice(); }), x: 3, y: 0 };
      dropT = 0; lockT = 0; lockResets = 0;
      if (collides(cur.shape, cur.x, cur.y)) { gameOver(); }
    }
    function collides(shape, x, y) {
      for (var r = 0; r < shape.length; r++) for (var c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        var gx = x + c, gy = y + r;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy >= 0 && grid[gy][gx]) return true;
      }
      return false;
    }
    function rotate(shape) {
      var out = [];
      for (var c = 0; c < shape[0].length; c++) {
        var row = [];
        for (var r = shape.length - 1; r >= 0; r--) row.push(shape[r][c]);
        out.push(row);
      }
      return out;
    }
    function lock() {
      cur.shape.forEach(function (row, r) { row.forEach(function (v, c) { if (v && cur.y + r >= 0) grid[cur.y + r][cur.x + c] = cur.type; }); });
      // Every pane placed pays a little, so the score moves before the
      // first line clears and a new player sees progress from the start.
      score += 5;
      var full = [];
      for (var y = ROWS - 1; y >= 0; y--) { if (grid[y].every(Boolean)) full.push(y); }
      var cleared = full.length;
      if (cleared) {
        var oldLevel = level;
        combo += 1;
        score += STACK_POINTS[cleared] * level;
        if (combo > 1) score += (combo - 1) * 50 * level;
        lines += cleared;
        level = 1 + Math.floor(lines / linesPerLevel);
        // Say what happened: a clear used to vanish silently. The banner
        // names the clear and its points, and a level rise gets its own
        // callout so the quickening pace is never a surprise.
        var clearName = ['', 'Single', 'Double', 'Triple', 'Tetris'][cleared];
        api.showBanner(clearName + '! +' + (STACK_POINTS[cleared] * oldLevel + (combo > 1 ? (combo - 1) * 50 * oldLevel : 0)) + (combo > 1 ? ' \u00b7 Combo x' + combo : ''), 1300);
        if (level > oldLevel) { var runAtClear = stackRun; setTimeout(function () { if (runAtClear === stackRun && state === 'playing') api.showBanner('Level ' + level + ' — the panes fall faster', 1500); }, 1300); }
        updateHud();
        // The cleared rows flash amber-gold for a beat before they
        // collapse, so a clear reads as an event instead of the rows
        // vanishing the instant the pane lands. The next pane waits.
        clearingRows = full; clearT = 0.16; cur = null;
        return;
      }
      combo = 0;
      updateHud();
      spawn();
    }
    function finishClear() {
      // Rebuild without the cleared rows and pad the top with fresh
      // rows: splicing one row at a time shifts the indices of the
      // rows above it, which would leave a cleared row behind.
      var keep = grid.filter(function (row, y) { return clearingRows.indexOf(y) < 0; });
      while (keep.length < ROWS) keep.unshift(new Array(COLS).fill(null));
      grid = keep;
      clearingRows = null;
      spawn();
    }
    function ghostY() { var y = cur.y; while (!collides(cur.shape, cur.x, y + 1)) y++; return y; }
    function gameOver() {
      state = 'over';
      var fb = writeBest('stack', score); best = fb;
      submitParishScore('stack', score);
      api.showOverlay('<h3>The window is full</h3><p>Score: ' + score + ' &middot; Lines: ' + lines + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="stack-again">Play again</button>' +
        kbdHint('Keyboard: Space or Enter plays again.') +
        '<button type="button" class="linklike" id="stack-back">Back to arcade</button>');
      var a = document.getElementById('stack-again');
      if (a) a.addEventListener('click', function () { startGame(); });
      var b = document.getElementById('stack-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function startGame() {
      applyStackDiff();
      parishSubmitted['stack'] = false;
      stackRun += 1;
      resetGrid(); bag = []; peekBag = null; held = null; canHold = true; score = 0; lines = 0; level = 1; combo = 0; dropT = 0; lockT = 0; lockResets = 0; clearingRows = null; clearT = 0;
      state = 'playing'; api.hideOverlay(); spawn(); updateHud();
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + score + '</span><span>Lines: ' + lines + '</span><span>Level: ' + level + '</span>' +
        (combo > 1 ? '<span>Combo x' + combo + '</span>' : '') + diffTag(diff) + '<span>Best: ' + best + '</span>');
    }
    function drawCell(x, y, color, ghost) {
      var px = OX + x * CELL, py = OY + y * CELL;
      api.ctx.fillStyle = color;
      api.ctx.globalAlpha = ghost ? 0.25 : 1;
      api.ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      api.ctx.globalAlpha = 1;
      if (!ghost) {
        // Leaded-glass bevel: a pale inner highlight so the panes read as
        // stained glass instead of flat coloured squares.
        api.ctx.fillStyle = 'rgba(255,253,247,0.28)';
        api.ctx.fillRect(px + 3, py + 3, CELL - 6, 4);
        api.ctx.fillRect(px + 3, py + 3, 4, CELL - 6);
      }
      api.ctx.strokeStyle = 'rgba(56,41,26,0.6)';
      api.ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
    }
    var stackBg = null;
    function draw() {
      var ctx = api.ctx;
      // Warm backdrop with a soft glow behind the window, built once per
      // mount instead of every frame; the window sits in a chapel gloom
      // rather than on a flat black board.
      if (!stackBg) {
        stackBg = ctx.createRadialGradient(GAME_W / 2, GAME_H / 2, 60, GAME_W / 2, GAME_H / 2, 340);
        stackBg.addColorStop(0, '#2e2118');
        stackBg.addColorStop(1, '#171008');
      }
      ctx.fillStyle = stackBg; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(OX - 4, OY - 4, COLS * CELL + 8, ROWS * CELL + 8);
      ctx.strokeStyle = '#33261a'; ctx.lineWidth = 2;
      ctx.strokeRect(OX - 4, OY - 4, COLS * CELL + 8, ROWS * CELL + 8);
      for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
        if (grid[y][x]) drawCell(x, y, STACK_COLORS[grid[y][x]]);
      }
      if (clearingRows) {
        var fa = 0.3 + 0.4 * (1 - clearT / 0.16);
        ctx.fillStyle = 'rgba(232,185,76,' + fa.toFixed(2) + ')';
        clearingRows.forEach(function (y) { ctx.fillRect(OX, OY + y * CELL, COLS * CELL, CELL); });
      }
      if (cur && state === 'playing') {
        var gy = ghostY();
        cur.shape.forEach(function (row, r) { row.forEach(function (v, c) { if (v) drawCell(cur.x + c, gy + r, STACK_COLORS[cur.type], true); }); });
        cur.shape.forEach(function (row, r) { row.forEach(function (v, c) { if (v) drawCell(cur.x + c, cur.y + r, STACK_COLORS[cur.type]); }); });
      }
      // The window is nearly full: a red border pulses around it so the
      // end never comes as a surprise — the player sees the danger coming
      // and can clear lines before the panes run out of room.
      var topRow = ROWS;
      for (var yy = 0; yy < ROWS; yy++) {
        var anyFilled = false;
        for (var xx = 0; xx < COLS; xx++) { if (grid[yy][xx]) { anyFilled = true; break; } }
        if (anyFilled) { topRow = yy; break; }
      }
      if (topRow < 5 && state === 'playing') {
        var pulse = 0.55 + 0.35 * Math.sin(Date.now() / 200);
        ctx.strokeStyle = 'rgba(178,32,32,' + pulse.toFixed(2) + ')'; ctx.lineWidth = 3;
        ctx.strokeRect(OX - 4, OY - 4, COLS * CELL + 8, ROWS * CELL + 8);
      }
      // Next piece, drawn as a small preview so the player can plan around
      // its shape, not just its letter. The piece after that sits below it,
      // so a plan can stretch two panes ahead.
      ctx.fillStyle = '#fffdf7'; ctx.font = '13px Georgia';
      ctx.fillText('Next', 12, 30);
      var nextType = bag.length ? bag[bag.length - 1] : null;
      if (nextType) {
        var ns = STACK_SHAPES[nextType];
        var nc = 9;
        ns.forEach(function (row, r) {
          row.forEach(function (v, c) {
            if (!v) return;
            ctx.fillStyle = STACK_COLORS[nextType];
            ctx.fillRect(14 + c * nc, 36 + r * nc, nc - 1, nc - 1);
          });
        });
      }
      var next2Type = bag.length > 1 ? bag[bag.length - 2] : (peekBag && peekBag.length ? peekBag[peekBag.length - 1] : null);
      if (next2Type) {
        ctx.fillStyle = '#fffdf7'; ctx.font = '13px Georgia';
        ctx.fillText('Then', 12, 82);
        var n2s = STACK_SHAPES[next2Type];
        var n2c = 9;
        n2s.forEach(function (row, r) {
          row.forEach(function (v, c) {
            if (!v) return;
            ctx.fillStyle = STACK_COLORS[next2Type];
            ctx.globalAlpha = 0.75;
            ctx.fillRect(14 + c * n2c, 88 + r * n2c, n2c - 1, n2c - 1);
            ctx.globalAlpha = 1;
          });
        });
      }
      // Hold preview, on the right of the window where the space is free,
      // so the player can plan around the held pane as well as the next one.
      ctx.fillStyle = '#fffdf7'; ctx.font = '13px Georgia';
      ctx.fillText('Hold', 340, 30);
      if (held) {
        var hs = STACK_SHAPES[held];
        var hc = 9;
        hs.forEach(function (row, r) {
          row.forEach(function (v, c) {
            if (!v) return;
            ctx.fillStyle = STACK_COLORS[held];
            ctx.globalAlpha = canHold ? 1 : 0.35; // dimmed once the hold is spent for this pane
            ctx.fillRect(342 + c * hc, 36 + r * hc, hc - 1, hc - 1);
            ctx.globalAlpha = 1;
          });
        });
      }
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(hasKeyboard() ? 'Paused — press P to resume' : 'Paused — tap Resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      if (clearingRows) { clearT -= dt; if (clearT <= 0) finishClear(); return; }
      // Lock delay: a pane resting on the floor or the stack waits before
      // it locks, so it can still be slid or turned into place at speed.
      // Nudges and turns restart the wait (capped), gravity does not run
      // while the pane is grounded, and the leftover drop time carries
      // over instead of being thrown away each step.
      if (collides(cur.shape, cur.x, cur.y + 1)) {
        lockT += dt;
        if (lockT >= LOCK_DELAY) lock();
        return;
      }
      lockT = 0; lockResets = 0;
      dropT += dt;
      var interval = Math.max(0.08, dropBase - (level - 1) * dropStep);
      if (dropT >= interval) {
        dropT -= interval;
        cur.y++;
      }
    }
    function loop(t) {
      if (destroyed) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      tick(dt); draw();
      raf = requestAnimationFrame(loop);
    }
    function doPause() { if (state === 'playing') { paused = true; api.pauseBtn.textContent = 'Resume'; } }
    function doResume() { paused = false; api.pauseBtn.textContent = 'Pause'; }
    var cleanupPause = wirePause(api, function () { return paused; }, doPause, doResume);
    // Named moves, shared by the keyboard and the touch buttons below, so
    // the two inputs can never drift apart. Rules unchanged.
    // A nudge or turn restarts the lock wait (capped), so a grounded pane
    // can be worked into place instead of locking mid-adjustment.
    function bumpLock() { if (lockT > 0 && lockResets < MAX_LOCK_RESETS) { lockT = 0; lockResets++; } }
    function moveLeft() { if (state === 'playing' && !paused && cur && !collides(cur.shape, cur.x - 1, cur.y)) { cur.x--; bumpLock(); } }
    function moveRight() { if (state === 'playing' && !paused && cur && !collides(cur.shape, cur.x + 1, cur.y)) { cur.x++; bumpLock(); } }
    function rotateCur() {
      if (state !== 'playing' || paused || !cur) return;
      var r = rotate(cur.shape);
      // Wall kicks: a turn against the wall or a stack tries a nudge left,
      // right, then further out, then up a row, before refusing — so turning
      // never silently does nothing when there is room beside or above the pane.
      var kicks = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];
      for (var i = 0; i < kicks.length; i++) {
        if (!collides(r, cur.x + kicks[i][0], cur.y + kicks[i][1])) { cur.x += kicks[i][0]; cur.y += kicks[i][1]; cur.shape = r; bumpLock(); return; }
      }
    }
    function softDrop() { if (state !== 'playing' || paused || !cur) return; if (!collides(cur.shape, cur.x, cur.y + 1)) { cur.y++; score += 1; updateHud(); } else lock(); }
    function slam() { if (state !== 'playing' || paused || !cur) return; var y0 = cur.y; while (!collides(cur.shape, cur.x, cur.y + 1)) cur.y++; score += (cur.y - y0) * 2; lock(); }
    document.addEventListener('keydown', onKey);
    // Keyboard play for the whole loop: Space or Enter starts and plays
    // again, arrows move and turn, C holds, Space slams. The typing and
    // focused-button guards keep Space from double-firing a button that
    // already answers it.
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      var go = (k === ' ' || k === 'enter');
      if (state === 'ready' || state === 'over') {
        if (go && !kbdOnButton(e)) { e.preventDefault(); startGame(); }
        return;
      }
      if (state !== 'playing' || paused) return;
      if (k === 'arrowleft') moveLeft();
      else if (k === 'arrowright') moveRight();
      else if (k === 'arrowdown') softDrop();
      else if (k === 'arrowup') rotateCur();
      else if (k === 'c') holdCur();
      else if (k === ' ' && !kbdOnButton(e)) { e.preventDefault(); slam(); }
    }
    // Direct touch on the window: drag sideways to slide the pane to the
    // column under your finger, tap to turn it, swipe down to drop it.
    // The buttons below still work exactly as before.
    var stackTouch = null;
    api.canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'playing' || paused || !cur) return;
      e.preventDefault();
      var pt = canvasPoint(api.canvas, e);
      stackTouch = { x: pt.x, y: pt.y, t: performance.now() };
    });
    api.canvas.addEventListener('pointermove', function (e) {
      if (!stackTouch || state !== 'playing' || paused || !cur) return;
      e.preventDefault();
      var pt = canvasPoint(api.canvas, e);
      // Slide the pane so its middle follows the finger, not its left edge:
      // the pane lands where the finger points instead of a column or two
      // to the right of it.
      var col = Math.floor((pt.x - OX) / CELL) - Math.floor(cur.shape[0].length / 2);
      var guard = 0;
      while (cur.x < col && !collides(cur.shape, cur.x + 1, cur.y) && guard++ < 10) cur.x++;
      while (cur.x > col && !collides(cur.shape, cur.x - 1, cur.y) && guard++ < 10) cur.x--;
      if (pt.y - stackTouch.y > 44) { softDrop(); stackTouch.y = pt.y; }
    });
    api.canvas.addEventListener('pointerup', function (e) {
      if (!stackTouch) return;
      var dt = performance.now() - stackTouch.t;
      var pt = canvasPoint(api.canvas, e);
      if (dt < 250 && Math.hypot(pt.x - stackTouch.x, pt.y - stackTouch.y) < 12) rotateCur();
      stackTouch = null;
    });
    api.canvas.addEventListener('pointercancel', function () { stackTouch = null; });
    // Touch controls: hold ← → ↓ to repeat, tap ↻ to turn, tap Slam to drop.
    var touchRow = makeTouchRow(api);
    touchRow.appendChild(makeTouchButton('←', moveLeft));
    touchRow.appendChild(makeTouchButton('↻', rotateCur, { repeat: false }));
    touchRow.appendChild(makeTouchButton('→', moveRight));
    touchRow.appendChild(makeTouchButton('↓', softDrop));
    touchRow.appendChild(makeTouchButton('Hold', holdCur, { repeat: false }));
    touchRow.appendChild(makeTouchButton('Slam', slam, { repeat: false, wide: true }));
    api.actions.appendChild(el('p', 'game-note', gameNote('Space or Enter starts and plays again. Left and right to move, Up to turn, Down to drop faster, Space to slam it down, C to hold a pane for later. On touch, drag on the window to slide a pane, tap to turn it, or use the buttons below.', 'Drag on the window to slide a pane, tap to turn it, or use the buttons below.')));
    api.showOverlay('<h3>Stained-Glass Blocks</h3><p>Fit the falling panes into the window. Complete rows to clear them. ' + gameMark('stack') + '</p>' +
      diffPickerHtml('stack', diff) +
      '<button type="button" class="big-btn press" id="stack-start">Start stacking</button>' +
      kbdHint('Keyboard: Space or Enter starts stacking.'));
    wireDiffButtons(api.overlay, 'stack', function () { return diff; }, function (d) { diff = d; writeDiff('stack', d); applyStackDiff(); });
    var s = document.getElementById('stack-start');
    if (s) s.addEventListener('click', startGame);
    resetGrid();
    updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      cleanupPause();
    };
  }

  // ================= Steeple Stack =================
  // Tower stacking; wind picks up from stone fifteen; height bonuses.
  var STEEPLE_FEATURE_BUTTRESS = true; // Feature (flagged): once per run, a
  // stone that would miss the tower outright is caught by the buttress and
  // placed as one narrow foothold instead of toppling the steeple, so a
  // single mistimed drop late in a tall run costs the tower's width, not
  // the whole run.
  function mountSteeple(parent, onBack) {
    var api = createStage(parent, { title: 'Steeple Stack', onBack: onBack });
    var tower = [], moving = null, wind = 0, score = 0, best = readBest('steeple');
    var state = 'ready', paused = false, raf = 0, last = 0, destroyed = false;
    var camOff = 0; // the view scrolls down as the tower grows, so the top stays in reach and the wind (stone fifteen) is reachable at all
    var perfectT = 0; // seconds left to show the Perfect flash after a clean drop
    var perfectStreak = 0; // consecutive perfect drops; the bonus grows with it
    var lastPerfectBonus = 0; // points the last perfect drop paid, for the flash text
    var steepleButtressUsed = false; // the one buttress save per run (feature, flagged)
    var debris = []; // trimmed slivers, falling away after a cut drop
    // Perfect means essentially nothing was trimmed: at most PERFECT_TOL px
    // of the moving stone may hang over the tower edge. The stone moves
    // ~2-3px per frame at full swing, so 2px is less than one frame of
    // travel — a drop timed to within a frame of square. Any real sliver
    // (3px or more cut off) is not perfect, and it stays cut off: the
    // stone is placed exactly where it landed, never snapped square.
    var PERFECT_TOL = 2;
    // Perfect streaks grow the tower: every PERFECT_STREAK_GROW-th
    // consecutive perfect (3rd, 6th, 9th, ...) grows the stone just placed
    // by PERFECT_GROW_PX, up to PERFECT_MAX_W wide. The wider stone is the
    // new tower top, so the next moving stone is wider too.
    var PERFECT_STREAK_GROW = 3, PERFECT_GROW_PX = 10, PERFECT_MAX_W = 150;
    var BASE_W = 120, BASE_Y = GAME_H - 20;
    var diff = readDiff('steeple'); // Easy / Medium / Hard; Medium is the tuned default
    var stoneBase = 115, stonePer = 6, windFrom = 15, windMag = 40, graceTopple = 3;
    function applySteepleDiff() {
      // Easy: the stone swings slower, the wind comes later and gentler,
      // and the first stones forgive a miss. Hard: faster swing, early
      // wind, less forgiveness. Medium is the current game.
      if (diff === 'easy') { stoneBase = 90; stonePer = 4; windFrom = 20; windMag = 20; graceTopple = 5; }
      else if (diff === 'hard') { stoneBase = 140; stonePer = 8; windFrom = 10; windMag = 60; graceTopple = 2; }
      else { stoneBase = 115; stonePer = 6; windFrom = 15; windMag = 40; graceTopple = 3; }
    }
    applySteepleDiff();
    function newStone() {
      var w = tower.length ? tower[tower.length - 1].w : BASE_W;
      // Narrow stones swing slower: the swing speed scales down as the
      // tower narrows, so a deep run on a thin tower stays humanly
      // playable instead of demanding frame-perfect drops at full pace.
      var soft = clamp(w / 70, 0.6, 1);
      moving = { x: -w / 2, w: w, dir: 1, speed: (stoneBase + tower.length * stonePer) * soft };
    }
    function startGame() {
      applySteepleDiff();
      parishSubmitted['steeple'] = false;
      tower = []; score = 0; wind = 0; camOff = 0; state = 'playing';
      perfectStreak = 0; perfectT = 0; lastPerfectBonus = 0; // a fresh run starts with no streak carried over
      steepleButtressUsed = false; debris = [];
      api.hideOverlay(); newStone(); updateHud();
    }
    function drop() {
      if (paused) return; // a tap on the field while paused must not place a stone
      if (state !== 'playing' || !moving) return;
      var top = tower.length ? tower[tower.length - 1] : { x: (GAME_W - BASE_W) / 2, w: BASE_W, y: BASE_Y };
      var left = Math.max(moving.x, top.x), right = Math.min(moving.x + moving.w, top.x + top.w);
      var overlap = right - left;
      if (overlap < 6) {
        // Too thin to hold: a landing that keeps less than 6px of stone
        // crumbles away instead of balancing the tower on a sliver the
        // player can neither see nor build on. It counts as a miss for
        // the grace stones and the buttress, and the falling stone shows
        // why the run ended.
        var crumbled = overlap > 0;
        if (crumbled) debris.push({ x: moving.x, w: moving.w, y: top.y - 18, vy: 0, life: 0.9 });
        // Early grace: the first three stones are for learning the swing.
        // A clean miss that early just drops the stone and lets the player
        // try again instead of ending the run before it has begun.
        if (tower.length < graceTopple) { api.showBanner(crumbled ? 'Too thin \u2014 the sliver crumbles' : 'Missed \u2014 try again', 1400); newStone(); return; }
        // The buttress (feature, flagged): once per run, a clean miss past
        // the grace stones is caught and placed as one narrow foothold
        // centred on the tower top, instead of ending the run. The next
        // stone is only as wide as the foothold, so the save costs the
        // tower's width and the run stays on a knife edge.
        if (STEEPLE_FEATURE_BUTTRESS && !steepleButtressUsed && tower.length) {
          steepleButtressUsed = true;
          var fw = Math.min(14, top.w);
          var fstone = { x: clamp(top.x + (top.w - fw) / 2, 0, GAME_W - fw), w: fw, y: top.y - 18 };
          tower.push(fstone);
          score += 1;
          perfectStreak = 0;
          camOff = Math.max(0, 18 * tower.length - 160);
          if (tower.length >= windFrom) wind = (Math.random() - 0.5) * windMag;
          api.showBanner('The buttress holds — one narrow stone', 1600);
          updateHud();
          newStone();
          return;
        }
        gameOver(); return;
      }
      var trimmed = moving.w - overlap; // px of the moving stone cut off by the tower edge
      // The trimmed sliver falls away instead of vanishing: the cut reads
      // on the tower, and a near miss looks like a near miss.
      if (trimmed > 0) {
        if (moving.x < left) debris.push({ x: moving.x, w: left - moving.x, y: top.y - 18, vy: 0, life: 0.9 });
        if (moving.x + moving.w > right) debris.push({ x: right, w: moving.x + moving.w - right, y: top.y - 18, vy: 0, life: 0.9 });
      }
      // Perfect only when essentially nothing was trimmed: a sliver cut off
      // means the drop was not perfect, however small the sliver. The stone
      // is placed exactly where it landed — the overhang is cut, the stone
      // is never snapped square onto the tower below.
      var perfect = overlap > 0 && trimmed <= PERFECT_TOL;
      var stone = { x: left, w: overlap, y: top.y - 18 };
      tower.push(stone);
      score += 1;
      // Scroll the view: keep the tower top near the same place on screen,
      // so a tall tower never runs into the moving stone and the game can
      // go past the dozen stones the fixed view used to allow.
      camOff = Math.max(0, 18 * tower.length - 160);
      // Height milestones: every fifth stone pays a bonus and says so, so
      // steady building is rewarded, not only perfect drops. Every tenth
      // pays a further 100, named in the same banner so the score never
      // jumps by more than the banner says.
      if (tower.length % 5 === 0) { score += 25; api.showBanner(tower.length + ' stones — the steeple rises! +' + (25 + (tower.length % 10 === 0 ? 100 : 0)), 1400); }
      // A run of perfect drops is worth more than one alone: the streak
      // grows the bonus, so a steady hand is rewarded for staying steady.
      // Every third consecutive perfect also grows the stone just placed
      // by 10px (up to 150px wide), so the tower gets easier to build on.
      if (perfect) {
        perfectStreak += 1;
        lastPerfectBonus = 10 + 5 * (perfectStreak - 1);
        score += lastPerfectBonus; perfectT = 1.2;
        if (perfectStreak % PERFECT_STREAK_GROW === 0) {
          var grow = Math.min(PERFECT_GROW_PX, PERFECT_MAX_W - stone.w);
          if (grow > 0) {
            stone.w += grow;
            stone.x = clamp(stone.x - grow / 2, 0, GAME_W - stone.w);
            api.showBanner('Perfect x' + perfectStreak + ' — the stone grows +' + grow, 1600);
          }
        }
      }
      else perfectStreak = 0;
      if (tower.length % 10 === 0) score += 100;
      if (tower.length >= windFrom) wind = (Math.random() - 0.5) * windMag;
      updateHud();
      newStone();
    }
    function gameOver() {
      state = 'over';
      var fb = writeBest('steeple', score); best = fb;
      submitParishScore('steeple', score);
      api.showOverlay('<h3>The steeple toppled</h3><p>Height: ' + tower.length + (tower.length === 1 ? ' stone' : ' stones') + ' &middot; Score: ' + score + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="steeple-again">Build again</button>' +
        kbdHint('Keyboard: Space or Enter builds again.') +
        '<button type="button" class="linklike" id="steeple-back">Back to arcade</button>');
      var a = document.getElementById('steeple-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('steeple-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + score + '</span><span>Stones: ' + tower.length + '</span>' +
        (perfectStreak > 1 ? '<span>Perfect x' + perfectStreak + '</span>' : '') +
        '<span>' + (tower.length >= windFrom ? 'Wind: ' + (wind >= 0 ? '→' : '←') + ' ' + Math.abs(Math.round(wind)) : 'Calm air') + '</span>' + diffTag(diff) + '<span>Best: ' + best + '</span>');
    }
    var steepleBg = null;
    function draw() {
      var ctx = api.ctx;
      // Warm sky gradient, built once per mount instead of every frame.
      if (!steepleBg) {
        steepleBg = ctx.createLinearGradient(0, 0, 0, GAME_H);
        steepleBg.addColorStop(0, '#fffdf7');
        steepleBg.addColorStop(0.75, '#f7ecd7');
        steepleBg.addColorStop(1, '#efdfc2');
      }
      ctx.fillStyle = steepleBg; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = '#2e5e4e'; ctx.fillRect(0, GAME_H - 14 + camOff, GAME_W, 14);
      ctx.fillStyle = '#6e1a26';
      ctx.fillRect((GAME_W - BASE_W) / 2, BASE_Y + camOff, BASE_W, 14);
      tower.forEach(function (s, i) {
        ctx.fillStyle = ['#6e1a26', '#b28a2e', '#2e5e4e', '#3a6ea5', '#8a6d3b'][i % 5];
        ctx.fillRect(s.x, s.y + camOff, s.w, 18);
        ctx.strokeStyle = '#33261a'; ctx.strokeRect(s.x, s.y + camOff, s.w, 18);
      });
      // Trimmed slivers, falling and fading where they were cut.
      debris.forEach(function (d) {
        ctx.globalAlpha = Math.max(0, d.life / 0.9);
        ctx.fillStyle = '#b28a2e';
        ctx.fillRect(d.x, d.y + camOff, d.w, 18);
        ctx.strokeStyle = '#33261a'; ctx.strokeRect(d.x, d.y + camOff, d.w, 18);
        ctx.globalAlpha = 1;
      });
      if (moving && state === 'playing') {
        ctx.fillStyle = '#b28a2e';
        ctx.fillRect(moving.x, 30, moving.w, 18);
        ctx.strokeStyle = '#33261a'; ctx.strokeRect(moving.x, 30, moving.w, 18);
        // Landing guide: a faint dashed outline of the stone projected onto
        // the tower top, with a thin line joining it to the moving stone,
        // so the player can judge the drop instead of guessing across the
        // gap between the top of the screen and the tower. It turns green
        // when the stone is lined up for a perfect drop, so a steady hand
        // gets its answer before committing.
        var topY = tower.length ? tower[tower.length - 1].y : BASE_Y;
        topY += camOff;
        var topX = tower.length ? tower[tower.length - 1].x : (GAME_W - BASE_W) / 2;
        var topW = tower.length ? tower[tower.length - 1].w : BASE_W;
        var gLeft = Math.max(moving.x, topX), gRight = Math.min(moving.x + moving.w, topX + topW);
        var gPerfect = (gRight - gLeft) > 0 && (moving.w - (gRight - gLeft)) <= PERFECT_TOL;
        ctx.strokeStyle = gPerfect ? 'rgba(46,125,50,0.9)' : 'rgba(178,138,46,0.55)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(moving.x, topY - 18, moving.w, 18);
        ctx.beginPath(); ctx.moveTo(moving.x + moving.w / 2, 48); ctx.lineTo(moving.x + moving.w / 2, topY - 18); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#6f6259'; ctx.font = '12px Georgia';
        ctx.fillText(hasKeyboard() ? 'Tap or press Space to drop' : 'Tap to drop', 12, 20);
      }
      if (perfectT > 0) {
        ctx.globalAlpha = Math.min(1, perfectT);
        ctx.fillStyle = '#b28a2e'; ctx.font = 'bold 18px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(perfectStreak > 1 ? 'Perfect x' + perfectStreak + '! +' + lastPerfectBonus : 'Perfect! +' + lastPerfectBonus, GAME_W / 2, 90); ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
      // Wind you can see: once the wind starts (stone fifteen), faint
      // streaks drift across the top of the screen in the wind's direction,
      // so the push on the stone is visible, not just a number in the HUD.
      if (tower.length >= windFrom) {
        var wNow = performance.now();
        ctx.strokeStyle = 'rgba(178,138,46,0.5)'; ctx.lineWidth = 1.5;
        for (var wi = 0; wi < 4; wi++) {
          var wPhase = (wNow / 18 + wi * 137) % (GAME_W + 80);
          var wx = wind >= 0 ? wPhase - 40 : (GAME_W + 40) - wPhase;
          var wy = 64 + wi * 20;
          ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + (wind >= 0 ? 26 : -26), wy); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(wx + (wind >= 0 ? 26 : -26), wy);
          ctx.lineTo(wx + (wind >= 0 ? 20 : -20), wy - 4); ctx.moveTo(wx + (wind >= 0 ? 26 : -26), wy);
          ctx.lineTo(wx + (wind >= 0 ? 20 : -20), wy + 4); ctx.stroke();
        }
      }
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(hasKeyboard() ? 'Paused — press P to resume' : 'Paused — tap Resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing' || !moving) return;
      if (perfectT > 0) perfectT = Math.max(0, perfectT - dt);
      if (debris.length) {
        debris.forEach(function (d) { d.vy += 500 * dt; d.y += d.vy * dt; d.life -= dt; });
        debris = debris.filter(function (d) { return d.life > 0; });
      }
      moving.x += (moving.dir * moving.speed + wind) * dt;
      if (moving.x + moving.w >= GAME_W) { moving.x = GAME_W - moving.w; moving.dir = -1; }
      if (moving.x <= 0) { moving.x = 0; moving.dir = 1; }
    }
    function loop(t) {
      if (destroyed) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      tick(dt); draw();
      raf = requestAnimationFrame(loop);
    }
    function doPause() { if (state === 'playing') { paused = true; api.pauseBtn.textContent = 'Resume'; } }
    function doResume() { paused = false; api.pauseBtn.textContent = 'Pause'; }
    var cleanupPause = wirePause(api, function () { return paused; }, doPause, doResume);
    document.addEventListener('keydown', onKey);
    // Keyboard play for the whole loop: Space or Enter starts and builds
    // again, Space drops the stone.
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      var go = (k === ' ' || k === 'enter');
      if ((state === 'ready' || state === 'over') && go && !kbdOnButton(e)) { e.preventDefault(); startGame(); return; }
      if (go && state === 'playing' && !paused && !kbdOnButton(e)) { e.preventDefault(); drop(); }
    }
    api.canvas.addEventListener('pointerdown', function () { drop(); });
    api.actions.appendChild(el('p', 'game-note', gameNote('Tap the field or press Space to drop the stone. Space or Enter starts and builds again. The wind picks up once the tower grows tall.', 'Tap the field to drop the stone. The wind picks up once the tower grows tall.')));
    api.showOverlay('<h3>Steeple Stack</h3><p>Drop each stone squarely on the last. Miss the tower and it topples — but once per run the buttress catches a clean miss and leaves one narrow stone. A drop counts as perfect only if almost nothing is trimmed off it, and three perfects in a row grows the stone by 10. ' + gameMark('steeple') + '</p>' +
      diffPickerHtml('steeple', diff) +
      '<button type="button" class="big-btn press" id="steeple-start">Start building</button>' +
      kbdHint('Keyboard: Space or Enter starts building.'));
    wireDiffButtons(api.overlay, 'steeple', function () { return diff; }, function (d) { diff = d; writeDiff('steeple', d); applySteepleDiff(); });
    var s = document.getElementById('steeple-start');
    if (s) s.addEventListener('click', startGame);
    updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      cleanupPause();
    };
  }

  // ================= Flee the Sins =================
  // Seven sins chase you. Halos are +25. Grace-dash on Space. The confession
  // bell rings every 60 seconds and drives the sins back.
  // The demo gives the seven sins distinct hunts rather than one shared
  // beeline: Wrath and Lust chase directly, Pride cuts ahead of where you
  // are going, Envy flanks to your side, Sloth plods straight at you.
  // Greed and Gluttony do not hunt at all: they drift slowly around the
  // edge of the sanctuary on patrol, dangerous only if you blunder into
  // them. That leaves five real hunters instead of seven converging at
  // once, and they are all well slower than you (you move at 200, the
  // fastest sin at 52), so a player who keeps moving and reads the field
  // can stay ahead of the pack. The sins also start slow: a short warmup
  // (6 seconds on Medium) at a third of their speed, so a player who needs
  // a beat to read the field is not dead before they have moved.
  // Patrollers walk this loop around the sanctuary edge: four waypoints
  // near the corners, in order, so two patrollers on different offsets
  // never stack on each other.
  var FLEE_FEATURE_SHIELD = true; // Feature (flagged): halos earn a
  // guardian halo that turns one catch aside, so daring halo runs
  // build their own safety net instead of only adding points. Each
  // new shield costs more halos than the last (5, then 10, then 15),
  // so the safety net stays earned late in a run instead of permanent.
  var FLEE_PATROL = [[40, 40], [440, 40], [440, 280], [40, 280]];
  var FLEE_SINS = [
    { name: 'Pride', speed: 44, color: '#5b2a4a', hunt: 'lead' }, { name: 'Greed', speed: 52, color: '#b28a2e', hunt: 'patrol' },
    { name: 'Lust', speed: 44, color: '#b8452a', hunt: 'chase' }, { name: 'Envy', speed: 44, color: '#2e5e4e', hunt: 'flank' },
    { name: 'Gluttony', speed: 44, color: '#8a6d3b', hunt: 'patrol' }, { name: 'Wrath', speed: 48, color: '#6e1a26', hunt: 'chase' },
    { name: 'Sloth', speed: 32, color: '#6f6259', hunt: 'chase' },
  ];
  function mountFlee(parent, onBack) {
    var api = createStage(parent, { title: 'Flee the Sins', onBack: onBack });
    var px = GAME_W / 2, py = GAME_H / 2, score = 0, best = readBest('flee');
    var sins = [], halos = [], dashT = 0, dashCd = 0, bellT = 60, elapsed = 0, warmupT = 0;
    var bellCount = 0; // bells rung: the sins quicken after each one, so the late game tightens
    var diff = readDiff('flee'); // Easy / Medium / Hard; Medium is the tuned default
    var sinMult = 1, bellFirst = 30, bellEvery = 60, warmupSecs = 6;
    var releaseSchedule = [0, 0, 0, 12, 20, 30, 40];
    function applyFleeDiff() {
      // Easy: slower sins that join the hunt later, and a quicker first
      // bell. Hard: faster sins, sooner, and the bell takes longer.
      // Medium is the current game.
      if (diff === 'easy') { sinMult = 0.75; bellFirst = 25; bellEvery = 50; warmupSecs = 8; releaseSchedule = [0, 0, 0, 18, 28, 40, 52]; }
      else if (diff === 'hard') { sinMult = 1.3; bellFirst = 35; bellEvery = 70; warmupSecs = 4; releaseSchedule = [0, 0, 0, 8, 14, 20, 26]; }
      // Medium: Lust joins at 10s, not 3s, so the opening is a single
      // hunter (Pride) while a casual player learns the arena; the second
      // chaser arrives just after the 8s warmup ends.
      else { sinMult = 1; bellFirst = 25; bellEvery = 60; warmupSecs = 8; releaseSchedule = [0, 8, 10, 18, 28, 38, 48]; }
    }
    applyFleeDiff();
    var nearCd = 0; // near-miss bonus cooldown
    var rings = []; // halo pickup rings: gold circles that bloom and fade
    var fleeShield = false, fleeShieldBreaks = 0, fleeHalosSinceShield = 0, fleeShieldsEarned = 0, shieldGraceT = 0; // guardian halo (feature, flagged): held shield, times one broke, halos since the last shield was earned, shields earned this run, and the grace second after a break
    var fleeHudT = 0; // HUD refresh throttle: the scoreboard redraws 4 times a second, not every frame
    var fleeLastDx = 0, fleeLastDy = -1; // last direction moved, so a dash from a standstill still carries Father somewhere
    var prevPx = px, prevPy = py, pvx = 0, pvy = 0;
    var state = 'ready', paused = false, raf = 0, last = 0, destroyed = false;
    var keys = makeKeys();
    var dpadVec = { x: 0, y: 0 };
    function startGame() {
      applyFleeDiff();
      parishSubmitted['flee'] = false;
      px = GAME_W / 2; py = GAME_H / 2; score = 0; elapsed = 0; bellT = bellFirst; warmupT = warmupSecs;
      bellCount = 0; nearCd = 0; rings = [];
      fleeShield = false; fleeShieldBreaks = 0; fleeHalosSinceShield = 0; fleeShieldsEarned = 0; shieldGraceT = 0; fleeHudT = 0;
      fleeLastDx = 0; fleeLastDy = -1;
      // The first bell rings after 30 seconds, not 60, so a casual player
      // has a realistic shot at the pushback that is the point of the game.
      // After the first bell it settles to every 60 seconds.
      prevPx = px; prevPy = py; pvx = 0; pvy = 0;
      dashT = 0; dashCd = 0; halos = [];
      sins = FLEE_SINS.map(function (s, i) {
        return { name: s.name, speed: s.speed, color: s.color, hunt: s.hunt,
          x: rand(30, GAME_W - 30), y: i < 4 ? 20 : GAME_H - 20,
          side: i % 2 === 0 ? 1 : -1, phase: rand(0, Math.PI * 2),
          wp: i % 4,
          // Staggered release: Pride hunts from the start, Greed patrols
          // from 8s, Lust joins at 10s, then a new sin every ten seconds.
          // A casual player gets a real chance to learn the arena before
          // all seven are closing in at once.
          releaseAt: releaseSchedule[i] || 0, announced: false };
      });
      halos.push({ x: px + 70, y: py - 50 }); spawnHalo(); spawnHalo();
      state = 'playing'; api.hideOverlay(); updateHud();
    }
    function spawnHalo() {
      // A halo sitting on top of a sin is a trap, not a pickup: try a few
      // spots and keep clear of the hunting sins and the player, so every
      // halo on the floor is one a player can actually run down.
      var best = null;
      for (var t = 0; t < 8; t++) {
        var cand = { x: rand(30, GAME_W - 30), y: rand(30, GAME_H - 30) };
        var ok = Math.hypot(cand.x - px, cand.y - py) >= 30;
        if (ok) {
          for (var i = 0; i < sins.length; i++) {
            if (elapsed < sins[i].releaseAt) continue;
            if (Math.hypot(cand.x - sins[i].x, cand.y - sins[i].y) < 45) { ok = false; break; }
          }
        }
        best = cand;
        if (ok) break;
      }
      halos.push(best);
    }
    function gameOver() {
      state = 'over';
      var finalScore = Math.floor(score);
      var fb = writeBest('flee', finalScore); best = fb;
      submitParishScore('flee', finalScore);
      api.showOverlay('<h3>The sins caught up</h3><p>Score: ' + finalScore + ' &middot; Survived: ' + Math.floor(elapsed) + 's<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="flee-again">Run again</button>' +
        kbdHint('Keyboard: Space or Enter runs again.') +
        '<button type="button" class="linklike" id="flee-back">Back to arcade</button>');
      var a = document.getElementById('flee-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('flee-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function updateHud() {
      // The bell is the reprieve, so its countdown turns gold in the last
      // five seconds — the player can see the rescue coming and hold on.
      api.setHud('<span class="score">Score: ' + Math.floor(score) + '</span><span>Halos: +25 each</span>' +
        (fleeShield ? '<span style="color:#e8b64c;font-weight:700;">Guardian halo</span>' : '') +
        '<span' + (bellT <= 5 ? ' style="color:#e8b64c;font-weight:700;"' : '') + '>Bell in: ' + Math.ceil(bellT) + 's</span>' + diffTag(diff) + '<span>Best: ' + best + '</span>');
    }
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#1d1712'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.strokeStyle = 'rgba(196,154,60,0.35)';
      for (var gx = 40; gx < GAME_W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, GAME_H); ctx.stroke(); }
      for (var gy = 40; gy < GAME_H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(GAME_W, gy); ctx.stroke(); }
      halos.forEach(function (h) {
        ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(h.x, h.y, 11, 5, 0, 0, Math.PI * 2); ctx.stroke();
      });
      // Halo pickup rings bloom where a halo was taken, then fade.
      rings.forEach(function (rg) {
        ctx.globalAlpha = Math.max(0, 0.8 * (1 - rg.t / 0.4));
        ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(rg.x, rg.y, 8 + rg.t * 45, (8 + rg.t * 45) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.globalAlpha = 1;
      sins.forEach(function (s) {
        if (elapsed < s.releaseAt) return; // not yet in the hunt
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 13, 0, Math.PI * 2); ctx.fill();
        // Little horns, so the sins read as sins at a glance instead of
        // plain coloured dots with initials.
        ctx.beginPath();
        ctx.moveTo(s.x - 8, s.y - 9); ctx.lineTo(s.x - 11, s.y - 18); ctx.lineTo(s.x - 3, s.y - 11);
        ctx.moveTo(s.x + 8, s.y - 9); ctx.lineTo(s.x + 11, s.y - 18); ctx.lineTo(s.x + 3, s.y - 11);
        ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '8px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(s.name.slice(0, 2).toUpperCase(), s.x, s.y + 3); ctx.textAlign = 'left';
      });
      ctx.fillStyle = dashT > 0 ? '#b28a2e' : '#6e1a26';
      ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      // Guardian halo (feature, flagged): a gold ring around Father while
      // the shield is held, so the safety net reads at a glance.
      if (fleeShield) {
        ctx.strokeStyle = '#e8b64c'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(px, py, 17, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('F', px, py + 4); ctx.textAlign = 'left';
      if (dashCd > 0) {
        ctx.fillStyle = '#fffdf7'; ctx.font = '11px Georgia';
        ctx.fillText('Dash ready in ' + Math.ceil(dashCd) + 's', 12, 20);
      } else if (state === 'playing') {
        // Dash is ready: say so at a glance, so the player knows the
        // grace-dash is available without having to remember the cooldown.
        ctx.fillStyle = '#b28a2e'; ctx.font = 'bold 11px Georgia';
        ctx.fillText(hasKeyboard() ? 'Dash ready — Space' : 'Dash ready — tap', 12, 20);
      }
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(hasKeyboard() ? 'Paused — press P to resume' : 'Paused — tap Resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      elapsed += dt; score += dt * 1;
      bellT -= dt;
      if (bellT <= 0) {
        bellT = bellEvery;
        bellCount += 1; // every bell quickens the sins a little, capped below
        sins.forEach(function (s) {
          var dx = s.x - px, dy = s.y - py, len = Math.hypot(dx, dy) || 1;
          s.x = clamp(s.x + (dx / len) * 120, 20, GAME_W - 20);
          s.y = clamp(s.y + (dy / len) * 120, 20, GAME_H - 20);
        });
        api.showBanner('The confession bell rings — the sins fall back!', 1800);
      }
      if (dashT > 0) dashT -= dt;
      if (dashCd > 0) dashCd -= dt;
      if (nearCd > 0) nearCd -= dt;
      if (shieldGraceT > 0) shieldGraceT -= dt;
      var ax = keys.axis();
      var dx = ax.x + dpadVec.x, dy = ax.y + dpadVec.y;
      // Direct touch: run toward the finger while it is on the floor.
      if (fleeTouch) {
        var fdx = fleeTouch.x - px, fdy = fleeTouch.y - py;
        var fl = Math.hypot(fdx, fdy);
        if (fl > 12) { dx += fdx / fl; dy += fdy / fl; }
      }
      var len = Math.hypot(dx, dy);
      if (len > 0) { dx /= len; dy /= len; fleeLastDx = dx; fleeLastDy = dy; }
      else if (dashT > 0) { dx = fleeLastDx; dy = fleeLastDy; } // a dash from a standstill carries Father in the last direction moved, instead of burning the cooldown on the spot
      var speed = dashT > 0 ? 420 : 200;
      px = clamp(px + dx * speed * dt, 14, GAME_W - 14);
      py = clamp(py + dy * speed * dt, 14, GAME_H - 14);
      pvx = (px - prevPx) / Math.max(dt, 0.001); pvy = (py - prevPy) / Math.max(dt, 0.001);
      prevPx = px; prevPy = py;
      if (warmupT > 0) warmupT -= dt;
      var warm = warmupT > 0 ? 0.35 : 1;
      sins.forEach(function (s) {
        if (elapsed < s.releaseAt) return; // not yet in the hunt
        if (!s.announced && s.releaseAt > 0) {
          s.announced = true;
          api.showBanner(s.name + ' joins the hunt!', 1600);
        }
        // Distinct hunts: chase runs straight at you, lead cuts ahead of
        // your movement, flank aims at your side, patrol drifts between
        // fixed waypoints around the edge and never hunts you. During the
        // warmup every sin moves at a third of pace.
        var tx = px, ty = py;
        if (s.hunt === 'lead') { tx = px + pvx * 0.2; ty = py + pvy * 0.2; }
        else if (s.hunt === 'flank') {
          var fdx = px - s.x, fdy = py - s.y, fl = Math.hypot(fdx, fdy) || 1;
          tx = px + (-fdy / fl) * 45 * s.side; ty = py + (fdx / fl) * 45 * s.side;
        } else if (s.hunt === 'patrol') {
          // Patrol the sanctuary edge on a slow loop; advance to the next
          // waypoint when close. A patroller is a hazard you steer around,
          // not a hunter closing on you.
          var wp = FLEE_PATROL[s.wp % FLEE_PATROL.length];
          tx = wp[0]; ty = wp[1];
          if (Math.hypot(tx - s.x, ty - s.y) < 24) s.wp++;
        }
        var ddx = tx - s.x, ddy = ty - s.y, l = Math.hypot(ddx, ddy) || 1;
        var sp = s.speed * sinMult * warm * (s.hunt === 'patrol' ? 0.7 : 1) * (1 + 0.06 * Math.min(bellCount, 5));
        s.x += (ddx / l) * sp * dt;
        s.y += (ddy / l) * sp * dt;
      });
      rings.forEach(function (rg) { rg.t += dt; });
      rings = rings.filter(function (rg) { return rg.t < 0.4; });
      for (var i = halos.length - 1; i >= 0; i--) {
        if (Math.hypot(halos[i].x - px, halos[i].y - py) < 20) {
          rings.push({ x: halos[i].x, y: halos[i].y, t: 0 });
          halos.splice(i, 1); score += 25; if (!fleeShield) fleeHalosSinceShield += 1; spawnHalo(); updateHud();
          // Guardian halo (feature, flagged): halos earn a shield that
          // turns one catch aside. Only one is held at a time, and each
          // new shield costs more halos than the last (5, then 10,
          // then 15, ...), so the net stays earned late in a run.
          // Halos only count toward the next shield while unshielded:
          // a shield held for a long run must not bank its replacement.
          if (FLEE_FEATURE_SHIELD && !fleeShield && fleeHalosSinceShield >= 5 * (fleeShieldsEarned + 1)) {
            fleeShield = true; fleeShieldsEarned += 1; fleeHalosSinceShield = 0;
            api.showBanner('A guardian halo shields you — it will turn one catch aside', 1800);
          }
        }
      }
      if (dashT <= 0 && shieldGraceT <= 0) {
        for (var j = 0; j < sins.length; j++) {
          if (elapsed < sins[j].releaseAt) continue;
          var d = Math.hypot(sins[j].x - px, sins[j].y - py);
          if (d < 18) {
            // Guardian halo (feature, flagged): the shield breaks instead
            // of the run ending, the sins are driven back a step, and a
            // grace second keeps the next frame from catching Father
            // again on the spot. The rest of this frame's checks are
            // skipped: the grace covers them.
            if (fleeShield) {
              fleeShield = false; fleeShieldBreaks += 1; shieldGraceT = 1;
              sins.forEach(function (s) {
                var pdx = s.x - px, pdy = s.y - py, plen = Math.hypot(pdx, pdy) || 1;
                s.x = clamp(s.x + (pdx / plen) * 60, 20, GAME_W - 20);
                s.y = clamp(s.y + (pdy / plen) * 60, 20, GAME_H - 20);
              });
              api.showBanner('The guardian halo turns the sin aside!', 1800);
              break;
            }
            gameOver(); return;
          }
          // A near miss pays: brushing past a sin without being caught is
          // worth a little, so daring play beats circling at arm's length.
          if (d < 34 && nearCd <= 0) { nearCd = 2.5; score += 5; api.showBanner('Close call! +5', 900); }
        }
      }
      fleeHudT -= dt;
      if (fleeHudT <= 0) { fleeHudT = 0.25; updateHud(); }
    }
    function loop(t) {
      if (destroyed) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      tick(dt); draw();
      raf = requestAnimationFrame(loop);
    }
    function doPause() { if (state === 'playing') { paused = true; api.pauseBtn.textContent = 'Resume'; } }
    function doResume() { paused = false; api.pauseBtn.textContent = 'Pause'; }
    var cleanupPause = wirePause(api, function () { return paused; }, doPause, doResume);
    document.addEventListener('keydown', onKey);
    // Keyboard play for the whole loop: Space or Enter starts and runs
    // again, Space dashes. Arrows / WASD steer through makeKeys.
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      var go = (k === ' ' || k === 'enter');
      if ((state === 'ready' || state === 'over') && go && !kbdOnButton(e)) { e.preventDefault(); startGame(); return; }
      if (k === ' ' && state === 'playing' && !paused && dashCd <= 0 && !kbdOnButton(e)) {
        e.preventDefault(); dashT = 0.45; dashCd = 2;
      }
    }
    // Direct touch on the sanctuary floor: drag and Father follows your
    // finger; a quick tap dashes with grace. The pad and dash button still
    // work exactly as before.
    var fleeTouch = null;
    api.canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'playing' || paused) return;
      e.preventDefault();
      var pt = canvasPoint(api.canvas, e);
      fleeTouch = { sx: pt.x, sy: pt.y, x: pt.x, y: pt.y, t: performance.now() };
    });
    api.canvas.addEventListener('pointermove', function (e) {
      if (!fleeTouch || state !== 'playing' || paused) return;
      e.preventDefault();
      var pt = canvasPoint(api.canvas, e);
      fleeTouch.x = pt.x; fleeTouch.y = pt.y;
    });
    function endFleeTouch(e) {
      if (!fleeTouch) return;
      var dt = performance.now() - fleeTouch.t;
      var pt = e ? canvasPoint(api.canvas, e) : null;
      var moved = pt ? Math.hypot(pt.x - fleeTouch.sx, pt.y - fleeTouch.sy) : 999;
      if (dt < 250 && moved < 12 && state === 'playing' && !paused && dashCd <= 0) { dashT = 0.45; dashCd = 2; }
      fleeTouch = null;
    }
    api.canvas.addEventListener('pointerup', endFleeTouch);
    api.canvas.addEventListener('pointerleave', function () { fleeTouch = null; });
    api.canvas.addEventListener('pointercancel', function () { fleeTouch = null; });
    var dpadHeld = {};
    makeDpad(api.stage, function (dx, dy, active) {
      var key = dx + ',' + dy;
      if (active) dpadHeld[key] = [dx, dy]; else delete dpadHeld[key];
      var hx = 0, hy = 0, ks = Object.keys(dpadHeld);
      for (var hi = 0; hi < ks.length; hi++) { hx += dpadHeld[ks[hi]][0]; hy += dpadHeld[ks[hi]][1]; }
      dpadVec.x = hx; dpadVec.y = hy;
    });
    var dashBtn = el('button', 'press', 'Grace-dash' + (hasKeyboard() ? ' (Space)' : '')); dashBtn.type = 'button';
    dashBtn.addEventListener('click', function () {
      if (state === 'playing' && !paused && dashCd <= 0) { dashT = 0.45; dashCd = 2; }
    });
    api.actions.appendChild(dashBtn);
    api.actions.appendChild(el('p', 'game-note', gameNote('Halos are +25, and halos earn guardian halos that turn one catch aside — each new one takes more than the last. Space dashes through the sins. Space or Enter starts and runs again. The bell rings and drives the sins back \u2014 survive until it rings. On touch, drag on the floor to run, tap to dash.', 'Halos are +25, and halos earn guardian halos that turn one catch aside — each new one takes more than the last. The bell rings and drives the sins back \u2014 survive until it rings. Drag on the floor to run, tap to dash.')));
    api.showOverlay('<h3>Flee the Sins</h3><p>Seven sins are chasing you. Grab halos, dash with grace, and survive until the bell rings \u2014 it drives the sins back. Halos earn guardian halos that turn one catch aside, and each new one takes more than the last. ' + gameMark('flee') + '</p>' +
      diffPickerHtml('flee', diff) +
      '<button type="button" class="big-btn press" id="flee-start">Start running</button>' +
      kbdHint('Keyboard: Space or Enter starts running.'));
    wireDiffButtons(api.overlay, 'flee', function () { return diff; }, function (d) { diff = d; writeDiff('flee', d); applyFleeDiff(); });
    var s = document.getElementById('flee-start');
    if (s) s.addEventListener('click', startGame);
    updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      keys.cleanup();
      cleanupPause();
    };
  }

  // ================= Father's Crossing =================
  // Five traffic lanes, a river of logs and turtles, five church doors, a bell
  // timer, and a moth that circles the right door.
  // Golden candle: one per level, waiting on a road lane. Stepping on it
  // is +50 and +8s on the bell. Set false to play without it.
  var CROSS_GOLDEN_CANDLE = true;
  function mountCross(parent, onBack) {
    var api = createStage(parent, { title: 'Father\u2019s Crossing', onBack: onBack });
    var LANE_Y = [258, 226, 194, 162, 130];
    var RIVER_TOP = 44, RIVER_BOT = 118;
    var DOOR_X = [48, 144, 240, 336, 432];
    var px = GAME_W / 2, py = GAME_H - 18, lives = 3, score = 0, level = 1, best = readBest('cross'), bestPy = GAME_H - 18;
    var cars = [], floats = [], mothDoor = 0, bellT = 60;
    var candle = null, bellWarned = false, doorWarned = false; // golden candle, low-bell warning, door-lineup warning
    var state = 'ready', paused = false, raf = 0, last = 0, destroyed = false;
    var keys = makeKeys();
    var dpadVec = { x: 0, y: 0 };
    var moveCd = 0;
    var diff = readDiff('cross'); // Easy / Medium / Hard; Medium is the tuned default
    var carMult = 1, floatMult = 1, livesStart = 3, bellStart = 60, carBase = 3;
    function applyCrossDiff() {
      // Easy: slower traffic, fewer cars, an extra life and a longer
      // bell. Hard: faster traffic, more cars, one life fewer and a
      // shorter bell. Medium is the current game.
      if (diff === 'easy') { carMult = 0.75; floatMult = 0.8; livesStart = 4; bellStart = 75; carBase = 2; }
      else if (diff === 'hard') { carMult = 1.25; floatMult = 1.2; livesStart = 2; bellStart = 50; carBase = 4; }
      else { carMult = 1; floatMult = 1; livesStart = 3; bellStart = 60; carBase = 3; }
    }
    applyCrossDiff();
    var riverT = 0; // grace in the water: a mistimed step is recoverable for 0.6s
    function buildLevel() {
      cars = [];
      LANE_Y.forEach(function (y, i) {
        var dir = i % 2 === 0 ? 1 : -1;
        // Level 1 is the welcome mat: slower cars and only three per lane, so
        // a first-time player can read the gaps and cross. It ramps up after.
        var speed = (42 + level * 10) * carMult * (0.8 + Math.random() * 0.5);
        var n = level === 1 ? carBase : carBase + Math.floor(Math.random() * 2);
        for (var k = 0; k < n; k++) {
          // Each car keeps its own pace, so the gaps open and close instead
          // of the whole lane rolling along as one block.
          // Cars start spread along the lane with jitter, so every lane
          // opens with real gaps instead of a random pile-up that can
          // wall the lane off before the player has moved.
          cars.push({ y: y, x: clamp((k + 0.5) * (GAME_W / n) + rand(-40, 40), 20, GAME_W - 20), dir: dir, speed: speed * (0.85 + Math.random() * 0.35), w: rand(34, 52) });
        }
      });
      floats = [];
      for (var r = 0; r < 3; r++) {
        var y = RIVER_TOP + 14 + r * 26;
        var dir2 = r % 2 === 0 ? 1 : -1;
        var n2 = 3;
        for (var k2 = 0; k2 < n2; k2++) {
          // Floats start spread along the river, so each row always offers
          // a ride within reach instead of a random desert of open water.
          floats.push({ y: y, x: clamp((k2 + 0.5) * (GAME_W / n2) + rand(-30, 30), 30, GAME_W - 30), dir: dir2, speed: (45 + level * 6) * floatMult, w: rand(60, 92), kind: k2 === 1 ? 'turtle' : 'log',
            diveCd: 3 + Math.random() * 3, diving: 0 }); // turtles dive now and then; logs never do
        }
      }
      mothDoor = randInt(0, 4);
      bellWarned = false; doorWarned = false;
      // The golden candle waits on a random road lane, clear of the start
      // column, so reaching it is a small detour, not a free gift. Spawned
      // last, after the moth door, so the level layout is unchanged.
      candle = null;
      if (CROSS_GOLDEN_CANDLE) {
        var cy = LANE_Y[randInt(0, LANE_Y.length - 1)];
        var cx = rand(40, GAME_W - 40);
        if (Math.abs(cx - GAME_W / 2) < 60) cx = cx < GAME_W / 2 ? 60 : GAME_W - 60;
        candle = { x: cx, y: cy };
      }
    }
    function startGame() {
      applyCrossDiff();
      parishSubmitted['cross'] = false;
      px = GAME_W / 2; py = GAME_H - 18; lives = livesStart; score = 0; level = 1; bellT = bellStart;
      bestPy = GAME_H - 18; riverT = 0; moveCd = 0; // bestPy gates the +10 forward-progress score; it must reset every game
      buildLevel(); state = 'playing'; api.hideOverlay(); updateHud();
    }
    function resetSpot() { px = GAME_W / 2; py = GAME_H - 18; bestPy = GAME_H - 18; moveCd = 0; riverT = 0; doorWarned = false; }
    function loseLife(why) {
      lives -= 1; updateHud();
      if (lives <= 0) { gameOver(why); return; }
      api.showBanner(why + ' — ' + lives + (lives === 1 ? ' life' : ' lives') + ' left', 1500);
      resetSpot();
    }
    function gameOver(why) {
      state = 'over';
      var fb = writeBest('cross', score); best = fb;
      submitParishScore('cross', score);
      api.showOverlay('<h3>' + esc(why) + '</h3><p>Score: ' + score + ' &middot; Level: ' + level + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="cross-again">Cross again</button>' +
        kbdHint('Keyboard: Space or Enter crosses again.') +
        '<button type="button" class="linklike" id="cross-back">Back to arcade</button>');
      var a = document.getElementById('cross-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('cross-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function reachDoor(i) {
      if (i === mothDoor) {
        // Beating the bell pays: the seconds left on the bell are a bonus,
        // so a quick, confident crossing is worth more than a slow one.
        var timeBonus = Math.ceil(bellT) * 5;
        var gained = 250 + level * 50 + timeBonus;
        score += gained;
        api.showBanner('Through the right door! +' + gained + (timeBonus > 0 ? ' (incl. +' + timeBonus + ' for beating the bell)' : ''), 1600);
        level += 1; bellT = bellStart; buildLevel(); resetSpot(); updateHud();
      } else {
        loseLife('Wrong door');
      }
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + score + '</span><span>Lives: ' + '♥'.repeat(Math.max(0, lives)) + '</span>' +
        '<span>Level: ' + level + '</span><span>Bell: ' + Math.ceil(bellT) + 's</span>' + diffTag(diff) + '<span>Best: ' + best + '</span>');
    }
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#2e5e4e'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      // Church (top): all five doors look the same, so the moth circling
      // one of them is the only tell. The right door used to be gold, which
      // gave the answer away and made the moth pointless.
      ctx.fillStyle = '#6e1a26'; ctx.fillRect(0, 0, GAME_W, RIVER_TOP - 8);
      DOOR_X.forEach(function (x, i) {
        ctx.fillStyle = '#33261a';
        ctx.fillRect(x - 16, 10, 32, 26);
        ctx.fillStyle = '#fffdf7'; ctx.font = '10px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('' + (i + 1), x, 28); ctx.textAlign = 'left';
      });
      // The moth's orbit, drawn as a faint gold ring around the right door,
      // so the tell is readable at a glance without giving the answer away
      // in the way a gold door used to.
      ctx.strokeStyle = 'rgba(178,138,46,0.85)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(DOOR_X[mothDoor], 52, 26, 14, 0, 0, Math.PI * 2); ctx.stroke();
      // Moth circling the right door
      var mt = performance.now() / 300;
      var mx = DOOR_X[mothDoor] + Math.cos(mt) * 18, my = 52 + Math.sin(mt * 1.3) * 8;
      ctx.fillStyle = '#fffdf7';
      ctx.beginPath(); ctx.ellipse(mx, my, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      // River
      ctx.fillStyle = '#3a6ea5'; ctx.fillRect(0, RIVER_TOP, GAME_W, RIVER_BOT - RIVER_TOP);
      // Current: faint dashes drifting across the water, so the river reads
      // as moving instead of a flat blue band. The rides sit on top of it.
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2;
      ctx.setLineDash([14, 26]); ctx.lineDashOffset = -(performance.now() / 40) % 40;
      for (var fy = RIVER_TOP + 12; fy < RIVER_BOT; fy += 22) {
        ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(GAME_W, fy); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      floats.forEach(function (f) {
        // A diving turtle shows as a faint ripple: it is under the water,
        // and the player can see the ride is about to vanish.
        ctx.globalAlpha = (f.kind === 'turtle' && f.diving > 0) ? 0.3 : 1;
        ctx.fillStyle = f.kind === 'turtle' ? '#2e5e4e' : '#8a6d3b';
        ctx.fillRect(f.x - f.w / 2, f.y - 8, f.w, 16);
        if (f.kind === 'turtle' && f.diving <= 0) { ctx.fillStyle = '#fffdf7'; ctx.font = '10px Georgia'; ctx.fillText('~', f.x - 3, f.y + 3); }
        // A turtle about to dive ripples first, so a rider gets a warning
        // to step off instead of the ride vanishing without a tell.
        if (f.kind === 'turtle' && f.diving <= 0 && f.diveCd < 0.8) {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, f.w / 2 + 4, 11, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });
      // Road lanes
      ctx.fillStyle = '#33261a'; ctx.fillRect(0, LANE_Y[4] - 14, GAME_W, LANE_Y[0] - LANE_Y[4] + 28);
      ctx.strokeStyle = 'rgba(251,247,239,0.5)'; ctx.setLineDash([10, 10]);
      LANE_Y.forEach(function (y) { ctx.beginPath(); ctx.moveTo(0, y + 14); ctx.lineTo(GAME_W, y + 14); ctx.stroke(); });
      ctx.setLineDash([]);
      cars.forEach(function (c) {
        ctx.fillStyle = c.dir > 0 ? '#b8452a' : '#b28a2e';
        ctx.fillRect(c.x - c.w / 2, c.y - 9, c.w, 18);
        // Headlights at the front, red tail lights at the back, so the
        // traffic reads as cars with a direction instead of flat bars.
        var fx = c.x + c.dir * (c.w / 2);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillRect(fx - 2, c.y - 6, 4, 3);
        ctx.fillRect(fx - 2, c.y + 3, 4, 3);
        ctx.fillStyle = '#e05a2a';
        ctx.fillRect(c.x - c.dir * (c.w / 2) - 2, c.y - 6, 4, 3);
        ctx.fillRect(c.x - c.dir * (c.w / 2) - 2, c.y + 3, 4, 3);
      });
      // The golden candle, while this level's is uncollected: a flickering
      // gold flame on the road.
      if (candle) {
        var flick = 6 + Math.sin(performance.now() / 180) * 1.5;
        ctx.fillStyle = '#ffd24d';
        ctx.beginPath(); ctx.arc(candle.x, candle.y, flick, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6e1a26'; ctx.font = 'bold 9px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('C', candle.x, candle.y + 3); ctx.textAlign = 'left';
      }
      // Player
      ctx.fillStyle = '#6e1a26';
      ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('F', px, py + 4); ctx.textAlign = 'left';
      // In the water with no log underfoot: a splash ring grows as the
      // 0.6s grace runs out, so the player sees the rescue window closing
      // and knows to step back onto a log instead of waiting to sink.
      if (riverT > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 - riverT).toFixed(2) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 12 + riverT * 40, 0, Math.PI * 2); ctx.stroke();
      }
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(hasKeyboard() ? 'Paused — press P to resume' : 'Paused — tap Resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function onRiver() { return py > RIVER_TOP && py < RIVER_BOT; }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      bellT -= dt;
      if (bellT <= 0) { gameOver('The bell rang — out of time'); return; }
      if (!bellWarned && bellT <= 10 && bellT > 0) { bellWarned = true; api.showBanner('Hurry, the bell is nearly rung!', 1400); }
      if (moveCd > 0) moveCd -= dt;
      var ax = keys.axis();
      var dx = ax.x + dpadVec.x, dy = ax.y + dpadVec.y;
      // Direct touch: step toward the finger while it is held on the field.
      if (crossTouch && dx === 0 && dy === 0) {
        if (crossTouch.x - px > 12) dx = 1;
        else if (crossTouch.x - px < -12) dx = -1;
        if (crossTouch.y - py > 12) dy = 1;
        else if (crossTouch.y - py < -12) dy = -1;
      }
      if (moveCd <= 0 && (dx !== 0 || dy !== 0)) {
        moveCd = 0.16;
        px = clamp(px + dx * 24, 14, GAME_W - 14);
        py = clamp(py + dy * 24, 18, GAME_H - 14);
      }
      // Forward progress pays: every new highest row is +10, so effort
      // reads on the scoreboard long before the first door is reached.
      if (py < bestPy) { bestPy = py; score += 10; }
      // The golden candle: +50 and +8s on the bell, once per level.
      if (candle && Math.abs(px - candle.x) < 16 && Math.abs(py - candle.y) < 14) {
        candle = null; score += 50; bellT += 8;
        api.showBanner('Golden candle! +50 and +8s on the bell', 1500);
      }
      cars.forEach(function (c) {
        c.x += c.dir * c.speed * dt;
        if (c.x - c.w / 2 > GAME_W) c.x = -c.w / 2;
        if (c.x + c.w / 2 < 0) c.x = GAME_W + c.w / 2;
      });
      floats.forEach(function (f) {
        f.x += f.dir * f.speed * dt;
        if (f.x - f.w / 2 > GAME_W) f.x = -f.w / 2;
        if (f.x + f.w / 2 < 0) f.x = GAME_W + f.w / 2;
        // Turtles dive: a diving turtle is under the water and cannot be
        // ridden, so a turtle is a riskier ride than a log.
        if (f.kind === 'turtle') {
          if (f.diving > 0) f.diving -= dt;
          else {
            f.diveCd -= dt;
            if (f.diveCd <= 0) { f.diving = 1.2; f.diveCd = 3 + Math.random() * 3; }
          }
        }
      });
      // Ride a log or turtle. A mistimed step into the water is recoverable
      // for a beat: the player can step back to the road or onto a float
      // before the river takes a life, instead of dying on one bad step.
      if (onRiver()) {
        var riding = null;
        floats.forEach(function (f) {
          if (Math.abs(py - f.y) < 12 && Math.abs(px - f.x) < f.w / 2 && !(f.kind === 'turtle' && f.diving > 0)) riding = f;
        });
        if (riding) {
          riverT = 0;
          px += riding.dir * riding.speed * dt; if (px < 8 || px > GAME_W - 8) { loseLife('Swept off the log'); return; }
        } else {
          riverT += dt;
          if (riverT > 0.6) { riverT = 0; loseLife('Into the river'); return; }
        }
      } else riverT = 0;
      // Traffic
      for (var i = 0; i < cars.length; i++) {
        var c = cars[i];
        if (Math.abs(py - c.y) < 12 && Math.abs(px - c.x) < c.w / 2 + 8) { loseLife('Hit by traffic'); return; }
      }
      // Doors: stepping up between doors holds the player at the bank
      // instead of charging the nearest door, so a step drifted sideways
      // by the river cannot cost a life on the wrong door.
      if (py <= 40) {
        var nearest = 0, bestD = 1e9;
        DOOR_X.forEach(function (x, idx) { var d = Math.abs(px - x); if (d < bestD) { bestD = d; nearest = idx; } });
        if (bestD > 26) {
          py = 44;
          if (!doorWarned) { doorWarned = true; api.showBanner('Line up with a door first', 1200); }
          updateHud();
          return;
        }
        doorWarned = false;
        reachDoor(nearest);
        return;
      }
      updateHud();
    }
    function loop(t) {
      if (destroyed) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      tick(dt); draw();
      raf = requestAnimationFrame(loop);
    }
    function doPause() { if (state === 'playing') { paused = true; api.pauseBtn.textContent = 'Resume'; } }
    function doResume() { paused = false; api.pauseBtn.textContent = 'Pause'; }
    var cleanupPause = wirePause(api, function () { return paused; }, doPause, doResume);
    // Keyboard play for the whole loop: Space or Enter starts and
    // crosses again. Arrows / WASD move through makeKeys.
    document.addEventListener('keydown', onKey);
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      var go = (k === ' ' || k === 'enter');
      if ((state === 'ready' || state === 'over') && go && !kbdOnButton(e)) { e.preventDefault(); startGame(); }
    }
    // Direct touch on the field: touch and hold, and Father steps toward
    // your finger, one grid step at a time; lift to stop. The pad still
    // works exactly as before.
    var crossTouch = null;
    api.canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'playing' || paused) return;
      e.preventDefault();
      var pt = canvasPoint(api.canvas, e);
      crossTouch = { x: pt.x, y: pt.y };
    });
    api.canvas.addEventListener('pointermove', function (e) {
      if (!crossTouch) return;
      e.preventDefault();
      var pt = canvasPoint(api.canvas, e);
      crossTouch = { x: pt.x, y: pt.y };
    });
    function endCrossTouch() { crossTouch = null; }
    api.canvas.addEventListener('pointerup', endCrossTouch);
    api.canvas.addEventListener('pointerleave', endCrossTouch);
    api.canvas.addEventListener('pointercancel', endCrossTouch);
    var dpadHeld = {};
    makeDpad(api.stage, function (dx, dy, active) {
      var key = dx + ',' + dy;
      if (active) dpadHeld[key] = [dx, dy]; else delete dpadHeld[key];
      var hx = 0, hy = 0, ks = Object.keys(dpadHeld);
      for (var hi = 0; hi < ks.length; hi++) { hx += dpadHeld[ks[hi]][0]; hy += dpadHeld[ks[hi]][1]; }
      dpadVec.x = hx; dpadVec.y = hy;
    });
    api.actions.appendChild(el('p', 'game-note', gameNote('Arrows or WASD to move. Space or Enter starts and crosses again. Cross the road, ride the logs and turtles, and enter the door the moth circles before the bell. Turtles dive now and then — do not trust one to stay up. On touch, hold the field to walk toward your finger.', 'Cross the road, ride the logs and turtles, and enter the door the moth circles before the bell. Turtles dive now and then — do not trust one to stay up. Hold the field to walk toward your finger.')));
    api.showOverlay('<h3>Father\u2019s Crossing</h3><p>Five lanes of traffic, a river, and five church doors. Every step forward is +10. Follow the moth to the right door. ' + (CROSS_GOLDEN_CANDLE ? 'A golden candle waits on the road: +50 and +8s on the bell. ' : '') + gameMark('cross') + '</p>' +
      diffPickerHtml('cross', diff) +
      '<button type="button" class="big-btn press" id="cross-start">Start crossing</button>' +
      kbdHint('Keyboard: Space or Enter starts crossing.'));
    wireDiffButtons(api.overlay, 'cross', function () { return diff; }, function (d) { diff = d; writeDiff('cross', d); applyCrossDiff(); });
    var s = document.getElementById('cross-start');
    if (s) s.addEventListener('click', startGame);
    updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      keys.cleanup();
      cleanupPause();
    };
  }

  // ================= Parish Pastor =================
  // 16-week season, shuffled 15-of-35 deck plus the fixed Holy Week,
  // start 140 / 3000 / 65 on Medium.
  // Ends early if cong <= 0, funds < -500, or happy <= 0. After each choice:
  // collection = round(cong * happy/100 * 2.2), costs = 120 + round(cong * 0.3).
  // Event titles, texts and choice labels/deltas are the demo deck as
  // reported by inspection; the one-line result after each choice is a
  // rebuilt paraphrase, not the demo's wording.
  // Season length: 16 weeks, not 24. A 24-week season drags in the middle:
  // the loop is identical every week and nothing new arrives after the
  // opening stretch, so a season ran past ten minutes of reading for a
  // casual player. Sixteen weeks is still a full season arc (four months,
  // 15 of 35 events plus Holy Week, so every season draws a different hand)
  // and lands in about seven minutes.
  var PASTOR_WEEKS = 16;
  // Second chance: once per season, take back the last week and choose
  // again. Set false to play without it.
  var PASTOR_UNDO_FEATURE = true;
  var PASTOR_DECK = [
    ["The leaky roof", "Rain has found its way through the nave roof, and a bucket now sits in the third pew. The roofing firm can start Monday - for a price.",
      ["Fix it properly, and fix it now", "The roof is mended and the third pew is dry again.", 1, -900, 8],
      ["Patch it and keep an eye on it", "The patch holds, and the bucket stays, just in case.", 0, -250, -2],
      ["Buckets out, and preach on Noah", "A few smile; most look up at the stain.", -3, 0, -6]],
    ["The choir feud", "The organist and the choir director have not spoken in a fortnight. Each has let it be known that the parish is big enough for only one of them.",
      ["Side with the organist", "The director resigns from the choir in a huff.", -4, 0, -6],
      ["Side with the director", "The organist plays very loudly on Sunday.", -3, 0, -5],
      ["Make them plan a concert together", "The concert is a triumph, and they are speaking again.", 4, -320, 8]],
    ["Bingo, twice a week?", "The bingo ladies run the most profitable night in the parish hall and want a second weekly session. The youth group, which uses the hall that evening, is less keen.",
      ["Approve the second bingo night", "The hall is full twice a week now.", 2, 380, 2],
      ["Keep bingo to its one night", "Everyone carries on much as before.", 0, 120, 0],
      ["End bingo, and rent the evening out", "The bingo ladies are not best pleased.", -5, 260, -7]],
    ["The boiler has died", "The church boiler has given up in the coldest week of the year. The engineer shakes his head in the way that always precedes a large number.",
      ["Replace it this week", "Warmth returns, and so does the congregation.", 2, -1200, 6],
      ["Space heaters, and wear your coats", "A cold, thin congregation shivers through Mass.", -6, -180, -8],
      ["An emergency appeal from the pulpit", "The parish digs deep, though some grumble.", 0, 480, -3]],
    ["A generous offer, with strings", "A wealthy parishioner offers a large donation - if the early Sunday Mass moves an hour later, to suit his golf. He is smiling, but he is not joking.",
      ["Accept, and move the Mass", "The money arrives; the early risers do not.", -6, 2000, -9],
      ["Decline, politely and firmly", "The parish respects a priest who cannot be bought.", 2, 0, 4],
      ["Accept a smaller gift, keep the hour", "A compromise, and the Mass stays put.", 1, 800, 2]],
    ["The pantry shelves are bare", "The food pantry has more families at the door than food on the shelves. The volunteers look to you.",
      ["Stock it from the parish funds", "No family is turned away this week.", 5, -520, 8],
      ["Ask the parish to bring cans", "The shelves fill, can by can.", 3, -40, 5],
      ["Close the pantry for a month", "The volunteers are ashamed to turn people away.", -8, 60, -10]],
    ["The bishop is coming", "The bishop will visit next month - his first visit in six years. The hall paint is peeling, the grounds are shaggy, and everyone has an opinion about what he will notice.",
      ["Deep-clean, repaint, replant everything", "The parish gleams, and the bishop notices.", 3, -600, 6],
      ["A tidy-up and fresh flowers", "Respectable, if not splendid.", 1, -150, 3],
      ["As we are - the Lord knows us", "The bishop is kind about it; the council is less so.", -1, 0, -4]],
    ["The youth lock-in", "The youth group wants an overnight lock-in in the hall: films, pizza, and Mass at dawn. The insurers have questions. So does the parish council.",
      ["Fund it - pizza, a speaker, chaperones", "A tired, happy crowd at dawn Mass.", 5, -220, 7],
      ["Let them run it themselves, cheaply", "It happens, on a shoestring, and mostly works.", 2, -40, 3],
      ["Veto it - too risky", "The young people drift away for a while.", -5, 0, -6]],
    ["The parking war", "Sunday parking has overflowed onto the neighbours street, and the letters have started - polite, then less polite. One mentions the council.",
      ["Rent the lot next door for Sundays", "Peace returns to the neighbours street.", 3, -300, 5],
      ["Ask people to walk or share rides", "Some walk; most keep driving.", -2, 0, -3],
      ["Ignore the letters", "The letters keep coming, less polite each time.", -1, 0, -5]],
    ["No catechists", "Sunday school has children enough for three classes and teachers enough for one. The new school year starts in a fortnight.",
      ["Hire a part-time coordinator", "Three classes, three teachers, happy parents.", 6, -650, 6],
      ["Ask from the pulpit, by name and need", "Volunteers step forward, slowly.", 4, 0, -1],
      ["Cancel the youngest class", "The youngest children have nowhere to go.", -9, 40, -8]],
    ["One Saturday, two bookings", "A couple wants to marry here on the very Saturday of the parish festival - booked, they point out, before the festival date was set. Both sides await your ruling.",
      ["Wedding in the morning, festival after", "A wedding, then a festival: a very good Saturday.", 2, 250, 5],
      ["Move the festival to another weekend", "The festival moves, and the volunteers sigh.", 0, -160, -3],
      ["Decline the wedding date", "The couple marries elsewhere, and word gets around.", -3, -60, -5]],
    ["The homily that travelled", "Someone filmed thirty seconds of Sundays homily and it has been shared far beyond the parish. Strangers are emailing. A few have started appearing in the back pews.",
      ["Welcome the newcomers warmly", "The back pews fill with new faces.", 10, 90, 4],
      ["Change nothing - let it settle", "The newcomers settle in quietly.", 6, 60, 1],
      ["Warn against church-shopping from the pulpit", "The newcomers stop coming, and so do a few others.", -4, -30, -6]],
    ["The confession queue", "Saturday confession now runs a queue out of the door - a good problem, the council calls it. You are only one priest, and Saturday is only so long.",
      ["Invite a retired priest to help", "Two confessors, and the queue melts away.", 3, -120, 7],
      ["Extend your own hours", "A long Saturday, but nobody is turned away.", 2, 0, 5],
      ["Confessions by appointment only", "The queue is gone, and so are some penitents.", -5, 0, -8]],
    ["The school subsidy", "The parish school is beloved and expensive. The finance council wants the parish subsidy debated openly this year, not nodded through.",
      ["Hold a gala for the school", "A glittering night, and the school is richer for it.", 2, 450, 4],
      ["Raise the subsidy from parish funds", "The school is safe for another year.", 4, -700, 5],
      ["Cut the subsidy", "The school community is furious.", -8, 400, -9]],
    ["The snow Sunday", "A serious snowstorm is forecast for Sunday. The plough contractor is ready either way; the question is what the parish does.",
      ["Full schedule, whatever falls", "A hardy few brave the snow, and love you for it.", 1, -160, 5],
      ["One Mass, then close up", "A sensible compromise; the snow does its worst.", 0, -60, 1],
      ["Cancel everything", "The parish stays home and wonders why.", -3, 40, -5]],
    ["Margaret retires", "Margaret, sacristan for thirty-one years, is retiring. She has ironed more altar linen than anyone alive and expects, characteristically, no fuss.",
      ["A proper send-off dinner", "Margaret weeps, then laughs, and the parish applauds.", 2, -260, 8],
      ["A card, a blessing, a bunch of flowers", "Margaret is quietly pleased.", 0, -30, 2],
      ["Post the vacancy and move on", "Thirty-one years, and not even a dinner.", -2, 0, -6]],
    ["The dog on the steps", "A stray dog has taken up residence on the rectory steps. He is thin, polite, and - the housekeeper reports - already named by the schoolchildren.",
      ["Keep him. The children named him Dominic", "Dominic greets every Mass-goer at the door.", 1, -60, 6],
      ["Find him a good home", "A kind family takes him in.", 0, -10, 1],
      ["Call animal control", "The children do not forgive this one quickly.", -2, 0, -5]],
    ["The votive candles", "Devotion is strong and the candle stands are always full - so full that the fire officer, doing a routine visit, went a little quiet.",
      ["Keep real candles, add a watch rota", "The flames burn on, watched over.", 1, -40, 4],
      ["Replace them with LED votives", "Safe, but somehow less warm.", 0, -180, -4],
      ["Remove half the candle stands", "Devotion finds fewer places to burn.", -3, 20, -6]],
    ["Festival season", "The parish festival - the years big fundraiser and bigger headache - needs a decision on scale while there is still time to book things.",
      ["Go big: rides, raffle, the works", "The biggest festival in years, and the coffers agree.", 6, 720, 7],
      ["Keep it simple: food stalls and music", "A gentle festival, well loved.", 2, 300, 3],
      ["Skip a year, to rest the volunteers", "The volunteers rest; the parish misses its party.", -3, -50, -5]],
    ["A baptism, and a question", "A young couple, new to the area and not seen at Mass, ask to have their baby baptised here. The parish secretary asks what the policy is.",
      ["Welcome them, and begin preparation", "A new family joins the parish fold.", 5, 30, 4],
      ["Ask them to attend for a few months first", "The couple drifts, unsure if they are wanted.", -1, 0, -3],
      ["Decline until they are settled parishioners", "The door closes before it ever opened.", -4, 0, -7]],
    ["The organs last note", "The organ wheezed through the final hymn and stopped. The organ builder can restore it properly, patch the bellows, or - his expression says it all - you can make do.",
      ["Full restoration", "The organ sings again, gloriously.", 1, -850, 6],
      ["Patch the bellows", "It plays, after a fashion.", 0, -220, 0],
      ["Borrow the school keyboard", "Sunday Mass sounds like a school assembly.", -2, -30, -6]],
    ["The pageant", "Christmas is coming and the childrens pageant needs a producer. The usual organiser has moved away, and the sign-up sheet is empty.",
      ["Fund costumes and let the youth group run it", "The best pageant anyone can remember.", 5, -120, 9],
      ["A simple nativity tableau instead", "Simple, and quietly beautiful.", 2, -30, 4],
      ["No pageant this year", "A Christmas without a pageant feels thinner.", -4, 0, -7]],
    ["The funeral request", "A grieving family asks for a favourite secular song and a eulogy from the grandchildren at their mothers funeral. Your predecessor never allowed either. The family is waiting in the parlour.",
      ["Allow a brief word of remembrance", "The grandchildren speak, and the church weeps with them.", 2, 40, 5],
      ["Offer the hall afterwards for memories", "Stories and tea in the hall, after a proper Mass.", 1, -40, 3],
      ["Hold the line - nothing extra", "The family buries their mother feeling unheard.", -3, 20, -6]],
    ["The finance councils warning", "Spending has outrun giving for three straight months. The finance council lays the figures in front of you, neatly, like evidence.",
      ["Publish the full parish accounts", "Open books, and the parish trusts you more.", 1, 150, 6],
      ["A quiet word with the big donors", "The donors quietly make up the gap.", 0, 350, -1],
      ["Cut the coffee hour and the flowers", "The parish notices every missing flower.", -2, 120, -6]],
    ["The pew that is theirs", "The Donnelly family has sat in the third pew for forty years. A new family sat there on Sunday, and words were exchanged in the car park. Everyone is watching you.",
      ["Preach on the last being first - then no reserved pews", "The sermon lands, and the pews belong to everyone.", 3, 0, 5],
      ["Quietly side with the Donnellys", "The new family quietly stops coming.", -3, 0, -4],
      ["Say nothing and let it settle", "The car park stays cold for weeks.", -1, 0, -3]],
    ["The seminarian", "The diocese is sending a seminarian for a placement term. He is twenty-four, keen, and - the bishops letter warns - full of ideas.",
      ["Give him real responsibility", "He thrives, and the parish loves his energy.", 4, -80, 5],
      ["Keep him shadowing you", "He learns, and waits his turn.", 1, -80, 2],
      ["Send him mostly to the school", "The schoolchildren adore him.", 2, -40, 0]],
    ["The journalists question", "A reporter from the local paper is writing about falling church attendance and wants a quote from you - the honest priest angle, she says.",
      ["Speak honestly, and hopefully", "The article is kind, and a few readers visit.", 5, 40, 3],
      ["No comment", "The article runs without you, and it shows.", -1, 0, -2],
      ["Blame the times, sharply", "The quote travels further than you hoped.", -5, 0, -5]],
    ["The coffee cart proposal", "The young adults propose a proper coffee cart after Sunday Mass - real coffee, a small price, proceeds to the pantry. The hall coffee, instant and ancient, has its defenders.",
      ["Fund the cart from parish money", "Real coffee, and the pantry benefits too.", 6, -350, 7],
      ["Let them run it as their own fundraiser", "The young adults run it like a small business.", 4, 140, 5],
      ["The hall coffee is enough", "The young adults take their coffee elsewhere.", -2, 0, -3]],
    ["The parish mission", "A well-known mission preacher has one free slot this year and your parish is next on his list. Three nights of preaching, if you want them.",
      ["Book the full three-night mission", "Three full nights, and confessions until midnight.", 8, -460, 9],
      ["One evening only", "One good night, and a taste of more.", 3, -120, 4],
      ["Pass this year", "The slot goes to another parish.", -1, 0, -2]],
    ["The relic comes to town", "A neighbouring diocese is touring a relic of St Therese, and your parish can host it for one evening - veneration, a candlelit Mass, and crowds the ushers are already nervous about.",
      ["Host it with full solemnity", "A candlelit Mass the parish will not forget.", 12, -380, 8],
      ["A quiet hour of veneration", "A quiet, reverent evening.", 5, -60, 5],
      ["Decline - the calendar is full", "The relic goes elsewhere, and so do the crowds.", -2, 0, -3]],
    ["The Corpus Christi procession", "Corpus Christi is coming, and the procession needs a route: through the town centre at noon with the canopy and the banners, or the modest loop around the church grounds.",
      ["Through the town centre, banners high", "The town stops and watches the canopy pass.", 7, -240, 7],
      ["The loop around the grounds", "A modest, prayerful loop.", 2, -40, 3],
      ["Skip the procession this year", "Corpus Christi passes without a procession.", -3, 30, -5]],
    ["The Latin Mass request", "A dozen parishioners - most of them young, several new - ask whether one Sunday Mass a month could be celebrated in the traditional Latin form. Others in the parish have views too, and they are not the same views.",
      ["Offer it monthly, and explain it well", "The monthly Mass is full, and the explanations help.", 6, -90, 1],
      ["One feast-day trial, then review it together", "A careful trial, and a calm review after.", 3, -30, 2],
      ["Decline, gently and finally", "The young dozen drift to another parish.", -4, 0, -2]],
    ["The 3 a.m. hour", "Perpetual adoration runs in the side chapel day and night, but the rota has one gap nobody will take: Thursdays at 3 a.m. The co-ordinator asks whether to keep adoration perpetual or scale it back to waking hours.",
      ["Take the 3 a.m. hour yourself", "A quiet hour with the Lord, and the rota holds.", 3, 0, 5],
      ["Appeal once more, by name, from the pulpit", "A volunteer finally takes the hour.", 2, -20, 3],
      ["Scale back to 6 a.m. to midnight", "Adoration is no longer perpetual.", -1, 0, -2]],
    ["The Lenten fish fry", "The Knights want to run their fish fry every Friday of Lent - a fundraiser, a tradition, and, the hall committee notes, a great deal of hot oil near a great many people.",
      ["Every Friday of Lent", "Fridays smell of fish and the hall is packed.", 5, 520, 6],
      ["Two Fridays only", "A modest fry, and a modest profit.", 2, 220, 3],
      ["Not this year - keep Lent quiet", "A quiet Lent, and a quieter hall fund.", -2, 0, -2]],
    ["The missionarys collection", "A missionary priest is visiting this weekend - wells, a school roof, and a clinic, all needing money. He asks for a second collection. Your own roof fund, the parish secretary points out, is not finished either.",
      ["Second collection, matched from parish funds", "The wells get dug, and the parish is proud.", 2, -450, 7],
      ["Take the second collection only", "A generous collection, and the roof fund waits.", 1, 0, 4],
      ["Prayers only this time", "The missionary leaves with prayers and little else.", -3, 0, -4]],
  ];

  // Holy Week, the one fixed week of the season: the biggest week of the
  // year always lands at the halfway point, so the season has an arc
  // instead of sixteen interchangeable weeks.
  var PASTOR_HOLY_WEEK = ["Holy Week", "Holy Week is here, the busiest week of the year. The Chrism Mass, the Triduum, the Easter Vigil — and the parish hall roof has sprung a leak over the altar servers' vestments.",
    ["All three Triduum liturgies, in full", "The church is packed, and the Vigil runs past midnight.", 6, -400, 8],
    ["One combined service, kept short", "A thin congregation, and a few disappointed faces.", -2, -100, -3],
    ["Cancel the Vigil, keep Good Friday only", "The Easter people stay home, and word gets around.", -8, 150, -10]];

  // Parish Pastor event illustrations: one simple cartoon scene per
  // event, drawn as inline SVG so a week reads as a little picture of
  // what is happening, not just a paragraph. Titles are the keys, taken
  // exactly as written in PASTOR_DECK (plus Holy Week); titles are never
  // personalised, so the map is looked up on the raw deck title.
  var PASTOR_SCENES = {
    'The leaky roof': 'roof',
    'The choir feud': 'choir',
    'Bingo, twice a week?': 'bingo',
    'The boiler has died': 'boiler',
    'A generous offer, with strings': 'donation',
    'The pantry shelves are bare': 'pantry',
    'The bishop is coming': 'bishop',
    'The youth lock-in': 'lockin',
    'The parking war': 'parking',
    'No catechists': 'school',
    'One Saturday, two bookings': 'wedding',
    'The homily that travelled': 'phone',
    'The confession queue': 'confession',
    'The school subsidy': 'subsidy',
    'The snow Sunday': 'snow',
    'Margaret retires': 'retire',
    'The dog on the steps': 'dog',
    'The votive candles': 'candles',
    'Festival season': 'festival',
    'A baptism, and a question': 'baptism',
    'The organs last note': 'organ',
    'The pageant': 'pageant',
    'The funeral request': 'funeral',
    'The finance councils warning': 'ledger',
    'The pew that is theirs': 'pew',
    'The seminarian': 'seminarian',
    'The journalists question': 'reporter',
    'The coffee cart proposal': 'coffee',
    'The parish mission': 'mission',
    'The relic comes to town': 'relic',
    'The Corpus Christi procession': 'procession',
    'The Latin Mass request': 'latin',
    'The 3 a.m. hour': 'adoration',
    'The Lenten fish fry': 'fishfry',
    'The missionarys collection': 'missionary',
    'Holy Week': 'holyweek'
  };
  function pastorSceneSvg(title) {
    var id = PASTOR_SCENES[title] || 'church';
    var B = '#6e1a26', B2 = '#7d2430', G = '#b28a2e', Y = '#e9bc4a', P = '#fffdf7',
      W = '#f3e9d2', S = '#9db8c6', K = '#3a2a22', GR = '#5d7d4a', SK = '#eec39a';
    function r(x, y, w, h, f, rx) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx || 0) + '" fill="' + f + '"/>'; }
    function c(x, y, rad, f) { return '<circle cx="' + x + '" cy="' + y + '" r="' + rad + '" fill="' + f + '"/>'; }
    function e(x, y, rx, ry, f) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + f + '"/>'; }
    function l(x1, y1, x2, y2, f, w) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + f + '" stroke-width="' + (w || 2) + '" stroke-linecap="round"/>'; }
    function p(d, f) { return '<path d="' + d + '" fill="' + f + '"/>'; }
    function ps(d, f, w) { return '<path d="' + d + '" fill="none" stroke="' + f + '" stroke-width="' + (w || 2) + '" stroke-linecap="round"/>'; }
    function t(x, y, str, size, f) { return '<text x="' + x + '" y="' + y + '" font-family="sans-serif" font-size="' + size + '" font-weight="bold" fill="' + f + '" text-anchor="middle">' + str + '</text>'; }
    function person(x, y, coat, hair) { // stands on ground line y
      return c(x, y - 30, 7, SK) + p('M' + (x - 7) + ' ' + (y - 31) + ' a7 6 0 0 1 14 0 Z', hair || '#5a3a22') +
        r(x - 7, y - 23, 14, 19, coat, 5) + r(x - 6, y - 4, 5, 9, K, 2) + r(x + 1, y - 4, 5, 9, K, 2);
    }
    function priest(x, y) { return person(x, y, K, K) + r(x - 2, y - 23, 4, 5, P, 1); }
    function church(x, y) { // a small church, door on ground line y
      return r(x - 42, y - 50, 84, 50, B2, 4) + p('M' + (x - 50) + ' ' + (y - 50) + ' L' + x + ' ' + (y - 78) + ' L' + (x + 50) + ' ' + (y - 50) + ' Z', B) +
        r(x - 8, y - 92, 16, 26, B, 3) + p('M' + (x - 11) + ' ' + (y - 92) + ' L' + x + ' ' + (y - 104) + ' L' + (x + 11) + ' ' + (y - 92) + ' Z', B) +
        l(x, y - 112, x, y - 100, G, 3) + l(x - 4, y - 108, x + 4, y - 108, G, 3) +
        c(x - 24, y - 34, 7, Y) + c(x + 24, y - 34, 7, Y) + p('M' + (x - 8) + ' ' + y + ' v-16 a8 8 0 0 1 16 0 v16 Z', W);
    }
    function tree(x, y) { return r(x - 2, y - 14, 4, 14, '#7a5230', 2) + c(x, y - 22, 11, GR) + c(x - 9, y - 15, 8, GR) + c(x + 9, y - 15, 8, GR); }
    function candle(x, y, h) { return r(x - 3, y - h, 6, h, P, 2) + e(x, y - h - 4, 3, 5, Y) + c(x, y - h - 4, 1.6, '#e07b2a'); }
    function coin(x, y, rad) { return c(x, y, rad, Y) + c(x, y, rad - 3, '#f6d67c') + t(x, y + 4, '$', rad, G); }
    function note(x, y, f) { return c(x, y, 5, f || B) + l(x + 5, y, x + 5, y - 16, f || B, 2) + p('M' + (x + 5) + ' ' + (y - 16) + ' q9 2 7 10 q-3 -6 -7 -6 Z', f || B); }
    function car(x, y, f) {
      return p('M' + (x - 30) + ' ' + y + ' v-10 q0 -6 8 -7 l6 -9 q2 -3 8 -3 h16 q6 0 9 4 l5 8 q8 1 8 8 v10 Z', f) +
        r(x - 16, y - 24, 13, 9, S, 2) + r(x + 3, y - 24, 13, 9, S, 2) + c(x - 17, y + 1, 6, K) + c(x + 18, y + 1, 6, K) + c(x - 17, y + 1, 2.5, W) + c(x + 18, y + 1, 2.5, W);
    }
    function flowers(x, y) {
      var s = l(x, y + 14, x - 5, y, GR, 2) + l(x, y + 14, x + 5, y, GR, 2) + l(x, y + 14, x, y - 3, GR, 2);
      return s + c(x - 6, y - 2, 4, '#d97b9b') + c(x + 6, y - 2, 4, Y) + c(x, y - 6, 4, B2);
    }
    var s = '';
    if (id === 'roof') {
      s = church(105, 128) + c(255, 30, 20, S) + c(282, 26, 25, S) + c(310, 32, 18, '#b9ccd6') +
        l(245, 52, 240, 66, '#6d9db8', 2) + l(268, 54, 263, 68, '#6d9db8', 2) + l(292, 52, 287, 66, '#6d9db8', 2) + l(315, 54, 310, 68, '#6d9db8', 2) +
        l(140, 62, 140, 92, '#6d9db8', 2) + p('M228 128 l5 -14 h18 l5 14 Z', G) + r(226, 110, 32, 5, B, 2) + c(242, 104, 3, '#6d9db8');
    } else if (id === 'choir') {
      s = r(52, 30, 12, 62, G, 3) + r(70, 22, 12, 70, G, 3) + r(88, 30, 12, 62, G, 3) +
        person(165, 122, B2, K) + person(225, 122, '#33566b', '#222') + r(148, 88, 30, 20, P, 2) + r(208, 88, 30, 20, P, 2) +
        note(140, 52) + note(205, 38, G) + note(262, 58, B2) + note(292, 40, G);
    } else if (id === 'bingo') {
      s = r(58, 34, 92, 62, P, 6) + l(58, 55, 150, 55, W, 2) + l(58, 76, 150, 76, W, 2) + l(89, 34, 89, 96, W, 2) + l(120, 34, 120, 96, W, 2) +
        t(73, 50, '7', 13, B) + t(104, 71, '22', 13, G) + t(135, 92, '41', 13, B2) +
        r(180, 104, 130, 10, '#8a5a34', 4) + c(215, 92, 13, B2) + t(215, 97, 'B', 12, P) + c(255, 90, 13, G) + t(255, 95, 'I', 12, P) + c(295, 92, 13, '#33566b') + t(295, 97, 'N', 12, P) + person(330, 118, B, '#888');
    } else if (id === 'boiler') {
      s = r(120, 42, 90, 84, '#5b4a42', 10) + c(165, 72, 17, '#8a6a55') + c(165, 72, 10, Y) + r(132, 108, 66, 10, B, 3) +
        l(140, 42, 140, 22, K, 4) + l(190, 42, 190, 22, K, 4) + ps('M132 30 q6 -8 12 0 M186 30 q6 -8 12 0', S, 2) +
        r(258, 30, 62, 62, S, 4) + r(258, 58, 62, 4, P, 0) + r(287, 30, 4, 62, P, 0) + c(272, 44, 3, P) + c(305, 76, 3, P) + c(276, 80, 3, P) +
        person(70, 126, '#33566b', K) + ps('M52 96 q4 -5 8 0 M84 96 q4 -5 8 0', '#6d9db8', 2);
    } else if (id === 'donation') {
      s = church(78, 126) + coin(185, 66, 24) + ps('M209 60 q44 -22 66 6 M209 74 q40 4 58 30', G, 2) +
        l(292, 66, 306, 112, '#7a5230', 4) + p('M292 66 q16 -8 20 2 q-8 8 -20 -2 Z', K) + person(255, 128, B2, '#888') + t(185, 122, 'strings attached', 11, B);
    } else if (id === 'pantry') {
      s = r(70, 36, 220, 8, '#8a5a34', 2) + r(70, 72, 220, 8, '#8a5a34', 2) + r(70, 108, 220, 8, '#8a5a34', 2) +
        r(86, 18, 14, 18, B2, 2) + r(108, 22, 12, 14, G, 2) + r(252, 54, 14, 18, '#33566b', 2) + r(88, 90, 14, 18, GR, 2) +
        t(180, 62, 'nearly empty', 12, B) + person(322, 126, GR, K) + p('M300 126 l4 -12 h20 l4 12 Z', G);
    } else if (id === 'bishop') {
      s = church(82, 126) + tree(300, 126) + tree(330, 126) +
        p('M196 44 L214 82 h-36 Z', P) + r(178, 82, 36, 4, G, 2) + l(196, 56, 196, 70, B, 3) + l(190, 62, 202, 62, B, 3) +
        person(196, 128, B2, '#888') + r(189, 98, 14, 8, Y, 2) + ps('M226 62 q14 2 10 16', G, 3) + l(232, 76, 232, 128, G, 3) + flowers(150, 112) + flowers(246, 112);
    } else if (id === 'lockin') {
      s = r(48, 28, 264, 98, B2, 8) + r(64, 44, 52, 40, '#33566b', 4) + c(98, 58, 8, Y) + ps('M84 44 q-4 20 0 40 M104 44 q4 20 0 40', P, 1) +
        e(190, 96, 26, 20, Y) + e(190, 96, 19, 13, '#e07b2a') + c(182, 90, 4, B) + c(198, 100, 4, GR) + c(196, 88, 3, B2) +
        r(238, 100, 56, 14, '#33566b', 7) + r(140, 112, 56, 14, B, 7) + person(150, 84, G, K) + person(268, 84, GR, '#222');
    } else if (id === 'parking') {
      s = church(180, 74) + r(30, 116, 300, 10, '#8d8578', 4) + l(45, 121, 315, 121, P, 2) + car(88, 112, B2) + car(196, 112, '#33566b') + car(292, 112, G) +
        ps('M120 84 q14 -12 26 0 M228 84 q14 -12 26 0', B, 2);
    } else if (id === 'school') {
      s = r(56, 30, 150, 66, '#33523f', 6) + t(131, 58, 'A B C', 17, P) + t(131, 82, '+  +  +', 12, Y) +
        person(248, 118, B2, K) + l(256, 96, 274, 82, SK, 4) +
        r(56, 112, 52, 10, '#8a5a34', 3) + r(140, 112, 52, 10, '#8a5a34', 3) + r(224, 112, 52, 10, '#8a5a34', 3) +
        c(82, 104, 7, SK) + c(166, 104, 7, SK) + c(300, 104, 7, SK);
    } else if (id === 'wedding') {
      s = church(180, 92) + person(148, 128, K, K) + person(214, 128, P, '#7a5230') + r(203, 98, 22, 10, P, 4) +
        c(168, 52, 11, 'none') + '<circle cx="168" cy="52" r="11" fill="none" stroke="' + Y + '" stroke-width="4"/>' + '<circle cx="192" cy="52" r="11" fill="none" stroke="' + G + '" stroke-width="4"/>' +
        p('M84 44 q6 -8 12 0 q6 -8 12 0 q0 10 -12 16 q-12 -6 -12 -16 Z', B2) + flowers(120, 112) + flowers(244, 112);
    } else if (id === 'phone') {
      s = r(140, 16, 82, 118, K, 12) + r(148, 30, 66, 82, S, 4) + priest(181, 92) + p('M172 66 L192 76 L172 86 Z', P) + c(181, 122, 4, P) +
        c(96, 62, 12, B2) + t(96, 67, '1', 12, P) + c(268, 48, 12, Y) + t(268, 53, '2', 12, K) + c(272, 94, 12, G) + t(272, 99, '3', 12, P) +
        person(82, 128, B, K) + person(292, 128, GR, '#222');
    } else if (id === 'confession') {
      s = r(56, 30, 120, 96, '#7a5230', 6) + p('M72 126 v-58 a14 14 0 0 1 28 0 v58 Z', B) + p('M122 126 v-58 a14 14 0 0 1 28 0 v58 Z', B2) +
        l(116, 34, 116, 22, G, 3) + l(110, 28, 122, 28, G, 3) +
        person(216, 126, '#33566b', K) + person(258, 126, GR, '#888') + person(300, 126, B2, '#222') + t(258, 60, 'one by one', 11, B);
    } else if (id === 'subsidy') {
      s = r(92, 56, 130, 70, B2, 4) + p('M84 56 L157 24 L230 56 Z', B) + l(157, 24, 157, 10, G, 3) + p('M157 10 h20 l-5 5 l5 5 h-20 Z', Y) +
        t(157, 84, 'SCHOOL', 13, P) + r(146, 98, 22, 28, W, 3) + coin(282, 62, 20) + ps('M262 76 q-16 22 -34 28', G, 3) + person(58, 126, GR, K);
    } else if (id === 'snow') {
      s = church(180, 122) + p('M124 52 L180 22 L236 52 q-28 8 -56 0 q-28 -8 -56 0 Z', P) + r(20, 118, 320, 14, P, 6) +
        c(62, 34, 3, P) + c(110, 18, 3, P) + c(258, 26, 3, P) + c(308, 44, 3, P) + c(84, 66, 3, P) + c(292, 76, 3, P) + c(226, 12, 3, P) +
        person(92, 124, B2, K) + r(84, 92, 17, 5, Y, 2) + person(272, 124, '#33566b', '#222');
    } else if (id === 'retire') {
      s = ps('M36 22 q144 26 288 0', G, 2) + p('M70 30 l8 14 l-16 0 Z', B2) + p('M140 36 l8 14 l-16 0 Z', Y) + p('M215 36 l8 14 l-16 0 Z', GR) + p('M282 30 l8 14 l-16 0 Z', B) +
        person(180, 124, B2, '#c9c9c9') + flowers(204, 96) + r(96, 104, 52, 10, '#8a5a34', 3) + e(122, 100, 20, 7, P) + c(122, 94, 4, B2) + person(268, 124, GR, K) + person(96, 124, '#33566b', '#222');
    } else if (id === 'dog') {
      s = church(104, 96) + r(48, 96, 130, 10, '#cbbd9d', 3) + r(62, 106, 130, 10, '#bfae8c', 3) + r(76, 116, 130, 10, '#cbbd9d', 3) +
        e(258, 106, 26, 13, '#b98a56') + c(286, 96, 12, '#b98a56') + p('M282 88 q12 -8 10 6 q-8 4 -12 -2 Z', '#8a5a34') + l(232, 100, 218, 90, '#b98a56', 5) +
        c(272, 94, 2, K) + r(276, 104, 16, 5, B2, 2) + l(246, 116, 244, 126, '#8a5a34', 4) + l(272, 116, 274, 126, '#8a5a34', 4) + person(326, 126, Y, K);
    } else if (id === 'candles') {
      s = r(70, 108, 220, 10, '#8a5a34', 3) + r(92, 76, 176, 8, '#8a5a34', 3) + r(116, 46, 128, 8, '#8a5a34', 3) +
        candle(104, 108, 18) + candle(140, 108, 24) + candle(180, 108, 18) + candle(220, 108, 24) + candle(256, 108, 18) +
        candle(128, 76, 18) + candle(168, 76, 22) + candle(208, 76, 18) + candle(238, 76, 20) +
        candle(150, 46, 16) + candle(184, 46, 20) + candle(216, 46, 16) + c(180, 62, 30, Y) + candle(180, 108, 34);
    } else if (id === 'festival') {
      s = ps('M20 18 q160 34 320 0', B, 2) + p('M58 26 l9 16 l-18 0 Z', B2) + p('M122 34 l9 16 l-18 0 Z', Y) + p('M188 36 l9 16 l-18 0 Z', GR) + p('M254 32 l9 16 l-18 0 Z', B) + p('M308 24 l9 16 l-18 0 Z', Y) +
        r(52, 76, 84, 50, P, 4) + p('M48 76 L94 56 L140 76 Z', B2) + r(226, 76, 84, 50, P, 4) + p('M222 76 L268 56 L314 76 Z', G) +
        c(268, 100, 5, B) + note(94, 104, B) + person(180, 128, GR, K);
    } else if (id === 'baptism') {
      s = church(84, 126) + p('M196 126 l6 -34 h44 l6 34 Z', '#cbbd9d') + e(226, 90, 34, 10, S) + e(226, 88, 26, 7, '#6d9db8') +
        l(226, 34, 226, 58, G, 4) + l(216, 44, 236, 44, G, 4) + ps('M226 66 q-4 8 0 12 q4 -4 0 -12', '#6d9db8', 2) +
        person(292, 126, B2, K) + person(322, 126, '#33566b', '#222') + e(306, 92, 13, 8, P) + c(316, 88, 5, SK);
    } else if (id === 'organ') {
      var pipes = '', px;
      for (px = 0; px < 9; px++) { var ph = 44 + (px % 3) * 12 + (px === 4 ? 18 : 0); pipes += r(96 + px * 19, 88 - ph, 13, ph, px % 2 ? G : '#c9a44a', 4); }
      s = pipes + r(82, 88, 196, 14, '#7a5230', 3) + r(104, 102, 152, 10, P, 2) + l(116, 107, 244, 107, K, 2) +
        person(180, 132, K, K) + note(52, 52, B2) + note(306, 44, G);
    } else if (id === 'pageant') {
      s = r(44, 118, 272, 8, '#8a5a34', 3) + p('M180 12 l4 10 l11 1 l-8 7 l2 11 l-9 -6 l-9 6 l2 -11 l-8 -7 l11 -1 Z', Y) +
        person(104, 118, '#33566b', K) + c(104, 80, 9, 'none') + person(150, 118, B2, '#222') + person(238, 118, GR, K) +
        r(176, 96, 42, 20, '#8a5a34', 3) + l(180, 96, 172, 84, G, 3) + l(214, 96, 222, 84, G, 3) + e(197, 98, 9, 6, P) + c(203, 94, 4, SK) + person(282, 118, G, '#888');
    } else if (id === 'funeral') {
      s = church(96, 126) + c(238, 78, 30, GR) + c(238, 78, 22, W) + c(222, 66, 5, '#d97b9b') + c(254, 66, 5, P) + c(238, 56, 5, Y) + c(222, 90, 5, P) + c(254, 90, 5, '#d97b9b') + c(238, 100, 5, Y) +
        ps('M238 108 v16 M226 116 q12 -6 24 0', GR, 3) + person(306, 126, K, K) + person(176, 126, K, '#888');
    } else if (id === 'ledger') {
      s = p('M92 34 L176 24 v92 L92 126 Z', P) + p('M268 34 L184 24 v92 L268 126 Z', '#fdf6e3') + l(180, 24, 180, 116, W, 3) +
        l(108, 48, 162, 42, S, 2) + l(108, 64, 162, 58, S, 2) + l(108, 80, 150, 75, B2, 3) + l(198, 42, 252, 48, S, 2) + l(198, 58, 252, 64, S, 2) + l(198, 74, 240, 79, B2, 3) +
        coin(66, 116, 13) + coin(292, 116, 13) + c(310, 52, 13, 'none') + '<circle cx="310" cy="52" r="13" fill="none" stroke="' + K + '" stroke-width="3"/>' + l(300, 62, 282, 80, K, 3);
    } else if (id === 'pew') {
      s = r(44, 62, 272, 14, '#8a5a34', 4) + r(44, 82, 272, 26, '#a06a3c', 4) + r(44, 116, 272, 12, '#8a5a34', 4) +
        person(96, 62, B2, K) + person(128, 62, B2, '#222') + person(238, 62, '#33566b', K) + person(268, 62, GR, '#888') +
        r(158, 40, 44, 20, P, 3) + t(180, 54, 'OURS?', 10, B) + ps('M140 34 q8 -8 16 0 M212 34 q8 -8 16 0', B, 2);
    } else if (id === 'seminarian') {
      s = church(92, 126) + person(216, 126, B, K) + r(226, 92, 22, 28, G, 3) + l(237, 96, 237, 116, P, 2) +
        c(216, 52, 10, Y) + t(216, 58, '!', 14, K) + ps('M150 118 q18 -6 30 0 M258 118 q14 -5 26 0', '#cbbd9d', 3) + person(308, 126, GR, '#222');
    } else if (id === 'reporter') {
      s = church(84, 126) + r(196, 52, 74, 58, P, 3) + t(233, 70, 'NEWS', 12, B) + l(206, 82, 260, 82, S, 2) + l(206, 94, 260, 94, S, 2) +
        person(292, 126, '#33566b', '#7a5230') + l(282, 98, 262, 86, SK, 4) + c(258, 84, 7, K) + t(150, 48, '?', 26, G);
    } else if (id === 'coffee') {
      s = r(112, 66, 120, 52, '#8a5a34', 5) + p('M104 66 L180 44 L256 66 Z', B2) + l(132, 58, 138, 66, P, 3) + l(168, 52, 172, 66, P, 3) + l(204, 52, 200, 66, P, 3) +
        r(128, 84, 20, 14, P, 2) + r(162, 84, 20, 14, P, 2) + ps('M136 78 q3 -6 0 -10 M170 78 q3 -6 0 -10', S, 2) + c(136, 126, 9, K) + c(216, 126, 9, K) +
        person(70, 126, GR, K) + person(282, 126, B, '#222') + person(180, 66 + 60, B2, K);
    } else if (id === 'mission') {
      s = p('M148 126 l8 -52 h48 l8 52 Z', '#7a5230') + r(142, 70, 76, 8, '#8a5a34', 2) + priest(180, 76) + l(166, 56, 148, 42, SK, 4) + l(194, 56, 214, 44, SK, 4) +
        ps('M128 36 q-10 8 0 16 M232 36 q10 8 0 16', G, 2) +
        c(92, 118, 10, '#5a3a22') + c(128, 122, 10, K) + c(232, 122, 10, '#888') + c(268, 118, 10, '#5a3a22') + r(60, 126, 240, 8, '#8a5a34', 3);
    } else if (id === 'relic') {
      s = r(96, 108, 168, 12, '#8a5a34', 3) + c(180, 62, 24, Y) + c(180, 62, 15, '#f6d67c') + l(180, 52, 180, 72, B, 3) + l(171, 60, 189, 60, B, 3) +
        l(180, 86, 180, 108, G, 5) + p('M162 108 h36 l6 8 h-48 Z', G) +
        l(148, 40, 138, 28, G, 2) + l(212, 40, 222, 28, G, 2) + l(180, 32, 180, 18, G, 2) + candle(112, 108, 26) + candle(248, 108, 26);
    } else if (id === 'procession') {
      s = church(180, 70) + r(104, 58, 152, 12, Y, 5) + l(112, 70, 112, 126, '#7a5230', 4) + l(248, 70, 248, 126, '#7a5230', 4) + l(180, 70, 180, 126, '#7a5230', 3) +
        priest(180, 126) + person(96, 126, B2, K) + person(264, 126, B, '#222') + r(258, 84, 10, 34, B2, 2) + l(263, 84, 263, 76, G, 2);
    } else if (id === 'latin') {
      s = r(84, 96, 192, 26, P, 3) + r(84, 96, 192, 8, W, 3) + l(180, 30, 180, 78, G, 5) + l(164, 46, 196, 46, G, 5) +
        candle(116, 96, 30) + candle(244, 96, 30) + p('M148 96 L178 86 v10 L148 106 Z', B2) + p('M212 96 L182 86 v10 L212 106 Z', B) +
        ps('M138 62 q6 -8 0 -16 M226 62 q6 -8 0 -16', S, 2) + person(64, 128, K, K) + person(300, 128, K, '#888');
    } else if (id === 'adoration') {
      s = c(84, 44, 26, P) + l(84, 44, 84, 28, K, 3) + l(84, 44, 98, 50, K, 3) + t(84, 128, '3 a.m.', 13, B) +
        c(222, 58, 20, Y) + c(222, 58, 12, '#f6d67c') + l(222, 50, 222, 66, B, 3) + l(215, 57, 229, 57, B, 3) + l(222, 78, 222, 106, G, 5) + p('M206 106 h32 l5 8 h-42 Z', G) +
        c(306, 30, 9, S) + p('M300 24 a9 9 0 1 0 12 12 a11 11 0 0 1 -12 -12 Z', W) + priest(150, 126);
    } else if (id === 'fishfry') {
      s = r(64, 104, 180, 10, '#8a5a34', 3) + e(150, 92, 44, 16, K) + e(150, 90, 36, 11, '#5b4a42') +
        p('M124 90 q14 -12 28 0 q-6 8 -14 9 l4 6 l-10 -2 l-6 5 q-4 -8 -2 -18 Z', Y) + ps('M132 68 q4 -7 0 -13 M158 66 q4 -7 0 -13 M182 68 q4 -7 0 -13', S, 2) +
        person(262, 126, P, K) + r(250, 98, 24, 10, B2, 2) + t(86, 62, 'FRIDAY', 12, B);
    } else if (id === 'missionary') {
      s = c(248, 66, 38, '#6d9db8') + p('M224 44 q14 -6 18 4 q-12 8 -20 2 q-2 -4 2 -6 Z', GR) + p('M252 78 q16 -4 20 8 q-14 8 -24 0 q0 -6 4 -8 Z', GR) + e(248, 66, 38, 38, 'none') +
        r(84, 84, 56, 34, '#8d8578', 3) + p('M78 84 L112 62 L146 84 Z', B2) + l(112, 62, 112, 92, '#7a5230', 3) + p('M104 92 h16 l-3 12 h-10 Z', G) +
        person(176, 126, B2, K) + r(188, 96, 14, 18, G, 3);
    } else if (id === 'holyweek') {
      s = c(180, 118, 52, Y) + church(72, 126) + l(180, 26, 180, 104, '#7a5230', 6) + l(158, 48, 202, 48, '#7a5230', 6) + r(120, 104, 120, 8, GR, 3) +
        ps('M128 108 q-16 -22 -30 -24 M138 110 q-6 -26 -20 -34 M232 108 q16 -22 30 -24 M222 110 q6 -26 20 -34', GR, 4) +
        person(268, 126, B2, K) + person(96 + 200, 126, P, '#222');
    } else { // 'church' fallback
      s = church(150, 126) + tree(248, 126) + tree(282, 126) + priest(216, 126);
    }
    return '<svg viewBox="0 0 360 150" width="100%" role="img" aria-label="Parish Pastor event illustration" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="0" y="0" width="360" height="150" rx="10" fill="#f7ecd4"/>' +
      '<circle cx="326" cy="24" r="13" fill="#f6d67c"/>' +
      '<rect x="0" y="126" width="360" height="24" fill="#e7d9b4"/>' + s + '</svg>';
  }

  function mountPastor(parent, onBack) {
    var wrap = el('div', 'pastor-wrap');
    var head = el('div', 'game-head');
    var backBtn = el('button', 'back-btn press', '← Back to arcade'); backBtn.type = 'button';
    backBtn.addEventListener('click', function () { onBack(); });
    head.appendChild(backBtn);
    head.appendChild(el('h2', 'font-display', 'Parish Pastor'));
    wrap.appendChild(head);
    var stats = el('div', 'pastor-stats');
    wrap.appendChild(stats);
    var trend = el('div', 'pastor-trend');
    wrap.appendChild(trend);
    var card = el('div', 'pastor-card');
    wrap.appendChild(card);
    var ledger = el('div', 'pastor-ledger');
    wrap.appendChild(ledger);
    parent.appendChild(wrap);
    var diff = readDiff('pastor'); // Easy / Medium / Hard; Medium is the tuned default
  var startCong = 140, startFunds = 3000, startHappy = 65, collMult = 2.2, costBase = 120, costPer = 0.3;
  function applyPastorDiff() {
    // Easy: a fuller parish, deeper coffers, a happier congregation,
    // and a kinder weekly balance. Hard: a thinner parish, tighter
    // funds, lower spirits, and a harsher balance. Medium is the
    // current game.
    if (diff === 'easy') { startCong = 165; startFunds = 4200; startHappy = 72; collMult = 2.5; costBase = 100; costPer = 0.25; }
    else if (diff === 'hard') { startCong = 115; startFunds = 2200; startHappy = 58; collMult = 1.9; costBase = 140; costPer = 0.35; }
    else { startCong = 140; startFunds = 3000; startHappy = 65; collMult = 2.2; costBase = 120; costPer = 0.3; }
  }
  applyPastorDiff();
  var deck = [], holyWeek = PASTOR_HOLY_WEEK, week = 0, cong = startCong, funds = startFunds, happy = startHappy, over = false, started = false;
    var histCong = [startCong], histHappy = [startHappy], histFunds = [startFunds]; // the season's arc, for the trend chart
    var undoAvailable = false, undoUsed = false, undoSnapshot = null; // second chance: one take-back per season
    var overdraftWarned = false; // the ledger warns once each time the funds slip below $0
    var halfwayNoted = false; // the halfway ledger entry is written once, even after a take-back
    // The week's event: Holy Week is fixed at the halfway point (week 8),
    // every other week comes from the shuffled deck. The deck holds 15
    // events, not 16: Holy Week fills the 16th week, so drawing 16 would
    // silently waste one shuffled event every season (the old deck[7]).
    function currentEvent() { return week === 7 ? holyWeek : deck[week < 7 ? week : week - 1]; }
    var best = readBest('pastor');
    function parishName() {
      try {
        var hp = readHomeParish();
        return localStorage.getItem('rmf-parish-bowl-parish') || (hp ? hp.parish : '') || 'Your Parish';
      } catch (e) { return 'Your Parish'; }
    }
    function personalise(text) {
      var name = parishName();
      return text.replace(/St Mary'?s/g, name);
    }
    function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(); }
    // The parish mood, in one line under the numbers: the season reads as
    // a place with a feeling, not three dials.
    function parishMood() {
      var m = happy >= 80 ? 'The parish is joyful' : happy >= 60 ? 'The parish is steady' : happy >= 40 ? 'The parish is weary' : 'The parish is losing heart';
      if (cong < 100) m += ', and the pews are thinning';
      return m + '.';
    }
    function renderStats() {
      // Week-over-week deltas, from the history the trend chart is drawn
      // from, so the player can see this week's change at a glance instead
      // of only reading the totals.
      var dCong = histCong.length > 1 ? cong - histCong[histCong.length - 2] : 0;
      var dHappy = histHappy.length > 1 ? happy - histHappy[histHappy.length - 2] : 0;
      var dFunds = histFunds.length > 1 ? funds - histFunds[histFunds.length - 2] : 0;
      var delta = function (d) {
        return d === 0 ? '' : ' <small style="color:' + (d > 0 ? '#2e7d32' : '#b8452a') + '">(' + (d > 0 ? '+' : '') + d + ')</small>';
      };
      var deltaMoney = function (d) {
        if (d === 0) return '';
        return ' <small style="color:' + (d > 0 ? '#2e7d32' : '#b8452a') + '">(' + (d > 0 ? '+$' : '-$') + Math.abs(d).toLocaleString() + ')</small>';
      };
      // Danger warnings, in plain words, before the season ends on the
      // player without warning: the overdraft rule, thinning pews, and
      // failing spirits each get a line while there is still time to act.
      var warns = [];
      if (funds < 0) warns.push('Overdrawn: below -$500 the season ends');
      if (cong < 30) warns.push('The pews are nearly empty');
      if (happy < 15) warns.push('The parish is losing heart');
      // This week's expected balance, from the parish as it stands, so the
      // player can judge what a choice will cost against what comes in.
      var expectColl = Math.round(cong * (happy / 100) * collMult);
      var expectCosts = costBase + Math.round(cong * costPer);
      stats.innerHTML = '<span>Week ' + Math.min(week + 1, PASTOR_WEEKS) + ' of ' + PASTOR_WEEKS + '</span>' +
        '<span>Congregation: <b>' + cong + '</b>' + delta(dCong) + '</span>' +
        '<span>Funds: <b>' + money(funds) + '</b>' + deltaMoney(dFunds) + '</span>' +
        '<span>Happiness: <b>' + happy + '</b>' + delta(dHappy) + '</span>' +
        '<span class="small">This week, about: collection +' + money(expectColl) + ' &middot; costs -' + money(expectCosts) + '</span>' +
        // The season score, live: congregation + happiness + funds / 10, so
        // the player can see the number they are playing for as it moves.
        '<span>Score: <b>' + Math.max(0, Math.round(cong + happy + Math.max(0, funds) / 10)) + '</b></span>' +
        '<span>' + parishMood() + '</span>' +
        (warns.length ? '<span style="color:#b8452a;font-weight:700;">' + esc(warns.join('. ')) + '.</span>' : '') +
        (diff !== 'medium' ? '<span>Difficulty: ' + DIFF_LABEL[diff] + '</span>' : '') +
        '<span>Best: ' + best + '</span>';
      // The season's arc, as a small chart: congregation in burgundy and
      // happiness in gold, week by week, so the player can see the parish
      // rising or falling instead of only reading this week's numbers.
      var n = histCong.length;
      var pts = function (arr, max) {
        return arr.map(function (v, i) {
          var x = n > 1 ? (i / (n - 1)) * 280 : 0;
          var y = 52 - (Math.max(0, Math.min(max, v)) / max) * 48;
          return x.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
      };
      trend.innerHTML = '<svg viewBox="0 0 300 60" width="100%" height="60" role="img" aria-label="Season trend: congregation and happiness by week">' +
        '<line x1="0" y1="52" x2="300" y2="52" stroke="#d8cdb8" stroke-width="1"/>' +
        '<polyline points="' + pts(histCong, 250) + '" fill="none" stroke="#6e1a26" stroke-width="2"/>' +
        '<polyline points="' + pts(histHappy, 100) + '" fill="none" stroke="#b28a2e" stroke-width="2"/>' +
        '</svg><p class="small" style="margin:2px 0 0;">Congregation in burgundy, happiness in gold, week by week.</p>';
    }
    function ledgerEntry(html) {
      var d = document.createElement('div');
      d.className = 'pastor-entry';
      d.innerHTML = html;
      ledger.appendChild(d);
      ledger.scrollTop = ledger.scrollHeight;
    }
    function endSeason(reason) {
      over = true;
      var score = Math.max(0, Math.round(cong + happy + Math.max(0, funds) / 10));
      var fb = writeBest('pastor', score); best = fb;
      submitParishScore('pastor', score);
      // A verdict for the season, so the ending lands and the player has a
      // title to chase next season.
      var verdict = score >= 700 ? 'A flourishing parish — the pews are full and the books balance.' :
        score >= 550 ? 'A steady parish — holding together, with room to grow.' :
        score >= 400 ? 'A parish holding on — the work is not finished.' :
        'A parish in need — the next season will ask more of you.';
      card.innerHTML = '<h3>' + esc(reason) + '</h3>' +
        '<p>Final congregation: ' + cong + ' &middot; Funds: ' + money(funds) + ' &middot; Happiness: ' + happy + '<br>' +
        'Season score: <b>' + score + '</b> &middot; Best: ' + fb + '<br>' + esc(verdict) + '</p>' +
        '<button type="button" class="big-btn press" id="pastor-again">New season</button> ' +
        kbdHint('Keyboard: Space or Enter starts a new season.') +
        '<button type="button" class="linklike" id="pastor-back2">Back to arcade</button>';
      var a = document.getElementById('pastor-again');
      if (a) a.addEventListener('click', startSeason);
      var b = document.getElementById('pastor-back2');
      if (b) b.addEventListener('click', function () { onBack(); });
      renderStats();
    }
    function showWeek() {
      // Halfway through the season, the ledger notes the moment, so the
      // season has an arc instead of sixteen identical weeks.
      if (week === 8 && !halfwayNoted) { halfwayNoted = true; ledgerEntry('<b>Halfway through the season.</b> Eight weeks shepherded, eight to go — congregation ' + cong + ', funds ' + money(funds) + ', happiness ' + happy + '.'); }
      var ev = currentEvent();
      // Deck entries are [title, text, choice, choice, choice]: the choices
      // are ev[2..4], not ev[2] itself. (An earlier build iterated ev[2],
      // which is the first choice array, and rendered five garbage buttons
      // while every pick corrupted the numbers to NaN.)
      var choices = ev.slice(2);
      var html = '<h3>Week ' + (week + 1) + ' — ' + esc(ev[0]) + '</h3><div class="pastor-scene">' + pastorSceneSvg(ev[0]) + '</div><p>' + esc(personalise(ev[1])) + '</p><div class="pastor-choices">';
      choices.forEach(function (ch, i) {
        html += '<button type="button" class="pastor-choice press" data-i="' + i + '">' + esc(ch[0]) + kbdChip(String(i + 1)) + '</button>';
      });
      html += '</div>' + kbdHint('Keyboard: 1, 2 or 3 picks a choice.' + ((PASTOR_UNDO_FEATURE && undoAvailable && week > 0) ? ' U takes back last week.' : ''));
      // Second chance, once per season: take back last week and choose
      // again. Offered only after a choice has been made.
      if (PASTOR_UNDO_FEATURE && undoAvailable && week > 0 && !over) {
        html += '<p style="margin:10px 0 0;"><button type="button" class="linklike" id="pastor-undo">Take back last week (once per season)</button></p>';
      }
      card.innerHTML = html;
      card.querySelectorAll('.pastor-choice').forEach(function (btn) {
        btn.addEventListener('click', function () { choose(parseInt(btn.getAttribute('data-i'), 10)); });
      });
      var undoBtn = document.getElementById('pastor-undo');
      if (undoBtn) undoBtn.addEventListener('click', undoWeek);
      renderStats();
    }
    function choose(i) {
      if (over) return;
      var ev = currentEvent();
      var ch = ev[2 + i];
      // Snapshot before the choice, so the season's one take-back can
      // restore the week exactly as it stood, ledger included.
      if (PASTOR_UNDO_FEATURE && !undoUsed) {
        undoSnapshot = { week: week, cong: cong, funds: funds, happy: happy,
          histCong: histCong.slice(), histHappy: histHappy.slice(), histFunds: histFunds.slice(),
          ledgerHtml: ledger.innerHTML, overdraftWarned: overdraftWarned, halfwayNoted: halfwayNoted };
      }
      var fundsBefore = funds;
      cong += ch[2]; funds += ch[3]; happy += ch[4];
      // Happiness is a percentage, so it stays on a 0–100 scale: a long
      // run of kind choices used to push it to 160+, which inflated the
      // collection (it multiplies by happy / 100) and the season score.
      // The floor keeps the low end on the same scale; the season still
      // ends on happy <= 0 just below.
      if (happy > 100) happy = 100;
      if (happy < 0) happy = 0;
      histCong.push(cong); histHappy.push(happy);
      var collection = Math.round(cong * (happy / 100) * collMult);
      var costs = costBase + Math.round(cong * costPer);
      funds += collection - costs;
      histFunds.push(funds);
      // The ledger names what the choice itself did, apart from the week's
      // collection and costs, so the player can tell the decision from the
      // arithmetic.
      var fmtDelta = function (d, isMoney) {
        if (d === 0) return '0';
        return (d > 0 ? '+' : '-') + (isMoney ? '$' + Math.abs(d).toLocaleString() : Math.abs(d));
      };
      ledgerEntry('<b>Week ' + (week + 1) + ' — ' + esc(ev[0]) + ':</b> ' + esc(ch[0]) + ' — ' + esc(ch[1]) +
        '<br><span class="pastor-nums">Choice: congregation ' + fmtDelta(ch[2]) + ' &middot; funds ' + fmtDelta(ch[3], true) + ' &middot; happiness ' + fmtDelta(ch[4]) +
        '<br>Collection +' + money(collection) + ' &middot; Costs -' + money(costs) +
        ' &middot; Congregation ' + cong + ' &middot; Funds ' + money(funds) + ' &middot; Happiness ' + happy + '</span>');
      if (funds < 0 && fundsBefore >= 0 && !overdraftWarned) {
        overdraftWarned = true;
        ledgerEntry('<b>The parish is overdrawn.</b> Below -$500 the season ends, so the next weeks need to bring money in.');
      }
      if (funds >= 0) overdraftWarned = false;
      week += 1;
      undoAvailable = PASTOR_UNDO_FEATURE && !undoUsed;
      if (cong <= 0) { endSeason('The pews are empty — the parish has drifted away.'); return; }
      if (funds < -500) { endSeason('The parish is overdrawn beyond its $500 grace — the season ends.'); return; }
      if (happy <= 0) { endSeason('The parish has lost heart — the season ends.'); return; }
      if (week >= PASTOR_WEEKS) { endSeason('A full season shepherded — well done, Father.'); return; }
      showWeek();
    }
    function undoWeek() {
      if (!PASTOR_UNDO_FEATURE || !undoAvailable || !undoSnapshot || over) return;
      var s = undoSnapshot;
      week = s.week; cong = s.cong; funds = s.funds; happy = s.happy;
      histCong = s.histCong.slice(); histHappy = s.histHappy.slice(); histFunds = s.histFunds.slice();
      ledger.innerHTML = s.ledgerHtml;
      overdraftWarned = s.overdraftWarned; halfwayNoted = s.halfwayNoted;
      undoAvailable = false; undoUsed = true; undoSnapshot = null;
      ledgerEntry('<i>Last week taken back. The one second chance is spent.</i>');
      showWeek();
    }
    function startSeason() {
      applyPastorDiff();
      parishSubmitted['pastor'] = false;
      // Fresh copies of the events, with each event's three choices
      // shuffled: no slot is systematically the kind one. Pressing 1
      // every week used to beat thoughtful play (always-1 averaged
      // ~690 vs ~541 for random picks), because the generous option
      // usually sat first. The source deck is never touched, and the
      // shuffle happens once per season, so the one take-back re-deals
      // the same week with the same choices in the same order.
      function shuffleChoices(ev) {
        var ch = [ev[2], ev[3], ev[4]];
        for (var i = ch.length - 1; i > 0; i--) { var j = randInt(0, i); var t = ch[i]; ch[i] = ch[j]; ch[j] = t; }
        ev[2] = ch[0]; ev[3] = ch[1]; ev[4] = ch[2];
      }
      deck = PASTOR_DECK.map(function (ev) { return ev.slice(); });
      deck.forEach(shuffleChoices);
      for (var i = deck.length - 1; i > 0; i--) { var j = randInt(0, i); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
      deck = deck.slice(0, PASTOR_WEEKS - 1); // 15 deck events + Holy Week = 16 weeks
      holyWeek = PASTOR_HOLY_WEEK.slice();
      shuffleChoices(holyWeek);
      week = 0; cong = startCong; funds = startFunds; happy = startHappy; over = false; started = true;
      histCong = [startCong]; histHappy = [startHappy]; histFunds = [startFunds];
      undoAvailable = false; undoUsed = false; undoSnapshot = null; overdraftWarned = false; halfwayNoted = false;
      ledger.innerHTML = '';
      showWeek();
    }
    card.innerHTML = '<h3>Parish Pastor</h3><p>Shepherd your parish for 16 weeks. Every decision moves the congregation, the funds, and the happiness of the parish. Keep the pews full, the books out of the red, and the people glad. Your season score is congregation + happiness + funds &divide; 10. ' + (PASTOR_UNDO_FEATURE ? 'Once per season you may take back a week and choose again. ' : '') + gameMark('pastor') + '</p>' +
      diffPickerHtml('pastor', diff) +
      '<button type="button" class="big-btn press" id="pastor-start">Begin the season</button>' +
      kbdHint('Keyboard: Space or Enter begins the season · 1, 2 or 3 picks a choice.');
    wireDiffButtons(card, 'pastor', function () { return diff; }, function (d) { diff = d; writeDiff('pastor', d); applyPastorDiff(); });
    var s = document.getElementById('pastor-start');
    if (s) s.addEventListener('click', startSeason);
    // Keyboard play for the whole season: Space or Enter begins the
    // season and starts a new one, 1 / 2 / 3 picks a choice each week.
    document.addEventListener('keydown', onKey);
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      if (k === '1' || k === '2' || k === '3') {
        if (!over && card.querySelector('.pastor-choice')) choose(parseInt(k, 10) - 1);
        return;
      }
      if (k === 'u' && PASTOR_UNDO_FEATURE && undoAvailable && !over && card.querySelector('.pastor-choice')) { undoWeek(); return; }
      var go = (k === ' ' || k === 'enter');
      if (!go || kbdOnButton(e)) return;
      e.preventDefault();
      if (over) { startSeason(); return; }
      if (!started) startSeason();
    }
    renderStats();
    return function cleanup() {
      document.removeEventListener('keydown', onKey);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };
  }

  // ================= Catholic Trivia =================
  // Ten questions a round, drawn from the difficulty's pool of 30
  // (180 questions in all). 100 points per right answer, 1,000 for a
  // perfect round. Every question shows the correct answer and a
  // one-line explanation after the player answers, so it teaches as
  // well as tests. Keyboard: 1-4 or A-D to answer, Enter for next.
  // The questions come from window.RMF_TRIVIA_ARCADE, embedded by
  // the server on the games page.
  var TRIVIA_ROUND = 10, TRIVIA_POINTS = 100;
  function mountTrivia(parent, onBack) {
    var wrap = el('div', 'pastor-wrap');
    var head = el('div', 'game-head');
    var backBtn = el('button', 'back-btn press', '\u2190 Back to arcade'); backBtn.type = 'button';
    backBtn.addEventListener('click', function () { onBack(); });
    head.appendChild(backBtn);
    head.appendChild(el('h2', 'font-display', 'Catholic Trivia'));
    wrap.appendChild(head);
    var card = el('div', 'pastor-card');
    wrap.appendChild(card);
    parent.appendChild(wrap);
    var diff = readDiff('trivia');
    var best = readBest('trivia');
    var pools = (typeof window !== 'undefined' && window.RMF_TRIVIA_ARCADE) || null;
    var round = [], qi = 0, correct = 0, answered = false, over = false;
    function shuffle(arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = randInt(0, i); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    function startRound() {
      over = false; qi = 0; correct = 0; answered = false;
      var pool = pools && pools[diff] ? pools[diff] : [];
      round = shuffle(pool).slice(0, TRIVIA_ROUND).map(function (q) {
        var order = shuffle([0, 1, 2, 3]);
        return { topic: q.topic, q: q.q, answers: order.map(function (i) { return q.answers[i]; }), correct: order.indexOf(q.correct), why: q.why };
      });
      if (!round.length) { card.innerHTML = '<p class="notice">No questions for this difficulty yet.</p>'; return; }
      showQuestion();
    }
    function showQuestion() {
      answered = false;
      var q = round[qi];
      if (!q) { showFinal(); return; }
      card.innerHTML =
        diffPickerHtml('trivia', diff) +
        '<p class="small" style="margin:0 0 4px;">Question ' + (qi + 1) + ' of ' + round.length + ' &middot; ' + esc(q.topic) + ' &middot; Score ' + (correct * TRIVIA_POINTS) + ' &middot; Best ' + best + '</p>' +
        '<h3 style="margin:6px 0 14px;">' + esc(q.q) + '</h3>' +
        '<div class="trivia-answers">' +
        q.answers.map(function (a, i) {
          return '<button type="button" class="press trivia-answer" data-i="' + i + '"><span class="trivia-key">' + 'ABCD'[i] + '</span> ' + esc(a) + '</button>';
        }).join('') + '</div>' +
        '<div class="trivia-feedback"></div>' +
        (hasKeyboard() ? '<p class="small">Press 1 to 4 or A to D to answer.</p>' : '');
      wireDiffButtons(card, 'trivia', function () { return diff; }, function (d) { diff = d; writeDiff('trivia', d); startRound(); });
      var btns = card.querySelectorAll('.trivia-answer');
      btns.forEach(function (b) {
        b.addEventListener('click', function () { answer(Number(b.getAttribute('data-i'))); });
      });
    }
    function answer(i) {
      if (answered || over) return;
      answered = true;
      var q = round[qi];
      var right = i === q.correct;
      if (right) correct += 1;
      var btns = card.querySelectorAll('.trivia-answer');
      btns.forEach(function (b) {
        var bi = Number(b.getAttribute('data-i'));
        b.disabled = true;
        if (bi === q.correct) b.classList.add('is-correct');
        else if (bi === i) b.classList.add('is-wrong');
      });
      var fb = card.querySelector('.trivia-feedback');
      fb.innerHTML = '<p style="margin:12px 0 4px;font-weight:700;">' + (right ? 'Right! +100' : 'Not quite. The answer is ' + esc(q.answers[q.correct]) + '.') + '</p>' +
        '<p class="small" style="margin:0 0 10px;">' + esc(q.why) + '</p>' +
        '<button type="button" class="press trivia-next">' + (qi + 1 >= round.length ? 'See your score' : 'Next question') + '</button>';
      var next = fb.querySelector('.trivia-next');
      next.addEventListener('click', function () { qi += 1; showQuestion(); });
      next.focus();
    }
    function showFinal() {
      over = true;
      var score = correct * TRIVIA_POINTS;
      best = writeBest('trivia', score);
      card.innerHTML =
        diffPickerHtml('trivia', diff) +
        '<h3 style="margin:6px 0;">' + (correct === round.length ? 'A perfect round!' : correct >= 7 ? 'Well played.' : 'Good effort.') + '</h3>' +
        '<p style="font-size:20px;margin:6px 0;"><strong>' + score + ' points</strong> &middot; ' + correct + ' of ' + round.length + ' right</p>' +
        '<p class="small">Best: ' + best + ' &middot; ' + DIFF_LABEL[diff] + ' &middot; 100 points per right answer.</p>' +
        '<p class="trivia-cap-note small"></p>' +
        '<button type="button" class="press trivia-again">Play again</button>';
      wireDiffButtons(card, 'trivia', function () { return diff; }, function (d) { diff = d; writeDiff('trivia', d); startRound(); });
      var again = card.querySelector('.trivia-again');
      again.addEventListener('click', function () { startRound(); });
      again.focus();
      submitParishScore('trivia', score, function (data) {
        if (!data) return;
        var note = card.querySelector('.trivia-cap-note');
        if (!note) return;
        if (data.capped) {
          note.textContent = 'Today\u2019s parish limit is reached for this game (' + Number(data.dailyTotal || 0).toLocaleString() + ' of ' + Number(data.dailyCap || 5000).toLocaleString() + ' points). It resets tomorrow.';
        } else if (data.added > 0) {
          note.textContent = 'Added ' + Number(data.added).toLocaleString() + ' points to your parish today (' + Number(data.dailyTotal || 0).toLocaleString() + ' of ' + Number(data.dailyCap || 5000).toLocaleString() + ').';
        }
      });
    }
    function onKey(e) {
      if (over) { if (e.key === 'Enter') { e.preventDefault(); startRound(); } return; }
      if (answered) { if (e.key === 'Enter') { e.preventDefault(); qi += 1; showQuestion(); } return; }
      var map = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3, A: 0, B: 1, C: 2, D: 3 };
      if (e.key in map) { e.preventDefault(); answer(map[e.key]); }
    }
    document.addEventListener('keydown', onKey);
    if (!pools || !pools[diff] || !pools[diff].length) {
      card.innerHTML = '<p class="notice">The trivia questions did not load. Check your connection and try again.</p>';
    } else {
      startRound();
    }
    return function cleanup() {
      document.removeEventListener('keydown', onKey);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };
  }

  // ================= Candle Maze =================
  // 19x16 cloister maze, cell 20px. Father walks on his own; the player
  // only steers (arrows/WASD, swipe, dpad). Reverse applies immediately.
  // Candles +10, 4 vials +50, frightened sins pay 200/400/800/1600 a chain,
  // chalice +300 (+100/level) at 70 and 120 candles, close call +15,
  // flawless vigil +500, extra lives at 10,000 and 30,000 grace.
  // Fright lasts 6.5s on level 1, -0.8s per level, 2s minimum.
  // Scatter/chase: 7s scatter, 20s chase, 7s scatter, 20s chase, 5s scatter,
  // then chase forever; sins reverse at each switch.
  // Speeds: player 111+3/level (cap 126); sins 100+5/level (cap 122);
  // Sloth 93%; frightened 62%. 3 lives; "The candles go dark" ends the run.
  // The maze wall layout is a rebuild (the inspection gave dimensions and
  // rules, not the wall map); the centre was opened so the chalice spawns
  // at the demo's tile (9,10). Grace shield: one forgiven catch per life,
  // with a 1.6s mercy window.
  var MAZE_MAP = [
    '###################',
    '#V.......#.......V#',
    '#.##.##..#..##.##.#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.###D#.###.####',
    '#....#..HHH..#....#',
    '#.##.#.#####.#.##.#',
    '#.................#',
    '#.##.##....##.##.##', // row 10: the closing wall, so the right edge has no gap
    '#........#........#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '#V.......#.......V#',
    '###################',
  ];
  var MAZE_COLS = 19, MAZE_ROWS = 16, MAZE_CELL = 20, MAZE_OX = 50, MAZE_OY = 0;
  var MAZE_DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]];
  // Grace shield: once per life, the first catch is forgiven and Father
  // gets a brief mercy window instead of losing a life. Set false to play
  // without it.
  var MAZE_GRACE_SHIELD = true;
  function mountMaze(parent, onBack) {
    var api = createStage(parent, { title: 'Candle Maze', onBack: onBack });
    var tileX = function (c) { return MAZE_OX + c * MAZE_CELL + MAZE_CELL / 2; };
    var tileY = function (r) { return MAZE_OY + r * MAZE_CELL + MAZE_CELL / 2; };
    function mChar(c, r) {
      if (r < 0 || r >= MAZE_ROWS || c < 0 || c >= MAZE_COLS) return '#';
      return MAZE_MAP[r][c];
    }
    function playerOpen(c, r) { var ch = mChar(c, r); return ch === '.' || ch === 'V'; }
    function sinOpen(c, r) { return mChar(c, r) !== '#'; }
    var SINS_DEF = [
      { name: 'Wrath', color: '#b8452a', release: 0, corner: [17, 1], spawn: [9, 7] },
      { name: 'Pride', color: '#5b2a4a', release: 0.6, corner: [1, 1], spawn: [8, 7] },
      { name: 'Envy', color: '#2e5e4e', release: 3.2, corner: [17, 14], spawn: [10, 7] },
      { name: 'Sloth', color: '#6f6259', release: 6.0, corner: [1, 14], spawn: [9, 7] },
    ];
    var score = 0, level = 1, lives = 3, best = readBest('maze');
    var candles = {}, vials = {}, candlesTotal = 0, candlesEaten = 0;
    var player = null, sins = [], queued = { dx: -1, dy: 0 };
    var frightT = 0, frightMax = 0, frightChain = 0, modeIdx = 0, modeT = 7;
    var shieldUp = true, mercyT = 0; // grace shield: one forgiven catch per life, then a mercy window
    var elapsed = 0, dyingT = 0, flawless = true, closeCd = 0;
    var chaliceSpawned = 0, chaliceActive = false, chaliceT = 0;
    var called25 = false, called10 = false;
    var extraGiven = { 10000: false, 30000: false };
    var state = 'ready', paused = false, raf = 0, last = 0, destroyed = false;
    var diff = readDiff('maze'); // Easy / Medium / Hard; Medium is the tuned default
    var vigilTarget = 110, sinMult = 1, playerMult = 1, livesStart = 3;
    var sinRelease = [0, 0.6, 3.2, 6.0];
    function applyMazeDiff() {
      // Easy: fewer candles to the vigil, slower sins that start later,
      // a quicker Father and an extra life. Hard: more candles, faster
      // sins that start sooner, a slower Father and one life fewer.
      if (diff === 'easy') { vigilTarget = 85; sinMult = 0.85; playerMult = 1.06; livesStart = 4; sinRelease = [0, 1.2, 5, 9]; }
      else if (diff === 'hard') { vigilTarget = 130; sinMult = 1.15; playerMult = 0.94; livesStart = 2; sinRelease = [0, 0.3, 1.8, 3.5]; }
      else { vigilTarget = 110; sinMult = 1; playerMult = 1; livesStart = 3; sinRelease = [0, 0.6, 3.2, 6.0]; }
    }
    applyMazeDiff();
    var MODE_SEQ = [7, 20, 7, 20, 5, Infinity]; // scatter, chase, scatter, chase, scatter, chase forever
    function modeName() { return modeIdx % 2 === 0 ? 'scatter' : 'chase'; }
    function playerSpeed() { return Math.min(126, 111 + 3 * (level - 1)) * playerMult; }
    function sinSpeed(s) {
      var sp = Math.min(122, 100 + 5 * (level - 1)) * sinMult;
      if (s.name === 'Sloth') sp *= 0.93;
      if (frightT > 0) sp *= 0.62;
      if (s.state === 'eyes') return 200;
      return sp;
    }
    function buildMaze() {
      candles = {}; vials = {}; candlesTotal = 0; candlesEaten = 0;
      for (var r = 0; r < MAZE_ROWS; r++) for (var c = 0; c < MAZE_COLS; c++) {
        var ch = MAZE_MAP[r][c];
        if (ch === '.') { candles[c + ',' + r] = true; candlesTotal++; }
        else if (ch === 'V') { vials[c + ',' + r] = true; candlesTotal++; }
      }
      chaliceSpawned = 0; chaliceActive = false; chaliceT = 0;
      called25 = false; called10 = false;
    }
    function resetPositions() {
      player = { c: 9, r: 14, tc: 9, tr: 14, x: tileX(9), y: tileY(14), dx: -1, dy: 0, speed: playerSpeed() };
      player.tc = 8; player.tr = 14;
      queued = { dx: -1, dy: 0 };
      sins = SINS_DEF.map(function (d, i) {
        return { name: d.name, color: d.color, release: sinRelease[i], corner: d.corner,
          c: d.spawn[0], r: d.spawn[1], tc: d.spawn[0], tr: d.spawn[1],
          x: tileX(d.spawn[0]), y: tileY(d.spawn[1]), dx: 0, dy: 0,
          active: d.release === 0, leaving: true, state: 'normal', eyesPhase: 0, waitT: 0 };
      });
      // Wrath leaves through the house door, not through the wall above
      // the house: first step sideways to the door column, then up.
      sins[0].dx = -1; sins[0].dy = 0; sins[0].tc = 8; sins[0].tr = 7;
      modeIdx = 0; modeT = 7; frightT = 0; frightChain = 0; elapsed = 0;
      dyingT = 0; mercyT = 0; shieldUp = true; // a fresh life starts shielded
    }
    function startGame() {
      applyMazeDiff();
      parishSubmitted['maze'] = false;
      score = 0; level = 1; lives = livesStart; flawless = true;
      extraGiven = { 10000: false, 30000: false };
      buildMaze(); resetPositions();
      state = 'playing'; api.hideOverlay(); updateHud();
    }
    function nextLevel() {
      // The vigil is complete: stop here and let the moment land, with a
      // summary of the vigil, instead of wiping the maze in the same frame.
      var flawlessBonus = 0;
      if (flawless) { flawlessBonus = 500; score += 500; }
      state = 'vigil-done';
      api.showOverlay('<h3>Vigil complete!</h3><p>' + candlesEaten + ' candles lit &middot; Grace: ' + score +
        (flawlessBonus ? ' (incl. +' + flawlessBonus + ' flawless vigil)' : '') + ' &middot; Lives: ' + lives + '<br>Best: ' + best + '</p>' +
        '<button type="button" class="big-btn press" id="maze-next-vigil">Begin vigil ' + (level + 1) + '</button>' +
        kbdHint('Keyboard: Space or Enter begins the next vigil.') +
        '<button type="button" class="linklike" id="maze-back2">Back to arcade</button>');
      var nx = document.getElementById('maze-next-vigil');
      if (nx) nx.addEventListener('click', beginNextVigil);
      var bk = document.getElementById('maze-back2');
      if (bk) bk.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function beginNextVigil() {
      level += 1; flawless = true;
      buildMaze(); resetPositions();
      state = 'playing'; api.hideOverlay(); updateHud();
    }
    function gameOver() {
      state = 'over';
      var fb = writeBest('maze', score); best = fb;
      submitParishScore('maze', score);
      api.showOverlay('<h3>The candles go dark</h3><p>Grace: ' + score + ' &middot; Vigil reached: ' + level + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="maze-again">Light the candles again</button>' +
        kbdHint('Keyboard: Space or Enter lights the candles again · R restarts too.') +
        '<button type="button" class="linklike" id="maze-back">Back to arcade</button>');
      var a = document.getElementById('maze-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('maze-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function updateHud() {
      // The vigil is the goal, so the HUD shows progress toward it:
      // candles lit out of the 110 that complete a vigil.
      api.setHud('<span class="score">Grace: ' + score + '</span><span>Vigil: ' + level + '</span>' +
        '<span>Hearts: ' + '♥'.repeat(Math.max(0, lives)) + '</span>' +
        '<span>Candles: ' + candlesEaten + '/' + vigilTarget + '</span>' + diffTag(diff) + '<span>Best: ' + best + '</span>');
    }
    function addScore(n) {
      score += n;
      [10000, 30000].forEach(function (t) {
        if (score >= t && !extraGiven[t]) { extraGiven[t] = true; lives += 1; api.showBanner('Extra life!', 1600); }
      });
      updateHud();
    }
    function setDir(m, dx, dy) { m.dx = dx; m.dy = dy; m.tc = m.c + dx; m.tr = m.r + dy; }
    function reverseMover(m) {
      if (!m.dx && !m.dy) return;
      m.dx = -m.dx; m.dy = -m.dy; m.tc = m.c; m.tr = m.r;
    }
    function stepMover(m, dt) {
      if (!m.dx && !m.dy) return;
      var tx = tileX(m.tc), ty = tileY(m.tr);
      var ddx = tx - m.x, ddy = ty - m.y;
      var dist = Math.hypot(ddx, ddy);
      var step = m.speed * dt;
      if (dist <= step) {
        m.x = tx; m.y = ty; m.c = m.tc; m.r = m.tr;
        onArrive(m);
      } else {
        m.x += (ddx / dist) * step; m.y += (ddy / dist) * step;
      }
    }
    function onArrive(m) {
      if (m === player) {
        collectAt(player.c, player.r);
        if (queued.dx !== 0 || queued.dy !== 0) {
          if (playerOpen(player.c + queued.dx, player.r + queued.dy)) { setDir(player, queued.dx, queued.dy); return; }
        }
        if (playerOpen(player.c + player.dx, player.r + player.dy)) {
          player.tc = player.c + player.dx; player.tr = player.r + player.dy; return;
        }
        player.dx = 0; player.dy = 0;
      } else {
        sinDecide(m);
      }
    }
    function collectAt(c, r) {
      var key = c + ',' + r;
      if (candles[key]) {
        delete candles[key]; candlesEaten += 1; addScore(10);
        var left = Object.keys(candles).length + Object.keys(vials).length;
        if (candlesEaten === vigilTarget - 25 && !called25) { called25 = true; api.showBanner('25 candles to the vigil', 1500); }
        if (candlesEaten === vigilTarget - 10 && !called10) { called10 = true; api.showBanner('10 candles to the vigil', 1500); }
        if (chaliceSpawned === 0 && candlesEaten >= vigilTarget - 40) { chaliceSpawned = 1; chaliceActive = true; chaliceT = 9; api.showBanner('A golden chalice appears!', 1600); }
        else if (chaliceSpawned === 1 && candlesEaten >= vigilTarget - 20 && !chaliceActive) { chaliceSpawned = 2; chaliceActive = true; chaliceT = 9; api.showBanner('Another golden chalice appears!', 1600); }
        // A vigil completes at the difficulty's target (110 on Medium), not all 150: a good run
        // finishes the vigil instead of the goal sitting out of reach.
        if (candlesEaten >= vigilTarget) { nextLevel(); return; }
        if (left === 0) { nextLevel(); return; }
        updateHud();
      } else if (vials[key]) {
        delete vials[key]; addScore(50);
        frightMax = Math.max(2, 6.5 - 0.8 * (level - 1));
        frightT = frightMax; frightChain = 0;
        if (Object.keys(candles).length + Object.keys(vials).length === 0) { nextLevel(); return; }
        updateHud();
      }
      // The chalice sits on a candle tile: it is collected on the same
      // visit as the candle beneath it, not only on a second visit.
      if (chaliceActive && c === 9 && r === 10 && state === 'playing') {
        chaliceActive = false;
        addScore(300 + 100 * (level - 1));
        api.showBanner('Chalice! +' + (300 + 100 * (level - 1)), 1600);
      }
    }
    function sinTarget(s) {
      if (s.state === 'eyes') {
        // Home is through the house door at column 8, not column 9: the
        // door tile is 'D' at (8,6), while (9,6) is a wall no sin can ever
        // enter, which stranded the eyes in the maze forever.
        if (s.eyesPhase === 0) return [8, 6];
        return [9, 7];
      }
      if (s.leaving) return [9, 5];
      if (modeName() === 'scatter') return s.corner;
      if (s.name === 'Wrath') return [player.c, player.r];
      if (s.name === 'Pride') return [clamp(player.c + 4 * player.dx, 0, MAZE_COLS - 1), clamp(player.r + 4 * player.dy, 0, MAZE_ROWS - 1)];
      if (s.name === 'Envy') {
        var w = sins[0];
        var ax = player.c + 2 * player.dx, ay = player.r + 2 * player.dy;
        return [clamp(2 * ax - w.c, 0, MAZE_COLS - 1), clamp(2 * ay - w.r, 0, MAZE_ROWS - 1)];
      }
      // Sloth
      var dTiles = Math.hypot(player.c - s.c, player.r - s.r);
      if (dTiles > 8) return [player.c, player.r];
      return s.corner;
    }
    // Eyes find their way home with a shortest-path search, not a greedy
    // step: greedy steps cycle in wall pockets (the top of the maze traps
    // them rocking between two tiles) and never arrive. Runs once per tile
    // arrival per eye, over a 19x16 grid, so it costs nothing.
    function eyesStep(s, tc, tr) {
      var key = function (c, r) { return c + ',' + r; };
      var prev = {}, queue = [[s.c, s.r]], seen = {};
      seen[key(s.c, s.r)] = true;
      var found = false;
      while (queue.length && !found) {
        var cur = queue.shift();
        for (var i = 0; i < MAZE_DIRS.length; i++) {
          var nc = cur[0] + MAZE_DIRS[i][0], nr = cur[1] + MAZE_DIRS[i][1];
          if (!sinOpen(nc, nr) || seen[key(nc, nr)]) continue;
          seen[key(nc, nr)] = true; prev[key(nc, nr)] = key(cur[0], cur[1]);
          if (nc === tc && nr === tr) { found = true; break; }
          queue.push([nc, nr]);
        }
      }
      if (!found) return null;
      var startKey = key(s.c, s.r), firstKey = key(tc, tr);
      while (prev[firstKey] && prev[firstKey] !== startKey) firstKey = prev[firstKey];
      if (!prev[firstKey]) return null;
      var parts = firstKey.split(',');
      return [parseInt(parts[0], 10) - s.c, parseInt(parts[1], 10) - s.r];
    }
    function sinDecide(s) {
      if (s.state === 'eyes') {
        // Phase 0 ends at the door or inside the house: any of these tiles
        // means the eyes made it home.
        if (s.eyesPhase === 0 && ((s.c === 8 && s.r === 6) || (s.r === 7 && s.c >= 8 && s.c <= 10))) { s.eyesPhase = 1; }
        if (s.eyesPhase === 1 && s.c === 9 && s.r === 7) {
          s.eyesPhase = 2; s.waitT = 0.5; s.dx = 0; s.dy = 0; return;
        }
        var home = s.eyesPhase === 0 ? [8, 6] : [9, 7];
        var step = eyesStep(s, home[0], home[1]);
        if (step) { setDir(s, step[0], step[1]); return; }
        // No path (should not happen): fall through to the greedy pick.
      }
      if (s.leaving && s.r <= 5) s.leaving = false;
      var target = sinTarget(s);
      var allowReverse = s.state === 'eyes';
      var opts = [];
      MAZE_DIRS.forEach(function (d) {
        if (!allowReverse && d[0] === -s.dx && d[1] === -s.dy) return;
        if (!sinOpen(s.c + d[0], s.r + d[1])) return;
        opts.push(d);
      });
      if (!opts.length) { setDir(s, -s.dx, -s.dy); return; }
      var pick;
      if (frightT > 0 && s.state === 'normal') {
        pick = opts[randInt(0, opts.length - 1)];
      } else {
        var bestD = Infinity;
        opts.forEach(function (d) {
          var dist = Math.hypot(s.c + d[0] - target[0], s.r + d[1] - target[1]);
          if (dist < bestD) { bestD = dist; pick = d; }
        });
      }
      setDir(s, pick[0], pick[1]);
    }
    function die(sinName) {
      lives -= 1; flawless = false; updateHud();
      if (sinName) api.showBanner('Caught by ' + sinName + '!', 1400);
      if (lives <= 0) { gameOver(); return; }
      dyingT = 1.1;
    }
    var wallLayer = null, wallTried = false;
    function renderWallLayer() {
      // The cloister walls never change, so they are painted once onto
      // an offscreen canvas and blitted each frame instead of redrawing
      // ~300 tiles (up to two rects each) 60 times a second. If an
      // offscreen canvas is unavailable, the direct draw below is used.
      wallTried = true;
      var cv = null, c2 = null;
      try { cv = document.createElement('canvas'); cv.width = GAME_W; cv.height = GAME_H; c2 = cv.getContext('2d'); } catch (e) { c2 = null; }
      if (!c2) return;
      c2.fillStyle = '#1d1712'; c2.fillRect(0, 0, GAME_W, GAME_H);
      for (var r = 0; r < MAZE_ROWS; r++) for (var c = 0; c < MAZE_COLS; c++) {
        var ch = MAZE_MAP[r][c];
        var px = MAZE_OX + c * MAZE_CELL, py = MAZE_OY + r * MAZE_CELL;
        if (ch === '#') {
          c2.fillStyle = '#33261a'; c2.fillRect(px, py, MAZE_CELL, MAZE_CELL);
          c2.fillStyle = '#4a3a28'; c2.fillRect(px + 1, py + 1, MAZE_CELL - 2, MAZE_CELL - 2);
        } else if (ch === 'H') {
          c2.fillStyle = '#2a211a'; c2.fillRect(px, py, MAZE_CELL, MAZE_CELL);
        }
      }
      wallLayer = cv;
    }
    function draw() {
      var ctx = api.ctx;
      if (!wallTried) renderWallLayer();
      if (wallLayer) {
        ctx.drawImage(wallLayer, 0, 0);
      } else {
        ctx.fillStyle = '#1d1712'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        // Walls
        for (var r = 0; r < MAZE_ROWS; r++) for (var c = 0; c < MAZE_COLS; c++) {
          var ch = MAZE_MAP[r][c];
          var px = MAZE_OX + c * MAZE_CELL, py = MAZE_OY + r * MAZE_CELL;
          if (ch === '#') {
            ctx.fillStyle = '#33261a'; ctx.fillRect(px, py, MAZE_CELL, MAZE_CELL);
            ctx.fillStyle = '#4a3a28'; ctx.fillRect(px + 1, py + 1, MAZE_CELL - 2, MAZE_CELL - 2);
          } else if (ch === 'H') {
            ctx.fillStyle = '#2a211a'; ctx.fillRect(px, py, MAZE_CELL, MAZE_CELL);
          }
        }
      }
      var pulse = Object.keys(candles).length <= 10 ? (0.5 + 0.5 * Math.sin(performance.now() / 200)) : 1;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#b28a2e';
      Object.keys(candles).forEach(function (k) {
        var parts = k.split(',');
        ctx.beginPath(); ctx.arc(tileX(+parts[0]), tileY(+parts[1]), 3, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#7fb3d5';
      Object.keys(vials).forEach(function (k) {
        var p2 = k.split(',');
        ctx.beginPath(); ctx.arc(tileX(+p2[0]), tileY(+p2[1]), 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '8px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('~', tileX(+p2[0]), tileY(+p2[1]) + 3); ctx.textAlign = 'left'; ctx.fillStyle = '#7fb3d5';
      });
      if (chaliceActive) {
        var cx = tileX(9), cy = tileY(10);
        ctx.fillStyle = '#b28a2e';
        ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6e1a26'; ctx.font = 'bold 9px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('C', cx, cy + 3); ctx.textAlign = 'left';
        // Countdown ring: the chalice only lasts nine seconds, and the
        // shrinking gold arc says how long is left.
        ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 12, -Math.PI / 2, -Math.PI / 2 + (chaliceT / 9) * Math.PI * 2); ctx.stroke();
      }
      // Sins
      sins.forEach(function (s) {
        if (!s.active) return;
        if (s.state === 'eyes') {
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#33261a';
          ctx.beginPath(); ctx.arc(s.x - 3, s.y, 2, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(s.x + 3, s.y, 2, 0, Math.PI * 2); ctx.fill();
          return;
        }
        // Frightened sins are pale blue; in their last two seconds they
        // flash white, so the player can see the edible window closing
        // instead of the sins snapping back without warning.
        var frightFlash = frightT > 0 && frightT < 2 && Math.floor(performance.now() / 200) % 2 === 0;
        ctx.fillStyle = frightT > 0 ? (frightFlash ? '#ffffff' : '#bcd8e8') : s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = frightT > 0 ? '#33261a' : '#fff';
        ctx.font = 'bold 9px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(s.name[0], s.x, s.y + 3); ctx.textAlign = 'left';
      });
      // Player
      if (player) {
        ctx.fillStyle = '#6e1a26';
        ctx.beginPath(); ctx.arc(player.x, player.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 2; ctx.stroke();
        // The grace shield reads as a gold halo while it is up; during the
        // mercy window the halo turns white, so the protection is visible.
        if (mercyT > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(player.x, player.y, 12, 0, Math.PI * 2); ctx.stroke();
        } else if (MAZE_GRACE_SHIELD && shieldUp) {
          ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(player.x, player.y, 12, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('F', player.x, player.y + 3); ctx.textAlign = 'left';
        // Direction tick: a small gold triangle at the rim pointing where
        // Father is heading, so the current direction reads at a glance.
        if (player.dx || player.dy) {
          var tx = player.x + player.dx * 12, ty = player.y + player.dy * 12;
          var nx = -player.dy, ny = player.dx;
          ctx.fillStyle = '#b28a2e';
          ctx.beginPath();
          ctx.moveTo(tx + player.dx * 5, ty + player.dy * 5);
          ctx.lineTo(tx - nx * 4 - player.dx * 2, ty - ny * 4 - player.dy * 2);
          ctx.lineTo(tx + nx * 4 - player.dx * 2, ty + ny * 4 - player.dy * 2);
          ctx.closePath(); ctx.fill();
        }
      }
      // Fright timer bar
      if (frightT > 0) {
        ctx.fillStyle = '#33261a'; ctx.fillRect(MAZE_OX, GAME_H - 10, MAZE_COLS * MAZE_CELL, 6);
        ctx.fillStyle = '#7fb3d5'; ctx.fillRect(MAZE_OX, GAME_H - 10, MAZE_COLS * MAZE_CELL * (frightT / frightMax), 6);
      }
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(hasKeyboard() ? 'Paused — press P to resume' : 'Paused — tap Resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      if (dyingT > 0) {
        dyingT -= dt;
        if (dyingT <= 0) { resetPositions(); }
        return;
      }
      elapsed += dt;
      if (frightT > 0) { frightT -= dt; if (frightT < 0) frightT = 0; }
      else {
        modeT -= dt;
        if (modeT <= 0) {
          if (modeIdx < MODE_SEQ.length - 1) {
            modeIdx += 1; modeT = MODE_SEQ[modeIdx];
            sins.forEach(function (s) { if (s.active && s.state === 'normal') reverseMover(s); });
          }
        }
      }
      if (chaliceActive) { chaliceT -= dt; if (chaliceT <= 0) chaliceActive = false; }
      if (closeCd > 0) closeCd -= dt;
      if (mercyT > 0) mercyT -= dt;
      player.speed = playerSpeed();
      // Release sins on schedule
      sins.forEach(function (s) {
        if (!s.active && elapsed >= s.release) {
          s.active = true; s.leaving = true;
          // Leave through the door: step sideways toward the door column
          // first, instead of straight up through the wall.
          if (s.c > 8) setDir(s, -1, 0);
          else if (s.c < 8) setDir(s, 1, 0);
          else setDir(s, 0, -1);
        }
        if (s.state === 'eyes' && s.eyesPhase === 2) {
          s.waitT -= dt;
          if (s.waitT <= 0) {
            s.state = 'normal'; s.eyesPhase = 0; s.leaving = true;
            s.c = 9; s.r = 7; s.x = tileX(9); s.y = tileY(7);
            setDir(s, -1, 0); // out through the door, as on release
          }
        }
      });
      stepMover(player, dt);
      // Collecting the last candle ends the vigil mid-tick: stop here so
      // the sins cannot catch Father after the vigil is complete.
      if (state !== 'playing') return;
      sins.forEach(function (s) {
        if (!s.active) return;
        s.speed = sinSpeed(s);
        stepMover(s, dt);
      });
      // Collisions
      sins.forEach(function (s) {
        if (!s.active || s.state === 'eyes') return;
        // A catch already landed this tick: the rest of the sins wait for
        // the next life instead of costing two lives in one frame.
        if (dyingT > 0 || state !== 'playing') return;
        var d = Math.hypot(s.x - player.x, s.y - player.y);
        if (frightT > 0) {
          if (d < 16) {
            addScore([200, 400, 800, 1600][Math.min(frightChain, 3)]);
            frightChain += 1;
            if (frightChain === 4) api.showBanner('All four absolved!', 1600);
            s.state = 'eyes'; s.eyesPhase = 0; s.dx = 0; s.dy = 0;
            s.tc = s.c; s.tr = s.r;
            sinDecide(s);
          }
        } else if (mercyT > 0) {
          // Mercy window: sins pass through harmlessly, and no close-call
          // points are farmed while invulnerable.
        } else {
          if (d < 13) {
            // Grace shield: the first catch each life is forgiven, with a
            // brief mercy window to get clear.
            if (MAZE_GRACE_SHIELD && shieldUp) {
              shieldUp = false; mercyT = 1.6;
              api.showBanner('Grace shields you!', 1400);
              return;
            }
            die(s.name); return;
          }
          if (d >= 13 && d <= 21 && closeCd <= 0) { closeCd = 1.6; addScore(15); api.showBanner('Close call! +15', 1000); }
        }
      });
    }
    function loop(t) {
      if (destroyed) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      tick(dt); draw();
      raf = requestAnimationFrame(loop);
    }
    function steer(dx, dy) {
      if (state !== 'playing' || paused) return;
      if (player.dx === -dx && player.dy === -dy && (player.dx || player.dy)) {
        reverseMover(player);
      }
      queued = { dx: dx, dy: dy };
      // If the player is standing still, try to start moving now.
      if (!player.dx && !player.dy && playerOpen(player.c + dx, player.r + dy)) {
        setDir(player, dx, dy);
      }
    }
    function doPause() { if (state === 'playing') { paused = true; api.pauseBtn.textContent = 'Resume'; } }
    function doResume() { paused = false; api.pauseBtn.textContent = 'Pause'; }
    var cleanupPause = wirePause(api, function () { return paused; }, doPause, doResume);
    document.addEventListener('keydown', onKey);
    // Keyboard play for the whole loop: Space or Enter lights the first
    // candle, begins the next vigil and restarts; R restarts too.
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      var go = (k === ' ' || k === 'enter');
      if (state === 'ready' && go && !kbdOnButton(e)) { e.preventDefault(); startGame(); return; }
      if (state === 'vigil-done' && go && !kbdOnButton(e)) { e.preventDefault(); beginNextVigil(); return; }
      if (state === 'over' && (k === 'r' || (go && !kbdOnButton(e)))) { if (go) e.preventDefault(); startGame(); return; }
      var map = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
      if (map[k]) { e.preventDefault(); steer(map[k][0], map[k][1]); }
    }
    makeDpad(api.stage, function (dx, dy, active) {
      if (!active) return;
      if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 1 : -1, 0);
      else steer(0, dy > 0 ? 1 : -1);
    });
    var swipeStart = null;
    api.canvas.addEventListener('pointerdown', function (e) { swipeStart = { x: e.clientX, y: e.clientY }; });
    // Direct touch: dragging across the field steers continuously, so the
    // player can guide Father around the cloister with one finger instead
    // of flicking swipe after swipe. A short swipe still works as before.
    api.canvas.addEventListener('pointermove', function (e) {
      if (!swipeStart) return;
      var dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
      if (Math.hypot(dx, dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 1 : -1, 0);
      else steer(0, dy > 0 ? 1 : -1);
      swipeStart = { x: e.clientX, y: e.clientY };
    });
    api.canvas.addEventListener('pointerup', function (e) {
      if (!swipeStart) return;
      var dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.hypot(dx, dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 1 : -1, 0);
      else steer(0, dy > 0 ? 1 : -1);
    });
    api.actions.appendChild(el('p', 'game-note', gameNote('Arrows or WASD to steer, swipe or drag on the field, or use the pad. Light the candles to complete the vigil; the vials turn the sins edible. Space or Enter starts, begins the next vigil and restarts. R restarts.', 'Swipe or drag on the field, or use the pad. Light the candles to complete the vigil; the vials turn the sins edible.')));
    api.showOverlay('<h3>Candle Maze</h3><p>Light the candles to complete the vigil while four sins hunt you. Holy water turns the tables. ' + (MAZE_GRACE_SHIELD ? 'Once per life, grace shields you from a catch. ' : '') + gameMark('maze') + '</p>' +
      diffPickerHtml('maze', diff) +
      '<button type="button" class="big-btn press" id="maze-start">Light the first candle</button>' +
      kbdHint('Keyboard: Space or Enter lights the first candle.'));
    wireDiffButtons(api.overlay, 'maze', function () { return diff; }, function (d) { diff = d; writeDiff('maze', d); applyMazeDiff(); });
    var s = document.getElementById('maze-start');
    if (s) s.addEventListener('click', startGame);
    buildMaze(); resetPositions(); updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      cleanupPause();
    };
  }

  // ================= Sanctuary Dash =================
  // One-button auto-runner down the nave. 9,200px course, procedurally laid
  // out fresh every run (seeded, so Retry replays the identical course).
  // Speed 250 + distance x 0.045, capped 430, times the speed gate.
  // Score = distance/10 + bonuses: halo hop +15 chaining +25/+35...,
  // quarter marks +25 each, best-depth crossing +25, sanctuary +250.
  // Jump velocity 900, gravity 2600, 0.12s coyote, 120ms press buffer:
  // a 156px jump that lasts 0.69s, snappy rather than floaty. Physics runs
  // on a fixed 1/120s timestep (see the loop below), so the jump is the
  // same height at 30, 60 and 120Hz instead of drifting with the frame
  // rate, and the scroll advances in even steps instead of stuttering
  // whenever a frame runs long. Dove stretches 2100-2950 and 5650-6500
  // Dove stretches 2100-2950 and 5650-6500 (gaps 118px); heavenward
  // (gravity-flip) stretch 3950-4700. Speed gates x1.25/x0.8/x1.3/x0.85/x1.25
  // at 1700/3300/5100/7350/8450. One hit kills, except the run's one grace
  // candle, which forgives a fall; practice mode respawns at lit candle
  // checkpoints with 0.9s mercy and never touches bests.
  var DASH_COURSE = 9200, DASH_FLOOR = 280, DASH_CEIL = 40, DASH_CUBE = 24;
  // Grace candle: once per run (outside practice), a fall is forgiven and
  // the run resumes where it ended, with brief mercy. Set false to play
  // without it.
  var DASH_GRACE_FEATURE = true;
  // What killed the run, and what to do about it: the end screen says
  // more than the cause, so a death teaches the next attempt.
  var DASH_TIPS = {
    'Caught on a thorn': 'Tip: jump a beat earlier — the thorn arrives faster than it looks.',
    'Ran into a pew': 'Tip: land on top of the pew, or clear it entirely — its side is solid.',
    'Struck by a swinging censer': 'Tip: run under the censer and never jump into it — watch its swing.',
    'The dove touched the floor': 'Tip: in dove flight, hold to rise and release to fall — small adjustments, not big ones.',
    'The dove touched the ceiling': 'Tip: in dove flight, hold to rise and release to fall — small adjustments, not big ones.',
    'The dove missed the gap': 'Tip: aim for the middle of the gap and hold steady through the columns.',
    'Caught on a ceiling thorn': 'Tip: in the heavenward stretch, the ceiling is your floor — jump off it, and mind the thorns above.',
  };
  function dashRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function genDashLayout(seed, dens, gapScale, flipScale, doveStepScale) {
    dens = dens || 1; // obstacle spacing: Easy spreads the course out, Hard packs it tighter
    // Extra Easy-only breathing room, all 1 (the classic layout) unless a
    // difficulty passes more: dove gap height, ceiling-thorn spacing in
    // the heavenward stretch, and dove column spacing.
    gapScale = gapScale || 1; flipScale = flipScale || 1; doveStepScale = doveStepScale || 1;
    var rnd = dashRng(seed);
    var L = {
      spikes: [], pews: [], clouds: [], censers: [], orbs: [],
      // The first gate sits past the first thorn cluster, not on it: the
      // pew at 1300 pushes the first thorns to ~1534, so a gate at 1500
      // stepped the speed up 25% in the middle of the player's first
      // pew-jump-then-thorn-jump, the tightest sequence in the opening.
      gates: [{ x: 1700, m: 1.25 }, { x: 3300, m: 0.8 }, { x: 5100, m: 1.3 }, { x: 7350, m: 0.85 }, { x: 8450, m: 1.25 }],
      doveCols: [], flipSpikes: [],
    };
    function inSpecial(x) {
      // The dove exits drop the player to the floor: after a stretch
      // ends the cube falls ~0.29-0.43s, travelling ~130-240px at full
      // speed before it lands, so each dove zone runs past the latest
      // landing (exit 2950 -> ~3147, exit 6500 -> ~6740) plus ~120px of
      // runway. A pew, thorn or censer inside that runway is an
      // unavoidable death, because the player cannot jump until they
      // land and the press buffer only covers 0.12s before landing.
      // The heavenward (flip) zone is the same idea at the other end:
      // the cube lands back on the floor at ~4839 after the 4700 exit,
      // so the zone runs to 4990, ~150px of runway past the landing.
      return (x > 1980 && x < 3260) || (x > 3830 && x < 4990) || (x > 5530 && x < 6850);
    }
    // Clear opening runway: the first thorn waits until 1400px on Medium (scaled by difficulty), so a new
    // player gets a few jumps in before the first thing to clear, and the
    // first pew waits until 1300px.
    // Pews are placed first, because thorns keep their distance from them:
    // a thorn cluster may never start inside a pew or within 160px after
    // one ends. Landing on (or jumping over) a pew and meeting thorns in
    // the same breath is not a fair jump — the player needs room to land
    // and jump again, about half a second at full speed.
    x = Math.round(1300 * dens);
    while (x < 8900) { if (!inSpecial(x)) L.pews.push({ x: x, w: 70 + rnd() * 30, h: 46 + rnd() * 20 }); x += (750 + rnd() * 350) * dens; }
    var x = Math.round(1400 * dens);
    while (x < 9000) {
      if (!inSpecial(x)) {
        var clearOfPews = true;
        for (var pi2 = 0; pi2 < L.pews.length; pi2++) {
          var pp = L.pews[pi2];
          if (x >= pp.x - 40 && x < pp.x + pp.w + 160) { x = pp.x + pp.w + 160; clearOfPews = false; break; }
        }
        if (!clearOfPews) continue;
        var n = 1 + Math.floor(rnd() * 3);
        for (var i = 0; i < n; i++) L.spikes.push({ x: x + i * 26, w: 24 });
        x += (380 + rnd() * 260) * dens;
      } else x += 120;
    }
    x = Math.round(1100 * dens);
    while (x < 8900) { if (!inSpecial(x)) L.clouds.push({ x: x, w: 54 }); x += (950 + rnd() * 400) * dens; }
    // The first censer waits until 3200px: a new player gets a few thorn
    // jumps in before the first thing that punishes jumping. The censers
    // hang above the floor, so you run under them — never jump into one.
    x = Math.round(3200 * dens);
    while (x < 8900) { if (!inSpecial(x)) L.censers.push({ x: x, phase: rnd() * Math.PI * 2 }); x += (850 + rnd() * 350) * dens; }
    x = Math.round(800 * dens);
    while (x < 8900) { if (!inSpecial(x)) L.orbs.push({ x: x, y: 150 + rnd() * 70, used: false }); x += (620 + rnd() * 300) * dens; }
    [[2100, 2950], [5650, 6500]].forEach(function (seg) {
      var cx = seg[0] + 120, prevC = null;
      while (cx < seg[1] - 60) {
        var gapC = 110 + rnd() * 110;
        // The flight reads as a line to follow, not a lottery: each gap
        // sits near the last one (at most 55px away), so the dove flows
        // from column to column instead of teleporting up and down.
        if (prevC !== null) gapC = clamp(prevC + clamp(gapC - prevC, -55, 55), 110, 220);
        prevC = gapC;
        L.doveCols.push({ x: cx, w: 26, gapTop: gapC - 59 * gapScale, gapBottom: gapC + 59 * gapScale });
        cx += (165 + rnd() * 45) * doveStepScale;
      }
    });
    // The first ceiling thorn waits until 4200: the cube lands on the
    // ceiling at ~4041 after the 3950 mode change, so a thorn at 4050
    // left 9px of runway — no time to react after landing. 4200 gives
    // ~160px, the same half-second the pew-to-thorn rule allows.
    x = 4200;
    while (x < 4650) {
      var n2 = 1 + Math.floor(rnd() * 2);
      for (var j = 0; j < n2; j++) L.flipSpikes.push({ x: x + j * 26, w: 24 });
      x += (320 + rnd() * 220) * flipScale;
    }
    return L;
  }
  function dashModeAt(dist) {
    if ((dist >= 2100 && dist < 2950) || (dist >= 5650 && dist < 6500)) return 'dove';
    if (dist >= 3950 && dist < 4700) return 'flip';
    return 'normal';
  }
  function mountDash(parent, onBack) {
    var api = createStage(parent, { title: 'Sanctuary Dash', onBack: onBack });
    var seed = Math.floor(Math.random() * 1e9);
    var diff = readDiff('dash'); // Easy / Medium / Hard; Medium is the tuned default
    var dashDens = 1, dashBase = 235, dashSlope = 0.045, dashCap = 430;
    // Forgiveness knobs, all at their classic values on Medium and Hard.
    // Easy alone turns them: wider dove gaps, sparser ceiling thorns and
    // dove columns, gentler speed gates, a higher and floatier jump, a
    // longer press buffer / coyote window, smaller thorn / censer
    // hitboxes, and slower dove rise and fall.
    var dashGapScale = 1, dashFlipScale = 1, dashDoveStep = 1, dashGateFactor = 1;
    var dashJump = 900, dashGrav = 2600, dashRot = 9.07, dashBuffer = 0.12, dashHitInset = 0;
    var dashDoveRise = 240, dashDoveFall = 300;
    function applyDashDiff() {
      // Easy: a much slower cube and a much roomier, gentler course.
      // Hard: a faster cube and tighter obstacles. Medium is the
      // current game, value for value.
      if (diff === 'easy') {
        dashDens = 1.55; dashBase = 180; dashSlope = 0.03; dashCap = 315;
        dashGapScale = 1.4; dashFlipScale = 1.5; dashDoveStep = 1.25; dashGateFactor = 0.45;
        dashJump = 950; dashGrav = 2400; dashRot = Math.PI * dashGrav / dashJump; dashBuffer = 0.18; dashHitInset = 4;
        dashDoveRise = 215; dashDoveFall = 265;
      }
      else if (diff === 'hard') {
        dashDens = 0.8; dashBase = 260; dashSlope = 0.05; dashCap = 470;
        dashGapScale = 1; dashFlipScale = 1; dashDoveStep = 1; dashGateFactor = 1;
        dashJump = 900; dashGrav = 2600; dashRot = 9.07; dashBuffer = 0.12; dashHitInset = 0;
        dashDoveRise = 240; dashDoveFall = 300;
      }
      else {
        dashDens = 1; dashBase = 235; dashSlope = 0.045; dashCap = 430;
        dashGapScale = 1; dashFlipScale = 1; dashDoveStep = 1; dashGateFactor = 1;
        dashJump = 900; dashGrav = 2600; dashRot = 9.07; dashBuffer = 0.12; dashHitInset = 0;
        dashDoveRise = 240; dashDoveFall = 300;
      }
    }
    applyDashDiff();
    function makeDashLayout() {
      var L = genDashLayout(seed, dashDens, dashGapScale, dashFlipScale, dashDoveStep);
      // Gentler gates on Easy only: each multiplier moves part-way back
      // toward x1, so the stepped speed jumps shrink. A factor of 1
      // (Medium and Hard) leaves the gate list untouched.
      if (dashGateFactor !== 1) {
        L.gates.forEach(function (g) { g.m = 1 + (g.m - 1) * dashGateFactor; });
      }
      return L;
    }
    var layout = makeDashLayout();
    var practice = false, practiceDeaths = 0;
    var dist = 0, y = DASH_FLOOR - DASH_CUBE / 2, vy = 0, grounded = true;
    var gateIdx = -1, gateMult = 1, gateTarget = 1, bonus = 0, chain = 0;
    var quarters = [false, false, false, false], depthAwarded = false;
    var coyoteT = 0, bufferT = 0, holding = false, mercyT = 0, rot = 0;
    var mode = 'normal', state = 'ready', paused = false;
    var raf = 0, last = 0, destroyed = false, runT = 0;
    var best = readBest('dash');
    var bestDepth = 0, attempts = 0;
    try {
      bestDepth = parseFloat(localStorage.getItem('rmf-dash-depth') || '0') || 0;
      attempts = parseInt(localStorage.getItem('rmf-dash-attempts') || '0', 10) || 0;
    } catch (e) { /* storage unavailable */ }
    var checkpoint = null; // {dist, bonus, quarters}
    var graceUsed = false; // the run's one grace candle, spent on the first forgiven fall
    var dust = []; // landing dust: small fading puffs where the cube lands
    var warned = {}; // mode-change warnings already shown this run, by boundary x
    function spawnDust(x, y) {
      for (var i = 0; i < 6; i++) dust.push({ x: x + (Math.random() - 0.5) * 18, y: y - 2, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 30, t: 0 });
    }
    var QUARTER_X = [2300, 4600, 6900, 8280];
    function score() { return Math.floor(dist / 10) + bonus; }
    function speedNow() { return Math.min(dashCap, dashBase + dist * dashSlope) * gateMult; }
    function screenX(wx) { return wx - dist + 120; }
    function startRun(newSeed) {
      applyDashDiff();
      parishSubmitted['dash'] = false;
      if (typeof newSeed === 'number') { seed = newSeed; layout = makeDashLayout(); }
      dist = 0; y = DASH_FLOOR - DASH_CUBE / 2; vy = 0; grounded = true;
      stepDx = 0; stepDy = 0; stepDr = 0;
      gateIdx = -1; gateMult = 1; gateTarget = 1; bonus = 0; chain = 0;
      quarters = [false, false, false, false]; depthAwarded = false;
      coyoteT = 0; bufferT = 0; mercyT = 0; rot = 0; mode = 'normal'; runT = 0;
      checkpoint = null; practiceDeaths = 0; graceUsed = false;
      warned = {};
      if (!practice) {
        attempts += 1;
        try { localStorage.setItem('rmf-dash-attempts', String(attempts)); } catch (e) { /* ignore */ }
      }
      state = 'playing'; api.hideOverlay(); updateHud();
    }
    function endRun(won, why) {
      state = 'over';
      // Reaching the sanctuary pays the +250 the course promises.
      if (won) bonus += 250;
      var pct = Math.min(100, Math.floor((dist / DASH_COURSE) * 100));
      var sc = score();
      var fb = best, newDepth = bestDepth;
      if (!practice) {
        fb = writeBest('dash', sc); best = fb;
        submitParishScore('dash', sc);
        if (pct > bestDepth) {
          newDepth = pct; bestDepth = pct;
          try { localStorage.setItem('rmf-dash-depth', String(pct)); } catch (e) { /* ignore */ }
        }
      }
      var title = won ? 'You reached the sanctuary!' : 'The run ends';
      var tip = (!won && why && DASH_TIPS[why]) ? DASH_TIPS[why] : '';
      api.showOverlay('<h3>' + esc(title) + '</h3><p>' + (why ? esc(why) + '<br>' : '') +
        (tip ? esc(tip) + '<br>' : '') +
        'Score: ' + sc + (won ? ' (incl. +250 for reaching the sanctuary)' : '') + ' &middot; Reached: ' + pct + '% &middot; Best: ' + fb + '<br>' +
        'Best depth: ' + newDepth + '% &middot; Attempt: ' + attempts +
        (practice ? '<br>Practice deaths: ' + practiceDeaths : '') + '</p>' +
        '<button type="button" class="big-btn press" id="dash-retry">Retry this course' + kbdChip('Space') + '</button> ' +
        '<button type="button" class="big-btn press" id="dash-again">Run again' + kbdChip('R') + '</button> ' +
        kbdHint('Keyboard: Space or Enter retries this course · R runs a new course.') +
        '<button type="button" class="linklike" id="dash-back">Back to arcade</button>');
      var r1 = document.getElementById('dash-retry');
      if (r1) r1.addEventListener('click', function () { startRun(seed); });
      var r2 = document.getElementById('dash-again');
      if (r2) r2.addEventListener('click', function () { startRun(Math.floor(Math.random() * 1e9)); });
      var b = document.getElementById('dash-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function die(why) {
      if (mercyT > 0) return;
      // Grace candle: once per run, outside practice, the fall is forgiven
      // and the run resumes where it ended, with brief mercy.
      if (DASH_GRACE_FEATURE && !practice && !graceUsed) {
        graceUsed = true;
        if (mode === 'dove') { y = 160; vy = 0; grounded = false; }
        else if (mode === 'flip') { y = DASH_CEIL + DASH_CUBE / 2; vy = 0; grounded = true; }
        else { y = DASH_FLOOR - DASH_CUBE / 2; vy = 0; grounded = true; }
        chain = 0; bufferT = 0; coyoteT = 0; rot = 0;
        stepDx = 0; stepDy = 0; stepDr = 0;
        mercyT = 1.2;
        api.showBanner('Grace intervenes: the fall is forgiven, once per run', 1800);
        updateHud();
        return;
      }
      if (practice && checkpoint) {
        practiceDeaths += 1;
        dist = checkpoint.dist; bonus = checkpoint.bonus;
        quarters = checkpoint.quarters.slice();
        y = DASH_FLOOR - DASH_CUBE / 2; vy = 0; grounded = true; chain = 0;
        stepDx = 0; stepDy = 0; stepDr = 0;
        mode = dashModeAt(dist);
        gateIdx = -1; gateMult = 1; gateTarget = 1;
        layout.gates.forEach(function (g, i) { if (g.x <= dist) { gateIdx = i; gateMult = g.m; gateTarget = g.m; } });
        layout.orbs.forEach(function (o) { if (o.x > dist) o.used = false; });
        mercyT = 0.9;
        api.showBanner('Back at the candle — ' + practiceDeaths + (practiceDeaths === 1 ? ' death' : ' deaths') + ' in practice', 1600);
        updateHud();
        return;
      }
      endRun(false, why);
    }
    function doJump() {
      if (state !== 'playing' || paused) return;
      if (mode === 'dove') return; // dove is hold-to-rise, not jump
      bufferT = dashBuffer;
      if (grounded || coyoteT > 0) {
        vy = mode === 'flip' ? dashJump : -dashJump;
        grounded = false; coyoteT = 0; bufferT = 0;
        return;
      }
      // Mid-air: halo orb within 58px?
      for (var i = 0; i < layout.orbs.length; i++) {
        var o = layout.orbs[i];
        if (o.used) continue;
        var d = Math.hypot(o.x - dist, o.y - y);
        if (d < 58) {
          o.used = true;
          vy = mode === 'flip' ? dashJump : -dashJump;
          bonus += 15 + chain * 10;
          chain += 1;
          api.showBanner('Halo hop! +' + (15 + (chain - 1) * 10), 900);
          updateHud();
          return;
        }
      }
    }
    // The HUD is rebuilt only when its text actually changes. It used to
    // be rewritten on every tick, which tore the whole HUD down and rebuilt
    // it 60+ times a second — DOM churn on every frame, and a real source
    // of the stutter.
    var lastHud = '';
    function updateHud() {
      var pct = Math.min(100, Math.floor((dist / DASH_COURSE) * 100));
      var h = '<span class="score">Score: ' + score() + '</span><span>' + pct + '%</span>' +
        '<span>' + (mode === 'dove' ? 'Dove flight' : mode === 'flip' ? 'Heavenward' : 'Running') + '</span>' +
        '<span>Speed x' + (Math.round(gateMult * 100) / 100) + '</span>' + diffTag(diff) + '<span>Best: ' + best + '</span>' +
        (DASH_GRACE_FEATURE && !practice && !graceUsed ? '<span>Grace ready</span>' : '') +
        (practice ? '<span>Practice</span>' : '');
      if (h !== lastHud) { lastHud = h; api.setHud(h); }
    }
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      // Parallax nave: tall arches drifting past at a third of the run
      // speed, so the nave has depth instead of a flat cream wall.
      ctx.strokeStyle = 'rgba(138,109,59,0.28)'; ctx.lineWidth = 5;
      var archOff = (dist * 0.35) % 340;
      for (var ai = -1; ai < 3; ai++) {
        var ax = 60 - archOff + ai * 340;
        ctx.beginPath(); ctx.moveTo(ax, DASH_FLOOR); ctx.lineTo(ax, 90);
        ctx.quadraticCurveTo(ax + 45, 30, ax + 90, 90); ctx.lineTo(ax + 90, DASH_FLOOR); ctx.stroke();
      }
      // Nave: floor and ceiling
      ctx.fillStyle = '#33261a'; ctx.fillRect(0, DASH_FLOOR, GAME_W, GAME_H - DASH_FLOOR);
      ctx.fillStyle = '#6e1a26'; ctx.fillRect(0, 0, GAME_W, 14);
      // Best-depth gold line
      if (!practice && bestDepth > 0) {
        var bx = screenX((bestDepth / 100) * DASH_COURSE);
        if (bx > 0 && bx < GAME_W) {
          ctx.strokeStyle = '#b28a2e'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(bx, 14); ctx.lineTo(bx, DASH_FLOOR); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#b28a2e'; ctx.font = '10px Georgia'; ctx.fillText('best', bx + 4, 26);
        }
      }
      // Portals
      [2100, 2950, 3950, 4700, 5650, 6500].forEach(function (px) {
        var sx = screenX(px);
        if (sx > -20 && sx < GAME_W + 20) {
          ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(sx, DASH_FLOOR, 46, Math.PI, 0); ctx.stroke();
        }
      });
      // Speed gates
      layout.gates.forEach(function (g) {
        var sx = screenX(g.x);
        if (sx > -20 && sx < GAME_W + 20) {
          ctx.fillStyle = '#b28a2e'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
          ctx.fillText('x' + g.m, sx, 60); ctx.textAlign = 'left';
        }
      });
      // Spikes
      ctx.fillStyle = '#6e1a26';
      layout.spikes.forEach(function (s) {
        var sx = screenX(s.x);
        if (sx < -30 || sx > GAME_W + 30) return;
        ctx.beginPath(); ctx.moveTo(sx, DASH_FLOOR); ctx.lineTo(sx + 12, DASH_FLOOR - 20); ctx.lineTo(sx + 24, DASH_FLOOR); ctx.closePath(); ctx.fill();
      });
      // Ceiling spikes (flip stretch)
      layout.flipSpikes.forEach(function (s) {
        var sx = screenX(s.x);
        if (sx < -30 || sx > GAME_W + 30) return;
        ctx.beginPath(); ctx.moveTo(sx, DASH_CEIL); ctx.lineTo(sx + 12, DASH_CEIL + 24); ctx.lineTo(sx + 24, DASH_CEIL); ctx.closePath(); ctx.fill();
      });
      // Pews
      layout.pews.forEach(function (p) {
        var sx = screenX(p.x);
        if (sx < -100 || sx > GAME_W + 100) return;
        ctx.fillStyle = '#8a6d3b';
        ctx.fillRect(sx, DASH_FLOOR - p.h, p.w, p.h);
        ctx.fillStyle = '#33261a'; ctx.fillRect(sx, DASH_FLOOR - p.h, p.w, 6);
      });
      // Cloud pads
      layout.clouds.forEach(function (c) {
        var sx = screenX(c.x);
        if (sx < -60 || sx > GAME_W + 60) return;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(sx + c.w / 2, DASH_FLOOR - 6, c.w / 2, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#b28a2e'; ctx.stroke();
      });
      // Censers
      layout.censers.forEach(function (c) {
        var sx = screenX(c.x);
        if (sx < -80 || sx > GAME_W + 80) return;
        var ang = Math.sin(runT * 1.5 + c.phase) * 0.5;
        var bx = sx + Math.sin(ang) * 70, by = 120 + Math.cos(ang) * 70;
        ctx.strokeStyle = '#33261a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, 120); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = '#b28a2e';
        ctx.beginPath(); ctx.arc(bx, by, 9, 0, Math.PI * 2); ctx.fill();
      });
      // Dove columns
      layout.doveCols.forEach(function (col) {
        var sx = screenX(col.x);
        if (sx < -30 || sx > GAME_W + 30) return;
        ctx.fillStyle = '#33261a';
        ctx.fillRect(sx, 14, col.w, col.gapTop - 14);
        ctx.fillRect(sx, col.gapBottom, col.w, DASH_FLOOR - col.gapBottom);
        ctx.fillStyle = '#b28a2e';
        ctx.fillRect(sx, col.gapTop - 4, col.w, 4);
        ctx.fillRect(sx, col.gapBottom, col.w, 4);
      });
      // Halo orbs
      layout.orbs.forEach(function (o) {
        if (o.used) return;
        var sx = screenX(o.x);
        if (sx < -20 || sx > GAME_W + 20) return;
        var pr = 8 + 2 * Math.sin(runT * 4 + o.x);
        ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(sx, o.y, pr, pr * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      });
      // Practice candles
      if (practice && checkpoint) {
        var csx = screenX(checkpoint.dist);
        if (csx > -20 && csx < GAME_W + 20) {
          ctx.fillStyle = '#b28a2e';
          ctx.fillRect(csx - 2, DASH_FLOOR - 18, 4, 18);
          ctx.fillStyle = '#e8b64c';
          ctx.beginPath(); ctx.arc(csx, DASH_FLOOR - 22, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Landing dust
      dust.forEach(function (pt) {
        ctx.globalAlpha = Math.max(0, 0.55 * (1 - pt.t / 0.5));
        ctx.fillStyle = '#8a6d3b';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 3 + pt.t * 8, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      // Cube / dove
      var cx = 120, cy = y;
      ctx.save();
      ctx.translate(cx, cy);
      if (mode === 'dove') {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b28a2e';
        // The wing flaps as the dove flies, so the dove reads as alive
        // instead of a still white shape.
        ctx.beginPath(); ctx.ellipse(-8, -6, 10, 4, -0.5 + Math.sin(runT * 12) * 0.35, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.rotate(rot);
        ctx.fillStyle = '#b28a2e';
        ctx.fillRect(-DASH_CUBE / 2, -DASH_CUBE / 2, DASH_CUBE, DASH_CUBE);
        ctx.strokeStyle = '#6e1a26'; ctx.lineWidth = 2;
        ctx.strokeRect(-DASH_CUBE / 2, -DASH_CUBE / 2, DASH_CUBE, DASH_CUBE);
      }
      ctx.restore();
      // Progress bar
      ctx.fillStyle = '#33261a'; ctx.fillRect(0, GAME_H - 8, GAME_W, 8);
      ctx.fillStyle = '#b28a2e'; ctx.fillRect(0, GAME_H - 8, GAME_W * (dist / DASH_COURSE), 8);
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(hasKeyboard() ? 'Paused — press P to resume' : 'Paused — tap Resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      runT += dt;
      if (mercyT > 0) mercyT -= dt;
      dust.forEach(function (pt) { pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; });
      dust = dust.filter(function (pt) { return pt.t < 0.5; });
      if (coyoteT > 0) coyoteT -= dt;
      if (bufferT > 0) bufferT -= dt;
      // Speed gates ease in over ~0.2s instead of jumping 25% in one frame.
      if (gateMult !== gateTarget) {
        gateMult += (gateTarget - gateMult) * Math.min(1, dt * 5);
        if (Math.abs(gateTarget - gateMult) < 0.005) gateMult = gateTarget;
      }
      var prevBottom = y + DASH_CUBE / 2;
      dist += speedNow() * dt;
      // Warning: a dove or heavenward stretch is coming up in 300px, so
      // the player can brace for the change instead of dying on the first
      // column or the first ceiling.
      if (mode === 'normal') {
        var warns = [[2100, 'Dove flight ahead — get ready to fly'], [3950, 'Heavenward ahead — the ceiling becomes your floor'], [5650, 'Dove flight ahead — get ready to fly']];
        warns.forEach(function (w) {
          if (!warned[w[0]] && dist < w[0] && dist + 300 >= w[0]) { warned[w[0]] = true; api.showBanner(w[1], 1400); }
        });
      }
      // Mode changes
      var newMode = dashModeAt(dist);
      if (newMode !== mode) {
        mode = newMode;
        if (mode === 'dove') { y = 160; vy = 0; grounded = false; api.showBanner('Dove flight — hold to rise, release to fall', 1800); }
        else if (mode === 'flip') { vy = -420; grounded = false; api.showBanner('Heavenward — the ceiling is your floor', 1800); }
        else { vy = 0; grounded = false; api.showBanner('Back on the ground', 1200); }
      }
      // Speed gates
      layout.gates.forEach(function (g, i) {
        if (i > gateIdx && dist >= g.x) {
          gateIdx = i; gateTarget = g.m;
          api.showBanner('Speed x' + g.m, 1200);
        }
      });
      // Quarter marks
      QUARTER_X.forEach(function (qx, i) {
        if (!quarters[i] && dist >= qx) {
          quarters[i] = true; bonus += 25;
          api.showBanner('The pews cheer! +25', 1500);
        }
      });
      // Best-depth crossing
      if (!practice && !depthAwarded && bestDepth > 0 && dist >= (bestDepth / 100) * DASH_COURSE) {
        depthAwarded = true; bonus += 25;
        api.showBanner('Past your best depth! +25', 1500);
      }
      // Practice checkpoint
      if (practice && grounded && mode === 'normal' && (!checkpoint || dist >= checkpoint.dist + 1000)) {
        var clearAhead = true;
        layout.spikes.forEach(function (s) { if (s.x > dist && s.x < dist + 150) clearAhead = false; });
        layout.censers.forEach(function (c) { if (c.x > dist && c.x < dist + 150) clearAhead = false; });
        if (clearAhead) {
          checkpoint = { dist: dist, bonus: bonus, quarters: quarters.slice() };
          api.showBanner('Candle lit — checkpoint', 1200);
        }
      }
      if (mode === 'dove') {
        var targetVy = holding ? -dashDoveRise : dashDoveFall;
        vy += (targetVy - vy) * Math.min(1, dt * 12);
        y += vy * dt;
        if (y + DASH_CUBE / 2 >= DASH_FLOOR) { die('The dove touched the floor'); return; }
        if (y - DASH_CUBE / 2 <= 16) { die('The dove touched the ceiling'); return; }
        for (var ci = 0; ci < layout.doveCols.length; ci++) {
          var col = layout.doveCols[ci];
          if (dist + DASH_CUBE / 2 > col.x && dist - DASH_CUBE / 2 < col.x + col.w) {
            if (y - DASH_CUBE / 2 + dashHitInset < col.gapTop || y + DASH_CUBE / 2 - dashHitInset > col.gapBottom) { die('The dove missed the gap'); return; }
          }
        }
      } else {
        var g = mode === 'flip' ? -dashGrav : dashGrav;
        vy += g * dt;
        y += vy * dt;
        if (!grounded) rot += dt * dashRot; // one full turn per full jump (0.69s), so the cube lands square
        if (mode === 'flip') {
          if (y <= DASH_CEIL + DASH_CUBE / 2 && vy <= 0) {
            y = DASH_CEIL + DASH_CUBE / 2; vy = 0; grounded = true; rot = 0; chain = 0;
            if (holding) { vy = dashJump; grounded = false; }
            else if (bufferT > 0) { vy = dashJump; grounded = false; bufferT = 0; }
          }
          // Ceiling spikes
          if (mercyT <= 0) {
            for (var fi = 0; fi < layout.flipSpikes.length; fi++) {
              var fs = layout.flipSpikes[fi];
              if (dist + DASH_CUBE / 2 - 4 - dashHitInset > fs.x && dist - DASH_CUBE / 2 + 4 + dashHitInset < fs.x + fs.w &&
                  y - DASH_CUBE / 2 + dashHitInset < DASH_CEIL + 20) { die('Caught on a ceiling thorn'); return; }
            }
          }
        } else {
          // Pews: land on top or die on the side
          var landed = false;
          for (var pi = 0; pi < layout.pews.length; pi++) {
            var p = layout.pews[pi];
            var top = DASH_FLOOR - p.h;
            if (dist + DASH_CUBE / 2 > p.x && dist - DASH_CUBE / 2 < p.x + p.w) {
              // Landing reads generously at the pew edge: a cube arriving
              // just below the top still lands, instead of dying on the side.
              if (vy >= 0 && prevBottom <= top + 10 && y + DASH_CUBE / 2 >= top) {
                if (!grounded) spawnDust(120, top); // screen x: the cube sits at 120 on screen
                y = top - DASH_CUBE / 2; vy = 0; grounded = true; rot = 0; chain = 0; landed = true;
                if (holding) { vy = -dashJump; grounded = false; }
                else if (bufferT > 0) { vy = -dashJump; grounded = false; bufferT = 0; }
                break;
              }
              if (y + DASH_CUBE / 2 > top + 10 && y - DASH_CUBE / 2 < DASH_FLOOR) {
                if (mercyT <= 0) { die('Ran into a pew'); return; }
              }
            }
          }
          if (!landed) {
            // Cloud pads
            for (var cl = 0; cl < layout.clouds.length; cl++) {
              var cd = layout.clouds[cl];
              if (vy > 0 && dist + DASH_CUBE / 2 > cd.x && dist - DASH_CUBE / 2 < cd.x + cd.w &&
                  prevBottom <= DASH_FLOOR - 6 && y + DASH_CUBE / 2 >= DASH_FLOOR - 6) {
                vy = -1030; grounded = false;
                break;
              }
            }
            // Floor
            if (y >= DASH_FLOOR - DASH_CUBE / 2 && vy >= 0) {
              y = DASH_FLOOR - DASH_CUBE / 2; vy = 0;
              if (!grounded) { grounded = true; rot = 0; chain = 0; spawnDust(120, DASH_FLOOR); }
              if (holding) { vy = -dashJump; grounded = false; }
              else if (bufferT > 0) { vy = -dashJump; grounded = false; bufferT = 0; }
            }
          }
          // Walked off a pew edge: start falling
          var onPew = false;
          layout.pews.forEach(function (p2) {
            if (dist + DASH_CUBE / 2 > p2.x && dist - DASH_CUBE / 2 < p2.x + p2.w && Math.abs((y + DASH_CUBE / 2) - (DASH_FLOOR - p2.h)) < 1) onPew = true;
          });
          if (grounded && !onPew && y < DASH_FLOOR - DASH_CUBE / 2) { grounded = false; coyoteT = dashBuffer; }
          // Floor spikes
          if (mercyT <= 0) {
            for (var si = 0; si < layout.spikes.length; si++) {
              var sp = layout.spikes[si];
              if (dist + DASH_CUBE / 2 - 4 - dashHitInset > sp.x && dist - DASH_CUBE / 2 + 4 + dashHitInset < sp.x + sp.w &&
                  y + DASH_CUBE / 2 - dashHitInset > DASH_FLOOR - 16) { die('Caught on a thorn'); return; }
            }
          }
        }
        // Censers
        if (mercyT <= 0) {
          for (var ce = 0; ce < layout.censers.length; ce++) {
            var cn = layout.censers[ce];
            var ang = Math.sin(runT * 1.5 + cn.phase) * 0.5;
            var bx = cn.x + Math.sin(ang) * 70, by = 120 + Math.cos(ang) * 70;
            if (Math.hypot(bx - dist, by - y) < 20 - dashHitInset) { die('Struck by a swinging censer'); return; }
          }
        }
      }
      if (dist >= DASH_COURSE) { endRun(true, null); return; }
      updateHud();
    }
    // Fixed-timestep loop: physics always advances in 1/120s steps, however
    // fast or slow the display refreshes. The old loop fed the raw frame
    // time straight into the physics, so a long frame made the cube jump
    // higher and the scroll lurch — the choppiness. Now a 120Hz screen
    // steps once per frame, a 60Hz screen twice, a 30Hz screen four times,
    // and the jump and the scroll are identical on all of them. A hitch
    // drops its backlog instead of spiralling. Drawing is extrapolated one
    // partial step ahead from the last step's motion, so the scroll stays
    // smooth even when the display hands us uneven frame times: the drawn
    // position is where the cube is heading, not the last stepped position.
    // The extrapolation is clamped to one step of real motion, so a
    // teleport (entering dove flight) can never fling the drawing.
    var FIXED_DT = 1 / 120, acc = 0;
    var stepDx = 0, stepDy = 0, stepDr = 0;
    function loop(t) {
      if (destroyed) return;
      var frameDt = Math.min(0.1, (t - last) / 1000 || 0); last = t;
      if (paused || state !== 'playing') { acc = 0; }
      else {
        var bD = dist, bY = y, bR = rot;
        acc += frameDt;
        var steps = 0;
        while (acc >= FIXED_DT && steps < 10) { tick(FIXED_DT); acc -= FIXED_DT; steps++; }
        if (steps === 10) acc = 0;
        if (steps > 0) { stepDx = (dist - bD) / steps; stepDy = (y - bY) / steps; stepDr = (rot - bR) / steps; }
      }
      var alpha = acc / FIXED_DT;
      if (alpha > 1) alpha = 1;
      var saveD = dist, saveY = y, saveR = rot;
      dist = dist + clamp(stepDx * alpha, -6, 6);
      y = y + clamp(stepDy * alpha, -12, 12);
      rot = rot + clamp(stepDr * alpha, -0.1, 0.1);
      draw();
      dist = saveD; y = saveY; rot = saveR;
      raf = requestAnimationFrame(loop);
    }
    function doPause() { if (state === 'playing') { paused = true; holding = false; api.pauseBtn.textContent = 'Resume'; } }
    function doResume() { paused = false; api.pauseBtn.textContent = 'Pause'; }
    var cleanupPause = wirePause(api, function () { return paused; }, doPause, doResume);
    document.addEventListener('keydown', onKey);
    // Keyboard play for the whole loop: Space or Enter starts the run and
    // retries this course; R runs a new course. Space / Up / W jumps, and
    // holding keeps hopping. The typing and focused-button guards keep
    // Space from double-firing a button that already answers it.
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      var go = (k === ' ' || k === 'enter');
      if (k === 'r' && state === 'over') { startRun(Math.floor(Math.random() * 1e9)); return; }
      if (state === 'ready' && go && !kbdOnButton(e)) { e.preventDefault(); startRun(seed); return; }
      if (state === 'over' && go && !kbdOnButton(e)) { e.preventDefault(); startRun(seed); return; }
      if ((k === ' ' || k === 'arrowup' || k === 'w') && state === 'playing' && !paused && !kbdOnButton(e)) {
        e.preventDefault();
        if (!holding) { holding = true; doJump(); }
      }
    }
    document.addEventListener('keyup', onKeyUp);
    function onKeyUp(e) {
      var k = e.key.toLowerCase();
      if (k === ' ' || k === 'arrowup' || k === 'w') holding = false;
    }
    api.canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (state !== 'playing' || paused) return;
      holding = true; doJump();
    });
    api.canvas.addEventListener('pointerup', function () { holding = false; });
    api.canvas.addEventListener('pointerleave', function () { holding = false; });
    api.canvas.addEventListener('pointercancel', function () { holding = false; });
    api.actions.appendChild(el('p', 'game-note', gameNote('Space, Up, W, click or tap to jump. Hold to keep hopping; in dove stretches hold to rise and release to fall. Space or Enter retries this course, R runs a new one.', 'Tap to jump. Hold to keep hopping; in dove stretches hold to rise and release to fall.')));
    var practiceWrap = el('label', 'game-note', '');
    var practiceBox = document.createElement('input');
    practiceBox.type = 'checkbox';
    practiceBox.addEventListener('change', function () {
      if (state === 'playing') { practiceBox.checked = practice; return; }
      practice = practiceBox.checked;
      updateHud();
    });
    practiceWrap.appendChild(practiceBox);
    practiceWrap.appendChild(document.createTextNode(' Practice mode (candle checkpoints, no bests)'));
    api.actions.appendChild(practiceWrap);
    api.showOverlay('<h3>Sanctuary Dash</h3><p>The golden cube never stops. Jump the thorns, ride the pews, run under the swinging censers — never jump into one — and reach the sanctuary 9,200px down the nave. ' + (DASH_GRACE_FEATURE ? 'Once per run, grace forgives a fall. ' : '') + gameMark('dash') + '</p>' +
      diffPickerHtml('dash', diff) +
      '<button type="button" class="big-btn press" id="dash-start">Start the run</button>' +
      kbdHint('Keyboard: Space or Enter starts the run.'));
    wireDiffButtons(api.overlay, 'dash', function () { return diff; }, function (d) { diff = d; writeDiff('dash', d); applyDashDiff(); });
    var s = document.getElementById('dash-start');
    if (s) s.addEventListener('click', function () { startRun(seed); });
    updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
      cleanupPause();
    };
  }

  // ================= Cathedral Defence =================
  // A winding stone path crosses the field to the cathedral door. Waves
  // of the seven deadly sins walk it; the player raises four kinds of
  // tower on the grass plots beside the path and turns them back.
  // Every tower is available from wave 1 (no unlock grind): difficulty
  // comes from the waves. Each tower upgrades twice along one of two
  // branches — choosing a branch locks the other for that tower, so a
  // defence is a set of commitments, not a checklist. Every sin trait
  // is named in the wave preview before it arrives and has at least
  // two tower answers: armor falls to choir (piercing) and to font
  // splash worn down by bells; veiled sins hide from candles only;
  // regenerating Wrath falls to bell speed or choir burst; splitting
  // Greed is answered by font splash or candle speed; swift Envy is
  // slowed by fonts and outshot by candles; hearty sins fall to any
  // sustained fire, choir fastest.
  var DEF_PATH = [[-20, 50], [380, 50], [380, 130], [80, 130], [80, 220], [436, 220]];
  var DEF_PLOTS = [[60, 90], [170, 90], [280, 90], [430, 90], [170, 175], [280, 175], [430, 175], [30, 175], [30, 270], [170, 270], [280, 270], [400, 270]];
  var DEF_TOWERS = {
    bell: { name: 'Bell Tower', cost: 50, range: 88, dmg: 8, rate: 0.38, color: '#6e1a26', letter: 'B', blurb: 'Cheap, quick shots, modest damage.' },
    candle: { name: 'Candle Turret', cost: 40, range: 64, dmg: 3, rate: 0.18, color: '#b28a2e', letter: 'C', blurb: 'Very fast, short range. Cannot target Veiled sins.' },
    font: { name: 'Holy Water Font', cost: 70, range: 78, dmg: 6, rate: 0.95, splash: 40, color: '#3a6ea5', letter: 'F', blurb: 'Splash damage, and its water slows sins.' },
    choir: { name: 'Choir Tower', cost: 90, range: 135, dmg: 26, rate: 1.7, color: '#5b3a7a', letter: 'Ch', blurb: 'Long range, slow heavy shots that pierce armor.' }
  };
  var DEF_ORDER = ['bell', 'candle', 'font', 'choir'];
  var DEF_UPGRADES = {
    bell: { A: { name: 'Louder bells', desc: '+80% damage per step' }, B: { name: 'Quicker ringing', desc: 'fires about 60% faster per step' } },
    candle: { A: { name: 'Brighter flames', desc: '+90% damage per step' }, B: { name: 'Taller candles', desc: '+35% range per step' } },
    font: { A: { name: 'Wider font', desc: 'bigger splash, +50% damage per step' }, B: { name: 'Colder water', desc: 'stronger, longer slow per step' } },
    choir: { A: { name: 'Deeper voices', desc: '+80% damage per step' }, B: { name: 'Farther voices', desc: '+30% range, a little faster per step' } }
  };
  var DEF_SINS = {
    sloth: { name: 'Sloth', letter: 'S', color: '#6f6259', hp: 36, speed: 24, reward: 7, trait: 'Hearty' },
    pride: { name: 'Pride', letter: 'P', color: '#5b2a4a', hp: 32, speed: 27, reward: 8, trait: 'Armored' },
    envy: { name: 'Envy', letter: 'E', color: '#2e5e4e', hp: 17, speed: 58, reward: 7, trait: 'Swift' },
    lust: { name: 'Lust', letter: 'L', color: '#b8452a', hp: 24, speed: 34, reward: 8, trait: 'Veiled' },
    wrath: { name: 'Wrath', letter: 'W', color: '#a02c3c', hp: 30, speed: 32, reward: 9, trait: 'Regenerating' },
    greed: { name: 'Greed', letter: 'G', color: '#b28a2e', hp: 22, speed: 30, reward: 8, trait: 'Splitting' },
    gluttony: { name: 'Gluttony', letter: 'Gl', color: '#8a6d3b', hp: 60, speed: 22, reward: 10, trait: 'Hearty' },
    imp: { name: 'Imp', letter: 'i', color: '#c49a3c', hp: 9, speed: 44, reward: 3, trait: 'Swift' }
  };
  var DEF_TRAIT_HINT = {
    Armored: 'choir voices pierce armor',
    Veiled: 'candles cannot see veiled sins; bells, fonts and choir can',
    Regenerating: 'burst it down fast, with bells or choir, before it heals',
    Splitting: 'font splash catches the imps it splits into',
    Swift: 'fonts slow them and candles fire fastest',
    Hearty: 'steady fire wears them down, choir fastest'
  };
  function mountDefence(parent, onBack) {
    var api = createStage(parent, { title: 'Cathedral Defence', onBack: onBack });
    var diff = readDiff('defence');
    var startCoins = 160, startLives = 20, hpMult = 1, speedMult = 1;
    function applyDiff() {
      if (diff === 'easy') { startCoins = 230; startLives = 25; hpMult = 0.8; speedMult = 0.9; }
      else if (diff === 'hard') { startCoins = 130; startLives = 15; hpMult = 1.25; speedMult = 1.12; }
      else { startCoins = 160; startLives = 20; hpMult = 1; speedMult = 1; }
    }
    applyDiff();
    // Path geometry: cumulative lengths once per mount.
    var segLen = [], pathTotal = 0;
    for (var si = 0; si < DEF_PATH.length - 1; si++) {
      var sl = Math.hypot(DEF_PATH[si + 1][0] - DEF_PATH[si][0], DEF_PATH[si + 1][1] - DEF_PATH[si][1]);
      segLen.push(sl); pathTotal += sl;
    }
    function posAt(d) {
      var left = d;
      for (var i = 0; i < segLen.length; i++) {
        if (left <= segLen[i] || i === segLen.length - 1) {
          var t = segLen[i] ? clamp(left / segLen[i], 0, 1) : 0;
          return { x: DEF_PATH[i][0] + (DEF_PATH[i + 1][0] - DEF_PATH[i][0]) * t, y: DEF_PATH[i][1] + (DEF_PATH[i + 1][1] - DEF_PATH[i][1]) * t };
        }
        left -= segLen[i];
      }
      return { x: DEF_PATH[DEF_PATH.length - 1][0], y: DEF_PATH[DEF_PATH.length - 1][1] };
    }
    var state = 'ready', paused = false, destroyed = false, raf = 0, last = 0;
    var coins = 0, lives = 0, wave = 0, wavesDone = 0, earned = 0, popped = 0, leaked = 0;
    var towers = [], sins = [], projs = [], rings = [], queue = [], spawnT = 0;
    var phase = 'build'; // build (between waves) | wave
    var pending = 'bell'; // tower type the next plot tap places
    var selected = -1; // index into towers, or -1
    var best = readBest('defence');
    function score() { return earned + 25 * wavesDone; }
    function compFor(w) {
      var pool = ['sloth', 'pride'];
      if (w >= 2) pool.push('envy');
      if (w >= 3) pool.push('lust');
      if (w >= 4) pool.push('wrath');
      if (w >= 5) pool.push('greed');
      if (w >= 6) pool.push('gluttony');
      var n = 4 + w * 2, out = [];
      for (var i = 0; i < n; i++) out.push(pool[(i * 2 + w) % pool.length]);
      if (w >= 2 && w <= 6) { out[n - 1] = pool[pool.length - 1]; out[n - 2] = pool[pool.length - 1]; }
      return out;
    }
    function previewFor(w) {
      var comp = compFor(w), seen = {}, names = [], hint = '';
      comp.forEach(function (t) {
        if (!seen[t]) { seen[t] = true; names.push(DEF_SINS[t].name); }
        if (!hint && DEF_TRAIT_HINT[DEF_SINS[t].trait] && t !== 'sloth') hint = DEF_TRAIT_HINT[DEF_SINS[t].trait];
      });
      if (!hint) hint = DEF_TRAIT_HINT.Hearty;
      return 'Wave ' + w + ': ' + names.join(', ') + ' \u2014 ' + hint + '.';
    }
    function towerStats(tw) {
      var b = DEF_TOWERS[tw.type];
      var st = { range: b.range, dmg: b.dmg, rate: b.rate, splash: b.splash || 0, slowF: 0.55, slowDur: 1.2, pierce: tw.type === 'choir' };
      if (tw.branch) {
        for (var lv = 0; lv < tw.level; lv++) {
          if (tw.type === 'bell') { if (tw.branch === 'A') st.dmg *= 1.8; else st.rate *= 0.62; }
          else if (tw.type === 'candle') { if (tw.branch === 'A') st.dmg *= 1.9; else st.range *= 1.35; }
          else if (tw.type === 'font') { if (tw.branch === 'A') { st.splash += 22; st.dmg *= 1.5; } else { st.slowF = Math.max(0.25, st.slowF - 0.18); st.slowDur += 0.8; st.dmg *= 1.25; } }
          else if (tw.type === 'choir') { if (tw.branch === 'A') st.dmg *= 1.8; else { st.range *= 1.3; st.rate *= 0.85; } }
        }
        if (tw.type === 'bell' && tw.branch === 'A' && tw.level >= 2) st.range *= 1.1;
        if (tw.type === 'bell' && tw.branch === 'B' && tw.level >= 2) st.dmg *= 1.3;
        if (tw.type === 'candle' && tw.branch === 'B' && tw.level >= 2) st.rate *= 0.8;
      }
      st.dmg = Math.round(st.dmg * 10) / 10;
      st.range = Math.round(st.range);
      return st;
    }
    function upCost(tw) { var b = DEF_TOWERS[tw.type]; return tw.level === 0 ? Math.round(b.cost * 0.8) : Math.round(b.cost * 1.2); }
    function startGame() {
      applyDiff();
      parishSubmitted['defence'] = false;
      coins = startCoins; lives = startLives; wave = 0; wavesDone = 0; earned = 0; popped = 0; leaked = 0;
      towers = []; sins = []; projs = []; rings = []; queue = [];
      phase = 'build'; pending = 'bell'; selected = -1; state = 'playing'; paused = false;
      api.pauseBtn.textContent = 'Pause';
      api.hideOverlay(); updateHud(); renderPanel();
    }
    function gameOver() {
      state = 'over';
      var fb = writeBest('defence', score()); best = fb;
      submitParishScore('defence', score());
      api.showOverlay('<h3>The cathedral fell</h3><p>The sins reached the door on wave ' + Math.max(1, wave) + '.<br>Score: ' + score() + ' &middot; Waves turned back: ' + wavesDone + ' &middot; Sins popped: ' + popped + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="defence-again">Defend again</button>' +
        kbdHint('Keyboard: Space or Enter defends again.') +
        '<button type="button" class="linklike" id="defence-back">Back to arcade</button>');
      var a = document.getElementById('defence-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('defence-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud(); renderPanel();
    }
    function startWave() {
      if (state !== 'playing' || phase !== 'build') return;
      wave += 1;
      queue = compFor(wave);
      spawnT = 0; phase = 'wave';
      api.showBanner(previewFor(wave), 2200);
      updateHud(); renderPanel();
    }
    function spawnSin(type, dist) {
      var d = DEF_SINS[type];
      var hp = Math.round(d.hp * hpMult * (1 + (wave - 1) * 0.22));
      sins.push({ type: type, hp: hp, maxHp: hp, dist: dist || 0, slowT: 0, slowF: 1, sinceHit: 9, dead: false });
    }
    function hurt(s, dmg, pierce) {
      if (s.dead) return;
      var dealt = dmg;
      if (s.type === 'pride' && !pierce) dealt = dmg * 0.35; // armor: only piercing shots land full
      s.hp -= dealt; s.sinceHit = 0;
      if (s.hp <= 0) killSin(s);
    }
    function killSin(s) {
      if (s.dead) return;
      s.dead = true; popped += 1;
      var r = DEF_SINS[s.type].reward + Math.floor(wave / 3);
      coins += r; earned += r;
      if (rings.length < 40) { var p = posAt(s.dist); rings.push({ x: p.x, y: p.y, r: 4, life: 0.3 }); }
      if (s.type === 'greed') { // splitting: two imps carry on from where it fell
        spawnSin('imp', Math.max(0, s.dist - 8));
        spawnSin('imp', Math.max(0, s.dist - 20));
      }
    }
    function placeTower(plotIdx) {
      var b = DEF_TOWERS[pending];
      for (var i = 0; i < towers.length; i++) if (towers[i].plot === plotIdx) { selected = i; renderPanel(); return; }
      if (coins < b.cost) { api.showBanner('Not enough coins for a ' + b.name + ' (' + b.cost + ')', 1500); return; }
      coins -= b.cost;
      towers.push({ plot: plotIdx, type: pending, branch: '', level: 0, cd: 0 });
      selected = towers.length - 1;
      updateHud(); renderPanel();
    }
    function upgradeSelected(branch) {
      if (selected < 0 || selected >= towers.length) return;
      var tw = towers[selected];
      if (tw.level >= 2) return;
      if (tw.level === 0 && branch !== 'A' && branch !== 'B') return;
      if (tw.level > 0 && branch !== tw.branch) return; // the first choice locks the other path
      var cost = upCost(tw);
      if (coins < cost) { api.showBanner('Not enough coins for that upgrade (' + cost + ')', 1500); return; }
      coins -= cost;
      if (tw.level === 0) tw.branch = branch;
      tw.level += 1;
      api.showBanner(DEF_TOWERS[tw.type].name + ': ' + DEF_UPGRADES[tw.type][tw.branch].name + ' ' + tw.level, 1400);
      updateHud(); renderPanel();
    }
    function renderPanel() {
      api.actions.innerHTML = '';
      if (state !== 'playing') return;
      var row = el('div', 'touch-row');
      DEF_ORDER.forEach(function (t, i) {
        var b = DEF_TOWERS[t];
        var btn = el('button', 'press touch-btn', b.name + ' \u00b7 ' + b.cost);
        btn.type = 'button'; btn.id = 'defence-tower-' + t;
        if (pending === t) { btn.style.background = '#6e1a26'; btn.style.color = '#f7ecd4'; }
        btn.addEventListener('click', function () { pending = t; selected = -1; renderPanel(); });
        row.appendChild(btn);
      });
      api.actions.appendChild(row);
      api.actions.appendChild(el('p', 'game-note', DEF_TOWERS[pending].name + ': ' + DEF_TOWERS[pending].blurb + ' Tap a grass plot to place it.'));
      if (phase === 'build') {
        api.actions.appendChild(el('p', 'game-note', previewFor(wave + 1)));
        var wb = el('button', 'press touch-btn wide', 'Begin wave ' + (wave + 1));
        wb.type = 'button'; wb.id = 'defence-wave';
        wb.addEventListener('click', startWave);
        api.actions.appendChild(wb);
      }
      if (selected >= 0 && towers[selected]) {
        var tw = towers[selected], st = towerStats(tw), ub = DEF_TOWERS[tw.type];
        var info = el('p', 'game-note', '');
        info.id = 'defence-selected';
        var txt = ub.name + (tw.level ? ' \u00b7 ' + DEF_UPGRADES[tw.type][tw.branch].name + ' ' + tw.level : ' \u00b7 no upgrade yet') +
          ' \u00b7 Damage ' + st.dmg + ' \u00b7 Range ' + st.range + ' \u00b7 One shot every ' + (Math.round(st.rate * 100) / 100) + 's' +
          (st.splash ? ' \u00b7 Splash ' + st.splash : '') + (st.pierce ? ' \u00b7 Pierces armor' : '');
        info.textContent = txt;
        api.actions.appendChild(info);
        if (tw.level < 2) {
          var cost = upCost(tw);
          var branches = tw.level === 0 ? ['A', 'B'] : [tw.branch];
          branches.forEach(function (br) {
            var up = DEF_UPGRADES[tw.type][br];
            var ubtn = el('button', 'press touch-btn', 'Upgrade: ' + up.name + ' \u00b7 ' + cost + ' coins (' + up.desc + ')');
            ubtn.type = 'button'; ubtn.id = 'defence-up-' + br.toLowerCase();
            ubtn.addEventListener('click', function () { upgradeSelected(br); });
            api.actions.appendChild(ubtn);
          });
        } else {
          api.actions.appendChild(el('p', 'game-note', 'Fully upgraded along its chosen path.'));
        }
      }
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + score() + '</span><span>Coins: ' + coins + '</span><span>Lives: ' + Math.max(0, lives) + '</span>' +
        '<span>Wave: ' + wave + '</span><span>Sins: ' + (sins.length + queue.length) + '</span><span>Popped: ' + popped + '</span>' + diffTag(diff) + '<span>Best: ' + best + '</span>');
    }
    function tick(dt) {
      // Spawning
      if (phase === 'wave' && queue.length) {
        spawnT -= dt;
        if (spawnT <= 0) { spawnSin(queue.shift(), 0); spawnT = Math.max(0.42, 0.95 - wave * 0.03); }
      }
      // Sins walk
      for (var i = 0; i < sins.length; i++) {
        var s = sins[i];
        if (s.dead) continue;
        s.sinceHit += dt;
        if (s.type === 'wrath' && s.sinceHit > 0.8 && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + 4 * dt); // regenerating
        if (s.slowT > 0) s.slowT -= dt;
        var spd = DEF_SINS[s.type].speed * speedMult * (s.slowT > 0 ? s.slowF : 1);
        s.dist += spd * dt;
        if (s.dist >= pathTotal) {
          s.dead = true; leaked += 1; lives -= 1;
          api.showBanner(DEF_SINS[s.type].name + ' reached the cathedral', 1100);
          if (lives <= 0) { updateHud(); gameOver(); return; }
        }
      }
      sins = sins.filter(function (x) { return !x.dead; });
      // Towers fire
      towers.forEach(function (tw) {
        var st = towerStats(tw);
        tw.cd -= dt;
        var px = DEF_PLOTS[tw.plot][0], py = DEF_PLOTS[tw.plot][1];
        var target = null;
        for (var j = 0; j < sins.length; j++) {
          var cand = sins[j];
          if (tw.type === 'candle' && cand.type === 'lust') continue; // veiled: candles cannot target Lust
          var cp = posAt(cand.dist);
          if (Math.hypot(cp.x - px, cp.y - py) <= st.range && (!target || cand.dist > target.dist)) target = cand;
        }
        if (target && tw.cd <= 0 && projs.length < 60) { // projectile cap keeps late waves smooth
          projs.push({ x: px, y: py - 10, target: target, dmg: st.dmg, pierce: st.pierce, splash: st.splash, slowF: st.slowF, slowDur: st.slowDur, font: tw.type === 'font' });
          tw.cd = st.rate;
        }
      });
      // Projectiles fly
      for (var k = 0; k < projs.length; k++) {
        var pr = projs[k];
        if (!pr.target || pr.target.dead) { pr.done = true; continue; }
        var tp = posAt(pr.target.dist);
        var dx = tp.x - pr.x, dy = tp.y - pr.y, dd = Math.hypot(dx, dy);
        var step = 340 * dt;
        if (dd <= step + 2) {
          pr.done = true;
          if (pr.splash) {
            if (rings.length < 40) rings.push({ x: tp.x, y: tp.y, r: 6, life: 0.35 });
            sins.slice().forEach(function (vic) {
              var vp = posAt(vic.dist);
              if (Math.hypot(vp.x - tp.x, vp.y - tp.y) <= pr.splash) {
                if (pr.font) { vic.slowT = pr.slowDur; vic.slowF = pr.slowF; }
                hurt(vic, pr.dmg, pr.pierce);
              }
            });
          } else hurt(pr.target, pr.dmg, pr.pierce);
        } else { pr.x += dx / dd * step; pr.y += dy / dd * step; }
      }
      projs = projs.filter(function (x) { return !x.done; });
      sins = sins.filter(function (x) { return !x.dead; });
      rings.forEach(function (r) { r.life -= dt; r.r += 60 * dt; });
      rings = rings.filter(function (r) { return r.life > 0; });
      // Wave cleared?
      if (phase === 'wave' && !queue.length && !sins.length) {
        phase = 'build'; wavesDone = wave; coins += 10;
        api.showBanner('Wave ' + wave + ' turned back. +25 score, +10 coins', 1700);
        renderPanel();
      }
      updateHud();
    }
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#7d8f57'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = '#efe3c2'; ctx.fillRect(0, 0, GAME_W, 26);
      ctx.fillStyle = '#2b1d12'; ctx.font = 'bold 12px Georgia'; ctx.textAlign = 'center';
      ctx.fillText(phase === 'wave' ? 'Wave ' + wave + ' is marching' : 'Place your towers, then begin wave ' + (wave + 1), GAME_W / 2, 17);
      ctx.textAlign = 'left';
      // Stone path
      ctx.strokeStyle = '#b8a88f'; ctx.lineWidth = 22; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      DEF_PATH.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.stroke();
      ctx.strokeStyle = 'rgba(43,29,18,0.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      DEF_PATH.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.stroke();
      // Cathedral at the path end
      ctx.fillStyle = '#f7ecd4'; ctx.fillRect(438, 192, 38, 56);
      ctx.fillStyle = '#6e1a26';
      ctx.beginPath(); ctx.moveTo(432, 192); ctx.lineTo(457, 168); ctx.lineTo(482, 192); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b28a2e'; ctx.fillRect(455, 150, 3, 14); ctx.fillRect(451, 155, 11, 3);
      ctx.fillStyle = '#33261a'; ctx.fillRect(450, 222, 14, 26);
      // Plots and towers
      DEF_PLOTS.forEach(function (pl, idx) {
        var occupied = false;
        towers.forEach(function (tw) { if (tw.plot === idx) occupied = true; });
        ctx.fillStyle = occupied ? '#8aa05c' : 'rgba(247,236,212,0.35)';
        ctx.beginPath(); ctx.arc(pl[0], pl[1], 17, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(43,29,18,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
      });
      if (selected >= 0 && towers[selected]) {
        var spl = DEF_PLOTS[towers[selected].plot];
        ctx.strokeStyle = 'rgba(110,26,38,0.55)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(spl[0], spl[1], towerStats(towers[selected]).range, 0, Math.PI * 2); ctx.stroke();
      }
      towers.forEach(function (tw) {
        var pl = DEF_PLOTS[tw.plot], b = DEF_TOWERS[tw.type];
        ctx.fillStyle = b.color; ctx.fillRect(pl[0] - 11, pl[1] - 8, 22, 20);
        ctx.fillStyle = '#f7ecd4'; ctx.fillRect(pl[0] - 11, pl[1] - 14, 22, 7);
        if (tw.type === 'candle') { ctx.fillStyle = '#e8b64c'; ctx.beginPath(); ctx.arc(pl[0], pl[1] - 19, 4, 0, Math.PI * 2); ctx.fill(); }
        if (tw.type === 'font') { ctx.fillStyle = '#3a6ea5'; ctx.beginPath(); ctx.arc(pl[0], pl[1] - 12, 8, 0, Math.PI); ctx.fill(); }
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(b.letter, pl[0], pl[1] + 8);
        if (tw.level) ctx.fillText(tw.branch + tw.level, pl[0], pl[1] + 24);
        ctx.textAlign = 'left';
      });
      // Sins: colored orbs with a letter; armor ring, veil arc, health bar
      sins.forEach(function (s) {
        var d = DEF_SINS[s.type], p = posAt(s.dist);
        var r = s.type === 'imp' ? 8 : s.type === 'gluttony' ? 14 : 11;
        ctx.fillStyle = d.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        if (s.type === 'pride') { ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
        if (s.type === 'lust') { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r - 3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
        ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (r >= 11 ? 11 : 9) + 'px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(d.letter, p.x, p.y + 4);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#33261a'; ctx.fillRect(p.x - r, p.y - r - 8, r * 2, 4);
        ctx.fillStyle = '#b28a2e'; ctx.fillRect(p.x - r, p.y - r - 8, r * 2 * clamp(s.hp / s.maxHp, 0, 1), 4);
      });
      // Projectiles and splash rings (both capped)
      ctx.fillStyle = '#f7ecd4';
      projs.forEach(function (pr) { ctx.beginPath(); ctx.arc(pr.x, pr.y, 3, 0, Math.PI * 2); ctx.fill(); });
      rings.forEach(function (r) {
        ctx.globalAlpha = Math.max(0, r.life / 0.35);
        ctx.strokeStyle = '#3a6ea5'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      });
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(hasKeyboard() ? 'Paused \u2014 press P to resume' : 'Paused \u2014 tap Resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function loop(t) {
      if (destroyed) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      if (!paused && state === 'playing') tick(dt);
      draw();
      raf = requestAnimationFrame(loop);
    }
    function doPause() { if (state === 'playing') { paused = true; api.pauseBtn.textContent = 'Resume'; } }
    function doResume() { paused = false; api.pauseBtn.textContent = 'Pause'; }
    var cleanupPause = wirePause(api, function () { return paused; }, doPause, doResume);
    document.addEventListener('keydown', onKey);
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      var go = (k === ' ' || k === 'enter');
      if ((state === 'ready' || state === 'over') && go && !kbdOnButton(e)) { e.preventDefault(); startGame(); return; }
      if (state === 'playing' && !paused && !kbdOnButton(e)) {
        if (k === 'b') { e.preventDefault(); startWave(); }
        var n = parseInt(k, 10);
        if (n >= 1 && n <= 4) { pending = DEF_ORDER[n - 1]; selected = -1; renderPanel(); }
      }
    }
    api.canvas.addEventListener('pointerdown', function (e) {
      if (state !== 'playing' || paused) return;
      e.preventDefault();
      var p = canvasPoint(api.canvas, e);
      var bestI = -1, bestD = 1e9;
      DEF_PLOTS.forEach(function (pl, idx) {
        var d = Math.hypot(pl[0] - p.x, pl[1] - p.y);
        if (d < bestD) { bestD = d; bestI = idx; }
      });
      if (bestI >= 0 && bestD <= 24) placeTower(bestI);
    });
    api.showOverlay('<h3>Cathedral Defence</h3><p>The seven sins are marching on the cathedral along the stone path. Raise bell, candle, font and choir towers on the grass plots and turn them back before they reach the door. Every tower is yours from wave 1; each one upgrades twice along a single chosen path, and the wave preview names what is coming so you can plan. ' + gameMark('defence') + '</p>' +
      diffPickerHtml('defence', diff) +
      '<button type="button" class="big-btn press" id="defence-start">Start defending</button>' +
      kbdHint('Keyboard: Space or Enter starts. 1 to 4 choose a tower, B begins the wave.'));
    wireDiffButtons(api.overlay, 'defence', function () { return diff; }, function (d) { diff = d; writeDiff('defence', d); applyDiff(); });
    var s = document.getElementById('defence-start');
    if (s) s.addEventListener('click', startGame);
    updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      cleanupPause();
    };
  }

  // ================= The Pilgrim Path =================
  // A stick-figure life in the Church, one day at a time. Each day the
  // pilgrim spends his energy at four places — the chapel, the library,
  // the parish hall and the town — and the stats he gathers there carry
  // him up the ranks: Seminarian, Deacon, Parish Priest, Pastor,
  // Monsignor, Bishop. No single stat is enough on its own: every rank
  // asks for a mix, every stat unlocks its own perk, and the actions
  // themselves grow up as he does (Pray becomes a Day of Retreat, Serve
  // becomes running the food bank), so grinding one button in one place
  // cannot carry him to the mitre. Rest ends the day: a little upkeep,
  // a fresh morning, and now and then the world knocks first — a
  // visitor, a request, a gift — remembering what he has been doing.
  var PILGRIM_RANKS = ['Seminarian', 'Deacon', 'Parish Priest', 'Pastor', 'Monsignor', 'Bishop'];
  // What each promotion asks for, before the difficulty offset.
  var PILGRIM_REQS = [
    null,
    { faith: 20 },
    { faith: 35, wisdom: 25 },
    { charity: 40, wisdom: 35 },
    { faith: 55, wisdom: 55, charity: 55 },
    { faith: 70, wisdom: 70, charity: 70, rep: 30 }
  ];
  // The parish's gift at each promotion, in coins: rising costs a little.
  var PILGRIM_FEES = [0, 0, 10, 15, 20, 25];
  function mountPilgrim(parent, onBack) {
    var wrap = el('div', 'pilgrim-wrap');
    var head = el('div', 'game-head');
    var backBtn = el('button', 'back-btn press', '\u2190 Back to arcade'); backBtn.type = 'button';
    backBtn.addEventListener('click', function () { onBack(); });
    head.appendChild(backBtn);
    head.appendChild(el('h2', 'font-display', 'The Pilgrim Path'));
    wrap.appendChild(head);
    var stats = el('div', 'pilgrim-stats');
    wrap.appendChild(stats);
    var figure = el('div', 'pilgrim-figure');
    wrap.appendChild(figure);
    var card = el('div', 'pilgrim-card');
    wrap.appendChild(card);
    var ledger = el('div', 'pilgrim-ledger');
    wrap.appendChild(ledger);
    parent.appendChild(wrap);
    var diff = readDiff('pilgrim'); // Easy / Medium / Hard; Medium is the tuned default
    var maxEnergy = 8, dayLimit = 40, upkeep = 3, reqOff = 0, repOff = 0;
    function applyPilgrimDiff() {
      // Easy: more breath in the day, gentler thresholds, a longer road.
      // Hard: shorter days, higher thresholds, a shorter road.
      if (diff === 'easy') { maxEnergy = 10; dayLimit = 50; upkeep = 2; reqOff = -10; repOff = -6; }
      else if (diff === 'hard') { maxEnergy = 7; dayLimit = 32; upkeep = 5; reqOff = 12; repOff = 6; }
      else { maxEnergy = 8; dayLimit = 40; upkeep = 3; reqOff = 0; repOff = 0; }
    }
    applyPilgrimDiff();
    var best = readBest('pilgrim');
    var day = 1, rank = 0, faith = 5, wisdom = 5, charity = 5, rep = 0, coins = 20, energy = maxEnergy;
    var over = false, started = false, note = '';
    function reqFor(target) {
      var base = PILGRIM_REQS[target];
      if (!base) return null;
      var req = {};
      ['faith', 'wisdom', 'charity'].forEach(function (k) { if (base[k]) req[k] = Math.max(10, base[k] + reqOff); });
      if (base.rep) req.rep = Math.max(10, base.rep + repOff);
      return req;
    }
    function statVal(k) { return k === 'faith' ? faith : k === 'wisdom' ? wisdom : k === 'charity' ? charity : rep; }
    function meetsReq(target) {
      var req = reqFor(target);
      if (!req) return false;
      var ok = true;
      ['faith', 'wisdom', 'charity', 'rep'].forEach(function (k) { if (req[k] && statVal(k) < req[k]) ok = false; });
      return ok;
    }
    function reqText(target) {
      var req = reqFor(target);
      var parts = [];
      ['faith', 'wisdom', 'charity', 'rep'].forEach(function (k) {
        if (req[k]) parts.push((k === 'rep' ? 'Reputation' : k.charAt(0).toUpperCase() + k.slice(1)) + ' ' + req[k] + (statVal(k) >= req[k] ? ' \u2713' : ' (now ' + statVal(k) + ')'));
      });
      return parts.join(' \u00b7 ');
    }
    // The actions grow up with the stat behind them: at 25 and again at
    // 55 the same place offers a new scene, a new name and a better yield.
    function tierOf(v) { return v >= 55 ? 2 : v >= 25 ? 1 : 0; }
    function actions() {
      var ft = tierOf(faith), wt = tierOf(wisdom), ct = tierOf(charity);
      return [
        { place: 'Chapel', name: ['Pray', 'Morning Prayer', 'Day of Retreat'][ft], cost: ft === 2 ? 3 : 2,
          gain: 'Faith +' + [3, 4, 6][ft] + ', a little breath back',
          flavor: ['A quiet hour in the chapel. The candles do the talking.', 'Morning Prayer with the psalms, sung slowly and meant.', 'A whole day of retreat. He comes back quieter, and stronger.'][ft] },
        { place: 'Library', name: ['Study', 'Read', 'Research & Write'][wt], cost: wt === 2 ? 3 : 2,
          gain: 'Wisdom +' + [3, 4, 6][wt] + (wt === 2 ? ', a few coins for the writing' : ''),
          flavor: ['Notes in the margins, questions in the margins of the notes.', 'One book leads to three more. That is how it always goes.', 'His article goes out to the diocesan paper. People write back.'][wt] },
        { place: 'Parish Hall', name: ['Serve', 'Serve Suppers', 'Run the Food Bank'][ct], cost: ct === 2 ? 3 : 2,
          gain: 'Charity +' + [3, 4, 6][ct] + ', Reputation +' + [2, 3, 4][ct],
          flavor: ['Dishes washed, tables wiped, nobody turned away.', 'Supper for forty, and he knows most of them by name now.', 'The food bank runs on his lists and his Saturdays. The town notices.'][ct] },
        { place: 'Town', name: ['Work', 'Odd Jobs', 'Skilled Work'][wt], cost: 3,
          gain: 'Coins +' + (wt === 0 ? 8 : wt === 1 ? 13 : 18),
          flavor: ['Honest hours for honest pay. The roof fund grows a little.', 'Word gets round: he can fix things, and he shows up.', 'Skilled work at a skilled wage. Study pays its own way in the end.'][wt] }
      ];
    }
    function figureSvg() {
      var s = '<svg viewBox="0 0 120 150" width="120" height="150" role="img" aria-label="Your pilgrim, a ' + PILGRIM_RANKS[rank] + '">';
      if (rank >= 5) s += '<path d="M97 26 q15 0 15 13 q0 11 -11 11" fill="none" stroke="#b28a2e" stroke-width="3"/><line x1="97" y1="34" x2="97" y2="140" stroke="#b28a2e" stroke-width="3"/>';
      if (rank >= 2) {
        // The chasuble: burgundy as a priest, deepening with gold at Monsignor and beyond.
        s += '<path d="M60 36 L42 94 L78 94 Z" fill="' + (rank >= 4 ? '#571521' : '#6e1a26') + '" stroke="#2e2205" stroke-width="2"/>';
        if (rank >= 4) s += '<line x1="60" y1="40" x2="60" y2="90" stroke="#b28a2e" stroke-width="3"/>';
      } else {
        s += '<line x1="60" y1="37" x2="60" y2="94" stroke="#333" stroke-width="3"/>';
      }
      if (rank === 1) s += '<line x1="50" y1="42" x2="70" y2="80" stroke="#b28a2e" stroke-width="5"/>';
      if (rank >= 2) { s += '<line x1="53" y1="40" x2="53" y2="76" stroke="#f7ecd4" stroke-width="3"/><line x1="67" y1="40" x2="67" y2="76" stroke="#f7ecd4" stroke-width="3"/>'; }
      s += '<line x1="60" y1="56" x2="38" y2="72" stroke="#333" stroke-width="3"/><line x1="60" y1="56" x2="82" y2="72" stroke="#333" stroke-width="3"/>';
      if (rank >= 4) s += '<circle cx="82" cy="72" r="4" fill="none" stroke="#b28a2e" stroke-width="2.5"/>';
      if (rank >= 3) s += '<line x1="60" y1="58" x2="60" y2="68" stroke="#b28a2e" stroke-width="2.5"/><line x1="56" y1="62" x2="64" y2="62" stroke="#b28a2e" stroke-width="2.5"/>';
      s += '<line x1="60" y1="94" x2="46" y2="126" stroke="#333" stroke-width="3"/><line x1="60" y1="94" x2="74" y2="126" stroke="#333" stroke-width="3"/>';
      s += '<circle cx="60" cy="26" r="11" fill="#f7ecd4" stroke="#333" stroke-width="2.5"/>';
      if (rank >= 5) s += '<path d="M49 22 L71 22 L60 3 Z" fill="#fffdf6" stroke="#b28a2e" stroke-width="2"/><line x1="60" y1="9" x2="60" y2="17" stroke="#6e1a26" stroke-width="2"/><line x1="57" y1="12" x2="63" y2="12" stroke="#6e1a26" stroke-width="2"/>';
      s += '</svg>';
      return s;
    }
    function scoreNow() {
      return Math.max(0, Math.round(faith + wisdom + charity + rep + Math.floor(coins / 5) + rank * 100 - 2 * day));
    }
    function renderStats() {
      stats.innerHTML = '<span>Day <b>' + Math.min(day, dayLimit) + '</b> of ' + dayLimit + '</span>' +
        '<span>Rank: <b>' + PILGRIM_RANKS[rank] + '</b></span>' +
        '<span>Faith: <b>' + faith + '</b></span>' +
        '<span>Wisdom: <b>' + wisdom + '</b></span>' +
        '<span>Charity: <b>' + charity + '</b></span>' +
        '<span>Reputation: <b>' + rep + '</b></span>' +
        '<span>Coins: <b>' + coins + '</b></span>' +
        '<span>Energy: <b>' + energy + '/' + maxEnergy + '</b></span>' +
        '<span>Score: <b>' + scoreNow() + '</b></span>' +
        (diff !== 'medium' ? '<span>Difficulty: ' + DIFF_LABEL[diff] + '</span>' : '') +
        '<span>Best: ' + best + '</span>';
      figure.innerHTML = figureSvg() + '<p class="pilgrim-rankname">' + PILGRIM_RANKS[rank] + '</p>';
    }
    function ledgerEntry(html) {
      var d = document.createElement('div');
      d.className = 'pilgrim-entry';
      d.innerHTML = html;
      ledger.appendChild(d);
      ledger.scrollTop = ledger.scrollHeight;
    }
    function endRun(reason, won) {
      over = true;
      var score = scoreNow();
      var fb = writeBest('pilgrim', score); best = fb;
      submitParishScore('pilgrim', score);
      // The kind of churchman he became, named by his strongest stat.
      var kind;
      if (faith >= wisdom && faith >= charity) kind = 'a praying ' + (won ? 'bishop, first at the altar' : 'soul, first at the altar');
      else if (wisdom >= charity) kind = 'a teaching ' + (won ? 'bishop, whose sermons people wrote down' : 'soul, whose words people wrote down');
      else kind = 'a shepherd ' + (won ? 'bishop, beloved in every parish' : 'soul, beloved in every parish he served');
      var verdict = won ? 'He became ' + kind + '.' : 'He finished as ' + PILGRIM_RANKS[rank] + ' \u2014 ' + kind + '.';
      if (rep >= 40) verdict += ' His reputation travelled ahead of him: doors opened before he knocked.';
      else if (rep >= 25) verdict += ' People spoke well of him in the towns he passed through.';
      card.innerHTML = '<h3>' + esc(reason) + '</h3>' +
        '<p>' + esc(verdict) + '<br>' +
        'Final rank: ' + PILGRIM_RANKS[rank] + ' &middot; Faith ' + faith + ' &middot; Wisdom ' + wisdom + ' &middot; Charity ' + charity + ' &middot; Reputation ' + rep + ' &middot; Coins ' + coins + '<br>' +
        'Score: <b>' + score + '</b> &middot; Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="pilgrim-again">Walk the path again</button> ' +
        kbdHint('Keyboard: Space or Enter walks the path again.') +
        '<button type="button" class="linklike" id="pilgrim-back2">Back to arcade</button>';
      var a = document.getElementById('pilgrim-again');
      if (a) a.addEventListener('click', startRun);
      var b = document.getElementById('pilgrim-back2');
      if (b) b.addEventListener('click', function () { onBack(); });
      renderStats();
    }
    function showDay() {
      var acts = actions();
      var html = '<h3>Day ' + day + ' \u2014 ' + PILGRIM_RANKS[rank] + '</h3>';
      if (note) html += '<p class="pilgrim-scene">' + esc(note) + '</p>';
      if (rank < 5) {
        html += '<p class="pilgrim-next">Next: <b>' + PILGRIM_RANKS[rank + 1] + '</b> \u2014 needs ' + reqText(rank + 1) +
          (PILGRIM_FEES[rank + 1] > 0 ? ' \u00b7 and ' + PILGRIM_FEES[rank + 1] + ' coins as the parish\u2019s gift' : '') + '.</p>';
        if (meetsReq(rank + 1) && coins >= PILGRIM_FEES[rank + 1]) {
          html += '<p><button type="button" class="pilgrim-promote press">Seek promotion to ' + PILGRIM_RANKS[rank + 1] + (PILGRIM_FEES[rank + 1] > 0 ? ' (' + PILGRIM_FEES[rank + 1] + ' coins)' : '') + '</button></p>';
        } else if (meetsReq(rank + 1)) {
          html += '<p class="pilgrim-ready-note">The call has come, but the parish\u2019s gift of ' + PILGRIM_FEES[rank + 1] + ' coins is not yet in hand. Work in the town will see to it.</p>';
        }
      }
      html += '<div class="pilgrim-actions">';
      acts.forEach(function (a, i) {
        html += '<button type="button" class="pilgrim-action press" data-i="' + i + '"' + (energy < a.cost ? ' disabled' : '') + '>' +
          '<span class="pilgrim-place">' + esc(a.place) + '</span> <b>' + esc(a.name) + '</b><br>' +
          '<span class="pilgrim-gain">' + esc(a.gain) + ' \u00b7 Energy ' + a.cost + '</span>' + kbdChip(String(i + 1)) + '</button>';
      });
      html += '</div>' +
        '<p style="margin:12px 0 0;"><button type="button" class="pilgrim-rest press">Rest \u2014 end the day (upkeep ' + upkeep + ' coins)</button></p>' +
        kbdHint('Keyboard: 1 to 4 chooses a place \u00b7 Space or Enter rests.');
      card.innerHTML = html;
      card.querySelectorAll('.pilgrim-action').forEach(function (btn) {
        btn.addEventListener('click', function () { doAction(parseInt(btn.getAttribute('data-i'), 10)); });
      });
      var promo = card.querySelector('.pilgrim-promote');
      if (promo) promo.addEventListener('click', promote);
      var rest = card.querySelector('.pilgrim-rest');
      if (rest) rest.addEventListener('click', restDay);
      renderStats();
    }
    function doAction(i) {
      if (over || !started) return;
      var a = actions()[i];
      if (!a || energy < a.cost) return;
      energy -= a.cost;
      if (i === 0) {
        var ft = tierOf(faith);
        faith = clamp(faith + [3, 4, 6][ft], 0, 100);
        // The Faith perk: prayer gives a little of the day back.
        energy = Math.min(maxEnergy, energy + 1);
      } else if (i === 1) {
        var wt = tierOf(wisdom);
        wisdom = clamp(wisdom + [3, 4, 6][wt], 0, 100);
        if (wt === 2) coins += 3;
      } else if (i === 2) {
        var ct = tierOf(charity);
        charity = clamp(charity + [3, 4, 6][ct], 0, 100);
        rep = clamp(rep + [2, 3, 4][ct], 0, 100);
        coins += [1, 2, 2][ct];
      } else {
        // The Wisdom perk: study turns into better pay in the town.
        var wt2 = tierOf(wisdom);
        coins += wt2 === 0 ? 8 : wt2 === 1 ? 13 : 18;
      }
      note = a.flavor;
      ledgerEntry('<b>Day ' + day + ' \u2014 ' + esc(a.place) + ':</b> ' + esc(a.name) + '. ' + esc(a.gain) + '.');
      showDay();
    }
    function promote() {
      if (over || rank >= 5 || !meetsReq(rank + 1) || coins < PILGRIM_FEES[rank + 1]) return;
      coins -= PILGRIM_FEES[rank + 1];
      rank += 1;
      note = 'The letter came at breakfast. ' + PILGRIM_RANKS[rank] + ' now \u2014 the parish turned out to see the new marks on him.';
      ledgerEntry('<b>Day ' + day + ':</b> Promoted to <b>' + PILGRIM_RANKS[rank] + '</b>' + (PILGRIM_FEES[rank] > 0 ? ', the parish\u2019s gift of ' + PILGRIM_FEES[rank] + ' coins given' : '') + '.');
      if (rank >= 5) { endRun('The mitre fits \u2014 he is a bishop.', true); return; }
      showDay();
    }
    function restDay() {
      if (over || !started) return;
      if (day >= dayLimit) { endRun('The road ends here \u2014 for now.', false); return; }
      day += 1;
      var paid = Math.min(coins, upkeep);
      coins -= paid;
      energy = maxEnergy;
      // The world remembers: from the third morning on, some days begin
      // with the parish answering back. A charitable pilgrim hears from
      // grateful givers most of all.
      var morning = 'A new morning. The bell, the breviary, the day\u2019s work waiting.';
      if (day >= 3) {
        if (charity >= 30 && Math.random() < 0.22) {
          var gift = randInt(5, 10);
          coins += gift;
          morning = 'A gift at the door before Mass: ' + gift + ' coins from a family he once fed, with a note that just says thank you.';
        } else if (Math.random() < 0.30) {
          var ev = randInt(0, 3);
          if (ev === 0) { coins += 6; morning = 'A visitor passing through left 6 coins for the poor box \u2014 and a kind word for the man who keeps it.'; }
          else if (ev === 1) { rep = clamp(rep + 2, 0, 100); morning = 'A note of thanks arrived from the next town over. Word of his service is travelling. Reputation +2.'; }
          else if (ev === 2) { charity = clamp(charity + 2, 0, 100); morning = 'Before breakfast, a neighbour needed help with a flooded kitchen. He went. Charity +2.'; }
          else { wisdom = clamp(wisdom + 1, 0, 100); morning = 'A letter from an old teacher, full of hard questions. He read it twice. Wisdom +1.'; }
        }
      }
      note = morning;
      ledgerEntry('<b>Day ' + day + ':</b> ' + esc(morning) + ' <span class="pilgrim-nums">Upkeep -' + paid + ' coins \u00b7 Energy restored.</span>');
      showDay();
    }
    function startRun() {
      applyPilgrimDiff();
      parishSubmitted['pilgrim'] = false;
      day = 1; rank = 0; faith = 5; wisdom = 5; charity = 5; rep = 0; coins = 20; energy = maxEnergy;
      over = false; started = true;
      note = 'First morning in the seminary. Plain room, plain cassock, one long road ahead of him.';
      ledger.innerHTML = '';
      ledgerEntry('<b>Day 1:</b> The path begins. Pray, study, serve and work \u2014 and mind the coins, for rising costs a little.');
      showDay();
    }
    card.innerHTML = '<h3>The Pilgrim Path</h3><p>One stick figure, one calling. Each day, spend his energy at the chapel, the library, the parish hall or in the town, and rise from Seminarian to Bishop before the days run out. Every rank asks for a mix of Faith, Wisdom and Charity, and Reputation besides \u2014 no single road gets him there. Score is his three stats, plus Reputation, a little for his coins, and 100 for every rank, less 2 for every day taken. ' + gameMark('pilgrim') + '</p>' +
      diffPickerHtml('pilgrim', diff) +
      '<button type="button" class="big-btn press" id="pilgrim-start">Begin the path</button>' +
      kbdHint('Keyboard: Space or Enter begins the path \u00b7 1 to 4 chooses a place.');
    wireDiffButtons(card, 'pilgrim', function () { return diff; }, function (d) { diff = d; writeDiff('pilgrim', d); applyPilgrimDiff(); });
    var s = document.getElementById('pilgrim-start');
    if (s) s.addEventListener('click', startRun);
    document.addEventListener('keydown', onKey);
    function onKey(e) {
      if (kbdTyping(e)) return;
      var k = e.key.toLowerCase();
      if (k === '1' || k === '2' || k === '3' || k === '4') {
        if (!over && started && card.querySelector('.pilgrim-action')) doAction(parseInt(k, 10) - 1);
        return;
      }
      var go = (k === ' ' || k === 'enter');
      if (!go || kbdOnButton(e)) return;
      e.preventDefault();
      if (over) { startRun(); return; }
      if (!started) { startRun(); return; }
      restDay();
    }
    renderStats();
    return function cleanup() {
      document.removeEventListener('keydown', onKey);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };
  }

  // __MORE_GAMES__

  renderShelf();
})();
