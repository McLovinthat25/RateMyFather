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
      setHud: function (html) { hud.innerHTML = html; },
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
  function kbdChip(key) {
    return '<span style="display:inline-block;min-width:20px;padding:2px 7px;margin-left:10px;border:1.5px solid rgba(46,34,5,.55);border-radius:5px;font-size:11px;font-weight:700;letter-spacing:.08em;vertical-align:2px;">' + key + '</span>';
  }
  // One line under a big button, naming the keyboard way to press it.
  function kbdHint(text) {
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
    { id: 'rungun', title: 'The Parish Bowl', blurb: 'Father Ted carries the ball for Craggy Island against St Swithin\u2019s. Run or pass your way down the field.', verdict: 'Best for a quick kickabout.', how: 'Arrows or WASD to move, or touch and drag on the field. R runs, T throws, Space kicks off. Choose RUN or PASS, then stand on the gold X to catch. On a pass you have 2 seconds to reach the X, and the defence will hold you up on the way.', mount: mountBowl },
    { id: 'stack', title: 'Stained-Glass Blocks', blurb: 'Fit the falling panes into the window before it fills up.', verdict: 'Best for puzzle lovers.', how: 'Left and right to move, Up to turn a pane, Down to drop it faster. On a phone, drag on the window to slide a pane, tap to turn it, or use the buttons below.', mount: mountStack },
    { id: 'maze', title: 'Candle Maze', blurb: 'Light 110 candles to complete the vigil while four sins hunt you. Holy water turns the tables.', verdict: 'Best for steady nerves.', how: 'Arrows or WASD to steer, or swipe and drag on the field. Father walks on his own.', mount: mountMaze },
    { id: 'steeple', title: 'Steeple Stack', blurb: 'Stack the stones into the tallest steeple. Mind the wind after stone fifteen.', verdict: 'Best for patient builders.', how: 'Tap or press Space to drop a stone on the tower.', mount: mountSteeple },
    { id: 'dash', title: 'Sanctuary Dash', blurb: 'The golden cube never stops. Jump the thorns, ride the pews, and reach the sanctuary 9,200px down the nave.', verdict: 'Best for quick reflexes.', how: 'Space, Up, W, click or tap to jump. Hold to keep hopping.', mount: mountDash },
    { id: 'flee', title: 'Flee the Sins', blurb: 'Outrun the seven sins. Grab halos, dash with grace, and mind the confession bell.', verdict: 'Best for a chase.', how: 'Arrows to move, Space for a grace-dash. On a phone, drag on the floor to run, tap to dash.', mount: mountFlee },
    { id: 'cross', title: 'Father\u2019s Crossing', blurb: 'Cross the road and the river to reach the church doors before the bell.', verdict: 'Best for careful crossers.', how: 'Arrows or WASD to move, Space or Enter starts, or touch and hold the field to walk toward your finger. Follow the moth to the right door.', mount: mountCross },
    { id: 'pastor', title: 'Parish Pastor', blurb: 'Run the parish for 16 weeks. Balance the congregation, the funds, and everyone\u2019s happiness.', verdict: 'Best for planners.', how: 'Press 1, 2 or 3 to pick a choice each week, or click one. Space or Enter begins the season. Watch the ledger.', mount: mountPastor },
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

  function renderShelf() {
    if (currentCleanup) { currentCleanup(); currentCleanup = null; }
    setChatVisible(true);
    window.scrollTo(0, 0);
    root.innerHTML = '';
    var head = el('div', 'arcade-head');
    head.appendChild(el('h2', '', 'The Arcade'));
    head.appendChild(el('p', 'small', 'Eight little games. Best scores live only in your browser.'));
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
      var play = el('button', 'press', 'Play'); play.type = 'button';
      play.addEventListener('click', function () { openGame(g.id); });
      row.appendChild(play);
      card.appendChild(row);
      card.appendChild(el('p', 'meta', '<strong>' + esc(g.verdict) + '</strong> ' + esc(g.how)));
      shelf.appendChild(card);
    });
    if (!shelf.children.length) {
      shelf.appendChild(el('p', 'small', currentFilter === 'trophies' ? 'No trophies yet. Play a game to earn your first best score.' : 'You have played them all.'));
    }
    root.appendChild(head); root.appendChild(tools); root.appendChild(shelf);
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
  // Craggy Island vs St Swithin's. Four downs to gain ten yards, four quarters
  // of 45 seconds. Run it or pass it: on a pass, reach the gold X and hold
  // still to catch, then run it in — but you have 2 seconds to get to the
  // spot, and the defence holds you up on the way, so the catch is a fight,
  // not a free run. A touchdown is the yards gained plus a bonus.
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
  var BOWL_PASS_TIME_LIMIT = 2.0; // Seconds to reach the gold X once the
  // pass is thrown: get to the spot before the clock runs out, or the pass
  // fails. The countdown is on the scoreboard and the X. Once the receiver
  // reaches the X, the clock stops and the catch itself is the fight.
  var BOWL_IMPEDE_RADIUS = 36; // A defender this close holds the runner up
  // on a pass: the route to the X is a fight through bodies, not a free run.
  var BOWL_IMPEDE_SLOW = 0.4; // Runner's pace while held up.
  var PX_PER_YARD = (RUNGUN_START_Y - RUNGUN_END_Y) / 80; // 9.8
  var BOWL_CATCH_DWELL = 0.38; // Medium throw on Medium difficulty: hold
  // still briefly to catch. The catch itself is quick, because the
  // defence is right there — a clean, fast route to the spot completes
  // the catch, and the man on the receiver is on him the instant after,
  // so the catch buys position and then the runner has to beat the
  // tackle. The hold is long enough that a man closing from a step away
  // can break the catch up, so reaching the spot is not enough on its
  // own: the receiver has to arrive with the defender still a step off
  // him.
  // Catch window scales with the throw (Nov 10, Mikey: a further pass
  // needs more time to catch than a short one). Base dwells on Medium:
  // short 0.30s, medium 0.38s, deep 0.45s. Easy and Hard scale by the
  // same factor as the difficulty table, so a medium throw is still
  // 0.5s on Easy and 0.3s on Hard. startPlay sets catchDwell per throw
  // from this table; the catch fill ring reads catchDwell, so the
  // visible window scales with it automatically.
  var BOWL_CATCH_DWELL_SHORT = 0.30;
  var BOWL_CATCH_DWELL_DEEP = 0.45;
  var BOWL_CATCH_RADIUS = 26;
  var RUNGUN_TOUCHDOWN_BONUS = 100; // demo: yards + 100 points on a touchdown
  var BOWL_TACKLE_RADIUS = 20; // was 21: a tackle has to actually reach the runner
  var BOWL_BLOCK_RADIUS = 26; // a blocker this close to a defender ties him up
  var BOWL_BLOCK_SECONDS = 1.6; // how long a tied-up defender stays out of the play
  var BOWL_BLOCKER_SPEED = 150; // blockers run ahead at a steady clip, slower than Father Ted
  var BOWL_PLAY_MAX_SECONDS = 9; // whistle: no play runs forever, no stall at 0:00
  // Pass-defence convergence (Nov 9, third pass): Mikey played the live
  // Bowl again and the defence was still nowhere near the receiver on a
  // pass. Measured on the previous build, the nearest man was 61-74px
  // from the runner when he reached the X, and the catch mostly failed
  // during a long 0.7s hold while the defence closed from a distance —
  // it read as the catch being stolen, not contested. So the coverage
  // now holds its ground ON the receiver (a man on the spot 43-54px from
  // the X, a shadow 60-75px off the route) and breaks on him at full
  // pace the instant he reaches the X, and the hold scales with the
  // throw (short 0.30s, medium 0.38s, deep 0.50s on Medium). Measured
  // with a straight-line driver over 16 pass plays: the nearest man is
  // 49-63px away when the receiver reaches the X (median 54) and 22-24px
  // away at the catch (median 24), the simple run-to-the-X strategy
  // catches 4 of 16 and scores 0 touchdowns, and the run play is
  // untouched (about 10 yards a carry). The pass is a gamble now, not a
  // free score, and a defender is right there on it.
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
  // Passes were verified separately with exact coordinates: the catch
  // registers in 1.38s from the snap when the runner reaches the gold X
  // and holds still, so the pass game is intact.
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
  // is a home kit (Father Ted, Craggy Island) and an away kit (St Swithin's).
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
  function uniformPickerHtml(cur) {
    return '<div class="uniform-row" style="margin:0 0 14px;">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#6b5636;margin-bottom:6px;">Uniforms</div>' +
      BOWL_UNIFORMS.map(function (u) {
        var on = u.id === cur;
        return '<button type="button" class="press uniform-btn" data-uniform="' + u.id + '" aria-pressed="' + (on ? 'true' : 'false') + '" style="margin:0 4px;padding:7px 10px;' + (on ? 'background:#6e1a26;color:#f7ecd4;box-shadow:0 0 0 2px #b28a2e;' : '') + '">' +
          '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + u.home.bright + ';border:2px solid ' + u.home.ring + ';vertical-align:middle;"></span>' +
          '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + u.away.bright + ';border:2px solid ' + u.away.ring + ';vertical-align:middle;margin-left:5px;"></span>' +
          '<span style="margin-left:7px;vertical-align:middle;">' + u.name + '</span></button>';
      }).join('') + '</div>';
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
    var priestName = storeGet('rmf-parish-bowl-priest') || 'Father Ted';
    var diff = readDiff('rungun'); // Easy / Medium / Hard; Medium is the tuned default
    var uniform = readBowlUniform(); // kit choice, remembered in the browser
    var defLo = 100, defHi = 125, covLo = 110, covHi = 130, defBase = 3;
    var passLimit = BOWL_PASS_TIME_LIMIT, catchDwell = BOWL_CATCH_DWELL, oppChance = 0.5, waveSecs = BOWL_WAVE_SECONDS;
    var blockerChance = 0.35, blockerCount = 2; // how often blockers line up, and how many
    function applyBowlDiff() {
      // Easy: slower defence, more time on the catch, a kinder opponent —
      // and blockers always in front of you, so the easy game reads as the
      // friendly one. Hard: faster defence, less time, a sharper opponent,
      // and blockers are rare and only one man. Medium sits between.
      if (diff === 'easy') { defLo = 80; defHi = 100; covLo = 90; covHi = 105; defBase = 2; passLimit = 2.6; catchDwell = 0.5; oppChance = 0.35; waveSecs = 5; blockerChance = 1; blockerCount = 2; }
      else if (diff === 'hard') { defLo = 120; defHi = 150; covLo = 130; covHi = 155; defBase = 4; passLimit = 1.6; catchDwell = 0.3; oppChance = 0.65; waveSecs = 3; blockerChance = 0.2; blockerCount = 1; }
      else { defLo = 100; defHi = 125; covLo = 110; covHi = 130; defBase = 3; passLimit = BOWL_PASS_TIME_LIMIT; catchDwell = BOWL_CATCH_DWELL; oppChance = 0.5; waveSecs = BOWL_WAVE_SECONDS; blockerChance = 0.35; blockerCount = 2; }
    }
    applyBowlDiff();
    var parishName = storeGet('rmf-parish-bowl-parish') || 'Craggy Island';
    var opponent = 'St Swithin\u2019s';
    var state = 'ready'; // ready | choose | run | pass | result | over
    var customizing = false; // the name screen is up: keyboard play must not fire while it is
    var paused = false;
    var quarter = 1, clock = RUNGUN_QUARTER_SECONDS;
    var score = 0, best = readBest('rungun'), tds = 0, oppTds = 0;
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
    var passTarget = null, catchT = 0, caught = false, hasBall = false, freezeT = 0;
  var passTimeLeft = 0, impeded = false, reachedX = false; // countdown to the catch spot; held-up flag; reached the X
  var passRoute = null; // what kind of throw this is (depth + direction), for the HUD
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
          if (Math.hypot(cand.x - px, cand.y - py) < 100) continue;
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
      var MAX_REACH = passLimit * 160;
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
    // he arrives. Once he reaches the X they break on him at full pace,
    // so the hold to catch is a real fight. The shadow sits wide of the
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
        { x: passTarget.x + perpX * offMan, y: passTarget.y + perpY * offMan },
      ];
      spots.forEach(function (s) {
        var x = clamp(s.x, 40, GAME_W - 40);
        var y = clamp(s.y, RUNGUN_END_Y + 10, RUNGUN_START_Y - 20);
        if (Math.hypot(x - px, y - py) < 45) return;
        if (Math.hypot(x - passTarget.x, y - passTarget.y) < 35) return;
        defenders.push({ x: x, y: y, speed: rand(covLo, covHi), heading: Math.atan2(py - y, px - x), cover: true, hx: x, hy: y, lane: x, aggr: rand(0.9, 1.1), laneGive: rand(0.3, 0.5), laneWidth: rand(40, 55), breakDelay: rand(0, 0.05) });
      });
    }
    function startPlay(kind) {
      if (paused) doResume();
      playStartYards = yardsToGo();
      playStartPy = py;
      playT = 0;
      caught = false; catchT = 0; freezeT = 0;
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
      spawnDefenders(defenderCount(), true, true, kind === 'pass' ? [maxReach + 35, maxReach + 155] : [110, 195]);
      // Blockers (Nov 10, Mikey: every once in a while, two men in front
      // of you to clear a lane — on Easy they are always there). A blocker
      // runs ahead of Father Ted and ties up the nearest defender in his
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
        // Catch window scales with the throw: a further pass gives the
        // receiver a longer hold at the catch spot than a short one.
        // Base dwells are the Medium values; Easy and Hard scale by the
        // same factor as the difficulty table, so a medium throw is still
        // 0.5s on Easy and 0.3s on Hard. The catch fill ring and the
        // countdown read catchDwell, so the visible window scales too.
        var dwellBase = passRoute.kind === 'Short' ? BOWL_CATCH_DWELL_SHORT : passRoute.kind === 'Deep' ? BOWL_CATCH_DWELL_DEEP : BOWL_CATCH_DWELL;
        var dwellFactor = diff === 'easy' ? 0.5 / BOWL_CATCH_DWELL : diff === 'hard' ? 0.3 / BOWL_CATCH_DWELL : 1;
        catchDwell = dwellBase * dwellFactor;
        passTimeLeft = passLimit;
        impeded = false; reachedX = false;
        hasBall = false;
        state = 'pass';
      } else {
        passTarget = null; passRoute = null;
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
      drivePlays += 1;
      // Floating "+N yards" above the runner when the play ends, so the
      // gain reads on the field as well as in the result slab. Display only:
      // it does not touch the play, the pass, or the score.
      if (playYards > 0) { popYards = playYards; popT = 1.4; }
      var note = '';
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
            py = RUNGUN_START_Y; px = GAME_W / 2;
            down = 1; seriesStart = 80; seriesGain = 0;
            drivePlays = 0; driveYards = 0; qTurnover = true;
          }
        }
      }
      resultMain = main; resultSub = sub + note;
      resultT = 1.6; state = 'result';
      coachLine = main + ' ' + sub + note;
      updateHud();
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
        var halfYards = Math.max(0, score - tds * RUNGUN_TOUCHDOWN_BONUS);
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
      best = finalBest;
      var yardsGained = Math.max(0, score - tds * RUNGUN_TOUCHDOWN_BONUS);
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
      quarter = 1; clock = RUNGUN_QUARTER_SECONDS; score = 0; tds = 0; oppTds = 0;
      bestPlay = 0; drivePlays = 0; driveYards = 0; popYards = 0; popT = 0;
      qTurnover = false; qScored = false;
      px = GAME_W / 2; py = RUNGUN_START_Y; timeGoneShown = false;
      down = 1; seriesStart = 80; seriesGain = 0;
      coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
      defenders = []; blockers = []; passTarget = null; caught = false; hasBall = false; freezeT = 0; playT = 0;
      state = 'choose'; showChoose();
    }
    // ---- designed overlay card: parchment panel, burgundy frame, gold rule ----
    function bowlCard(eyebrow, title, body, extra) {
      return '<div style="background:' + BOWL_PARCHMENT + ';border:3px solid ' + BOWL_BURGUNDY + ';border-radius:16px;padding:24px 22px 20px;max-width:430px;margin:0 auto;text-align:center;box-shadow:0 14px 34px rgba(20,8,6,.45);color:' + BOWL_INK + ';font-family:Georgia,serif;">' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:.34em;text-transform:uppercase;color:' + BOWL_BURGUNDY_BRIGHT + '">' + eyebrow + '</div>' +
        '<div style="font-size:32px;font-weight:700;line-height:1.05;margin:10px 0 2px;letter-spacing:.01em;">' + title + '</div>' +
        '<div style="width:64px;height:3px;background:' + BOWL_GOLD + ';margin:12px auto;"></div>' +
        body + (extra || '') + '</div>';
    }
    function bowlBtn(id, label) {
      return '<button type="button" class="big-btn press" id="' + id + '" style="background:' + BOWL_BURGUNDY + ';color:' + BOWL_PARCHMENT + ';letter-spacing:.14em;text-transform:uppercase;">' + label + '</button>';
    }
    // A key shown on the button itself, so a keyboard player sees at a
    // glance which key picks it — no hunting through the fine print.
    function keyChip(key) {
      return '<span style="display:inline-block;min-width:20px;padding:2px 7px;margin-left:10px;border:1.5px solid rgba(255,244,214,.7);border-radius:5px;font-size:11px;font-weight:700;letter-spacing:.08em;vertical-align:2px;">' + key + '</span>';
    }
    // One line under a big button, naming the keyboard way to press it.
    function keyHint(text) {
      return '<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#6b5636;">' + text + '</p>';
    }
    function showStart() {
      state = 'ready';
      customizing = false;
      api.showOverlay(bowlCard(esc(parishName) + ' vs ' + esc(opponent), 'The Parish Bowl',
        '<p style="margin:0 0 6px;font-size:15px;line-height:1.45;">Four quarters of 45 seconds. Run or pass your way down the field — four downs to gain ten yards, and a touchdown is worth the yards plus a hundred. St Swithin\u2019s drive after every quarter. Every once in a while two blockers line up in front of you to clear a lane — on Easy they are always there.</p>' +
        '<p style="margin:0 0 16px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b5636;">' + gameMark('rungun') + '</p>',
        diffPickerHtml('rungun', diff) +
        uniformPickerHtml(uniform.id) +
        bowlBtn('bowl-kickoff', 'Kick off for ' + esc(parishName)) +
        keyHint('Keyboard: Space or Enter kicks off · R runs, T throws.') +
        '<button type="button" class="linklike" id="bowl-custom">Play as your home parish priest</button>'));
      wireDiffButtons(api.overlay, 'rungun', function () { return diff; }, function (d) { diff = d; writeDiff('rungun', d); applyBowlDiff(); });
      wireUniformButtons(api.overlay, function () { return uniform.id; }, function (u) { uniform = bowlUniform(u); storeSet('rmf-parish-bowl-uniform', u); });
      var kick = document.getElementById('bowl-kickoff');
      if (kick) kick.addEventListener('click', function () { state = 'choose'; showChoose(); });
      var custom = document.getElementById('bowl-custom');
      if (custom) custom.addEventListener('click', showCustomize);
      updateHud();
    }
    function showCustomize() {
      customizing = true;
      api.showOverlay(bowlCard('Your home parish priest', 'Who\u2019s carrying it?',
        '<p style="margin:0 0 14px;font-size:14px;line-height:1.45;">Your priest and parish run through the game: the scoreboard, the coach, and the results.</p>' +
        '<label style="display:block;text-align:left;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;margin-bottom:12px;">Priest name<input id="rungun-priest-name" placeholder="Father Ted" value="' + esc(storeGet('rmf-parish-bowl-priest') || '') + '" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px 12px;border:2px solid ' + BOWL_BURGUNDY + ';border-radius:8px;background:#fff;font-family:Georgia,serif;font-size:15px;letter-spacing:0;text-transform:none;font-weight:400;"></label>' +
        '<label style="display:block;text-align:left;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;margin-bottom:16px;">Parish name<input id="rungun-parish-name" placeholder="St Patrick\u2019s" value="' + esc(storeGet('rmf-parish-bowl-parish') || '') + '" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px 12px;border:2px solid ' + BOWL_BURGUNDY + ';border-radius:8px;background:#fff;font-family:Georgia,serif;font-size:15px;letter-spacing:0;text-transform:none;font-weight:400;"></label>',
        '<button type="button" class="big-btn press" id="bowl-save-names" style="background:' + BOWL_BURGUNDY + ';color:' + BOWL_PARCHMENT + ';letter-spacing:.14em;text-transform:uppercase;">Save</button>' +
        '<button type="button" class="linklike" id="bowl-forget-names">Forget my names</button>' +
        '<button type="button" class="linklike" id="bowl-custom-back">Back</button>'));
      var save = document.getElementById('bowl-save-names');
      if (save) save.addEventListener('click', function () {
        var pn = (document.getElementById('rungun-priest-name').value || '').trim();
        var pp = (document.getElementById('rungun-parish-name').value || '').trim();
        if (pn) storeSet('rmf-parish-bowl-priest', pn); else storeDel('rmf-parish-bowl-priest');
        if (pp) storeSet('rmf-parish-bowl-parish', pp); else storeDel('rmf-parish-bowl-parish');
        priestName = pn || 'Father Ted';
        parishName = pp || 'Craggy Island';
        coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
        showStart();
      });
      var forget = document.getElementById('bowl-forget-names');
      if (forget) forget.addEventListener('click', function () {
        storeDel('rmf-parish-bowl-priest'); storeDel('rmf-parish-bowl-parish');
        priestName = 'Father Ted'; parishName = 'Craggy Island';
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
        '<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#6b5636;">Clock stops while you choose. Pass: you have ' + passLimit.toFixed(1) + ' seconds to reach the gold X, and the defence will hold you up on the way, so beat them to the spot and hold still to catch, then run it in. A tackle before the catch is pass interference — +10 yards and a first down. The clock running out is incomplete. Keys: R runs, T throws.</p>'));
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
      // and a man is right there when the receiver reaches the spot. Once
      // he reaches the X the coverage breaks on him at full pace, so the
      // hold to catch is a fight. The runner is still the faster man in
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
        // Coverage men on a pass hold their ground until the receiver
        // reaches the X, then break on him at full pace. Holding means the
        // receiver can actually reach the spot instead of being run down
        // on the way, and breaking means a man is right on him for the
        // catch itself — the contest is at the X, not on the route.
        if (state === 'pass' && !caught && d.cover && !reachedX && d.hx !== undefined) {
          if (Math.hypot(d.hx - d.x, d.hy - d.y) < 12) return; // holding: stay put
        }
        var chase = (state === 'pass' && !caught) ? (d.cover ? ((reachedX && catchT >= (d.breakDelay || 0)) ? 1 : 0.75) : 0.6) : 1;
        // Lead pursuit: aim at where the runner will be in a third of a
        // second, not where he is, so the defence cuts off the run instead
        // of trailing a faster man. A sharp cut still beats it, because
        // the defender commits to the lead point and turns slowly.
        // A holding coverage man drifts back to his spot instead.
        var tx = px + pvx * 0.3, ty = py + pvy * 0.3;
        if (state === 'pass' && !caught && d.cover && !reachedX && d.hx !== undefined) { tx = d.hx; ty = d.hy; }
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
          ty = d.y;
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
          tx = clamp(px + pvx * 0.3, d.lane - 70, d.lane + 70);
          ty = py + pvy * 0.3;
        }
        var want = Math.atan2(ty - d.y, tx - d.x);
        var diff = want - d.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        d.heading += clamp(diff, -BOWL_TURN_RATE * dt, BOWL_TURN_RATE * dt);
        var sp = d.speed * chase * goalBoost * (d.aggr || 1);
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
          var dist = Math.hypot(passTarget.x - px, passTarget.y - py);
          if (dist <= BOWL_CATCH_RADIUS) {
            reachedX = true; // made the spot: the clock stops, the catch is the fight now
            catchT += dt;
            if (catchT >= catchDwell) {
              caught = true; hasBall = true; freezeT = RUNGUN_PASS_STUN_SECONDS;
              api.showBanner('Caught!', 1600);
              state = 'run'; // carry on running with the ball
            }
          } else {
            // Demo catch: standing off the mark lets the catch slip away
            // gradually instead of resetting it to zero in one frame.
            catchT = Math.max(0, catchT - dt);
          }
        }
        // The clock on the catch spot: once the pass is thrown, the receiver
        // has a few seconds to reach the X. If the defence holds him up
        // until the clock runs out, the pass fails. Once he reaches the X,
        // the clock stops and the catch itself is the fight.
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
    function draw() {
      var ctx = api.ctx;
      updateCam();
      // Field: a soft vertical gradient over the mown stripes, so the pitch
      // reads as a lit surface, not a flat green board. Stripes stay subtle.
      var fieldGrad = ctx.createLinearGradient(0, 0, 0, GAME_H);
      fieldGrad.addColorStop(0, '#21543a');
      fieldGrad.addColorStop(1, '#1a4230');
      ctx.fillStyle = fieldGrad; ctx.fillRect(0, 0, GAME_W, GAME_H);
      for (var band = 0; band < 10; band++) {
        ctx.fillStyle = band % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
        ctx.fillRect(0, screenY(RUNGUN_END_Y + band * 78.4), GAME_W, 79.4);
      }
      // A soft light from above, fading toward the goal, for depth.
      var light = ctx.createLinearGradient(0, 0, 0, GAME_H);
      light.addColorStop(0, 'rgba(255,246,220,0.10)');
      light.addColorStop(0.5, 'rgba(255,246,220,0.0)');
      light.addColorStop(1, 'rgba(0,0,0,0.10)');
      ctx.fillStyle = light; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.strokeStyle = 'rgba(255,255,255,0.38)'; ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.font = '11px Georgia';
      for (var y = 10; y <= 80; y += 10) {
        var fy = screenY(RUNGUN_END_Y + y * PX_PER_YARD);
        ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(GAME_W, fy); ctx.stroke();
        ctx.fillText(String(80 - y), 8, fy - 5);
      }
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
      if (state === 'pass' && passTarget && !caught) {
        var tx = passTarget.x, ty = screenY(passTarget.y);
        var halo = ctx.createRadialGradient(tx, ty, 4, tx, ty, BOWL_CATCH_RADIUS + 14);
        halo.addColorStop(0, 'rgba(178,138,46,0.34)');
        halo.addColorStop(1, 'rgba(178,138,46,0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(tx, ty, BOWL_CATCH_RADIUS + 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(178,138,46,0.22)';
        ctx.beginPath(); ctx.arc(tx, ty, BOWL_CATCH_RADIUS, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = BOWL_GOLD; ctx.lineWidth = 4; ctx.lineCap = 'round';
        var s = 10;
        ctx.beginPath();
        ctx.moveTo(tx - s, ty - s); ctx.lineTo(tx + s, ty + s);
        ctx.moveTo(tx + s, ty - s); ctx.lineTo(tx - s, ty + s);
        ctx.stroke();
        ctx.fillStyle = BOWL_GOLD_BRIGHT; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('CATCH HERE', tx, ty - 22);
        ctx.textAlign = 'left';
        if (catchT > 0) {
          ctx.fillStyle = 'rgba(217,180,90,0.55)';
          ctx.beginPath(); ctx.arc(tx, ty, BOWL_CATCH_RADIUS * (catchT / catchDwell), 0, Math.PI * 2); ctx.fill();
        }
        // Countdown ring: the time left to reach the X, shrinking as it
        // runs out, red in the last second. The seconds sit under it. Once
        // the receiver reaches the X the ring is gone and the catch fill
        // shows the hold instead.
        if (!reachedX) {
          var frac = Math.max(0, passTimeLeft / passLimit);
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
      // Blockers: home-kit discs with a B, a beat smaller than Father Ted,
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
        ctx.fillText('Paused \u2014 press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
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
    makeDpad(api.stage, function (dx, dy, active) {
      if (active) { dpadVec.x = dx; dpadVec.y = dy; } else { dpadVec.x = 0; dpadVec.y = 0; }
    });
    // Direct touch on the field: touch and drag, and the player runs toward
    // your finger; drag to the gold X and hold still there to catch a pass.
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
      }
    }
    document.addEventListener('keydown', onBowlKey);
    api.actions.appendChild(el('p', 'game-note', 'Arrows or WASD to move. Space or Enter kicks off, continues and plays again. R runs, T throws, P or Esc pauses. The clock stops while you choose a play. Four downs to gain ten yards. On a pass, reach the gold X before the clock runs out, and defenders in your face slow you down, so beat them to the spot and hold still to catch. Every once in a while two blockers line up in front of you to clear a lane; on Easy they are always there. On a phone, touch and drag on the field to run; drag to the gold X and hold still to catch.'));
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
  var STACK_COLORS = { I: '#3a6ea5', O: '#b28a2e', T: '#5b2a4a', S: '#2e5e4e', Z: '#b8452a', J: '#3a6ea5', L: '#8a6d3b' };
  var STACK_POINTS = [0, 100, 300, 500, 800];
  function mountStack(parent, onBack) {
    var api = createStage(parent, { title: 'Stained-Glass Blocks', onBack: onBack });
    var COLS = 10, ROWS = 20, CELL = 15, OX = (GAME_W - COLS * CELL) / 2, OY = 10;
    var grid = [], bag = [], cur = null, score = 0, lines = 0, level = 1, combo = 0;
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
    function resetGrid() { grid = []; for (var y = 0; y < ROWS; y++) { grid.push(new Array(COLS).fill(null)); } }
    function refillBag() {
      bag = Object.keys(STACK_SHAPES).slice();
      for (var i = bag.length - 1; i > 0; i--) { var j = randInt(0, i); var t = bag[i]; bag[i] = bag[j]; bag[j] = t; }
    }
    function spawn(fromHold) {
      if (!bag.length) refillBag();
      var type = bag.pop();
      cur = { type: type, shape: STACK_SHAPES[type].map(function (r) { return r.slice(); }), x: 3, y: 0 };
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
      var cleared = 0;
      for (var y = ROWS - 1; y >= 0; y--) {
        if (grid[y].every(Boolean)) { grid.splice(y, 1); grid.unshift(new Array(COLS).fill(null)); cleared++; y++; }
      }
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
        if (level > oldLevel) setTimeout(function () { api.showBanner('Level ' + level + ' — the panes fall faster', 1500); }, 1300);
      } else combo = 0;
      updateHud();
      spawn();
    }
    function ghostY() { var y = cur.y; while (!collides(cur.shape, cur.x, y + 1)) y++; return y; }
    function gameOver() {
      state = 'over';
      var fb = writeBest('stack', score); best = fb;
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
      resetGrid(); bag = []; held = null; canHold = true; score = 0; lines = 0; level = 1; combo = 0; dropT = 0;
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
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#1d1712'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(OX - 4, OY - 4, COLS * CELL + 8, ROWS * CELL + 8);
      ctx.strokeStyle = '#33261a'; ctx.lineWidth = 2;
      ctx.strokeRect(OX - 4, OY - 4, COLS * CELL + 8, ROWS * CELL + 8);
      for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
        if (grid[y][x]) drawCell(x, y, STACK_COLORS[grid[y][x]]);
      }
      if (cur && state === 'playing') {
        var gy = ghostY();
        cur.shape.forEach(function (row, r) { row.forEach(function (v, c) { if (v) drawCell(cur.x + c, gy + r, STACK_COLORS[cur.type], true); }); });
        cur.shape.forEach(function (row, r) { row.forEach(function (v, c) { if (v) drawCell(cur.x + c, cur.y + r, STACK_COLORS[cur.type]); }); });
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
      var next2Type = bag.length > 1 ? bag[bag.length - 2] : null;
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
        ctx.fillText('Paused — press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      dropT += dt;
      var interval = Math.max(0.08, dropBase - (level - 1) * dropStep);
      if (dropT >= interval) {
        dropT = 0;
        if (!collides(cur.shape, cur.x, cur.y + 1)) cur.y++;
        else lock();
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
    function moveLeft() { if (state === 'playing' && !paused && !collides(cur.shape, cur.x - 1, cur.y)) cur.x--; }
    function moveRight() { if (state === 'playing' && !paused && !collides(cur.shape, cur.x + 1, cur.y)) cur.x++; }
    function rotateCur() {
      if (state !== 'playing' || paused) return;
      var r = rotate(cur.shape);
      // Wall kicks: a turn against the wall or a stack tries a nudge left,
      // right, then further out, before refusing — so turning never silently
      // does nothing when there is room beside the pane.
      var kicks = [0, -1, 1, -2, 2];
      for (var i = 0; i < kicks.length; i++) {
        if (!collides(r, cur.x + kicks[i], cur.y)) { cur.x += kicks[i]; cur.shape = r; return; }
      }
    }
    function softDrop() { if (state !== 'playing' || paused) return; if (!collides(cur.shape, cur.x, cur.y + 1)) { cur.y++; score += 1; updateHud(); } else lock(); }
    function slam() { if (state !== 'playing' || paused) return; while (!collides(cur.shape, cur.x, cur.y + 1)) cur.y++; lock(); }
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
      var col = Math.floor((pt.x - OX) / CELL);
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
    api.actions.appendChild(el('p', 'game-note', 'Space or Enter starts and plays again. Left and right to move, Up to turn, Down to drop faster, Space to slam it down, C to hold a pane for later. On touch, drag on the window to slide a pane, tap to turn it, or use the buttons below.'));
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
  function mountSteeple(parent, onBack) {
    var api = createStage(parent, { title: 'Steeple Stack', onBack: onBack });
    var tower = [], moving = null, wind = 0, score = 0, best = readBest('steeple');
    var state = 'ready', paused = false, raf = 0, last = 0, destroyed = false;
    var camOff = 0; // the view scrolls down as the tower grows, so the top stays in reach and the wind (stone fifteen) is reachable at all
    var perfectT = 0; // seconds left to show the Perfect flash after a clean drop
    var perfectStreak = 0; // consecutive perfect drops; the bonus grows with it
    var BASE_W = 120, BASE_Y = GAME_H - 20;
    var diff = readDiff('steeple'); // Easy / Medium / Hard; Medium is the tuned default
    var stoneBase = 115, stonePer = 6, windFrom = 15, windMag = 40, graceTopple = 3, graceWidth = 5;
    function applySteepleDiff() {
      // Easy: the stone swings slower, the wind comes later and gentler,
      // and the first stones forgive a miss. Hard: faster swing, early
      // wind, less forgiveness. Medium is the current game.
      if (diff === 'easy') { stoneBase = 90; stonePer = 4; windFrom = 20; windMag = 20; graceTopple = 5; graceWidth = 8; }
      else if (diff === 'hard') { stoneBase = 140; stonePer = 8; windFrom = 10; windMag = 60; graceTopple = 2; graceWidth = 3; }
      else { stoneBase = 115; stonePer = 6; windFrom = 15; windMag = 40; graceTopple = 3; graceWidth = 5; }
    }
    applySteepleDiff();
    function newStone() {
      var w = tower.length ? tower[tower.length - 1].w : BASE_W;
      moving = { x: -w / 2, w: w, dir: 1, speed: stoneBase + tower.length * stonePer };
    }
    function startGame() {
      applySteepleDiff();
      tower = []; score = 0; wind = 0; camOff = 0; state = 'playing';
      api.hideOverlay(); newStone(); updateHud();
    }
    function drop() {
      if (state !== 'playing' || !moving) return;
      var top = tower.length ? tower[tower.length - 1] : { x: (GAME_W - BASE_W) / 2, w: BASE_W, y: BASE_Y };
      var left = Math.max(moving.x, top.x), right = Math.min(moving.x + moving.w, top.x + top.w);
      var overlap = right - left;
      if (overlap <= 0) {
        // Early grace: the first three stones are for learning the swing.
        // A clean miss that early just drops the stone and lets the player
        // try again instead of ending the run before it has begun.
        if (tower.length < graceTopple) { api.showBanner('Missed \u2014 try again', 1400); newStone(); return; }
        gameOver(); return;
      }
      var perfect = overlap / top.w > 0.9;
      // Early forgiveness: the first five stones keep the full width of the
      // tower below and settle squarely on it, so a new player can build a
      // base instead of the tower narrowing to a sliver on one sloppy drop.
      // After five stones the overhang is cut, as usual.
      var stone;
      if (tower.length < graceWidth) {
        stone = { x: top.x, w: top.w, y: top.y - 18 };
      } else {
        stone = { x: left, w: overlap, y: top.y - 18 };
      }
      tower.push(stone);
      score += 1;
      // Scroll the view: keep the tower top near the same place on screen,
      // so a tall tower never runs into the moving stone and the game can
      // go past the dozen stones the fixed view used to allow.
      camOff = Math.max(0, 18 * tower.length - 160);
      // Height milestones: every fifth stone pays a bonus and says so, so
      // steady building is rewarded, not only perfect drops.
      if (tower.length % 5 === 0) { score += 25; api.showBanner(tower.length + ' stones — the steeple rises! +25', 1400); }
      // A run of perfect drops is worth more than one alone: the streak
      // grows the bonus, so a steady hand is rewarded for staying steady.
      if (perfect) { perfectStreak += 1; score += 10 + 5 * (perfectStreak - 1); perfectT = 1.2; }
      else perfectStreak = 0;
      if (tower.length % 10 === 0) score += 100;
      if (tower.length >= windFrom) wind = (Math.random() - 0.5) * windMag;
      updateHud();
      newStone();
    }
    function gameOver() {
      state = 'over';
      var fb = writeBest('steeple', score); best = fb;
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
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = '#2e5e4e'; ctx.fillRect(0, GAME_H - 14 + camOff, GAME_W, 14);
      ctx.fillStyle = '#6e1a26';
      ctx.fillRect((GAME_W - BASE_W) / 2, BASE_Y + camOff, BASE_W, 14);
      tower.forEach(function (s, i) {
        ctx.fillStyle = ['#6e1a26', '#b28a2e', '#2e5e4e', '#3a6ea5', '#8a6d3b'][i % 5];
        ctx.fillRect(s.x, s.y + camOff, s.w, 18);
        ctx.strokeStyle = '#33261a'; ctx.strokeRect(s.x, s.y + camOff, s.w, 18);
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
        var gPerfect = (gRight - gLeft) / topW > 0.9;
        ctx.strokeStyle = gPerfect ? 'rgba(46,125,50,0.9)' : 'rgba(178,138,46,0.55)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(moving.x, topY - 18, moving.w, 18);
        ctx.beginPath(); ctx.moveTo(moving.x + moving.w / 2, 48); ctx.lineTo(moving.x + moving.w / 2, topY - 18); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#6f6259'; ctx.font = '12px Georgia';
        ctx.fillText('Tap or press Space to drop', 12, 20);
      }
      if (perfectT > 0) {
        ctx.globalAlpha = Math.min(1, perfectT);
        ctx.fillStyle = '#b28a2e'; ctx.font = 'bold 18px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(perfectStreak > 1 ? 'Perfect x' + perfectStreak + '!' : 'Perfect! +10', GAME_W / 2, 90); ctx.textAlign = 'left';
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
        ctx.fillText('Paused — press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing' || !moving) return;
      if (perfectT > 0) perfectT = Math.max(0, perfectT - dt);
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
    api.actions.appendChild(el('p', 'game-note', 'Tap the field or press Space to drop the stone. Space or Enter starts and builds again. The wind picks up once the tower grows tall.'));
    api.showOverlay('<h3>Steeple Stack</h3><p>Drop each stone squarely on the last. Miss the tower and it topples. ' + gameMark('steeple') + '</p>' +
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
  // fastest sin at 55), so a player who keeps moving and reads the field
  // can stay ahead of the pack. The sins also start slow: a 4-second
  // warmup at a third of their speed, so a player who needs a beat to
  // read the field is not dead before they have moved.
  // Patrollers walk this loop around the sanctuary edge: four waypoints
  // near the corners, in order, so two patrollers on different offsets
  // never stack on each other.
  var FLEE_PATROL = [[40, 40], [440, 40], [440, 280], [40, 280]];
  var FLEE_SINS = [
    { name: 'Pride', speed: 46, color: '#5b2a4a', hunt: 'lead' }, { name: 'Greed', speed: 52, color: '#b28a2e', hunt: 'patrol' },
    { name: 'Lust', speed: 46, color: '#b8452a', hunt: 'chase' }, { name: 'Envy', speed: 44, color: '#2e5e4e', hunt: 'flank' },
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
      else { sinMult = 1; bellFirst = 30; bellEvery = 60; warmupSecs = 6; releaseSchedule = [0, 0, 0, 12, 20, 30, 40]; }
    }
    applyFleeDiff();
    var nearCd = 0; // near-miss bonus cooldown
    var rings = []; // halo pickup rings: gold circles that bloom and fade
    var prevPx = px, prevPy = py, pvx = 0, pvy = 0;
    var state = 'ready', paused = false, raf = 0, last = 0, destroyed = false;
    var keys = makeKeys();
    var dpadVec = { x: 0, y: 0 };
    function startGame() {
      applyFleeDiff();
      px = GAME_W / 2; py = GAME_H / 2; score = 0; elapsed = 0; bellT = bellFirst; warmupT = warmupSecs;
      bellCount = 0; nearCd = 0;
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
          // Staggered release: only three sins hunt at first, a new one joins
          // every twelve seconds. A casual player gets a real chance to learn
          // the arena before all seven are closing in at once.
          releaseAt: releaseSchedule[i] || 0, announced: false };
      });
      halos.push({ x: px + 70, y: py - 50 }); spawnHalo(); spawnHalo();
      state = 'playing'; api.hideOverlay(); updateHud();
    }
    function spawnHalo() { halos.push({ x: rand(30, GAME_W - 30), y: rand(30, GAME_H - 30) }); }
    function gameOver() {
      state = 'over';
      var finalScore = Math.floor(score);
      var fb = writeBest('flee', finalScore); best = fb;
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
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('F', px, py + 4); ctx.textAlign = 'left';
      if (dashCd > 0) {
        ctx.fillStyle = '#fffdf7'; ctx.font = '11px Georgia';
        ctx.fillText('Dash ready in ' + Math.ceil(dashCd) + 's', 12, 20);
      } else if (state === 'playing') {
        // Dash is ready: say so at a glance, so the player knows the
        // grace-dash is available without having to remember the cooldown.
        ctx.fillStyle = '#b28a2e'; ctx.font = 'bold 11px Georgia';
        ctx.fillText('Dash ready — Space', 12, 20);
      }
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('Paused — press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
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
      var ax = keys.axis();
      var dx = ax.x + dpadVec.x, dy = ax.y + dpadVec.y;
      // Direct touch: run toward the finger while it is on the floor.
      if (fleeTouch) {
        var fdx = fleeTouch.x - px, fdy = fleeTouch.y - py;
        var fl = Math.hypot(fdx, fdy);
        if (fl > 12) { dx += fdx / fl; dy += fdy / fl; }
      }
      var len = Math.hypot(dx, dy);
      if (len > 0) { dx /= len; dy /= len; }
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
        if (s.hunt === 'lead') { tx = px + pvx * 0.25; ty = py + pvy * 0.25; }
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
          halos.splice(i, 1); score += 25; spawnHalo(); updateHud();
        }
      }
      if (dashT <= 0) {
        for (var j = 0; j < sins.length; j++) {
          if (elapsed < sins[j].releaseAt) continue;
          var d = Math.hypot(sins[j].x - px, sins[j].y - py);
          if (d < 20) { gameOver(); return; }
          // A near miss pays: brushing past a sin without being caught is
          // worth a little, so daring play beats circling at arm's length.
          if (d < 34 && nearCd <= 0) { nearCd = 2.5; score += 5; api.showBanner('Close call! +5', 900); }
        }
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
    makeDpad(api.stage, function (dx, dy, active) {
      if (active) { dpadVec.x = dx; dpadVec.y = dy; } else { dpadVec.x = 0; dpadVec.y = 0; }
    });
    var dashBtn = el('button', 'press', 'Grace-dash (Space)'); dashBtn.type = 'button';
    dashBtn.addEventListener('click', function () {
      if (state === 'playing' && !paused && dashCd <= 0) { dashT = 0.45; dashCd = 2; }
    });
    api.actions.appendChild(dashBtn);
    api.actions.appendChild(el('p', 'game-note', 'Halos are +25. Space dashes through the sins. Space or Enter starts and runs again. The bell rings and drives the sins back \u2014 survive until it rings. On touch, drag on the floor to run, tap to dash.'));
    api.showOverlay('<h3>Flee the Sins</h3><p>Seven sins are chasing you. Grab halos, dash with grace, and survive until the bell rings \u2014 it drives the sins back. ' + gameMark('flee') + '</p>' +
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
  function mountCross(parent, onBack) {
    var api = createStage(parent, { title: 'Father\u2019s Crossing', onBack: onBack });
    var LANE_Y = [258, 226, 194, 162, 130];
    var RIVER_TOP = 44, RIVER_BOT = 118;
    var DOOR_X = [48, 144, 240, 336, 432];
    var px = GAME_W / 2, py = GAME_H - 18, lives = 3, score = 0, level = 1, best = readBest('cross'), bestPy = GAME_H - 18;
    var cars = [], floats = [], mothDoor = 0, bellT = 60;
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
        var speed = (45 + level * 10) * carMult * (0.8 + Math.random() * 0.5);
        var n = level === 1 ? carBase : carBase + Math.floor(Math.random() * 2);
        for (var k = 0; k < n; k++) {
          // Each car keeps its own pace, so the gaps open and close instead
          // of the whole lane rolling along as one block.
          cars.push({ y: y, x: rand(0, GAME_W), dir: dir, speed: speed * (0.85 + Math.random() * 0.35), w: rand(34, 52) });
        }
      });
      floats = [];
      for (var r = 0; r < 3; r++) {
        var y = RIVER_TOP + 14 + r * 26;
        var dir2 = r % 2 === 0 ? 1 : -1;
        var n2 = 3;
        for (var k2 = 0; k2 < n2; k2++) {
          floats.push({ y: y, x: rand(0, GAME_W), dir: dir2, speed: (45 + level * 6) * floatMult, w: rand(52, 84), kind: k2 === 1 ? 'turtle' : 'log',
            diveCd: 3 + Math.random() * 3, diving: 0 }); // turtles dive now and then; logs never do
        }
      }
      mothDoor = randInt(0, 4);
    }
    function startGame() {
      applyCrossDiff();
      px = GAME_W / 2; py = GAME_H - 18; lives = livesStart; score = 0; level = 1; bellT = bellStart;
      buildLevel(); state = 'playing'; api.hideOverlay(); updateHud();
    }
    function resetSpot() { px = GAME_W / 2; py = GAME_H - 18; bestPy = GAME_H - 18; }
    function loseLife(why) {
      lives -= 1; updateHud();
      if (lives <= 0) { gameOver(why); return; }
      api.showBanner(why + ' — ' + lives + (lives === 1 ? ' life' : ' lives') + ' left', 1500);
      resetSpot();
    }
    function gameOver(why) {
      state = 'over';
      var fb = writeBest('cross', score); best = fb;
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
      // Player
      ctx.fillStyle = '#6e1a26';
      ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('F', px, py + 4); ctx.textAlign = 'left';
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('Paused — press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function onRiver() { return py > RIVER_TOP && py < RIVER_BOT; }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      bellT -= dt;
      if (bellT <= 0) { gameOver('The bell rang — out of time'); return; }
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
      // Doors
      if (py <= 40) {
        var nearest = 0, bestD = 1e9;
        DOOR_X.forEach(function (x, idx) { var d = Math.abs(px - x); if (d < bestD) { bestD = d; nearest = idx; } });
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
    makeDpad(api.stage, function (dx, dy, active) {
      if (active) { dpadVec.x = dx; dpadVec.y = dy; } else { dpadVec.x = 0; dpadVec.y = 0; }
    });
    api.actions.appendChild(el('p', 'game-note', 'Arrows or WASD to move. Space or Enter starts and crosses again. Cross the road, ride the logs and turtles, and enter the door the moth circles before the bell. Turtles dive now and then — do not trust one to stay up. On touch, hold the field to walk toward your finger.'));
    api.showOverlay('<h3>Father\u2019s Crossing</h3><p>Five lanes of traffic, a river, and five church doors. Every step forward is +10. Follow the moth to the right door. ' + gameMark('cross') + '</p>' +
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
  // 16-week season, shuffled 16-of-35 deck, start 140 / 3000 / 65 on Medium.
  // Ends early if cong <= 0, funds < -500, or happy <= 0. After each choice:
  // collection = round(cong * happy/100 * 2.2), costs = 120 + round(cong * 0.3).
  // Event titles, texts and choice labels/deltas are the demo deck as
  // reported by inspection; the one-line result after each choice is a
  // rebuilt paraphrase, not the demo's wording.
  // Season length: 16 weeks, not 24. A 24-week season drags in the middle:
  // the loop is identical every week and nothing new arrives after the
  // opening stretch, so a season ran past ten minutes of reading for a
  // casual player. Sixteen weeks is still a full season arc (four months,
  // 16 of 35 events, so every season draws a different hand) and lands in
  // about seven minutes.
  var PASTOR_WEEKS = 16;
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
  var deck = [], week = 0, cong = startCong, funds = startFunds, happy = startHappy, over = false, started = false;
    var histCong = [startCong], histHappy = [startHappy]; // the season's arc, for the trend chart
    // The week's event: Holy Week is fixed at the halfway point (week 8),
    // every other week comes from the shuffled deck.
    function currentEvent() { return week === 7 ? PASTOR_HOLY_WEEK : deck[week]; }
    var best = readBest('pastor');
    function parishName() {
      try { return localStorage.getItem('rmf-parish-bowl-parish') || 'Craggy Island'; } catch (e) { return 'Craggy Island'; }
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
      var delta = function (d) {
        return d === 0 ? '' : ' <small style="color:' + (d > 0 ? '#2e7d32' : '#b8452a') + '">(' + (d > 0 ? '+' : '') + d + ')</small>';
      };
      stats.innerHTML = '<span>Week ' + Math.min(week + 1, PASTOR_WEEKS) + ' of ' + PASTOR_WEEKS + '</span>' +
        '<span>Congregation: <b>' + cong + '</b>' + delta(dCong) + '</span>' +
        '<span>Funds: <b>' + money(funds) + '</b></span>' +
        '<span>Happiness: <b>' + happy + '</b>' + delta(dHappy) + '</span>' +
        // The season score, live: congregation + happiness + funds / 10, so
        // the player can see the number they are playing for as it moves.
        '<span>Score: <b>' + Math.max(0, Math.round(cong + happy + Math.max(0, funds) / 10)) + '</b></span>' +
        '<span>' + parishMood() + '</span>' +
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
      if (week === 8) ledgerEntry('<b>Halfway through the season.</b> Eight weeks shepherded, eight to go — congregation ' + cong + ', funds ' + money(funds) + ', happiness ' + happy + '.');
      var ev = currentEvent();
      // Deck entries are [title, text, choice, choice, choice]: the choices
      // are ev[2..4], not ev[2] itself. (An earlier build iterated ev[2],
      // which is the first choice array, and rendered five garbage buttons
      // while every pick corrupted the numbers to NaN.)
      var choices = ev.slice(2);
      var html = '<h3>Week ' + (week + 1) + ' — ' + esc(ev[0]) + '</h3><p>' + esc(personalise(ev[1])) + '</p><div class="pastor-choices">';
      choices.forEach(function (ch, i) {
        html += '<button type="button" class="pastor-choice press" data-i="' + i + '">' + esc(ch[0]) + kbdChip(String(i + 1)) + '</button>';
      });
      html += '</div>' + kbdHint('Keyboard: 1, 2 or 3 picks a choice.');
      card.innerHTML = html;
      card.querySelectorAll('.pastor-choice').forEach(function (btn) {
        btn.addEventListener('click', function () { choose(parseInt(btn.getAttribute('data-i'), 10)); });
      });
      renderStats();
    }
    function choose(i) {
      if (over) return;
      var ev = currentEvent();
      var ch = ev[2 + i];
      cong += ch[2]; funds += ch[3]; happy += ch[4];
      histCong.push(cong); histHappy.push(happy);
      var collection = Math.round(cong * (happy / 100) * collMult);
      var costs = costBase + Math.round(cong * costPer);
      funds += collection - costs;
      ledgerEntry('<b>Week ' + (week + 1) + ' — ' + esc(ev[0]) + ':</b> ' + esc(ch[0]) + ' — ' + esc(ch[1]) +
        '<br><span class="pastor-nums">Collection +' + money(collection) + ' &middot; Costs -' + money(costs) +
        ' &middot; Congregation ' + cong + ' &middot; Funds ' + money(funds) + ' &middot; Happiness ' + happy + '</span>');
      week += 1;
      if (cong <= 0) { endSeason('The pews are empty — the parish has drifted away.'); return; }
      if (funds < -500) { endSeason('The parish is overdrawn beyond its $500 grace — the season ends.'); return; }
      if (happy <= 0) { endSeason('The parish has lost heart — the season ends.'); return; }
      if (week >= PASTOR_WEEKS) { endSeason('A full season shepherded — well done, Father.'); return; }
      showWeek();
    }
    function startSeason() {
      applyPastorDiff();
      deck = PASTOR_DECK.slice();
      for (var i = deck.length - 1; i > 0; i--) { var j = randInt(0, i); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
      deck = deck.slice(0, PASTOR_WEEKS);
      week = 0; cong = startCong; funds = startFunds; happy = startHappy; over = false; started = true;
      histCong = [startCong]; histHappy = [startHappy];
      ledger.innerHTML = '';
      showWeek();
    }
    card.innerHTML = '<h3>Parish Pastor</h3><p>Shepherd your parish for 16 weeks. Every decision moves the congregation, the funds, and the happiness of the parish. Keep the pews full, the books out of the red, and the people glad. Your season score is congregation + happiness + funds &divide; 10. ' + gameMark('pastor') + '</p>' +
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
  // at the demo's tile (9,10).
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
    '#.##.##....##.##.#',
    '#........#........#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '#V.......#.......V#',
    '###################',
  ];
  var MAZE_COLS = 19, MAZE_ROWS = 16, MAZE_CELL = 20, MAZE_OX = 50, MAZE_OY = 0;
  var MAZE_DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]];
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
      sins[0].dx = 0; sins[0].dy = -1; sins[0].tc = 9; sins[0].tr = 6;
      modeIdx = 0; modeT = 7; frightT = 0; frightChain = 0; elapsed = 0;
    }
    function startGame() {
      applyMazeDiff();
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
      } else if (chaliceActive && c === 9 && r === 10) {
        chaliceActive = false;
        addScore(300 + 100 * (level - 1));
        api.showBanner('Chalice! +' + (300 + 100 * (level - 1)), 1600);
      }
    }
    function sinTarget(s) {
      if (s.state === 'eyes') {
        if (s.eyesPhase === 0) return [9, 6];
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
    function sinDecide(s) {
      if (s.state === 'eyes') {
        if (s.eyesPhase === 0 && s.c === 9 && s.r === 6) { s.eyesPhase = 1; }
        if (s.eyesPhase === 1 && s.c === 9 && s.r === 7) {
          s.eyesPhase = 2; s.waitT = 0.5; s.dx = 0; s.dy = 0; return;
        }
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
    function draw() {
      var ctx = api.ctx;
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
        ctx.fillText('Paused — press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
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
      player.speed = playerSpeed();
      // Release sins on schedule
      sins.forEach(function (s) {
        if (!s.active && elapsed >= s.release) {
          s.active = true; s.leaving = true;
          setDir(s, 0, -1);
        }
        if (s.state === 'eyes' && s.eyesPhase === 2) {
          s.waitT -= dt;
          if (s.waitT <= 0) {
            s.state = 'normal'; s.eyesPhase = 0; s.leaving = true;
            s.c = 9; s.r = 7; s.x = tileX(9); s.y = tileY(7);
            setDir(s, 0, -1);
          }
        }
      });
      stepMover(player, dt);
      sins.forEach(function (s) {
        if (!s.active) return;
        s.speed = sinSpeed(s);
        stepMover(s, dt);
      });
      // Collisions
      sins.forEach(function (s) {
        if (!s.active || s.state === 'eyes') return;
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
        } else {
          if (d < 13) { die(s.name); return; }
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
    api.actions.appendChild(el('p', 'game-note', 'Arrows or WASD to steer, swipe or drag on the field, or use the pad. Light the candles to complete the vigil; the vials turn the sins edible. Space or Enter starts, begins the next vigil and restarts. R restarts.'));
    api.showOverlay('<h3>Candle Maze</h3><p>Light the candles to complete the vigil while four sins hunt you. Holy water turns the tables. ' + gameMark('maze') + '</p>' +
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
  // Jump velocity 790, gravity 2100, 0.09s coyote, 110ms press buffer.
  // Dove stretches 2100-2950 and 5650-6500 (gaps 118px); heavenward
  // (gravity-flip) stretch 3950-4700. Speed gates x1.25/x0.8/x1.3/x0.85/x1.25
  // at 1500/3300/5100/7350/8450. One hit kills; practice mode respawns at
  // lit candle checkpoints with 0.9s mercy and never touches bests.
  var DASH_COURSE = 9200, DASH_FLOOR = 280, DASH_CEIL = 40, DASH_CUBE = 24;
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
  function genDashLayout(seed, dens) {
    dens = dens || 1; // obstacle spacing: Easy spreads the course out, Hard packs it tighter
    var rnd = dashRng(seed);
    var L = {
      spikes: [], pews: [], clouds: [], censers: [], orbs: [],
      gates: [{ x: 1500, m: 1.25 }, { x: 3300, m: 0.8 }, { x: 5100, m: 1.3 }, { x: 7350, m: 0.85 }, { x: 8450, m: 1.25 }],
      doveCols: [], flipSpikes: [],
    };
    function inSpecial(x) {
      return (x > 1980 && x < 3070) || (x > 3830 && x < 4820) || (x > 5530 && x < 6620);
    }
    // Clear opening runway: the first thorn waits until 1400px on Medium (scaled by difficulty), so a new
    // player gets a few jumps in before the first thing to clear, and the
    // first pew waits until 1300px.
    var x = Math.round(1400 * dens);
    while (x < 9000) {
      if (!inSpecial(x)) {
        var n = 1 + Math.floor(rnd() * 3);
        for (var i = 0; i < n; i++) L.spikes.push({ x: x + i * 26, w: 24 });
        x += (380 + rnd() * 260) * dens;
      } else x += 120;
    }
    x = Math.round(1300 * dens);
    while (x < 8900) { if (!inSpecial(x)) L.pews.push({ x: x, w: 70 + rnd() * 30, h: 46 + rnd() * 20 }); x += (750 + rnd() * 350) * dens; }
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
      var cx = seg[0] + 120;
      while (cx < seg[1] - 60) {
        var gapC = 110 + rnd() * 110;
        L.doveCols.push({ x: cx, w: 26, gapTop: gapC - 59, gapBottom: gapC + 59 });
        cx += 165 + rnd() * 45;
      }
    });
    x = 4050;
    while (x < 4650) {
      var n2 = 1 + Math.floor(rnd() * 2);
      for (var j = 0; j < n2; j++) L.flipSpikes.push({ x: x + j * 26, w: 24 });
      x += 320 + rnd() * 220;
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
    function applyDashDiff() {
      // Easy: a slower cube and a roomier course. Hard: a faster cube
      // and tighter obstacles. Medium is the current game.
      if (diff === 'easy') { dashDens = 1.25; dashBase = 210; dashSlope = 0.04; dashCap = 380; }
      else if (diff === 'hard') { dashDens = 0.8; dashBase = 260; dashSlope = 0.05; dashCap = 470; }
      else { dashDens = 1; dashBase = 235; dashSlope = 0.045; dashCap = 430; }
    }
    applyDashDiff();
    var layout = genDashLayout(seed, dashDens);
    var practice = false, practiceDeaths = 0;
    var dist = 0, y = DASH_FLOOR - DASH_CUBE / 2, vy = 0, grounded = true;
    var gateIdx = -1, gateMult = 1, bonus = 0, chain = 0;
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
      if (typeof newSeed === 'number') { seed = newSeed; layout = genDashLayout(seed, dashDens); }
      dist = 0; y = DASH_FLOOR - DASH_CUBE / 2; vy = 0; grounded = true;
      gateIdx = -1; gateMult = 1; bonus = 0; chain = 0;
      quarters = [false, false, false, false]; depthAwarded = false;
      coyoteT = 0; bufferT = 0; mercyT = 0; rot = 0; mode = 'normal'; runT = 0;
      checkpoint = null; practiceDeaths = 0;
      warned = {};
      if (!practice) {
        attempts += 1;
        try { localStorage.setItem('rmf-dash-attempts', String(attempts)); } catch (e) { /* ignore */ }
      }
      state = 'playing'; api.hideOverlay(); updateHud();
    }
    function endRun(won, why) {
      state = 'over';
      var pct = Math.min(100, Math.floor((dist / DASH_COURSE) * 100));
      var sc = score();
      var fb = best, newDepth = bestDepth;
      if (!practice) {
        fb = writeBest('dash', sc); best = fb;
        if (pct > bestDepth) {
          newDepth = pct; bestDepth = pct;
          try { localStorage.setItem('rmf-dash-depth', String(pct)); } catch (e) { /* ignore */ }
        }
      }
      var title = won ? 'You reached the sanctuary!' : 'The run ends';
      var tip = (!won && why && DASH_TIPS[why]) ? DASH_TIPS[why] : '';
      api.showOverlay('<h3>' + esc(title) + '</h3><p>' + (why ? esc(why) + '<br>' : '') +
        (tip ? esc(tip) + '<br>' : '') +
        'Score: ' + sc + ' &middot; Reached: ' + pct + '% &middot; Best: ' + fb + '<br>' +
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
      if (practice && checkpoint) {
        practiceDeaths += 1;
        dist = checkpoint.dist; bonus = checkpoint.bonus;
        quarters = checkpoint.quarters.slice();
        y = DASH_FLOOR - DASH_CUBE / 2; vy = 0; grounded = true; chain = 0;
        mode = dashModeAt(dist);
        gateIdx = -1; gateMult = 1;
        layout.gates.forEach(function (g, i) { if (g.x <= dist) { gateIdx = i; gateMult = g.m; } });
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
      bufferT = 0.11;
      if (grounded || coyoteT > 0) {
        vy = mode === 'flip' ? 790 : -790;
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
          vy = mode === 'flip' ? 800 : -800;
          bonus += 15 + chain * 10;
          chain += 1;
          api.showBanner('Halo hop! +' + (15 + (chain - 1) * 10), 900);
          updateHud();
          return;
        }
      }
    }
    function updateHud() {
      var pct = Math.min(100, Math.floor((dist / DASH_COURSE) * 100));
      api.setHud('<span class="score">Score: ' + score() + '</span><span>' + pct + '%</span>' +
        '<span>' + (mode === 'dove' ? 'Dove flight' : mode === 'flip' ? 'Heavenward' : 'Running') + '</span>' +
        '<span>Speed x' + gateMult + '</span>' + diffTag(diff) + '<span>Best: ' + best + '</span>' +
        (practice ? '<span>Practice</span>' : ''));
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
        ctx.fillText('Paused — press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
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
          gateIdx = i; gateMult = g.m;
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
        var targetVy = holding ? -240 : 300;
        vy += (targetVy - vy) * Math.min(1, dt * 8);
        y += vy * dt;
        if (y + DASH_CUBE / 2 >= DASH_FLOOR) { die('The dove touched the floor'); return; }
        if (y - DASH_CUBE / 2 <= 16) { die('The dove touched the ceiling'); return; }
        for (var ci = 0; ci < layout.doveCols.length; ci++) {
          var col = layout.doveCols[ci];
          if (dist + DASH_CUBE / 2 > col.x && dist - DASH_CUBE / 2 < col.x + col.w) {
            if (y - DASH_CUBE / 2 < col.gapTop || y + DASH_CUBE / 2 > col.gapBottom) { die('The dove missed the gap'); return; }
          }
        }
      } else {
        var g = mode === 'flip' ? -2100 : 2100;
        vy += g * dt;
        y += vy * dt;
        if (!grounded) rot += dt * 6;
        if (mode === 'flip') {
          if (y <= DASH_CEIL + DASH_CUBE / 2 && vy <= 0) {
            y = DASH_CEIL + DASH_CUBE / 2; vy = 0; grounded = true; rot = 0; chain = 0;
            if (holding) { vy = 790; grounded = false; }
            else if (bufferT > 0) { vy = 790; grounded = false; bufferT = 0; }
          }
          // Ceiling spikes
          if (mercyT <= 0) {
            for (var fi = 0; fi < layout.flipSpikes.length; fi++) {
              var fs = layout.flipSpikes[fi];
              if (dist + DASH_CUBE / 2 - 4 > fs.x && dist - DASH_CUBE / 2 + 4 < fs.x + fs.w &&
                  y - DASH_CUBE / 2 < DASH_CEIL + 24) { die('Caught on a ceiling thorn'); return; }
            }
          }
        } else {
          // Pews: land on top or die on the side
          var landed = false;
          for (var pi = 0; pi < layout.pews.length; pi++) {
            var p = layout.pews[pi];
            var top = DASH_FLOOR - p.h;
            if (dist + DASH_CUBE / 2 > p.x && dist - DASH_CUBE / 2 < p.x + p.w) {
              if (vy >= 0 && prevBottom <= top + 6 && y + DASH_CUBE / 2 >= top) {
                if (!grounded) spawnDust(dist, top);
                y = top - DASH_CUBE / 2; vy = 0; grounded = true; rot = 0; chain = 0; landed = true;
                if (holding) { vy = -790; grounded = false; }
                else if (bufferT > 0) { vy = -790; grounded = false; bufferT = 0; }
                break;
              }
              if (y + DASH_CUBE / 2 > top + 6 && y - DASH_CUBE / 2 < DASH_FLOOR) {
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
              if (!grounded) { grounded = true; rot = 0; chain = 0; spawnDust(dist, DASH_FLOOR); }
              if (holding) { vy = -790; grounded = false; }
              else if (bufferT > 0) { vy = -790; grounded = false; bufferT = 0; }
            }
          }
          // Walked off a pew edge: start falling
          var onPew = false;
          layout.pews.forEach(function (p2) {
            if (dist + DASH_CUBE / 2 > p2.x && dist - DASH_CUBE / 2 < p2.x + p2.w && Math.abs((y + DASH_CUBE / 2) - (DASH_FLOOR - p2.h)) < 1) onPew = true;
          });
          if (grounded && !onPew && y < DASH_FLOOR - DASH_CUBE / 2) { grounded = false; coyoteT = 0.09; }
          // Floor spikes
          if (mercyT <= 0) {
            for (var si = 0; si < layout.spikes.length; si++) {
              var sp = layout.spikes[si];
              if (dist + DASH_CUBE / 2 - 4 > sp.x && dist - DASH_CUBE / 2 + 4 < sp.x + sp.w &&
                  y + DASH_CUBE / 2 > DASH_FLOOR - 20) { die('Caught on a thorn'); return; }
            }
          }
        }
        // Censers
        if (mercyT <= 0) {
          for (var ce = 0; ce < layout.censers.length; ce++) {
            var cn = layout.censers[ce];
            var ang = Math.sin(runT * 1.5 + cn.phase) * 0.5;
            var bx = cn.x + Math.sin(ang) * 70, by = 120 + Math.cos(ang) * 70;
            if (Math.hypot(bx - dist, by - y) < 20) { die('Struck by a swinging censer'); return; }
          }
        }
      }
      if (dist >= DASH_COURSE) { endRun(true, null); return; }
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
    api.actions.appendChild(el('p', 'game-note', 'Space, Up, W, click or tap to jump. Hold to keep hopping; in dove stretches hold to rise and release to fall. Space or Enter retries this course, R runs a new one.'));
    var practiceWrap = el('label', 'game-note', '');
    var practiceBox = document.createElement('input');
    practiceBox.type = 'checkbox';
    practiceBox.addEventListener('change', function () {
      if (state === 'playing') { practiceBox.checked = practice; return; }
      practice = practiceBox.checked;
    });
    practiceWrap.appendChild(practiceBox);
    practiceWrap.appendChild(document.createTextNode(' Practice mode (candle checkpoints, no bests)'));
    api.actions.appendChild(practiceWrap);
    api.showOverlay('<h3>Sanctuary Dash</h3><p>The golden cube never stops. Jump the thorns, ride the pews, run under the swinging censers — never jump into one — and reach the sanctuary 9,200px down the nave. ' + gameMark('dash') + '</p>' +
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

  // __MORE_GAMES__

  renderShelf();
})();
