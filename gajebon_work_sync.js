// 구성별 작업/출고 상태 공유. 기존 로컬 기록은 서버에 없는 항목만 최초 이전한다.
let gajWorkSyncState = null;
let gajWorkSyncBusy = false;
let gajWorkSyncReady = false;
let gajWorkSyncError = '';
function gajWorkState() {
  if (!gajWorkSyncState) {
    gajWorkSyncState = readGajebonLocal('gajebonWorkSync', {pending:{}, migrated:false});
    gajWorkSyncState.pending ||= {};
  }
  return gajWorkSyncState;
}
function gajWorkKey(order, idx) { return JSON.stringify([String(order), Number(idx)]); }
function gajWorkPut(target, order, idx, value) {
  if (['__proto__','constructor','prototype'].includes(order)) throw new Error('잘못된 주문번호');
  if (value) { target[order] ||= {}; target[order][idx] = value; }
  else if (target[order]) {
    delete target[order][idx];
    if (!Object.keys(target[order]).length) delete target[order];
  }
}
function gajWorkCommit(state) {
  if (!writeGajebonLocal('gajebonWorkSync', state)) return false;
  gajWorkSyncState = state;
  return true;
}
function gajWorkStatus() {
  const count = Object.keys(gajWorkState().pending).length;
  if (gajWorkSyncError) return '공유 연결 확인 필요' + (count ? ' · 전송 대기 ' + count + '건' : '');
  if (count) return '전송 대기 ' + count + '건 (자동 재시도)';
  return gajWorkSyncReady ? '서버 확인 완료 (30초마다 갱신)' : '서버 확인 중';
}
function queueGajebonWork(order, idx, value) {
  const state = gajWorkState();
  const entry = {order:String(order), idx:Number(idx), value,
    revision:Date.now() + '-' + Math.random(), migrate:false};
  if (!gajWorkCommit({...state, pending:{...state.pending, [gajWorkKey(order,idx)]:entry}})) return false;
  // Local cache is secondary to the durable pending queue.
  gajWorkPut(gajebonEbsWork, order, idx, value);
  writeGajebonLocal('gajebonEbsWork', gajebonEbsWork);
  showGajebonSaveStatus();
  void syncGajebonWork();
  return true;
}
async function gajWorkRequest(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(payload ? CLAIM_SHEET_URL : CLAIM_SHEET_URL + '?type=gajebonWork&t=' + Date.now(),
      payload ? {method:'POST', signal:controller.signal, headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({key:CLAIM_SHEET_KEY, type:'gajebonWork', ...payload})} : {signal:controller.signal});
    const result = await response.json();
    if (!response.ok || result.ok !== true || result.schema !== 'gajebon-work-v1')
      throw new Error('구성별 상태 공유 서버 업데이트가 필요하거나 저장에 실패했습니다.');
    return result;
  } finally { clearTimeout(timer); }
}
async function syncGajebonWork() {
  if (gajWorkSyncBusy || typeof CLAIM_SHEET_URL === 'undefined') return;
  gajWorkSyncBusy = true;
  try {
    const result = await gajWorkRequest();
    if (!Array.isArray(result.rows)) throw new Error('공유 데이터 형식 오류');
    const shared = {}, existing = new Set();
    for (const [order, idx, value] of result.rows) {
      if (typeof order !== 'string' || !Number.isInteger(idx) || idx < 0 ||
          (value !== null && (!value || !['done','shipped'].includes(value.st)))) throw new Error('공유 상태 형식 오류');
      existing.add(gajWorkKey(order,idx));
      gajWorkPut(shared, order, idx, value);
    }
    let state = gajWorkState();
    if (!state.migrated) {
      const pending = {...state.pending};
      for (const [order, parts] of Object.entries(gajebonEbsWork)) {
        for (const [idx, old] of Object.entries(parts)) {
          const key = gajWorkKey(order,idx);
          if (!existing.has(key) && !pending[key] && old) pending[key] = {
            order, idx:Number(idx), value:{...old, st:old.st || 'done'},
            revision:Date.now() + '-' + Math.random(), migrate:true};
        }
      }
      if (!gajWorkCommit({...state, pending, migrated:true})) throw new Error('이전 기록 저장 실패');
    }
    // Pending local clicks made while GET was in flight always win locally.
    Object.values(gajWorkState().pending).forEach(e => gajWorkPut(shared,e.order,e.idx,e.value));
    gajebonEbsWork = shared;
    writeGajebonLocal('gajebonEbsWork', shared);
    renderGajebonTable();
    for (const [key, entry] of Object.entries(gajWorkState().pending)) {
      const saved = await gajWorkRequest(entry);
      state = gajWorkState();
      if (state.pending[key]?.revision !== entry.revision) continue;
      // Keep pending data until both the cache and queue update have succeeded.
      gajWorkPut(gajebonEbsWork,entry.order,entry.idx,saved.value);
      if (!writeGajebonLocal('gajebonEbsWork',gajebonEbsWork)) throw new Error('기록 저장 실패');
      const pending = {...state.pending}; delete pending[key];
      if (!gajWorkCommit({...state,pending})) throw new Error('전송 상태 저장 실패');
    }
    gajWorkSyncReady = true;
    gajWorkSyncError = '';
  } catch(e) {
    gajWorkSyncError = e.message || '공유 연결 실패';
  } finally {
    gajWorkSyncBusy = false;
    renderGajebonTable();
    showGajebonSaveStatus();
  }
}
function initGajebonWorkSync() {
  // Restore unacknowledged edits even if the cache write was interrupted.
  Object.values(gajWorkState().pending).forEach(e => gajWorkPut(gajebonEbsWork,e.order,e.idx,e.value));
  void syncGajebonWork();
  setInterval(() => { if (!document.hidden) void syncGajebonWork(); }, 30000);
  window.addEventListener('online', () => void syncGajebonWork());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void syncGajebonWork(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGajebonWorkSync);
else initGajebonWorkSync();
