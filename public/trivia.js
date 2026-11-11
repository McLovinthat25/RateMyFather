// Daily trivia, Kahoot style: a round of three questions, one at a time,
// four multiple choice answers each. After each answer the correct one is
// shown with a one-line explanation, then the next question. The score is
// posted at the end of the round for the shared daily high score.
// The day's questions come from window.RMF_TRIVIA (rendered into the
// homepage by the server); the answer order is shuffled per round so the
// right answer is not always in the same spot, and the round timer runs
// from Start to the last answer (the daily best ties on fastest time).
(function () {
  var root = document.getElementById('trivia');
  if (!root || !window.RMF_TRIVIA || !window.RMF_TRIVIA.questions) return;
  var questions = window.RMF_TRIVIA.questions;
  var startBtn = document.getElementById('trivia-start');
  var panel = document.getElementById('trivia-panel');
  var bestLine = document.getElementById('trivia-best');
  var state = null; // { i, score, startedAt, answered }

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

  function render() {
    if (!state) { panel.innerHTML = ''; return; }
    var q = questions[state.i];
    if (!q) { renderDone(); return; }
    var order = shuffle([0, 1, 2, 3]);
    var html = '<p class="trivia-count">Question ' + (state.i + 1) + ' of ' + questions.length + ' &middot; ' + q.topic + '</p>'
      + '<h3 class="trivia-q">' + q.q + '</h3>'
      + '<div class="trivia-answers">' + order.map(function (oi, pos) {
        return '<button type="button" class="trivia-answer" data-pos="' + pos + '" data-correct="' + (oi === q.correct ? '1' : '0') + '">' + q.answers[oi] + '</button>';
      }).join('') + '</div>'
      + '<div class="trivia-feedback" hidden></div>';
    panel.innerHTML = html;
    var feedback = panel.querySelector('.trivia-feedback');
    panel.querySelectorAll('.trivia-answer').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state.answered) return;
        state.answered = true;
        var right = btn.getAttribute('data-correct') === '1';
        if (right) state.score++;
        panel.querySelectorAll('.trivia-answer').forEach(function (b) {
          b.disabled = true;
          if (b.getAttribute('data-correct') === '1') b.classList.add('is-correct');
          else if (b === btn) b.classList.add('is-wrong');
        });
        feedback.hidden = false;
        feedback.innerHTML = '<p><strong>' + (right ? 'Correct.' : 'Not quite.') + '</strong> ' + q.why + '</p>'
          + '<p><button type="button" class="btn btn--gold btn-pill press" id="trivia-next">'
          + (state.i + 1 >= questions.length ? 'See your score' : 'Next question') + '</button></p>';
        document.getElementById('trivia-next').addEventListener('click', function () {
          state.i++;
          state.answered = false;
          render();
        });
      });
    });
  }

  function renderDone() {
    var ms = Date.now() - state.startedAt;
    var total = questions.length;
    panel.innerHTML = '<h3 class="trivia-q">You got ' + state.score + ' out of ' + total + '.</h3>'
      + '<p class="trivia-time">Finished in ' + fmtMs(ms) + '.</p>'
      + '<p class="trivia-best-update" id="trivia-best-update"></p>'
      + '<p><button type="button" class="btn btn--gold btn-pill press" id="trivia-again">Play again</button></p>';
    document.getElementById('trivia-again').addEventListener('click', startRound);
    // Post the score for the shared daily high score. Anonymous: only the
    // score and the time are sent, nothing about the player.
    fetch('/api/trivia/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: state.score, ms: ms }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      var line = document.getElementById('trivia-best-update');
      if (line && d && d.best) {
        line.textContent = d.isNewBest
          ? "That's today's best score so far."
          : "Today's best is still " + d.best.score + ' out of ' + total + ' in ' + fmtMs(d.best.ms) + '.';
      }
      if (bestLine && d && d.best) {
        bestLine.textContent = "Today's best: " + d.best.score + ' out of ' + total + ' in ' + fmtMs(d.best.ms) + '.';
      }
    }).catch(function () { /* the round still counts locally if the post fails */ });
  }

  function startRound() {
    state = { i: 0, score: 0, startedAt: Date.now(), answered: false };
    startBtn.hidden = true;
    render();
  }

  if (startBtn) startBtn.addEventListener('click', startRound);
})();
