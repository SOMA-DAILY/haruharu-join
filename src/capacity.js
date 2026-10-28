// Public recruitment state only. Applicant counts and configured limits stay in the authenticated admin API.
(function () {
  var form = document.getElementById('f');
  if (!form) return;
  var own = location.pathname.replace(/\/?$/, '/');
  var paths = [own];
  document.querySelectorAll('#pick [data-path],.q[data-name="sv_join"] .opt[data-path]').forEach(function (el) { paths.push(el.getAttribute('data-path')); });
  paths = paths.filter(function (p, i) { return paths.indexOf(p) === i; });
  var note = document.createElement('div');
  note.hidden = true; note.setAttribute('role', 'status'); note.className = 'capacity-note';
  note.style.cssText = 'margin:16px 0;padding:14px 16px;border:1px solid #E3E8EF;border-radius:12px;background:#F3F5F8;color:#465061;font-size:15px;line-height:1.6';
  var pick = document.getElementById('pick'), nav = form.querySelector('.nav');
  if (pick) pick.after(note); else if (nav) nav.before(note); else form.appendChild(note);
  var states = {}, loaded = false, failed = false, version = 0, applying = false;
  window.hhCapacityStates = states;
  function gender() {
    var input = form.querySelector('input[name="gender"]:checked');
    if (input) return input.value === '남성' ? 'm' : input.value === '여성' ? 'f' : '';
    // A landing variant or a previous visit does not answer the form's gender question.
    if (form.querySelector('input[name="gender"]')) return '';
    return window.HH_G || new URLSearchParams(location.search).get('g') || '';
  }
  function chosenPath() {
    var survey = form.querySelector('.q[data-name="sv_join"]');
    if (survey) { var selected = survey.querySelector('input:checked'); return selected && selected.closest('[data-path]') ? selected.closest('[data-path]').getAttribute('data-path') : ''; }
    var c = form.querySelector('input[name="cohort_pick"]'), target = c && pick && pick.querySelector('[data-cohort="' + (c.value || pick.getAttribute('data-own')) + '"]');
    return target ? target.getAttribute('data-path') : own;
  }
  function apply() {
    if (applying) return; applying = true;
    document.dispatchEvent(new Event('hh-capacity-change'));
    var p = chosenPath(), st = states[p], blocked = !!p && (!loaded || failed || (st && st.open === false && st.reason === 'capacity'));
    note.hidden = !blocked;
    note.textContent = !loaded || failed ? (failed ? '모집 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' : '모집 상태를 확인하고 있어요.') : (gender() === 'm' ? '남성' : gender() === 'f' ? '여성' : '해당') + ' 정원이 마감됐어요. 다른 기수를 선택해 주세요.';
    var submit = document.getElementById('submit');
    if (submit && form.dataset.submitting !== 'true') {
      if (blocked && !submit.disabled) { submit.disabled = true; submit.dataset.capacityDisabled = 'true'; }
      if (!blocked && submit.dataset.capacityDisabled) { submit.disabled = !!form.querySelector('.q[data-name="sv_join"][data-required-join="true"]') && !chosenPath(); delete submit.dataset.capacityDisabled; }
    }
    form.querySelectorAll('#pay,#acctCopy').forEach(function (el) {
      if (blocked) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
    });
    applying = false;
  }
  function refresh() {
    var token = ++version, g = gender();
    var queryGender = !g && form.querySelector('input[name="gender"]') ? 'all' : g;
    return fetch('/api/capacity?paths=' + encodeURIComponent(paths.join(',')) + '&g=' + encodeURIComponent(queryGender), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw Error(); return r.json(); })
      .then(function (d) { if (token !== version) return; if (!d.states) throw Error(); Object.keys(states).forEach(function (k) { delete states[k]; }); Object.assign(states, d.states); loaded = true; failed = false; apply(); })
      .catch(function () { if (token !== version) return; failed = true; apply(); });
  }
  window.hhCapacityRefresh = refresh;
  window.hhCapacityRejected = function (reason) {
    form.dataset.submitting = 'false';
    var submit = document.getElementById('submit'); if (submit) { submit.disabled = false; submit.textContent = '제출하기'; }
    if (reason === 'gender_required') {
      var q = form.querySelector('.q[data-name="gender"]');
      if (!q) {
        q = document.createElement('div'); q.className = 'q'; q.dataset.name = 'gender';
        q.innerHTML = '<p class="t">성별을 확인해 주세요<span class="req">*</span></p><label class="opt"><input type="radio" name="gender" value="여성" required>여성</label><label class="opt"><input type="radio" name="gender" value="남성" required>남성</label>';
        note.after(q);
      }
      q.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      var p = chosenPath(); states[p] = { open: false, reason: 'capacity' }; apply();
      if (window.hhSvClosed) window.hhSvClosed();
      else alert('고른 기수의 해당 성별 정원이 방금 마감됐어요. 다른 기수를 선택해 주세요. 이미 송금했다면 인스타그램 @haruharu.ting 으로 알려 주세요.');
    }
    refresh();
  };
  form.addEventListener('submit', function (e) {
    var p = chosenPath(), st = states[p];
    if (p && (!loaded || failed || (st && st.open === false && st.reason === 'capacity'))) { e.preventDefault(); e.stopImmediatePropagation(); apply(); refresh(); }
  }, true);
  form.addEventListener('click', function (e) {
    var target = e.target.closest('#pay,#acctCopy');
    if (target && target.getAttribute('aria-disabled') === 'true') { e.preventDefault(); e.stopImmediatePropagation(); refresh(); }
  }, true);
  form.addEventListener('change', function (e) { if (e.target.name === 'gender') { loaded = false; apply(); refresh(); } else if (e.target.name === 'sv_join') { apply(); refresh(); } });
  document.addEventListener('hh-cohort-change', apply);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  setInterval(function () { if (!document.hidden) refresh(); }, 30000);
  apply(); refresh();
})();
