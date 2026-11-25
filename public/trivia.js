// Daily trivia: a round of three questions, one at a time, four
// multiple choice answers each. There is no timer and no time limit:
// take as long as you like on a question. A right answer earns 500 to
// 1,000 points depending on speed: answer instantly for 1,000, and the
// points on offer tick down to a floor of 500, where they stay, so a
// slow right answer is still worth 500. A wrong answer earns nothing
// for that question. After each answer the correct one is shown with a
// one-line explanation and the points earned, then the next question.
// The round posts its points, correct count, total time, and an optional
// display name for the shared daily leaderboard (top five names and
// points for the day, most points first, fastest time breaking ties).
// The name is remembered in this browser only, so a returning player
// does not type it twice. A blocked name is refused by the server and
// the score is not saved under it; the player is asked to pick a
// different name.
// The day's questions come from window.RMF_TRIVIA (rendered into the
// homepage by the server); the answer order is shuffled per round so the
// right answer is not always in the same spot. Keyboard: 1-4 or A-D
// answers a question, Enter moves on, so a round can be played without
// touching the mouse.
(function () {
  var root = document.getElementById('trivia');
  if (!root || !window.RMF_TRIVIA || !window.RMF_TRIVIA.questions) return;
  var questions = window.RMF_TRIVIA.questions;
  var startBtn = document.getElementById('trivia-start');
  var nameInput = document.getElementById('trivia-name');
  var panel = document.getElementById('trivia-panel');
  var bestLine = document.getElementById('trivia-best');
  var board = document.getElementById('trivia-board');
  var state = null; // { i, points, correct, startedAt, finishedAt, answered, qStartedAt }
  var timerId = null;
  var LETTERS = ['A', 'B', 'C', 'D'];
  // How long the points on offer take to decay from 1,000 to the 500
  // floor. This is not a time limit: after it passes, a right answer
  // is still worth 500 and there is no time-out.
  var POINTS_DECAY_SECONDS = 10;
  var NAME_KEY = 'rmf_trivia_name';

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function fmtMs(ms) {
    var s = Math.round(ms / 1000);
    return s + (s === 1 ? ' second' : ' seconds');
  }

  function fmtPoints(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // A right answer is worth 1,000 instantly, decaying linearly to a
  // floor of 500 over POINTS_DECAY_SECONDS, where it stays no matter
  // how long the player takes. Wrong is 0.
  function pointsFor(correct, elapsedMs) {
    if (!correct) return 0;
    var t = Math.max(0, Math.min(POINTS_DECAY_SECONDS * 1000, elapsedMs));
    return 500 + Math.round(500 * (1 - t / (POINTS_DECAY_SECONDS * 1000)));
  }

  function readName() {
    var v = nameInput ? nameInput.value.trim().replace(/\s+/g, ' ') : '';
    return v || 'Anonymous';
  }

  function rememberName() {
    try {
      var v = nameInput ? nameInput.value.trim() : '';
      if (v) localStorage.setItem(NAME_KEY, v);
    } catch (e) { /* private mode: the name just is not remembered */ }
  }

  function stopTicker() {
    if (timerId !== null) { clearInterval(timerId); timerId = null; }
  }

  // The points on offer tick down live (1,000 toward the 500 floor) so
  // the player can feel the speed matter. There is no clock, no
  // countdown, and no time-out: the ticker only moves the points.
  function startTicker() {
    stopTicker();
    if (typeof setInterval !== 'function') return;
    timerId = setInterval(function () {
      if (!state || state.answered) return;
      var elapsed = Date.now() - state.qStartedAt;
      var pts = document.getElementById('trivia-offer-points');
      if (pts) pts.textContent = fmtPoints(pointsFor(true, elapsed)) + ' pts';
    }, 100);
  }

  function showFeedback(btn, earned) {
    var q = questions[state.i];
    if (state.i + 1 >= questions.length) {
      state.finishedAt = Date.now();
    }
    panel.querySelectorAll('.trivia-answer').forEach(function (b) {
      b.disabled = true;
      if (b.getAttribute('data-correct') === '1') b.classList.add('is-correct');
      else if (b === btn) b.classList.add('is-wrong');
    });
    var feedback = panel.querySelector('.trivia-feedback');
    var verdict = earned > 0 ? 'Correct.' : 'Not quite.';
    var pointsLine = earned > 0
      ? '<p class="trivia-earned">+' + fmtPoints(earned) + ' points' + (earned >= 900 ? ' — quick!' : '') + '</p>'
      : '<p class="trivia-earned">No points for this one.</p>';
    feedback.hidden = false;
    feedback.innerHTML = '<p><strong>' + verdict + '</strong> ' + q.why + '</p>' + pointsLine
      + '<p><button type="button" class="btn btn--gold btn-pill press" id="trivia-next">'
      + (state.i + 1 >= questions.length ? 'See your score' : 'Next question') + '</button></p>';
    var nextBtn = document.getElementById('trivia-next');
    nextBtn.addEventListener('click', function () {
      state.i++;
      state.answered = false;
      render();
    });
    nextBtn.focus();
  }

  function render() {
    if (!state) { panel.innerHTML = ''; return; }
    var q = questions[state.i];
    if (!q) { renderDone(); return; }
    state.qStartedAt = Date.now();
    var order = shuffle([0, 1, 2, 3]);
    var html = '<p class="trivia-count">Question ' + (state.i + 1) + ' of ' + questions.length + ' &middot; ' + q.topic + ' &middot; <span id="trivia-offer-points">1,000 pts</span></p>'
      + '<h3 class="trivia-q">' + q.q + '</h3>'
      + '<div class="trivia-answers">' + order.map(function (oi, pos) {
        return '<button type="button" class="trivia-answer" data-pos="' + pos + '" data-correct="' + (oi === q.correct ? '1' : '0') + '" aria-label="' + LETTERS[pos] + ': ' + q.answers[oi].replace(/"/g, '&quot;') + '"><span class="trivia-key" aria-hidden="true">' + LETTERS[pos] + '</span><span class="trivia-answer-text">' + q.answers[oi] + '</span></button>';
      }).join('') + '</div>'
      + '<p class="trivia-running">Score so far: <strong>' + fmtPoints(state.points) + ' points</strong></p>'
      + '<div class="trivia-feedback" hidden></div>';
    panel.innerHTML = html;
    startTicker();
    panel.querySelectorAll('.trivia-answer').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state.answered) return;
        state.answered = true;
        stopTicker();
        var elapsed = Date.now() - state.qStartedAt;
        var right = btn.getAttribute('data-correct') === '1';
        var earned = pointsFor(right, elapsed);
        if (right) { state.points += earned; state.correct++; }
        showFeedback(btn, earned);
      });
    });
  }

  function renderBoard(top) {
    if (!board) return;
    board.innerHTML = '';
    (top || []).forEach(function (r, i) {
      var li = document.createElement('li');
      var rank = document.createElement('span');
      rank.className = 'trivia-rank';
      rank.textContent = String(i + 1);
      var nm = document.createElement('span');
      nm.className = 'trivia-board-name';
      nm.textContent = r.name;
      var pts = document.createElement('span');
      pts.className = 'trivia-board-points';
      pts.textContent = fmtPoints(r.points) + ' pts';
      li.appendChild(rank);
      li.appendChild(nm);
      li.appendChild(pts);
      board.appendChild(li);
    });
  }

  function postScore() {
    var ms = (state.finishedAt || Date.now()) - state.startedAt;
    var name = readName();
    return fetch('/api/trivia/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, points: state.points, correct: state.correct, ms: ms }),
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); });
  }

  function renderDone() {
    stopTicker();
    var ms = (state.finishedAt || Date.now()) - state.startedAt;
    var total = questions.length;
    panel.innerHTML = '<h3 class="trivia-q">You scored ' + fmtPoints(state.points) + ' points.</h3>'
      + '<p class="trivia-time">' + state.correct + ' out of ' + total + ' right, finished in ' + fmtMs(ms) + '.</p>'
      + '<p class="trivia-best-update" id="trivia-best-update">Saving your score&hellip;</p>'
      + '<p><button type="button" class="btn btn--gold btn-pill press" id="trivia-again">Play again</button></p>';
    document.getElementById('trivia-again').addEventListener('click', startRound);
    // The round is over, so the name can be changed again (for example
    // when the name just typed was refused by the server).
    if (nameInput) nameInput.disabled = false;
    rememberName();
    submitAndShow();

    function submitAndShow() {
      var line = document.getElementById('trivia-best-update');
      if (line) line.textContent = 'Saving your score\u2026';
      postScore().then(function (res) {
        var d = res.data;
        if (res.status === 400 && d && d.error === 'bad name') {
          showBadName(line);
          return;
        }
        applyScoreResult(res);
      }).catch(function () {
        var l = document.getElementById('trivia-best-update');
        if (l) l.textContent = 'Your score could not be saved this time. The round still counts locally.';
      });
    }

    function showBadName(line) {
      if (!line) return;
      line.textContent = 'That name cannot go on the leaderboard. Please choose a different name, then save again.';
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn--gold btn-pill press';
      retry.textContent = 'Save with this name';
      retry.addEventListener('click', function () {
        if (nameInput) nameInput.focus();
        submitAndShow();
      });
      line.appendChild(document.createTextNode(' '));
      line.appendChild(retry);
    }

    function applyScoreResult(res) {
      var d = res.data;
      var line = document.getElementById('trivia-best-update');
      if (!d || !d.best) return;
      if (d.top) renderBoard(d.top);
      if (bestLine) {
        bestLine.textContent = "Today's best: " + d.best.name + ' \u2014 ' + fmtPoints(d.best.points) + ' points (' + d.best.correct + ' of ' + total + ' right, ' + fmtMs(d.best.ms) + ').';
      }
      if (!line) return;
      if (d.isNewBest) {
        line.textContent = "That's today's best score so far.";
      } else if (d.rank) {
        line.textContent = 'You are #' + d.rank + ' on today\u2019s leaderboard. ' + d.best.name + ' leads with ' + fmtPoints(d.best.points) + ' points.';
      } else {
        line.textContent = "Today's best is " + d.best.name + ' with ' + fmtPoints(d.best.points) + ' points.';
      }
    }
  }

  function startRound() {
    state = { i: 0, points: 0, correct: 0, startedAt: Date.now(), finishedAt: 0, answered: false, qStartedAt: 0 };
    startBtn.hidden = true;
    if (nameInput) nameInput.disabled = true;
    render();
  }

  // Keyboard play: 1-4 or A-D picks an answer, Enter advances after one
  // and starts a fresh round from the done screen.
  document.addEventListener('keydown', function (e) {
    if (!state || !startBtn.hidden) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Enter' || e.key === ' ') {
      var againBtn = document.getElementById('trivia-again');
      if (againBtn) { e.preventDefault(); againBtn.click(); return; }
      if (state.answered) {
        var nextBtn = document.getElementById('trivia-next');
        if (nextBtn) { e.preventDefault(); nextBtn.click(); }
      }
      return;
    }
    if (state.answered) return;
    var pos = -1;
    if (e.key >= '1' && e.key <= '4') pos = Number(e.key) - 1;
    else if (/^[a-dA-D]$/.test(e.key)) pos = e.key.toLowerCase().charCodeAt(0) - 97;
    if (pos >= 0) {
      var btns = panel.querySelectorAll('.trivia-answer');
      if (btns[pos]) { e.preventDefault(); btns[pos].click(); }
    }
  });

  // Remember the name in this browser so a returning player does not
  // type it twice. The name is only a leaderboard label, nothing more.
  try {
    var saved = localStorage.getItem(NAME_KEY);
    if (saved && nameInput) nameInput.value = saved;
  } catch (e) { /* private mode */ }

  if (startBtn) startBtn.addEventListener('click', startRound);
})();
