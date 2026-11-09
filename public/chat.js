// Chatbot widget: posts to /api/chat, renders the JSON cards. The chatbot never
// quotes individual reviews and only reports aggregated approved-review scores
// with their counts (the server enforces this; this script only renders them).
(function () {
  const toggle = document.getElementById('chat-toggle');
  const panel = document.getElementById('chat-panel');
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  if (!toggle || !panel) return;
  let greeted = false;
  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!greeted) {
        greeted = true;
        log.insertAdjacentHTML('beforeend', '<div class="msg">Hi. Ask me about a priest by name, or ask for a quick Mass, a great homily, or a lovable priest. I only use approved-review averages, with review counts.</div>');
      }
      input.focus();
    }
  }
  toggle.addEventListener('click', () => { setOpen(panel.hidden); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { setOpen(false); toggle.focus(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    log.insertAdjacentHTML('beforeend', `<div class="msg"><strong>You:</strong> ${escapeHtml(message)}</div>`);
    log.insertAdjacentHTML('beforeend', `<div class="msg" id="chat-wait">Thinking…</div>`);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
      const data = await res.json();
      document.getElementById('chat-wait')?.remove();
      let html = `<div class="msg">${escapeHtml(data.text || '')}</div>`;
      (data.cards || []).forEach((c) => {
        html += `<div class="chat-card"><a href="${escapeHtml(c.url)}">${escapeHtml(c.name)}</a><br>${escapeHtml(c.assignment)}<br>${escapeHtml(c.ratedText)}${c.userAdded ? '<br><em>User-added profile</em>' : ''}</div>`;
      });
      if (data.addLink) html += `<div class="msg"><a href="${data.addLink}">Add this priest</a></div>`;
      log.insertAdjacentHTML('beforeend', html);
    } catch (err) {
      document.getElementById('chat-wait')?.remove();
      log.insertAdjacentHTML('beforeend', '<div class="msg">Sorry, that search failed. Please try again.</div>');
    }
    log.scrollTop = log.scrollHeight;
  });
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
})();
