// Review form: live character counters for the two length-limited fields
// (written review, 2000; Mass context, 120). The maxlength attributes still
// enforce the limits server side; the counters just show where you stand.
// This script loads in <head>, so wait for the form to exist first.
function initReviewCounters() {
  function wire(field, max) {
    if (!field) return;
    var counter = document.createElement('p');
    counter.className = 'char-count small';
    counter.setAttribute('aria-live', 'polite');
    field.insertAdjacentElement('afterend', counter);
    function update() {
      var used = field.value.length;
      counter.textContent = used.toLocaleString() + ' / ' + max.toLocaleString() + ' characters';
      counter.classList.toggle('char-count-full', used >= max);
    }
    field.addEventListener('input', update);
    update();
  }
  wire(document.querySelector('textarea[name="body"]'), 2000);
  wire(document.querySelector('input[name="mass_context"]'), 120);
}
// Review form: live anchor text under each star dropdown. When the reviewer
// picks a star, the line below the dropdown shows what that star means, so
// the rating has a real basis. Anchor data comes from window.RMF_ANCHORS,
// rendered into the profile page by the server.
function initReviewAnchors() {
  var anchors = window.RMF_ANCHORS;
  if (!anchors) return;
  ['pace', 'homily', 'likability', 'church_beauty'].forEach(function (key) {
    var select = document.querySelector('select[name="' + key + '"]');
    var line = document.querySelector('[data-anchor="' + key + '"]');
    if (!select || !line) return;
    var prompt = line.textContent;
    function update() {
      var a = anchors[key] && anchors[key][select.value];
      line.textContent = a ? a.text : prompt;
    }
    select.addEventListener('change', update);
    update();
  });
}
function initReview() {
  initReviewCounters();
  initReviewAnchors();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReview);
} else {
  initReview();
}
