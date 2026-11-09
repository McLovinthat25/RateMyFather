// Find by place: state, then city, then diocese. Wires any .place-filters block
// on the page. Data comes from /api/places; the selected values are restored
// from the block's data-state / data-city / data-diocese attributes.
(function () {
  const box = document.querySelector('.place-filters');
  if (!box) return;
  const stateSel = document.getElementById('place-state');
  const citySel = document.getElementById('place-city');
  const dioceseSel = document.getElementById('place-diocese');
  if (!stateSel || !citySel || !dioceseSel) return;
  const selectedState = (box.dataset.state || '').toUpperCase();
  const selectedCity = box.dataset.city || '';
  const selectedDiocese = (box.dataset.diocese || '').toUpperCase();

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
  async function loadCities(state) {
    citySel.disabled = true;
    dioceseSel.disabled = true;
    fill(citySel, [], 'city', (c) => c.city, 'Choose a city');
    fill(dioceseSel, [], 'code', (d) => d.name, 'Choose a diocese');
    if (!state) return;
    try {
      const cities = await (await fetch('/api/places/cities?state=' + encodeURIComponent(state))).json();
      fill(citySel, cities, 'city', (c) => `${c.city} (${c.n})`, 'Choose a city');
      citySel.disabled = false;
      if (selectedCity) citySel.value = selectedCity;
      const dioceses = await (await fetch('/api/places/dioceses?state=' + encodeURIComponent(state))).json();
      fill(dioceseSel, dioceses, 'code', (d) => `${d.name} (${d.n})`, 'Choose a diocese');
      dioceseSel.disabled = false;
      if (selectedDiocese) dioceseSel.value = selectedDiocese;
    } catch (e) { /* leave the selects disabled; the text search still works */ }
  }
  stateSel.addEventListener('change', () => {
    citySel.value = ''; dioceseSel.value = '';
    loadCities(stateSel.value);
  });
  (async () => {
    try {
      const states = await (await fetch('/api/places/states')).json();
      fill(stateSel, states, 'state', (s) => `${s.state} (${s.n})`, 'Choose a state');
      if (selectedState) {
        stateSel.value = selectedState;
        await loadCities(selectedState);
      }
    } catch (e) { /* leave the selects as-is; the text search still works */ }
  })();
})();
