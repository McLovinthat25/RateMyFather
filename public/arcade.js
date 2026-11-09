// RateMyFather Arcade: nine games, vanilla canvas JS. Best scores live only in
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
  function storeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function storeSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function storeDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

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
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
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

  // ---- game registry ----
  var ARCADE_GAMES = [
    { id: 'rungun', title: 'The Parish Bowl', blurb: 'Carry the ball for St Mary\u2019s against St Swithin\u2019s. Run or pass your way down the field.', verdict: 'Best for a quick kickabout.', how: 'Arrows or WASD to move. Choose RUN or PASS, then stand on the gold X to catch.', mount: mountBowl },
    { id: 'stack', title: 'Stained-Glass Stack', blurb: 'Fit the falling panes into the window before it fills up.', verdict: 'Best for puzzle lovers.', how: 'Left and right to move, Up to turn a pane, Down to drop it faster. On a phone, use the buttons under the window.', mount: mountStack },
    { id: 'maze', title: 'Candle Maze', blurb: 'Light every candle in the cloister while four sins hunt you. Holy water turns the tables.', verdict: 'Best for steady nerves.', how: 'Arrows or WASD to steer. Father walks on his own.', mount: mountMaze },
    { id: 'steeple', title: 'Steeple Stack', blurb: 'Stack the stones into the tallest steeple. Mind the wind after stone fifteen.', verdict: 'Best for patient builders.', how: 'Tap or press Space to drop a stone on the tower.', mount: mountSteeple },
    { id: 'holy', title: 'Holy Water Havoc', blurb: 'Fend off the devil with holy water. Charge your shots and watch for extra hearts.', verdict: 'Best for boss fighters.', how: 'Move with arrows. Hold Space to charge, release to fire. On a phone, use the move buttons and hold FIRE to charge.', mount: mountHoly },
    { id: 'dash', title: 'Sanctuary Dash', blurb: 'The golden cube never stops. Jump the thorns, ride the pews, and reach the sanctuary 9,200px down the nave.', verdict: 'Best for quick reflexes.', how: 'Space, Up, W, click or tap to jump. Hold to keep hopping.', mount: mountDash },
    { id: 'flee', title: 'Flee the Sins', blurb: 'Outrun the seven sins. Grab halos, dash with grace, and mind the confession bell.', verdict: 'Best for a chase.', how: 'Arrows to move, Space for a grace-dash.', mount: mountFlee },
    { id: 'cross', title: 'Father\u2019s Crossing', blurb: 'Cross the road and the river to reach the church doors before the bell.', verdict: 'Best for careful crossers.', how: 'Arrows to move. Follow the moth to the right door.', mount: mountCross },
    { id: 'pastor', title: 'Parish Pastor', blurb: 'Run the parish for 16 weeks. Balance the congregation, the funds, and everyone\u2019s happiness.', verdict: 'Best for planners.', how: 'Pick one choice each week. Watch the ledger.', mount: mountPastor },
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
    head.appendChild(el('p', 'small', 'Nine little games. Best scores live only in your browser.'));
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
  // St Mary's vs St Swithin's. Four downs to gain ten yards, four quarters
  // of 45 seconds. Run it or pass it: reach the gold X and hold still to
  // catch, then run it in. A touchdown is the yards gained plus a bonus.
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
  var RUNGUN_PASS_STUN_SECONDS = 0.3; // A heartbeat to take a step after the
  // catch, not a free run while the defence stands still.
  var PX_PER_YARD = (RUNGUN_START_Y - RUNGUN_END_Y) / 80; // 9.8
  var BOWL_CATCH_DWELL = 0.85; // Hold still the better part of a second to
  // catch: the defence has a real chance to close, so a completion is earned.
  var BOWL_CATCH_RADIUS = 26;
  var RUNGUN_TOUCHDOWN_BONUS = 100; // demo: yards + 100 points on a touchdown
  var BOWL_TACKLE_RADIUS = 19; // was 21: a tackle has to actually reach the runner
  var BOWL_PLAY_MAX_SECONDS = 9; // whistle: no play runs forever, no stall at 0:00
  // Human-first defence tuning (Nov 9, second pass): Mikey played the live
  // Bowl again and the defence was still far too fast. The bots scored
  // easily, but a human reacts in 600-800ms and plays on a dpad, so the
  // defence must be clearly slower than the runner (208) in a way a human
  // feels: defenders at well under half the runner's pace, a slow turn so
  // a sharp cut genuinely leaves them wrong-footed, slow pre-catch
  // coverage, and wide gaps between reinforcement waves. Fair, not trivial.
  // Final numbers (verified with a human-like driver that re-plans every
  // 700ms and steers by the canvas): defender speed 85-105 (was 110-135),
  // turn 2.2 rad/s (was 3.0), pre-catch chase 0.15 (was 0.3), waves every
  // 6s (was 4.5) or 22 yards (was 18), cap 6 (was 7), opening line
  // 2 + quarter (was 3 + quarter), tackle radius 19 (was 21).
  var BOWL_WAVE_SECONDS = 6; // was 4.5: waves spaced out, the runner gets room
  var BOWL_DEFENDER_CAP = 6; // was 7: fewer defenders on the field at once
  var BOWL_TURN_RATE = 2.2; // rad/s, was 3.0: a cut beats the chase; a 180 takes ~1.4s
  var BOWL_BURGUNDY = '#6e1a26', BOWL_BURGUNDY_DEEP = '#521219', BOWL_BURGUNDY_BRIGHT = '#a02c3c';
  var BOWL_GOLD = '#b28a2e', BOWL_GOLD_BRIGHT = '#d9b45a', BOWL_GOLD_PALE = '#f0d48a';
  var BOWL_PARCHMENT = '#f7ecd4', BOWL_INK = '#2b1d12';

  function mountBowl(parent, onBack) {
    var api = createStage(parent, { title: 'The Parish Bowl', onBack: onBack });
    api.overlay.style.overflowY = 'auto';
    var priestName = storeGet('rmf-parish-bowl-priest') || 'Father Murphy';
    var parishName = storeGet('rmf-parish-bowl-parish') || 'St Mary\u2019s';
    var opponent = 'St Swithin\u2019s';
    var state = 'ready'; // ready | choose | run | pass | result | over
    var paused = false;
    var quarter = 1, clock = RUNGUN_QUARTER_SECONDS;
    var score = 0, best = readBest('rungun'), tds = 0, oppTds = 0;
    var down = 1, seriesStart = 80, seriesGain = 0; // four downs, ten yards for a first
    var px = GAME_W / 2, py = RUNGUN_START_Y;
    var camY = RUNGUN_WORLD_H - GAME_H; // camera: follows the runner down the world
    function screenY(wy) { return wy - camY; }
    function updateCam() { camY = clamp(py - 190, 0, RUNGUN_WORLD_H - GAME_H); }
    var defenders = [];
    var waveT = 0, yardsAtWave = 80, playStartYards = 80, playStartPy = RUNGUN_START_Y, playT = 0;
    var passTarget = null, catchT = 0, caught = false, hasBall = false, freezeT = 0;
    var resultMain = '', resultSub = '', resultT = 0, timeGoneShown = false;
    var coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
    var keys = makeKeys();
    var dpadVec = { x: 0, y: 0 };
    var raf = 0, last = 0, destroyed = false;

    function yardsToGo() { return Math.max(0, Math.round((py - RUNGUN_END_Y) / PX_PER_YARD)); }
    function downWord() { return down === 1 ? '1ST' : down === 2 ? '2ND' : down === 3 ? '3RD' : '4TH'; }
    function toGoLabel() { return seriesStart <= 10 ? 'GOAL' : String(10 - seriesGain); }
    function downLabel() { return downWord() + ' & ' + toGoLabel(); }
    function defenderCount() { return 2 + quarter; } // was 3 + quarter: a thinner opening line
    // The defence lines up ahead of the runner in the scrolling world, so
    // the play is about reading the field as it scrolls and cutting past
    // defenders in sequence — not about one wall across a squeezed field.
    // Wave reinforcements keep coming to the ball, near the runner's lane,
    // so beating the line is not a free touchdown.
    function spawnDefenders(n, upfield, line, lineDepth) {
      for (var i = 0; i < n; i++) {
        var d = null;
        for (var tries = 0; tries < 8; tries++) {
          var cand;
          if (line) {
            var slot = (i + 0.5) / Math.max(1, n);
            var lo = lineDepth ? lineDepth[0] : 170, hi = lineDepth ? lineDepth[1] : 230;
            cand = {
              x: clamp(50 + slot * (GAME_W - 100) + rand(-24, 24), 40, GAME_W - 40),
              y: clamp(py - rand(lo, hi), RUNGUN_END_Y + 10, RUNGUN_START_Y - 20),
              speed: rand(85, 105),
              heading: 0,
            };
          } else if (upfield) {
            cand = {
              x: clamp(px + rand(-140, 140), 40, GAME_W - 40),
              y: clamp(py - rand(150, 240), RUNGUN_END_Y + 10, RUNGUN_START_Y - 20),
              speed: rand(85, 105),
              heading: 0,
            };
          } else {
            cand = {
              x: rand(40, GAME_W - 40),
              y: rand(RUNGUN_END_Y + 10, RUNGUN_START_Y - 20),
              speed: rand(85, 105),
              heading: 0,
            };
          }
          // Fair spawn: never on top of the runner, never on the catch spot.
          if (Math.hypot(cand.x - px, cand.y - py) < 100) continue;
          if (passTarget && Math.hypot(cand.x - passTarget.x, cand.y - passTarget.y) < 70) continue;
          d = cand; break;
        }
        if (!d) continue;
        d.heading = Math.atan2(py - d.y, px - d.x);
        defenders.push(d);
      }
    }
    function pickPassTarget() {
      // Routes are short: a catch puts you a few yards upfield, and the rest
      // is earned by running, like any other play.
      var depth = clamp(playStartYards * 0.25, 5, 14);
      var baseX = px, baseY = Math.max(RUNGUN_END_Y + 14, py - depth * PX_PER_YARD);
      var bestSpot = null, bestScore = -1e9;
      var offsets = [[0, 0], [-45, 0], [45, 0], [-80, 0], [80, 0], [0, -20], [-45, -20], [45, -20], [0, 20]];
      offsets.forEach(function (o) {
        var tx = clamp(baseX + o[0], 30, GAME_W - 30);
        var ty = clamp(baseY + o[1], RUNGUN_END_Y + 14, RUNGUN_START_Y - 10);
        var minD = 999;
        defenders.forEach(function (dd) { minD = Math.min(minD, Math.hypot(dd.x - tx, dd.y - ty)); });
        var s = minD - Math.hypot(tx - baseX, ty - baseY) * 0.4;
        if (s > bestScore) { bestScore = s; bestSpot = { x: tx, y: ty }; }
      });
      return bestSpot;
    }
    function startPlay(kind) {
      if (paused) doResume();
      playStartYards = yardsToGo();
      playStartPy = py;
      playT = 0;
      caught = false; catchT = 0; freezeT = 0;
      defenders = [];
      // On a pass the defence drops deep, beyond the catch spot, so the
      // route to the gold X is open and the catch is about beating coverage
      // to the spot — the run after the catch is where the defence bites.
      // On a run the line sits just ahead of the runner, as usual.
      spawnDefenders(defenderCount(), true, true, kind === 'pass' ? [380, 460] : null);
      waveT = 0; yardsAtWave = playStartYards;
      if (kind === 'pass') {
        passTarget = pickPassTarget();
        hasBall = false;
        state = 'pass';
      } else {
        passTarget = null;
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
      var note = '';
      if (flags.touchdown) {
        tds += 1;
        py = RUNGUN_START_Y; px = GAME_W / 2;
        down = 1; seriesStart = 80; seriesGain = 0;
      } else if (flags.incomplete) {
        py = playStartPy;
        down += 1;
        if (down > 4) {
          note = ' Turnover on downs — back to the 80.';
          py = RUNGUN_START_Y; px = GAME_W / 2;
          down = 1; seriesStart = 80; seriesGain = 0;
        }
      } else {
        seriesGain += gained;
        if (seriesGain >= 10) {
          note = ' First down!';
          down = 1; seriesStart = yardsToGo(); seriesGain = 0;
        } else {
          down += 1;
          if (down > 4) {
            note = ' Turnover on downs — back to the 80.';
            py = RUNGUN_START_Y; px = GAME_W / 2;
            down = 1; seriesStart = 80; seriesGain = 0;
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
      // against an opponent, not a solo points tally.
      var oppScored = Math.random() < 0.5;
      if (oppScored) oppTds += 1;
      if (quarter >= 4) { gameOver(); return; }
      quarter += 1; clock = RUNGUN_QUARTER_SECONDS; timeGoneShown = false;
      py = RUNGUN_START_Y; px = GAME_W / 2;
      down = 1; seriesStart = 80; seriesGain = 0;
      coachLine = oppScored
        ? 'Monsignor Coach: St Swithin\u2019s drove down and scored. Match ' + (tds * 7) + '–' + (oppTds * 7) + '. Your ball — answer them.'
        : 'Monsignor Coach: St Swithin\u2019s drive stalled. Match ' + (tds * 7) + '–' + (oppTds * 7) + '. Your ball — keep it rolling.';
      state = 'choose'; showChoose();
    }
    function gameOver() {
      state = 'over';
      var finalBest = writeBest('rungun', score);
      best = finalBest;
      var yardsGained = Math.max(0, score - tds * RUNGUN_TOUCHDOWN_BONUS);
      api.showOverlay(bowlCard('Full time', esc(parishName) + ' ' + (tds * 7) + ' — ' + esc(opponent) + ' ' + (oppTds * 7),
        '<p style="margin:0 0 4px;font-size:15px;">' + tds + (tds === 1 ? ' touchdown' : ' touchdowns') + ' · ' + yardsGained + ' yards gained · ' + score + ' points.</p>' +
        '<p style="margin:0 0 16px;font-size:14px;">Best: ' + finalBest + '</p>',
        '<button type="button" class="big-btn press" id="bowl-again" style="background:' + BOWL_BURGUNDY + ';color:' + BOWL_PARCHMENT + ';letter-spacing:.14em;text-transform:uppercase;">Play again</button>' +
        '<button type="button" class="linklike" id="bowl-back">Back to arcade</button>'));
      var again = document.getElementById('bowl-again');
      if (again) again.addEventListener('click', function () { resetGame(); });
      var back = document.getElementById('bowl-back');
      if (back) back.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function resetGame() {
      quarter = 1; clock = RUNGUN_QUARTER_SECONDS; score = 0; tds = 0; oppTds = 0;
      px = GAME_W / 2; py = RUNGUN_START_Y; timeGoneShown = false;
      down = 1; seriesStart = 80; seriesGain = 0;
      coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
      defenders = []; passTarget = null; caught = false; hasBall = false; freezeT = 0; playT = 0;
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
    function showStart() {
      state = 'ready';
      api.showOverlay(bowlCard(esc(parishName) + ' vs ' + esc(opponent), 'The Parish Bowl',
        '<p style="margin:0 0 6px;font-size:15px;line-height:1.45;">Four quarters of 45 seconds. Run or pass your way down the field — four downs to gain ten yards, and a touchdown is worth the yards plus a hundred. St Swithin\u2019s drive after every quarter.</p>' +
        '<p style="margin:0 0 16px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b5636;">' + gameMark('rungun') + '</p>',
        bowlBtn('bowl-kickoff', 'Kick off for ' + esc(parishName)) +
        '<button type="button" class="linklike" id="bowl-custom">Play as your home parish priest</button>'));
      var kick = document.getElementById('bowl-kickoff');
      if (kick) kick.addEventListener('click', function () { state = 'choose'; showChoose(); });
      var custom = document.getElementById('bowl-custom');
      if (custom) custom.addEventListener('click', showCustomize);
      updateHud();
    }
    function showCustomize() {
      api.showOverlay(bowlCard('Your home parish priest', 'Who\u2019s carrying it?',
        '<p style="margin:0 0 14px;font-size:14px;line-height:1.45;">Your priest and parish run through the game: the scoreboard, the coach, and the results.</p>' +
        '<label style="display:block;text-align:left;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;margin-bottom:12px;">Priest name<input id="rungun-priest-name" placeholder="Father Murphy" value="' + esc(storeGet('rmf-parish-bowl-priest') || '') + '" style="display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px 12px;border:2px solid ' + BOWL_BURGUNDY + ';border-radius:8px;background:#fff;font-family:Georgia,serif;font-size:15px;letter-spacing:0;text-transform:none;font-weight:400;"></label>' +
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
        priestName = pn || 'Father Murphy';
        parishName = pp || 'St Mary\u2019s';
        coachLine = 'Run it or pass it, ' + priestName + '. Your call.';
        showStart();
      });
      var forget = document.getElementById('bowl-forget-names');
      if (forget) forget.addEventListener('click', function () {
        storeDel('rmf-parish-bowl-priest'); storeDel('rmf-parish-bowl-parish');
        priestName = 'Father Murphy'; parishName = 'St Mary\u2019s';
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
        '<p style="margin:0 0 16px;font-size:14px;line-height:1.45;">Coach: ' + esc(coachLine) + '</p>',
        bowlBtn('bowl-run', 'Run') + bowlBtn('bowl-pass', 'Pass') +
        '<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#6b5636;">Clock stops while you choose. Pass: reach the gold X and hold still to catch, then run it in. A tackle before the catch is incomplete — no gain, next down. Keys: R runs, T throws.</p>'));
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
        '<span style="margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase">' + esc(parishName) + ' <b style="font-size:22px;color:' + BOWL_GOLD_BRIGHT + '">' + score + '</b></span>' +
        '<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:' + BOWL_GOLD_PALE + '">Match ' + (tds * 7) + '–' + (oppTds * 7) + '</span>' +
        '<span style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:' + BOWL_GOLD_PALE + '">Best ' + best + '</span>' +
        '</div>');
    }
    function movePlayer(dt) {
      var ax = keys.axis();
      var dx = ax.x + dpadVec.x, dy = ax.y + dpadVec.y;
      var len = Math.hypot(dx, dy);
      if (len > 0) { dx /= len; dy /= len; }
      var speed = 208; // Same pace with or without the ball: a caught pass
      // gives no speed edge. The catch buys field position, not a faster run.
      px = clamp(px + dx * speed * dt, 16, GAME_W - 16);
      // The goal line is the floor: reaching it scores. The start line is
      // the ceiling: no running backwards past your own 80, no negative yards.
      py = clamp(py + dy * speed * dt, RUNGUN_END_Y, RUNGUN_START_Y);
      updateCam();
    }
    function moveDefenders(dt) {
      if (freezeT > 0) return;
      // Before the catch the defence is in coverage: slow, closing on
      // the receiver, so reaching the catch spot is about beating coverage
      // to the spot — it closes slowly and does not instantly converge.
      // After the catch (or on a run) it hunts at full pace,
      // but every defender steers with a limited turn rate, so a sharp cut
      // leaves them wrong-footed instead of glued to the runner.
      var chase = (state === 'pass' && !caught) ? 0.15 : 1;
      defenders.forEach(function (d) {
        var want = Math.atan2(py - d.y, px - d.x);
        var diff = want - d.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        d.heading += clamp(diff, -BOWL_TURN_RATE * dt, BOWL_TURN_RATE * dt);
        var sp = d.speed * chase;
        d.x += Math.cos(d.heading) * sp * dt;
        d.y += Math.sin(d.heading) * sp * dt;
      });
    }
    function checkTackle() {
      for (var i = 0; i < defenders.length; i++) {
        var d = defenders[i];
        if (Math.hypot(d.x - px, d.y - py) < BOWL_TACKLE_RADIUS) return true;
      }
      return false;
    }
    function tick(dt) {
      if (paused || destroyed) return;
      if (state === 'run' || state === 'pass' || state === 'result') {
        clock -= dt;
        if (clock <= 0) {
          clock = 0;
          if (!timeGoneShown) { timeGoneShown = true; api.showBanner('Time — finish the play!', 2000); }
        }
      }
      if (freezeT > 0) freezeT -= dt;
      if (state === 'run' || state === 'pass') {
        playT += dt;
        movePlayer(dt);
        moveDefenders(dt);
        // Fresh legs: one defender at a time, never a wall of them. Only
        // once the runner has the ball — no reinforcements dropping on the
        // receiver while a pass is in the air.
        waveT += dt;
        if (state === 'run' && (waveT >= BOWL_WAVE_SECONDS || (yardsAtWave - yardsToGo()) >= 22)) {
          waveT = 0; yardsAtWave = yardsToGo();
          if (defenders.length < BOWL_DEFENDER_CAP) spawnDefenders(1, true);
        }
        if (state === 'pass' && passTarget && !caught) {
          var dist = Math.hypot(passTarget.x - px, passTarget.y - py);
          if (dist <= BOWL_CATCH_RADIUS) {
            catchT += dt;
            if (catchT >= BOWL_CATCH_DWELL) {
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
        if (state === 'run' && yardsToGo() <= 0) {
          // Touchdown: the yards gained, plus a bonus for reaching the end
          // zone, so a scoring drive is worth more than the same yards
          // gained on a tackle.
          var gained = playStartYards + RUNGUN_TOUCHDOWN_BONUS;
          endPlay(gained, 'Touchdown, ' + priestName + '!', parishName + ' score. +' + playStartYards + ' yards, +' + RUNGUN_TOUCHDOWN_BONUS + ' bonus.', { touchdown: true });
          return;
        }
        if (checkTackle()) {
          if (state === 'pass' && !caught) {
            endPlay(0, 'Incomplete.', 'Tackled before the catch. No gain, next down.', { incomplete: true });
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
          ctx.beginPath(); ctx.arc(tx, ty, BOWL_CATCH_RADIUS * (catchT / BOWL_CATCH_DWELL), 0, Math.PI * 2); ctx.fill();
        }
      }
      // Defenders: soft shadow, a radial umber disc, a fine parchment ring.
      defenders.forEach(function (d) {
        var dy = screenY(d.y);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(d.x, dy + 9, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
        var dg = ctx.createRadialGradient(d.x - 3, dy - 4, 2, d.x, dy, 12);
        dg.addColorStop(0, '#4a3826');
        dg.addColorStop(1, '#241a10');
        ctx.fillStyle = dg;
        ctx.beginPath(); ctx.arc(d.x, dy, 11, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = freezeT > 0 ? '#8a8a8a' : BOWL_PARCHMENT; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('S', d.x, dy + 3); ctx.textAlign = 'left';
      });
      // Player (Father): soft shadow, a radial burgundy disc, a gold ring,
      // and the ball only when carrying.
      var pyS = screenY(py);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath(); ctx.ellipse(px, pyS + 10, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      var pg = ctx.createRadialGradient(px - 4, pyS - 5, 2, px, pyS, 13);
      pg.addColorStop(0, '#8a2a38');
      pg.addColorStop(1, BOWL_BURGUNDY);
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(px, pyS, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = BOWL_GOLD; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('F', px, pyS + 4); ctx.textAlign = 'left';
      if (hasBall) {
        ctx.fillStyle = BOWL_GOLD;
        ctx.beginPath(); ctx.arc(px + 10, pyS - 6, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(46,34,5,0.6)'; ctx.lineWidth = 1; ctx.stroke();
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
    // Keyboard play-calling on the choose screen: R runs, T throws, so a
    // desktop player is not reaching for the mouse on every down. P stays
    // the pause key, so it is deliberately not the pass key.
    function onChooseKey(e) {
      if (state !== 'choose' || paused) return;
      var k = e.key.toLowerCase();
      if (k === 'r') startPlay('run');
      else if (k === 't') startPlay('pass');
    }
    document.addEventListener('keydown', onChooseKey);
    api.actions.appendChild(el('p', 'game-note', 'Arrows or WASD to move. R runs, T throws, P or Esc pauses. The clock stops while you choose a play. Four downs to gain ten yards.'));
    showStart();
    updateHud();
    last = performance.now();
    raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true;
      cancelAnimationFrame(raf);
      keys.cleanup();
      cleanupPause();
      document.removeEventListener('keydown', onChooseKey);
    };
  }

  // ================= Stained-Glass Stack =================
  // Falling panes, 7-piece bag, ghost pane, guideline scoring.
  var STACK_SHAPES = {
    I: [[1, 1, 1, 1]], O: [[1, 1], [1, 1]], T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]], Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]], L: [[0, 0, 1], [1, 1, 1]],
  };
  var STACK_COLORS = { I: '#3a6ea5', O: '#b28a2e', T: '#5b2a4a', S: '#2e5e4e', Z: '#b8452a', J: '#3a6ea5', L: '#8a6d3b' };
  var STACK_POINTS = [0, 100, 300, 500, 800];
  function mountStack(parent, onBack) {
    var api = createStage(parent, { title: 'Stained-Glass Stack', onBack: onBack });
    var COLS = 10, ROWS = 20, CELL = 15, OX = (GAME_W - COLS * CELL) / 2, OY = 10;
    var grid = [], bag = [], cur = null, score = 0, lines = 0, level = 1;
    var best = readBest('stack');
    var state = 'ready', paused = false, dropT = 0, raf = 0, last = 0, destroyed = false;
    function resetGrid() { grid = []; for (var y = 0; y < ROWS; y++) { grid.push(new Array(COLS).fill(null)); } }
    function refillBag() {
      bag = Object.keys(STACK_SHAPES).slice();
      for (var i = bag.length - 1; i > 0; i--) { var j = randInt(0, i); var t = bag[i]; bag[i] = bag[j]; bag[j] = t; }
    }
    function spawn() {
      if (!bag.length) refillBag();
      var type = bag.pop();
      cur = { type: type, shape: STACK_SHAPES[type].map(function (r) { return r.slice(); }), x: 3, y: 0 };
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
      var cleared = 0;
      for (var y = ROWS - 1; y >= 0; y--) {
        if (grid[y].every(Boolean)) { grid.splice(y, 1); grid.unshift(new Array(COLS).fill(null)); cleared++; y++; }
      }
      if (cleared) {
        score += STACK_POINTS[cleared] * level;
        lines += cleared;
        level = 1 + Math.floor(lines / 10);
      }
      updateHud();
      spawn();
    }
    function ghostY() { var y = cur.y; while (!collides(cur.shape, cur.x, y + 1)) y++; return y; }
    function gameOver() {
      state = 'over';
      var fb = writeBest('stack', score); best = fb;
      api.showOverlay('<h3>The window is full</h3><p>Score: ' + score + ' &middot; Lines: ' + lines + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="stack-again">Play again</button>' +
        '<button type="button" class="linklike" id="stack-back">Back to arcade</button>');
      var a = document.getElementById('stack-again');
      if (a) a.addEventListener('click', function () { startGame(); });
      var b = document.getElementById('stack-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function startGame() {
      resetGrid(); bag = []; score = 0; lines = 0; level = 1; dropT = 0;
      state = 'playing'; api.hideOverlay(); spawn(); updateHud();
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + score + '</span><span>Lines: ' + lines + '</span><span>Level: ' + level + '</span><span>Best: ' + best + '</span>');
    }
    function drawCell(x, y, color, ghost) {
      var px = OX + x * CELL, py = OY + y * CELL;
      api.ctx.fillStyle = color;
      api.ctx.globalAlpha = ghost ? 0.25 : 1;
      api.ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      api.ctx.globalAlpha = 1;
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
      // its shape, not just its letter.
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
      ctx.fillText('← → move · ↻ turn · ↓ drop', 12, GAME_H - 12);
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('Paused — press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      dropT += dt;
      var interval = Math.max(0.08, 0.7 - (level - 1) * 0.06);
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
    function rotateCur() { if (state !== 'playing' || paused) return; var r = rotate(cur.shape); if (!collides(r, cur.x, cur.y)) cur.shape = r; }
    function softDrop() { if (state !== 'playing' || paused) return; if (!collides(cur.shape, cur.x, cur.y + 1)) cur.y++; else lock(); }
    function slam() { if (state !== 'playing' || paused) return; while (!collides(cur.shape, cur.x, cur.y + 1)) cur.y++; lock(); }
    document.addEventListener('keydown', onKey);
    function onKey(e) {
      if (state !== 'playing' || paused) return;
      var k = e.key.toLowerCase();
      if (k === 'arrowleft') moveLeft();
      else if (k === 'arrowright') moveRight();
      else if (k === 'arrowdown') softDrop();
      else if (k === 'arrowup') rotateCur();
      else if (k === ' ') { e.preventDefault(); slam(); }
    }
    // Touch controls: hold ← → ↓ to repeat, tap ↻ to turn, tap Slam to drop.
    var touchRow = makeTouchRow(api);
    touchRow.appendChild(makeTouchButton('←', moveLeft));
    touchRow.appendChild(makeTouchButton('↻', rotateCur, { repeat: false }));
    touchRow.appendChild(makeTouchButton('→', moveRight));
    touchRow.appendChild(makeTouchButton('↓', softDrop));
    touchRow.appendChild(makeTouchButton('Slam', slam, { repeat: false, wide: true }));
    api.actions.appendChild(el('p', 'game-note', 'Left and right to move, Up to turn, Down to drop faster, Space to slam it down. On touch, use the buttons under the window.'));
    api.showOverlay('<h3>Stained-Glass Stack</h3><p>Fit the falling panes into the window. Complete rows to clear them. ' + gameMark('stack') + '</p>' +
      '<button type="button" class="big-btn press" id="stack-start">Start stacking</button>');
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
    var perfectT = 0; // seconds left to show the Perfect flash after a clean drop
    var BASE_W = 120, BASE_Y = GAME_H - 20;
    function newStone() {
      var w = tower.length ? tower[tower.length - 1].w : BASE_W;
      moving = { x: -w / 2, w: w, dir: 1, speed: 130 + tower.length * 6 };
    }
    function startGame() {
      tower = []; score = 0; wind = 0; state = 'playing';
      api.hideOverlay(); newStone(); updateHud();
    }
    function drop() {
      if (state !== 'playing' || !moving) return;
      var top = tower.length ? tower[tower.length - 1] : { x: (GAME_W - BASE_W) / 2, w: BASE_W, y: BASE_Y };
      var left = Math.max(moving.x, top.x), right = Math.min(moving.x + moving.w, top.x + top.w);
      var overlap = right - left;
      if (overlap <= 0) { gameOver(); return; }
      var perfect = overlap / top.w > 0.9;
      var stone = { x: left, w: overlap, y: top.y - 18 };
      tower.push(stone);
      score += 1;
      if (perfect) { score += 10; perfectT = 1.2; }
      if (tower.length % 10 === 0) score += 100;
      if (tower.length >= 15) wind = (Math.random() - 0.5) * 40;
      updateHud();
      newStone();
    }
    function gameOver() {
      state = 'over';
      var fb = writeBest('steeple', score); best = fb;
      api.showOverlay('<h3>The steeple toppled</h3><p>Height: ' + tower.length + ' stones &middot; Score: ' + score + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="steeple-again">Build again</button>' +
        '<button type="button" class="linklike" id="steeple-back">Back to arcade</button>');
      var a = document.getElementById('steeple-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('steeple-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + score + '</span><span>Stones: ' + tower.length + '</span>' +
        '<span>' + (tower.length >= 15 ? 'Wind: ' + (wind >= 0 ? '→' : '←') + ' ' + Math.abs(Math.round(wind)) : 'Calm air') + '</span><span>Best: ' + best + '</span>');
    }
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = '#2e5e4e'; ctx.fillRect(0, GAME_H - 14, GAME_W, 14);
      ctx.fillStyle = '#6e1a26';
      ctx.fillRect((GAME_W - BASE_W) / 2, BASE_Y, BASE_W, 14);
      tower.forEach(function (s, i) {
        ctx.fillStyle = ['#6e1a26', '#b28a2e', '#2e5e4e', '#3a6ea5', '#8a6d3b'][i % 5];
        ctx.fillRect(s.x, s.y, s.w, 18);
        ctx.strokeStyle = '#33261a'; ctx.strokeRect(s.x, s.y, s.w, 18);
      });
      if (moving && state === 'playing') {
        ctx.fillStyle = '#b28a2e';
        ctx.fillRect(moving.x, 30, moving.w, 18);
        ctx.strokeStyle = '#33261a'; ctx.strokeRect(moving.x, 30, moving.w, 18);
        // Landing guide: a faint dashed outline of the stone projected onto
        // the tower top, with a thin line joining it to the moving stone,
        // so the player can judge the drop instead of guessing across the
        // gap between the top of the screen and the tower.
        var topY = tower.length ? tower[tower.length - 1].y : BASE_Y;
        ctx.strokeStyle = 'rgba(178,138,46,0.55)'; ctx.lineWidth = 1.5;
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
        ctx.fillText('Perfect! +10', GAME_W / 2, 90); ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
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
    function onKey(e) { if (e.key === ' ' && state === 'playing' && !paused) { e.preventDefault(); drop(); } }
    api.canvas.addEventListener('pointerdown', function () { drop(); });
    api.actions.appendChild(el('p', 'game-note', 'Tap the field or press Space to drop the stone. After stone fifteen the wind pushes it.'));
    api.showOverlay('<h3>Steeple Stack</h3><p>Drop each stone squarely on the last. Miss the tower and it topples. ' + gameMark('steeple') + '</p>' +
      '<button type="button" class="big-btn press" id="steeple-start">Start building</button>');
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

  // ================= Holy Water Havoc =================
  // Devil boss: waypoint drift, teleports, weighted attacks. Charge shots:
  // droplet, bolt, beam. Extra hearts at 800 and 2,000 points.
  function mountHoly(parent, onBack) {
    var api = createStage(parent, { title: 'Holy Water Havoc', onBack: onBack });
    var px = GAME_W / 2, hearts = 3, score = 0, best = readBest('holy');
    var boss = null, bossLevel = 1, shots = [], bolts = [], parts = [];
    var charge = 0, charging = false, state = 'ready', paused = false;
    var invulnT = 0; // seconds of grace after a hit: one bolt spread cannot
    // strip all three hearts in a single frame, and the player can see it.
    var heartsGiven = { 800: false, 2000: false };
    var raf = 0, last = 0, destroyed = false;
    var keys = makeKeys();
    // Touch state: held move buttons and the hold-to-charge fire button.
    var leftHeld = false, rightHeld = false, touchCharging = false;
    var WAYPOINTS = [{ x: 80, y: 70 }, { x: 240, y: 50 }, { x: 400, y: 70 }, { x: 150, y: 110 }, { x: 330, y: 110 }];
    function newBoss() {
      boss = { x: 240, y: 60, hp: 30 + bossLevel * 12, maxHp: 30 + bossLevel * 12, wp: 0, wpT: 0, atkT: 2, teleT: 9 };
    }
    function startGame() {
      px = GAME_W / 2; hearts = 3; score = 0; bossLevel = 1;
      shots = []; bolts = []; parts = []; charge = 0;
      heartsGiven = { 800: false, 2000: false };
      newBoss(); state = 'playing'; api.hideOverlay(); updateHud();
    }
    function fire() {
      var kind = charge > 1 ? 'beam' : charge > 0.4 ? 'bolt' : 'droplet';
      var dmg = kind === 'beam' ? 12 : kind === 'bolt' ? 6 : 3;
      shots.push({ x: px, y: GAME_H - 40, vy: kind === 'beam' ? -520 : -340, kind: kind, dmg: dmg, pierce: kind === 'beam' });
      charge = 0; charging = false;
    }
    function bossAttack() {
      var roll = Math.random();
      if (roll < 0.45) {
        for (var i = -1; i <= 1; i++) bolts.push({ x: boss.x, y: boss.y + 18, vx: i * 70, vy: 170, r: 6 });
      } else if (roll < 0.8) {
        var dx = px - boss.x, dy = (GAME_H - 30) - boss.y, len = Math.hypot(dx, dy) || 1;
        bolts.push({ x: boss.x, y: boss.y + 18, vx: (dx / len) * 230, vy: (dy / len) * 230, r: 7 });
      } else {
        for (var j = 0; j < 5; j++) bolts.push({ x: rand(40, GAME_W - 40), y: -10, vx: 0, vy: rand(120, 190), r: 6 });
      }
    }
    function checkHearts() {
      [800, 2000].forEach(function (t) {
        if (score >= t && !heartsGiven[t]) { heartsGiven[t] = true; hearts += 1; api.showBanner('+1 heart!', 1500); }
      });
    }
    function gameOver() {
      state = 'over';
      var fb = writeBest('holy', score); best = fb;
      api.showOverlay('<h3>The devil got away... this time</h3><p>Score: ' + score + ' &middot; Level: ' + bossLevel + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="holy-again">Play again</button>' +
        '<button type="button" class="linklike" id="holy-back">Back to arcade</button>');
      var a = document.getElementById('holy-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('holy-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + score + '</span><span>Hearts: ' + '♥'.repeat(Math.max(0, hearts)) + '</span><span>Boss level: ' + bossLevel + '</span><span>Best: ' + best + '</span>');
    }
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#1d1712'; ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = '#2a211a'; ctx.fillRect(0, GAME_H - 24, GAME_W, 24);
      // Boss
      if (boss) {
        ctx.fillStyle = '#b8452a';
        ctx.beginPath(); ctx.arc(boss.x, boss.y, 26, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fffdf7'; ctx.font = 'bold 12px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('😈', boss.x, boss.y + 4); ctx.textAlign = 'left';
        ctx.fillStyle = '#33261a'; ctx.fillRect(boss.x - 30, boss.y - 40, 60, 6);
        ctx.fillStyle = '#b8452a'; ctx.fillRect(boss.x - 30, boss.y - 40, 60 * Math.max(0, boss.hp / boss.maxHp), 6);
      }
      // Shots
      shots.forEach(function (s) {
        ctx.fillStyle = s.kind === 'beam' ? '#b28a2e' : s.kind === 'bolt' ? '#7fb3d5' : '#bcd8e8';
        if (s.kind === 'beam') { ctx.fillRect(s.x - 3, s.y - 26, 6, 26); }
        else { ctx.beginPath(); ctx.arc(s.x, s.y, s.kind === 'bolt' ? 6 : 4, 0, Math.PI * 2); ctx.fill(); }
      });
      bolts.forEach(function (b) {
        ctx.fillStyle = '#e05a2a';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      });
      // Player priest: blinks while invulnerable, so a hit reads clearly.
      ctx.globalAlpha = (invulnT > 0 && Math.floor(performance.now() / 120) % 2 === 0) ? 0.35 : 1;
      ctx.fillStyle = '#6e1a26';
      ctx.beginPath(); ctx.arc(px, GAME_H - 34, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b28a2e'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Georgia'; ctx.textAlign = 'center';
      ctx.fillText('F', px, GAME_H - 30); ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
      // Charge meter
      if (charging) {
        ctx.fillStyle = '#33261a'; ctx.fillRect(px - 25, GAME_H - 62, 50, 7);
        ctx.fillStyle = charge > 1 ? '#b28a2e' : charge > 0.4 ? '#7fb3d5' : '#bcd8e8';
        ctx.fillRect(px - 25, GAME_H - 62, 50 * clamp(charge / 1.2, 0, 1), 7);
        ctx.fillStyle = '#fffdf7'; ctx.font = '11px Georgia'; ctx.textAlign = 'center';
        ctx.fillText(charge > 1 ? 'BEAM' : charge > 0.4 ? 'BOLT' : 'droplet', px, GAME_H - 68); ctx.textAlign = 'left';
      }
      if (paused) {
        ctx.fillStyle = 'rgba(20,12,8,0.6)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('Paused — press P to resume', GAME_W / 2, GAME_H / 2); ctx.textAlign = 'left';
      }
    }
    function tick(dt) {
      if (paused || destroyed || state !== 'playing') return;
      var ax = keys.axis();
      var mx = ax.x + (rightHeld ? 1 : 0) - (leftHeld ? 1 : 0);
      px = clamp(px + mx * 260 * dt, 20, GAME_W - 20);
      var held = keys.pressed(' ') || touchCharging;
      if (held && !charging) { charging = true; charge = 0; }
      if (charging) charge += dt;
      if (!held && charging) fire();
      // Boss drift between waypoints
      if (boss) {
        var wp = WAYPOINTS[boss.wp];
        var dx = wp.x - boss.x, dy = wp.y - boss.y, len = Math.hypot(dx, dy) || 1;
        boss.x += (dx / len) * 42 * dt; boss.y += (dy / len) * 42 * dt;
        boss.wpT += dt;
        if (boss.wpT > 2.4) { boss.wpT = 0; boss.wp = (boss.wp + 1) % WAYPOINTS.length; }
        boss.teleT -= dt;
        if (boss.teleT <= 0) {
          boss.teleT = rand(7, 11);
          var nw = WAYPOINTS[randInt(0, WAYPOINTS.length - 1)];
          boss.x = nw.x; boss.y = nw.y;
        }
        boss.atkT -= dt;
        if (boss.atkT <= 0) { boss.atkT = Math.max(0.9, 2.2 - bossLevel * 0.12); bossAttack(); }
      }
      shots.forEach(function (s) { s.y += s.vy * dt; });
      shots = shots.filter(function (s) { return s.y > -30; });
      bolts.forEach(function (b) { b.x += b.vx * dt; b.y += b.vy * dt; });
      bolts = bolts.filter(function (b) { return b.y < GAME_H + 20 && b.x > -20 && b.x < GAME_W + 20; });
      // Shot vs boss
      shots = shots.filter(function (s) {
        if (boss && Math.abs(s.x - boss.x) < 30 && Math.abs(s.y - boss.y) < 30) {
          boss.hp -= s.dmg;
          score += s.dmg * 2;
          if (boss.hp <= 0) {
            score += 500;
            bossLevel += 1;
            api.showBanner('Devil banished! Level ' + bossLevel, 1800);
            newBoss();
          }
          checkHearts(); updateHud();
          return s.pierce;
        }
        return true;
      });
      if (invulnT > 0) invulnT -= dt;
      // Bolts vs player: a hit grants a short grace window, so one spread
      // cannot take more than one heart.
      for (var i = bolts.length - 1; i >= 0; i--) {
        var b = bolts[i];
        if (Math.hypot(b.x - px, b.y - (GAME_H - 34)) < 16) {
          bolts.splice(i, 1);
          if (invulnT > 0) continue;
          hearts -= 1; invulnT = 1.2; updateHud();
          if (hearts <= 0) { gameOver(); return; }
        }
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
    // Touch controls: hold ◀ ▶ to move, hold FIRE to charge, release to shoot.
    var touchRow = makeTouchRow(api);
    touchRow.appendChild(makeHoldButton('◀', function () { leftHeld = true; }, function () { leftHeld = false; }));
    touchRow.appendChild(makeHoldButton('▶', function () { rightHeld = true; }, function () { rightHeld = false; }));
    touchRow.appendChild(makeHoldButton('FIRE', function () { touchCharging = true; }, function () { touchCharging = false; }, { cls: 'fire-btn' }));
    api.actions.appendChild(el('p', 'game-note', 'Move with arrows. Hold Space to charge: droplet, bolt, then beam. Extra hearts at 800 and 2,000 points. On touch, hold the arrows to move and hold FIRE to charge, release to shoot.'));
    api.showOverlay('<h3>Holy Water Havoc</h3><p>The devil is loose in the sanctuary. Drive him off with holy water. ' + gameMark('holy') + '</p>' +
      '<button type="button" class="big-btn press" id="holy-start">Start the fight</button>');
    var s = document.getElementById('holy-start');
    if (s) s.addEventListener('click', startGame);
    updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      keys.cleanup();
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
    var prevPx = px, prevPy = py, pvx = 0, pvy = 0;
    var state = 'ready', paused = false, raf = 0, last = 0, destroyed = false;
    var keys = makeKeys();
    var dpadVec = { x: 0, y: 0 };
    function startGame() {
      px = GAME_W / 2; py = GAME_H / 2; score = 0; elapsed = 0; bellT = 60; warmupT = 6;
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
          releaseAt: [0, 0, 0, 12, 20, 30, 40][i] || 0, announced: false };
      });
      spawnHalo(); spawnHalo(); spawnHalo();
      state = 'playing'; api.hideOverlay(); updateHud();
    }
    function spawnHalo() { halos.push({ x: rand(30, GAME_W - 30), y: rand(30, GAME_H - 30) }); }
    function gameOver() {
      state = 'over';
      var finalScore = Math.floor(score);
      var fb = writeBest('flee', finalScore); best = fb;
      api.showOverlay('<h3>The sins caught up</h3><p>Score: ' + finalScore + ' &middot; Survived: ' + Math.floor(elapsed) + 's<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="flee-again">Run again</button>' +
        '<button type="button" class="linklike" id="flee-back">Back to arcade</button>');
      var a = document.getElementById('flee-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('flee-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + Math.floor(score) + '</span><span>Halos: +25 each</span>' +
        '<span>Bell in: ' + Math.ceil(bellT) + 's</span><span>Best: ' + best + '</span>');
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
      sins.forEach(function (s) {
        if (elapsed < s.releaseAt) return; // not yet in the hunt
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 13, 0, Math.PI * 2); ctx.fill();
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
        bellT = 60;
        sins.forEach(function (s) {
          var dx = s.x - px, dy = s.y - py, len = Math.hypot(dx, dy) || 1;
          s.x = clamp(s.x + (dx / len) * 120, 20, GAME_W - 20);
          s.y = clamp(s.y + (dy / len) * 120, 20, GAME_H - 20);
        });
        api.showBanner('The confession bell rings — the sins fall back!', 1800);
      }
      if (dashT > 0) dashT -= dt;
      if (dashCd > 0) dashCd -= dt;
      var ax = keys.axis();
      var dx = ax.x + dpadVec.x, dy = ax.y + dpadVec.y;
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
        var sp = s.speed * warm * (s.hunt === 'patrol' ? 0.7 : 1);
        s.x += (ddx / l) * sp * dt;
        s.y += (ddy / l) * sp * dt;
      });
      for (var i = halos.length - 1; i >= 0; i--) {
        if (Math.hypot(halos[i].x - px, halos[i].y - py) < 20) {
          halos.splice(i, 1); score += 25; spawnHalo(); updateHud();
        }
      }
      if (dashT <= 0) {
        for (var j = 0; j < sins.length; j++) {
          if (elapsed < sins[j].releaseAt) continue;
          if (Math.hypot(sins[j].x - px, sins[j].y - py) < 20) { gameOver(); return; }
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
    function onKey(e) {
      if (e.key === ' ' && state === 'playing' && !paused && dashCd <= 0) {
        e.preventDefault(); dashT = 0.45; dashCd = 2;
      }
    }
    makeDpad(api.stage, function (dx, dy, active) {
      if (active) { dpadVec.x = dx; dpadVec.y = dy; } else { dpadVec.x = 0; dpadVec.y = 0; }
    });
    var dashBtn = el('button', 'press', 'Grace-dash (Space)'); dashBtn.type = 'button';
    dashBtn.addEventListener('click', function () {
      if (state === 'playing' && !paused && dashCd <= 0) { dashT = 0.45; dashCd = 2; }
    });
    api.actions.appendChild(dashBtn);
    api.actions.appendChild(el('p', 'game-note', 'Halos are +25. Space dashes through the sins. The bell rings every 60 seconds.'));
    api.showOverlay('<h3>Flee the Sins</h3><p>Seven sins are chasing you. Grab halos, dash with grace, and listen for the bell. ' + gameMark('flee') + '</p>' +
      '<button type="button" class="big-btn press" id="flee-start">Start running</button>');
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
    var px = GAME_W / 2, py = GAME_H - 18, lives = 3, score = 0, level = 1, best = readBest('cross');
    var cars = [], floats = [], mothDoor = 0, bellT = 60;
    var state = 'ready', paused = false, raf = 0, last = 0, destroyed = false;
    var keys = makeKeys();
    var dpadVec = { x: 0, y: 0 };
    var moveCd = 0;
    var riverT = 0; // grace in the water: a mistimed step is recoverable for 0.6s
    function buildLevel() {
      cars = [];
      LANE_Y.forEach(function (y, i) {
        var dir = i % 2 === 0 ? 1 : -1;
        // Level 1 is the welcome mat: slower cars and only three per lane, so
        // a first-time player can read the gaps and cross. It ramps up after.
        var speed = (45 + level * 10) * (0.8 + Math.random() * 0.5);
        var n = level === 1 ? 3 : 3 + Math.floor(Math.random() * 2);
        for (var k = 0; k < n; k++) {
          cars.push({ y: y, x: rand(0, GAME_W), dir: dir, speed: speed, w: rand(34, 52) });
        }
      });
      floats = [];
      for (var r = 0; r < 3; r++) {
        var y = RIVER_TOP + 14 + r * 26;
        var dir2 = r % 2 === 0 ? 1 : -1;
        var n2 = 3;
        for (var k2 = 0; k2 < n2; k2++) {
          floats.push({ y: y, x: rand(0, GAME_W), dir: dir2, speed: 45 + level * 6, w: rand(52, 84), kind: k2 === 1 ? 'turtle' : 'log' });
        }
      }
      mothDoor = randInt(0, 4);
    }
    function startGame() {
      px = GAME_W / 2; py = GAME_H - 18; lives = 3; score = 0; level = 1; bellT = 60;
      buildLevel(); state = 'playing'; api.hideOverlay(); updateHud();
    }
    function resetSpot() { px = GAME_W / 2; py = GAME_H - 18; }
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
        '<button type="button" class="linklike" id="cross-back">Back to arcade</button>');
      var a = document.getElementById('cross-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('cross-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function reachDoor(i) {
      if (i === mothDoor) {
        score += 250 + level * 50;
        api.showBanner('Through the right door! +' + (250 + level * 50), 1600);
        level += 1; bellT = 60; buildLevel(); resetSpot(); updateHud();
      } else {
        loseLife('Wrong door');
      }
    }
    function updateHud() {
      api.setHud('<span class="score">Score: ' + score + '</span><span>Lives: ' + '♥'.repeat(Math.max(0, lives)) + '</span>' +
        '<span>Level: ' + level + '</span><span>Bell: ' + Math.ceil(bellT) + 's</span><span>Best: ' + best + '</span>');
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
      // Moth circling the right door
      var mt = performance.now() / 300;
      var mx = DOOR_X[mothDoor] + Math.cos(mt) * 18, my = 52 + Math.sin(mt * 1.3) * 8;
      ctx.fillStyle = '#fffdf7';
      ctx.beginPath(); ctx.ellipse(mx, my, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      // River
      ctx.fillStyle = '#3a6ea5'; ctx.fillRect(0, RIVER_TOP, GAME_W, RIVER_BOT - RIVER_TOP);
      floats.forEach(function (f) {
        ctx.fillStyle = f.kind === 'turtle' ? '#2e5e4e' : '#8a6d3b';
        ctx.fillRect(f.x - f.w / 2, f.y - 8, f.w, 16);
        if (f.kind === 'turtle') { ctx.fillStyle = '#fffdf7'; ctx.font = '10px Georgia'; ctx.fillText('~', f.x - 3, f.y + 3); }
      });
      // Road lanes
      ctx.fillStyle = '#33261a'; ctx.fillRect(0, LANE_Y[4] - 14, GAME_W, LANE_Y[0] - LANE_Y[4] + 28);
      ctx.strokeStyle = 'rgba(251,247,239,0.5)'; ctx.setLineDash([10, 10]);
      LANE_Y.forEach(function (y) { ctx.beginPath(); ctx.moveTo(0, y + 14); ctx.lineTo(GAME_W, y + 14); ctx.stroke(); });
      ctx.setLineDash([]);
      cars.forEach(function (c) {
        ctx.fillStyle = c.dir > 0 ? '#b8452a' : '#b28a2e';
        ctx.fillRect(c.x - c.w / 2, c.y - 9, c.w, 18);
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
      if (moveCd <= 0 && (dx !== 0 || dy !== 0)) {
        moveCd = 0.16;
        px = clamp(px + dx * 24, 14, GAME_W - 14);
        py = clamp(py + dy * 24, 18, GAME_H - 14);
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
      });
      // Ride a log or turtle. A mistimed step into the water is recoverable
      // for a beat: the player can step back to the road or onto a float
      // before the river takes a life, instead of dying on one bad step.
      if (onRiver()) {
        var riding = null;
        floats.forEach(function (f) {
          if (Math.abs(py - f.y) < 12 && Math.abs(px - f.x) < f.w / 2) riding = f;
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
    makeDpad(api.stage, function (dx, dy, active) {
      if (active) { dpadVec.x = dx; dpadVec.y = dy; } else { dpadVec.x = 0; dpadVec.y = 0; }
    });
    api.actions.appendChild(el('p', 'game-note', 'Cross the road, ride the logs and turtles, and enter the door the moth circles before the bell.'));
    api.showOverlay('<h3>Father\u2019s Crossing</h3><p>Five lanes of traffic, a river, and five church doors. Follow the moth. ' + gameMark('cross') + '</p>' +
      '<button type="button" class="big-btn press" id="cross-start">Start crossing</button>');
    var s = document.getElementById('cross-start');
    if (s) s.addEventListener('click', startGame);
    updateHud();
    last = performance.now(); raf = requestAnimationFrame(loop);
    return function cleanup() {
      destroyed = true; cancelAnimationFrame(raf);
      keys.cleanup();
      cleanupPause();
    };
  }

  // ================= Parish Pastor =================
  // 16-week season, shuffled 16-of-35 deck, start 140 / 3000 / 65.
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
    var card = el('div', 'pastor-card');
    wrap.appendChild(card);
    var ledger = el('div', 'pastor-ledger');
    wrap.appendChild(ledger);
    parent.appendChild(wrap);
    var deck = [], week = 0, cong = 140, funds = 3000, happy = 65, over = false;
    var best = readBest('pastor');
    function parishName() {
      try { return localStorage.getItem('rmf-parish-bowl-parish') || 'St Mary\u2019s'; } catch (e) { return 'St Mary\u2019s'; }
    }
    function personalise(text) {
      var name = parishName();
      return text.replace(/St Mary'?s/g, name);
    }
    function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(); }
    function renderStats() {
      stats.innerHTML = '<span>Week ' + Math.min(week + 1, PASTOR_WEEKS) + ' of ' + PASTOR_WEEKS + '</span>' +
        '<span>Congregation: <b>' + cong + '</b></span>' +
        '<span>Funds: <b>' + money(funds) + '</b></span>' +
        '<span>Happiness: <b>' + happy + '</b></span>' +
        '<span>Best: ' + best + '</span>';
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
      card.innerHTML = '<h3>' + esc(reason) + '</h3>' +
        '<p>Final congregation: ' + cong + ' &middot; Funds: ' + money(funds) + ' &middot; Happiness: ' + happy + '<br>' +
        'Season score: <b>' + score + '</b> &middot; Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="pastor-again">New season</button> ' +
        '<button type="button" class="linklike" id="pastor-back2">Back to arcade</button>';
      var a = document.getElementById('pastor-again');
      if (a) a.addEventListener('click', startSeason);
      var b = document.getElementById('pastor-back2');
      if (b) b.addEventListener('click', function () { onBack(); });
      renderStats();
    }
    function showWeek() {
      var ev = deck[week];
      // Deck entries are [title, text, choice, choice, choice]: the choices
      // are ev[2..4], not ev[2] itself. (An earlier build iterated ev[2],
      // which is the first choice array, and rendered five garbage buttons
      // while every pick corrupted the numbers to NaN.)
      var choices = ev.slice(2);
      var html = '<h3>Week ' + (week + 1) + ' — ' + esc(ev[0]) + '</h3><p>' + esc(personalise(ev[1])) + '</p><div class="pastor-choices">';
      choices.forEach(function (ch, i) {
        html += '<button type="button" class="pastor-choice press" data-i="' + i + '">' + esc(ch[0]) +
          '<span class="pastor-delta">' + (ch[2] >= 0 ? '+' : '') + ch[2] + ' people &middot; ' + (ch[3] >= 0 ? '+' : '') + money(ch[3]) + ' &middot; ' + (ch[4] >= 0 ? '+' : '') + ch[4] + ' happy</span></button>';
      });
      html += '</div>';
      card.innerHTML = html;
      card.querySelectorAll('.pastor-choice').forEach(function (btn) {
        btn.addEventListener('click', function () { choose(parseInt(btn.getAttribute('data-i'), 10)); });
      });
      renderStats();
    }
    function choose(i) {
      if (over) return;
      var ev = deck[week];
      var ch = ev[2 + i];
      cong += ch[2]; funds += ch[3]; happy += ch[4];
      var collection = Math.round(cong * (happy / 100) * 2.2);
      var costs = 120 + Math.round(cong * 0.3);
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
      deck = PASTOR_DECK.slice();
      for (var i = deck.length - 1; i > 0; i--) { var j = randInt(0, i); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
      deck = deck.slice(0, PASTOR_WEEKS);
      week = 0; cong = 140; funds = 3000; happy = 65; over = false;
      ledger.innerHTML = '';
      showWeek();
    }
    card.innerHTML = '<h3>Parish Pastor</h3><p>Shepherd your parish for 16 weeks. Every decision moves the congregation, the funds, and the happiness of the parish. Keep the pews full, the books out of the red, and the people glad. ' + gameMark('pastor') + '</p>' +
      '<button type="button" class="big-btn press" id="pastor-start">Begin the season</button>';
    var s = document.getElementById('pastor-start');
    if (s) s.addEventListener('click', startSeason);
    renderStats();
    return function cleanup() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
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
    var MODE_SEQ = [7, 20, 7, 20, 5, Infinity]; // scatter, chase, scatter, chase, scatter, chase forever
    function modeName() { return modeIdx % 2 === 0 ? 'scatter' : 'chase'; }
    function playerSpeed() { return Math.min(126, 111 + 3 * (level - 1)); }
    function sinSpeed(s) {
      var sp = Math.min(122, 100 + 5 * (level - 1));
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
      sins = SINS_DEF.map(function (d) {
        return { name: d.name, color: d.color, release: d.release, corner: d.corner,
          c: d.spawn[0], r: d.spawn[1], tc: d.spawn[0], tr: d.spawn[1],
          x: tileX(d.spawn[0]), y: tileY(d.spawn[1]), dx: 0, dy: 0,
          active: d.release === 0, leaving: true, state: 'normal', eyesPhase: 0, waitT: 0 };
      });
      sins[0].dx = 0; sins[0].dy = -1; sins[0].tc = 9; sins[0].tr = 6;
      modeIdx = 0; modeT = 7; frightT = 0; frightChain = 0; elapsed = 0;
    }
    function startGame() {
      score = 0; level = 1; lives = 3; flawless = true;
      extraGiven = { 10000: false, 30000: false };
      buildMaze(); resetPositions();
      state = 'playing'; api.hideOverlay(); updateHud();
    }
    function nextLevel() {
      if (flawless) { score += 500; api.showBanner('Flawless vigil! +500', 1800); }
      level += 1; flawless = true;
      buildMaze(); resetPositions();
      api.showBanner('Vigil ' + level + ' — the candles are lit again', 1800);
      updateHud();
    }
    function gameOver() {
      state = 'over';
      var fb = writeBest('maze', score); best = fb;
      api.showOverlay('<h3>The candles go dark</h3><p>Grace: ' + score + ' &middot; Vigil reached: ' + level + '<br>Best: ' + fb + '</p>' +
        '<button type="button" class="big-btn press" id="maze-again">Light the candles again</button>' +
        '<button type="button" class="linklike" id="maze-back">Back to arcade</button>');
      var a = document.getElementById('maze-again');
      if (a) a.addEventListener('click', startGame);
      var b = document.getElementById('maze-back');
      if (b) b.addEventListener('click', function () { onBack(); });
      updateHud();
    }
    function updateHud() {
      var dark = Object.keys(candles).length + Object.keys(vials).length;
      api.setHud('<span class="score">Grace: ' + score + '</span><span>Vigil: ' + level + '</span>' +
        '<span>Hearts: ' + '♥'.repeat(Math.max(0, lives)) + '</span>' +
        '<span>Candles still dark: ' + dark + '</span><span>Best: ' + best + '</span>');
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
        if (left === 25 && !called25) { called25 = true; api.showBanner('25 candles still dark', 1500); }
        if (left === 10 && !called10) { called10 = true; api.showBanner('10 candles still dark', 1500); }
        if (chaliceSpawned === 0 && candlesEaten >= 70) { chaliceSpawned = 1; chaliceActive = true; chaliceT = 9; api.showBanner('A golden chalice appears!', 1600); }
        else if (chaliceSpawned === 1 && candlesEaten >= 120 && !chaliceActive) { chaliceSpawned = 2; chaliceActive = true; chaliceT = 9; api.showBanner('Another golden chalice appears!', 1600); }
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
    function die() {
      lives -= 1; flawless = false; updateHud();
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
        ctx.fillStyle = frightT > 0 ? '#bcd8e8' : s.color;
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
          if (d < 13) { die(); return; }
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
    function onKey(e) {
      var k = e.key.toLowerCase();
      if (k === 'r' && state === 'over') { startGame(); return; }
      if (k === ' ' && state === 'ready') { e.preventDefault(); startGame(); return; }
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
    api.canvas.addEventListener('pointerup', function (e) {
      if (!swipeStart) return;
      var dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.hypot(dx, dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 1 : -1, 0);
      else steer(0, dy > 0 ? 1 : -1);
    });
    api.actions.appendChild(el('p', 'game-note', 'Arrows or WASD to steer, swipe on the field, or use the pad. Light every candle; the vials turn the sins edible. R restarts.'));
    api.showOverlay('<h3>Candle Maze</h3><p>Light every candle in the cloister while four sins hunt you. Holy water turns the tables. ' + gameMark('maze') + '</p>' +
      '<button type="button" class="big-btn press" id="maze-start">Light the first candle</button>');
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
  function dashRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function genDashLayout(seed) {
    var rnd = dashRng(seed);
    var L = {
      spikes: [], pews: [], clouds: [], censers: [], orbs: [],
      gates: [{ x: 1500, m: 1.25 }, { x: 3300, m: 0.8 }, { x: 5100, m: 1.3 }, { x: 7350, m: 0.85 }, { x: 8450, m: 1.25 }],
      doveCols: [], flipSpikes: [],
    };
    function inSpecial(x) {
      return (x > 1980 && x < 3070) || (x > 3830 && x < 4820) || (x > 5530 && x < 6620);
    }
    var x = 620;
    while (x < 9000) {
      if (!inSpecial(x)) {
        var n = 1 + Math.floor(rnd() * 3);
        for (var i = 0; i < n; i++) L.spikes.push({ x: x + i * 26, w: 24 });
        x += 380 + rnd() * 260;
      } else x += 120;
    }
    x = 900;
    while (x < 8900) { if (!inSpecial(x)) L.pews.push({ x: x, w: 70 + rnd() * 30, h: 46 + rnd() * 20 }); x += 750 + rnd() * 350; }
    x = 1100;
    while (x < 8900) { if (!inSpecial(x)) L.clouds.push({ x: x, w: 54 }); x += 950 + rnd() * 400; }
    x = 1000;
    while (x < 8900) { if (!inSpecial(x)) L.censers.push({ x: x, phase: rnd() * Math.PI * 2 }); x += 850 + rnd() * 350; }
    x = 800;
    while (x < 8900) { if (!inSpecial(x)) L.orbs.push({ x: x, y: 150 + rnd() * 70, used: false }); x += 620 + rnd() * 300; }
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
    var layout = genDashLayout(seed);
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
    var QUARTER_X = [2300, 4600, 6900, 8280];
    function score() { return Math.floor(dist / 10) + bonus; }
    function speedNow() { return Math.min(430, 250 + dist * 0.045) * gateMult; }
    function screenX(wx) { return wx - dist + 120; }
    function startRun(newSeed) {
      if (typeof newSeed === 'number') { seed = newSeed; layout = genDashLayout(seed); }
      dist = 0; y = DASH_FLOOR - DASH_CUBE / 2; vy = 0; grounded = true;
      gateIdx = -1; gateMult = 1; bonus = 0; chain = 0;
      quarters = [false, false, false, false]; depthAwarded = false;
      coyoteT = 0; bufferT = 0; mercyT = 0; rot = 0; mode = 'normal'; runT = 0;
      checkpoint = null; practiceDeaths = 0;
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
      api.showOverlay('<h3>' + esc(title) + '</h3><p>' + (why ? esc(why) + '<br>' : '') +
        'Score: ' + sc + ' &middot; Reached: ' + pct + '% &middot; Best: ' + fb + '<br>' +
        'Best depth: ' + newDepth + '% &middot; Attempt: ' + attempts +
        (practice ? '<br>Practice deaths: ' + practiceDeaths : '') + '</p>' +
        '<button type="button" class="big-btn press" id="dash-retry">Retry this course</button> ' +
        '<button type="button" class="big-btn press" id="dash-again">Run again</button> ' +
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
        '<span>Speed x' + gateMult + '</span><span>Best: ' + best + '</span>' +
        (practice ? '<span>Practice</span>' : ''));
    }
    function draw() {
      var ctx = api.ctx;
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, GAME_W, GAME_H);
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
      // Cube / dove
      var cx = 120, cy = y;
      ctx.save();
      ctx.translate(cx, cy);
      if (mode === 'dove') {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b28a2e';
        ctx.beginPath(); ctx.ellipse(-8, -6, 10, 4, -0.5, 0, Math.PI * 2); ctx.fill();
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
      if (coyoteT > 0) coyoteT -= dt;
      if (bufferT > 0) bufferT -= dt;
      var prevBottom = y + DASH_CUBE / 2;
      dist += speedNow() * dt;
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
              if (!grounded) { grounded = true; rot = 0; chain = 0; }
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
            if (Math.hypot(bx - dist, by - y) < 27) { die('Struck by a swinging censer'); return; }
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
    function onKey(e) {
      var k = e.key.toLowerCase();
      if (k === 'r' && state === 'over') { startRun(Math.floor(Math.random() * 1e9)); return; }
      if (k === ' ' && state === 'ready') { e.preventDefault(); startRun(seed); return; }
      if ((k === ' ' || k === 'arrowup' || k === 'w') && state === 'playing' && !paused) {
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
    api.actions.appendChild(el('p', 'game-note', 'Space, Up, W, click or tap to jump. Hold to keep hopping; in dove stretches hold to rise and release to fall. R restarts.'));
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
    api.showOverlay('<h3>Sanctuary Dash</h3><p>The golden cube never stops. Jump the thorns, ride the pews, mind the censers, and reach the sanctuary 9,200px down the nave. ' + gameMark('dash') + '</p>' +
      '<button type="button" class="big-btn press" id="dash-start">Start the run</button>');
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
