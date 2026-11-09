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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReviewCounters);
} else {
  initReviewCounters();
}
