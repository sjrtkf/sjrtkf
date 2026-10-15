'use strict';

// Live selectors must be verified against an authenticated booking screen.
const DEMO_PROFILE = Object.freeze({ selector: '[data-seat-id]', available: 'data-available', label: 'aria-label', id: 'data-seat-id' });
function isHttps(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
function isTicketOrigin(value) {
  try { const u = new URL(value); return isHttps(value) && ['yanolja.com', 'interpark.com', 'interparktriple.com'].some(d => u.hostname === d || u.hostname.endsWith('.' + d)); } catch { return false; }
}
function filterSeats(seats, query) {
  const q = String(query || '').trim().toLocaleLowerCase();
  return seats.filter(s => s.available && (!q || s.label.toLocaleLowerCase().includes(q)));
}
function scanScript(profile) {
  return `(() => {
    const p = ${JSON.stringify(profile)};
    return Array.from(document.querySelectorAll(p.selector)).map(el => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {id: el.getAttribute(p.id), label: el.getAttribute(p.label) || '',
        available: el.getAttribute(p.available) === 'true' && !el.disabled && el.getAttribute('aria-disabled') !== 'true'
          && el.getAttribute('aria-pressed') !== 'true' && box.width > 0 && box.height > 0 && style.visibility === 'visible' && style.display !== 'none'};
    }).filter(s => s.id && s.label);
  })()`;
}
function actionScript(profile, seat, action) {
  if (!['focus', 'click'].includes(action)) throw new Error('알 수 없는 좌석 동작');
  return `(() => {
    const p = ${JSON.stringify(profile)}, target = ${JSON.stringify(seat)};
    const matches = Array.from(document.querySelectorAll(p.selector)).filter(el => el.getAttribute(p.id) === target.id);
    if (matches.length !== 1) throw new Error('좌석 화면이 변경되었습니다. 다시 확인해 주세요.');
    const el = matches[0], box = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (el.getAttribute(p.label) !== target.label || el.getAttribute(p.available) !== 'true' || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-pressed') === 'true' || box.width <= 0 || box.height <= 0 || style.visibility !== 'visible')
      throw new Error('현재 선택할 수 없는 좌석입니다. 다시 확인해 주세요.');
    el.scrollIntoView({block:'center', inline:'center'}); el.focus();
    ${action === 'click' ? 'el.click();' : ''}
    return true;
  })()`;
}
module.exports = { DEMO_PROFILE, isHttps, isTicketOrigin, filterSeats, scanScript, actionScript };
