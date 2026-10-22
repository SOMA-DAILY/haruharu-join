import { cohortLabel, reviewRows } from '../shared/review-cohorts.mjs';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const topicLabel = (topic) => topic === 'sv_wish' ? '바라는 점' : '후기';
const focusable = (root) => [...root.querySelectorAll('button:not(:disabled),a[href],summary,input,select,textarea,[tabindex="0"]')]
  .filter((el) => el.getClientRects().length && (!el.closest('details:not([open])') || el.matches('summary')));
const contactDetails = (row) => '<details class="sg-details"><summary>자세히 보기</summary>' + (row.phone ?
  '<div class="sg-contact"><span>전화번호</span><a href="tel:' + row.phone + '">' + row.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3') + '</a>' +
  '<button class="sg-close" data-copy-phone="' + row.phone + '">전화번호 복사</button><span class="sg-copy-status" role="status"></span></div>' :
  '<p class="sg-contact-empty">등록된 전화번호 없음</p>') + '</details>';

export function createSurveyGallery({ getRows, registry }) {
  const overlay = document.createElement('div');
  overlay.className = 'sg-overlay'; overlay.hidden = true;
  overlay.innerHTML = '<section class="sg-shell" role="dialog" aria-modal="true" aria-labelledby="sgTitle" tabindex="-1">' +
    '<div class="sg-head"><div class="sg-top"><span class="sg-brand">하루하루 / 참여자 이야기</span><button class="sg-close" data-close>닫기</button></div>' +
    '<h2 id="sgTitle">후기와 바라는 점</h2><p class="sg-intro">함께한 3일, 남겨 준 이야기.</p>' +
    '<div class="sg-tabs" role="tablist" aria-label="응답 문항"></div><div class="sg-filter" role="group" aria-label="참여했던 기수"></div></div>' +
    '<div class="sg-content" role="tabpanel" id="sgResponses" tabindex="0"><p class="sg-count" aria-live="polite"></p><div class="sg-list"></div></div></section>';
  document.body.append(overlay);
  const shell = overlay.querySelector('.sg-shell');
  let topic = 'sv_review', cohort = 'all', rows = [];
  let originFocus, previousOverflow;

  function render() {
    rows = reviewRows(getRows(), registry);
    overlay.querySelector('.sg-tabs').innerHTML = ['sv_review', 'sv_wish'].map((key) =>
      '<button class="sg-tab" role="tab" id="sgTab-' + key + '" aria-controls="sgResponses" aria-selected="' + (topic === key) + '" tabindex="' + (topic === key ? '0' : '-1') + '" data-topic="' + key + '">' +
      topicLabel(key) + '<span>' + rows.filter((r) => r.survey[key]).length + '</span></button>').join('');
    const all = rows.filter((row) => typeof row.survey[topic] === 'string' && row.survey[topic].trim());
    const keys = [...new Set(all.flatMap((row) => row.cohorts))].sort((a, b) => {
      if (a === 'unknown') return 1; if (b === 'unknown') return -1;
      return (Number(b) || 0) - (Number(a) || 0);
    });
    // Keep the selected cohort across topics, including a topic with no answers.
    if (cohort !== 'all' && !keys.includes(cohort)) keys.push(cohort);
    overlay.querySelector('.sg-filter').innerHTML = ['all', ...keys].map((key) => {
      const count = key === 'all' ? all.length : all.filter((row) => row.cohorts.includes(key)).length;
      return '<button data-cohort="' + escape(key) + '" aria-pressed="' + (cohort === key) + '">' + (key === 'all' ? '전체' : cohortLabel(key)) + '<small>' + count + '</small></button>';
    }).join('');
    const filtered = all.filter((row) => cohort === 'all' || row.cohorts.includes(cohort));
    overlay.querySelector('#sgResponses').setAttribute('aria-labelledby', 'sgTab-' + topic);
    overlay.querySelector('.sg-count').textContent = (cohort === 'all' ? '전체' : cohortLabel(cohort)) + ' / ' + filtered.length + '개의 ' + topicLabel(topic);
    overlay.querySelector('.sg-list').innerHTML = filtered.length ? '<div class="sg-grid">' + filtered.map((row) =>
      '<article class="sg-card"><div class="sg-card-head"><span class="sg-cohort" title="' + escape(row.source) + '">' + escape(row.participant) + '</span>' +
      '<span class="sg-gender">' + escape(row.gender) + '</span><time class="sg-date">' +
      (row.time ? new Date(row.time + 9 * 3600e3).toISOString().slice(0, 10).replaceAll('-', '.') : '날짜 미확인') + '</time></div>' +
      '<p class="sg-text">' + escape(row.survey[topic]) + '</p>' + contactDetails(row) + '</article>'
    ).join('') + '</div>' : '<div class="sg-empty">이 기수에 남겨진 ' + topicLabel(topic) + '가 아직 없어요.<br><button class="sg-close" data-cohort="all">전체 보기</button></div>';
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true; document.body.style.overflow = previousOverflow;
    if (originFocus?.isConnected) originFocus.focus();
  }

  async function copyPhone(button) {
    const status = button.parentElement.querySelector('[role="status"]');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(button.dataset.copyPhone);
      else {
        const input = document.createElement('textarea');
        input.value = button.dataset.copyPhone; input.readOnly = true;
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.append(input);
        try { input.select(); if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
        finally { input.remove(); button.focus(); }
      }
      status.textContent = '복사됨';
    } catch {
      status.textContent = '복사하지 못했어요. 번호를 길게 눌러 복사해 주세요.';
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close]')) return close();
    const copy = event.target.closest('[data-copy-phone]');
    if (copy) { copyPhone(copy); return; }
    const tab = event.target.closest('[data-topic]');
    if (tab) { topic = tab.dataset.topic; render(); overlay.querySelector('[data-topic="' + topic + '"]').focus(); return; }
    const filter = event.target.closest('[data-cohort]');
    if (filter) { cohort = filter.dataset.cohort; render(); overlay.querySelector('[data-cohort="' + cohort + '"]').focus(); return; }
  });
  document.addEventListener('keydown', (event) => {
    if (overlay.hidden) return;
    const active = overlay;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (event.target.matches('[role=tab]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); topic = event.key === 'Home' ? 'sv_review' : event.key === 'End' ? 'sv_wish' : topic === 'sv_review' ? 'sv_wish' : 'sv_review';
      render(); overlay.querySelector('[data-topic="' + topic + '"]').focus(); return;
    }
    if (event.key === 'Tab') {
      const controls = focusable(active), first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !active.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !active.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  return { open(invoker) {
    if (!overlay.hidden) return;
    originFocus = invoker || document.activeElement; previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; render(); shell.scrollTop = 0; overlay.hidden = false;
    overlay.querySelector('[data-close]').focus();
  }, close };
}
