// Find by place: state, then city, then diocese. Wires any .place-filters block
// on the page. Data comes from /api/places; the selected values are restored
// from the block's data-state / data-city / data-diocese attributes, but only
// on the initial load: once the visitor picks a different state, the old city
// and diocese are never re-applied to the new state. If the place lists fail
// to load, an inline note says so and the text search keeps working.
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
  async function loadCities(state, restore) {
    citySel.disabled = true;
    dioceseSel.disabled = true;
    fill(citySel, [], 'city', (c) => c.city, 'Choose a city');
    fill(dioceseSel, [], 'code', (d) => d.name, 'Choose a diocese');
    if (!state) return;
    try {
      const cities = await (await fetch('/api/places/cities?state=' + encodeURIComponent(state))).json();
      fill(citySel, cities, 'city', (c) => `${c.city} (${c.n})`, 'Choose a city');
      citySel.disabled = false;
      if (restore && selectedCity) citySel.value = selectedCity;
      const dioceses = await (await fetch('/api/places/dioceses?state=' + encodeURIComponent(state))).json();
      fill(dioceseSel, dioceses, 'code', (d) => `${d.name} (${d.n})`, 'Choose a diocese');
      dioceseSel.disabled = false;
      if (restore && selectedDiocese) dioceseSel.value = selectedDiocese;
      restored = true;
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
      fill(stateSel, states, 'state', (s) => `${s.state} (${s.n})`, 'Choose a state');
      if (selectedState) {
        stateSel.value = selectedState;
        await loadCities(selectedState, !restored);
      }
    } catch (e) { showPlacesError(); /* leave the selects as-is; the text search still works */ }
  })();
})();
