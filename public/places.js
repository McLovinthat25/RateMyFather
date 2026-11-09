// Find by place: state, then city, then diocese. Each list is a searchable
// combobox (type to filter) built around the native <select>, which stays in
// the form as the submitted value and as the no-JavaScript fallback. Data
// comes from /api/places; the selected values are restored from the block's
// data-state / data-city / data-diocese attributes, but only on the initial
// load: once the visitor picks a different state, the old city and diocese
// are never re-applied to the new state. If the place lists fail to load, an
// inline note says so and the text search keeps working.
(function () {
  const box = document.querySelector('.place-filters');
  if (!box) return;
  const stateSel = document.getElementById('place-state');
  const citySel = document.getElementById('place-city');
  const dioceseSel = document.getElementById('place-diocese');
  if (!stateSel || !citySel || !dioceseSel) return;
  const selectedState = (box.dataset.state || '').toUpperCase();
  let selectedCity = box.dataset.city || '';
  let selectedDiocese = (box.dataset.diocese || '').toUpperCase();
  let restored = false;

  function showPlacesError() {
    if (box.parentElement.querySelector('.place-error')) return;
    const note = document.createElement('p');
    note.className = 'place-error small';
    note.textContent = 'Place lists could not be loaded. You can still search by name, parish, or city above.';
    box.insertAdjacentElement('afterend', note);
  }
  function fill(sel, items, valueKey, labelFn, placeholder) {
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = placeholder;
    sel.appendChild(ph);
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item[valueKey];
      opt.textContent = labelFn(item);
      sel.appendChild(opt);
    }
  }

  // State codes to full names, so the state list reads "Pennsylvania"
  // instead of a bare "PA" and typing either the name or the code matches.
  const STATE_NAMES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
    WY: 'Wyoming',
    AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands',
    PR: 'Puerto Rico', VI: 'U.S. Virgin Islands',
  };
  function stateName(code) { return STATE_NAMES[code] || code; }

  // Normalize for filtering: case-insensitive, periods dropped, and "St."
  // matches "Saint" (the same normalization the text search uses), so
  // typing "Saint George" finds "St. George" in a list.
  function norm(s) {
    return String(s || '').replace(/\./g, '').toLowerCase().replace(/\bst\b/g, 'saint');
  }
  function matches(label, query) {
    return norm(label).indexOf(norm(query)) !== -1;
  }

  // A searchable combobox around one <select>. The select keeps the value
  // the form submits; the input is only the visible, typeable face. The
  // list is read from the select's current options each time it renders,
  // so repopulating the select (cascading) is picked up automatically.
  function makeCombo(sel, searchPlaceholder, disabledPlaceholder) {
    const wrap = document.createElement('div');
    wrap.className = 'combo';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('combo-source');
    sel.setAttribute('tabindex', '-1');
    sel.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'combo-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-label', sel.getAttribute('aria-label') || '');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.placeholder = searchPlaceholder;
    wrap.appendChild(input);

    const panel = document.createElement('div');
    panel.className = 'combo-panel';
    panel.setAttribute('role', 'listbox');
    panel.hidden = true;
    wrap.appendChild(panel);

    const chev = document.createElement('button');
    chev.type = 'button';
    chev.className = 'combo-btn combo-chevron';
    chev.setAttribute('aria-label', 'Show options');
    chev.setAttribute('tabindex', '-1');
    chev.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    wrap.appendChild(chev);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'combo-btn combo-clear';
    clearBtn.setAttribute('aria-label', 'Clear selection');
    clearBtn.setAttribute('tabindex', '-1');
    clearBtn.textContent = '\u00d7';
    clearBtn.hidden = true;
    wrap.appendChild(clearBtn);

    let open = false;
    let activeIdx = -1;
    let visible = []; // [{value, label, el}]

    function labelFor(value) {
      for (const o of sel.options) if (o.value === value) return o.textContent;
      return '';
    }
    function currentQuery() {
      // When the input just shows the chosen label, the user is browsing:
      // show the whole list. Otherwise the typed text is the filter.
      if (sel.value && input.value === labelFor(sel.value)) return '';
      return input.value;
    }
    function renderList() {
      const q = currentQuery().trim();
      const all = [];
      for (const o of sel.options) {
        if (o.value === '') continue;
        all.push({ value: o.value, label: o.textContent });
      }
      // Alphabetical, so a long list is scannable when browsing.
      all.sort((a, b) => a.label.localeCompare(b.label));
      visible = q ? all.filter((it) => matches(it.label, q) || matches(it.value, q)) : all;
      panel.innerHTML = '';
      activeIdx = -1;
      input.removeAttribute('aria-activedescendant');
      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'combo-empty';
        empty.textContent = q ? 'No matches. Try a different spelling.' : 'Nothing here yet.';
        panel.appendChild(empty);
        return;
      }
      visible.forEach((it, i) => {
        const el = document.createElement('div');
        el.className = 'combo-option';
        el.setAttribute('role', 'option');
        el.id = sel.id + '-opt-' + i;
        el.textContent = it.label;
        // mousedown is prevented so the input keeps focus (no blur before
        // the pick); the click then makes the selection.
        el.addEventListener('mousedown', (e) => { e.preventDefault(); });
        el.addEventListener('click', () => { choose(it); });
        panel.appendChild(el);
        it.el = el;
      });
    }
    function openPanel() {
      if (sel.disabled) return;
      if (!open) {
        open = true;
        panel.hidden = false;
        wrap.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
      }
      renderList();
    }
    function closePanel() {
      if (!open) return;
      open = false;
      panel.hidden = true;
      wrap.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      activeIdx = -1;
      input.removeAttribute('aria-activedescendant');
    }
    function setActive(i) {
      const opts = panel.querySelectorAll('.combo-option');
      opts.forEach((el) => el.classList.remove('active'));
      activeIdx = i;
      if (i >= 0 && visible[i]) {
        visible[i].el.classList.add('active');
        input.setAttribute('aria-activedescendant', visible[i].el.id);
        visible[i].el.scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }
    function choose(it) {
      sel.value = it.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      input.value = it.label;
      clearBtn.hidden = false;
      closePanel();
      input.focus();
    }
    function clearSelection() {
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      input.value = '';
      clearBtn.hidden = true;
      refresh();
      input.focus();
      openPanel();
    }
    function refresh() {
      input.disabled = sel.disabled;
      input.placeholder = sel.disabled ? disabledPlaceholder : searchPlaceholder;
      input.value = sel.value ? labelFor(sel.value) : '';
      clearBtn.hidden = !sel.value || sel.disabled;
      if (open) renderList();
    }

    input.addEventListener('focus', () => {
      openPanel();
      if (sel.value) input.select();
    });
    input.addEventListener('input', () => {
      // The user is editing away from the chosen value: drop it at once,
      // so the form can never submit a value the box no longer shows.
      if (sel.value && input.value !== labelFor(sel.value)) {
        sel.value = '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        clearBtn.hidden = true;
      }
      openPanel();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) openPanel();
        setActive(visible.length ? (activeIdx + 1) % visible.length : -1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) openPanel();
        setActive(visible.length ? (activeIdx <= 0 ? visible.length - 1 : activeIdx - 1) : -1);
      } else if (e.key === 'Enter') {
        if (open && activeIdx >= 0 && visible[activeIdx]) { e.preventDefault(); choose(visible[activeIdx]); }
        else if (open && visible.length === 1) { e.preventDefault(); choose(visible[0]); }
        else { closePanel(); }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
        refresh();
      }
    });
    input.addEventListener('blur', () => {
      // Give a click on an option time to land (its mousedown prevents the
      // blur), then put the input back to the real selection.
      setTimeout(() => { if (document.activeElement !== input) { closePanel(); refresh(); } }, 120);
    });
    chev.addEventListener('mousedown', (e) => { e.preventDefault(); });
    chev.addEventListener('click', () => {
      if (sel.disabled) return;
      if (open) { closePanel(); refresh(); } else { input.focus(); openPanel(); }
    });
    clearBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
    clearBtn.addEventListener('click', () => { clearSelection(); });
    document.addEventListener('click', (e) => {
      if (open && !wrap.contains(e.target)) { closePanel(); refresh(); }
    });

    refresh();
    return { refresh };
  }

  const stateCombo = makeCombo(stateSel, 'Search states\u2026', 'Search states\u2026');
  const cityCombo = makeCombo(citySel, 'Search cities\u2026', 'Choose a state first');
  const dioceseCombo = makeCombo(dioceseSel, 'Search dioceses\u2026', 'Choose a state first');

  async function loadCities(state, restore) {
    citySel.disabled = true;
    dioceseSel.disabled = true;
    fill(citySel, [], 'city', (c) => c.city, 'Choose a city');
    fill(dioceseSel, [], 'code', (d) => d.name, 'Choose a diocese');
    cityCombo.refresh();
    dioceseCombo.refresh();
    if (!state) return;
    try {
      const cities = await (await fetch('/api/places/cities?state=' + encodeURIComponent(state))).json();
      fill(citySel, cities, 'city', (c) => c.city, 'Choose a city');
      citySel.disabled = false;
      if (restore && selectedCity) citySel.value = selectedCity;
      const dioceses = await (await fetch('/api/places/dioceses?state=' + encodeURIComponent(state))).json();
      fill(dioceseSel, dioceses, 'code', (d) => d.name, 'Choose a diocese');
      dioceseSel.disabled = false;
      if (restore && selectedDiocese) dioceseSel.value = selectedDiocese;
      restored = true;
      cityCombo.refresh();
      dioceseCombo.refresh();
    } catch (e) { showPlacesError(); /* leave the selects disabled; the text search still works */ }
  }
  stateSel.addEventListener('change', () => {
    // A new state means a fresh city and diocese: drop the restored values
    // so they can never be re-applied to the wrong state.
    selectedCity = ''; selectedDiocese = '';
    citySel.value = ''; dioceseSel.value = '';
    loadCities(stateSel.value, false);
  });
  (async () => {
    try {
      const states = await (await fetch('/api/places/states')).json();
      fill(stateSel, states, 'state', (s) => stateName(s.state), 'Choose a state');
      stateCombo.refresh();
      if (selectedState) {
        stateSel.value = selectedState;
        stateCombo.refresh();
        await loadCities(selectedState, !restored);
      }
    } catch (e) { showPlacesError(); /* leave the selects as-is; the text search still works */ }
  })();
})();
