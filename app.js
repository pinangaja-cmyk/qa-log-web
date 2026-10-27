// QA 업무일지 앱 로직. index.html의 CSP(script-src 'self')에 맞춰 별도 파일로 둡니다.
(() => {
  // Clickjacking guard: GitHub Pages cannot send frame-ancestors headers, so refuse to run inside a frame.
  if (window.top !== window.self) {
    try { window.top.location.replace(window.location.href); } catch { }
    document.documentElement.innerHTML = '';
    return;
  }
  // A Supabase confirmation link lands here with session tokens in the URL. Remove them from the
  // address bar and history immediately; the session is revoked once the app has started.
  const AUTH_RETURN = (() => {
    const raw = (location.hash || '').replace(/^#/, '') + '&' + (location.search || '').replace(/^\?/, '');
    if (!/(^|&)(access_token|refresh_token|error_description|error_code|code|token_hash)=/.test(raw)) return null;
    try { history.replaceState(null, '', location.pathname); } catch { }
    return new URLSearchParams(raw);
  })();
  const APP_VERSION = '2.8';

  // ---------- work types ----------
  const GROUPS = [
    { id: 'insp', label: '검사', color: 'var(--g-insp)', types: ['iqc', 'ipqc', 'fqc', 'ct'] },
    { id: 'mgmt', label: '관리 · 기술', color: 'var(--g-mgmt)', types: ['spec', 'std', 'smp', 'mk', 'pe'] },
    { id: 'resp', label: '대응', color: 'var(--g-resp)', types: ['cs', 'sq'] },
    { id: 'etc', label: '미팅 · 기타', color: 'var(--g-etc)', types: ['mtg', 'etc'] },
  ];
  const TYPES = {
    iqc:  { label: '부자재 수입검사', short: '수입검사', code: 'IQC' },
    ipqc: { label: '공정검사', short: '공정검사', code: 'IPQC' },
    fqc:  { label: '완제품 검사', short: '완제품', code: 'FQC' },
    ct:   { label: 'CT테스트', short: 'CT', code: 'CT' },
    spec: { label: '포장사양서 검토', short: '사양서', code: 'SPEC' },
    std:  { label: '부자재 표준관리', short: '표준견본', code: 'STD' },
    smp:  { label: '관리품 출고', short: '관리품', code: 'RET' },
    mk:   { label: '샘플제작', short: '샘플제작', code: 'SMP' },
    pe:   { label: '생산기술', short: '생산기술', code: 'PE' },
    cs:   { label: '고객사 대응', short: '고객사', code: 'CS' },
    sq:   { label: '업체 대응', short: '업체', code: 'SQ' },
    mtg:  { label: '미팅', short: '미팅', code: 'MTG' },
    etc:  { label: '기타 업무', short: '기타', code: 'ETC' },
  };
  GROUPS.forEach(g => g.types.forEach(t => { TYPES[t].group = g.id; TYPES[t].color = g.color; }));
  const SUPPLIER_TYPES = ['iqc', 'sq', 'std', 'ct'];
  const has = (arr, v) => Array.isArray(arr) && arr.includes(v);
  const smpSteps = d => ['관리대장 기록', ...(has(d.kinds, '고객사') ? ['송장 발행', '출고 완료'] : [])];

  const FORMS = {
    iqc: [
      { f: 'partner', label: '부자재 업체', type: 'text', req: true, ph: '예: 대한포장' },
      { f: 'item', label: '품목', type: 'text', ph: '예: 외박스 B-200' },
      { f: 'lots', label: '검사 로트 수', type: 'step', def: 1, min: 1 },
      { f: 'result', label: '판정', type: 'chips', opts: ['합격', '불합격'], def: '합격' },
      { f: 'defect', label: '불량 내용', type: 'text', ph: '예: 인쇄 번짐 3EA', show: d => d.result === '불합격' },
    ],
    ipqc: [
      { f: 'lines', label: '라인', type: 'multi', opts: ['A라인', 'B라인', 'C라인'], def: [], req: true, hint: '여러 개 선택 가능' },
      { f: 'result', label: '결과', type: 'chips', opts: ['OK', 'NG'], def: 'OK' },
      { f: 'ngCount', label: '부적합 건수', type: 'step', def: 1, min: 1, show: d => d.result === 'NG' },
      { f: 'action', label: '조치 내용', type: 'text', ph: '예: 라인 정지 후 재조정', show: d => d.result === 'NG' },
    ],
    fqc: [
      { f: 'item', label: '제품', type: 'text', req: true, ph: '예: 수분크림 50ml' },
      { f: 'partner', label: '고객사', type: 'text', ph: '예: OO코스메틱' },
      { f: 'lot', label: '로트 번호', type: 'text', ph: '예: 261019A' },
      { f: 'lots', label: '검사 로트 수', type: 'step', def: 1, min: 1 },
      { f: 'result', label: '판정', type: 'chips', opts: ['합격', '불합격'], def: '합격' },
      { f: 'defect', label: '불량 내용', type: 'text', ph: '예: 캡 스크래치', show: d => d.result === '불합격' },
      { f: 'samples', label: '관리품 채취', type: 'multi', opts: ['고객사', '자사'], def: [], hint: '선택하면 관리품 출고 건이 자동으로 생깁니다', createOnly: true },
    ],
    ct: [
      { f: 'item', label: '제품 · 용기', type: 'text', req: true, ph: '예: 50ml 에어리스 용기' },
      { f: 'partner', label: '용기 업체', type: 'text', ph: '예: 대한용기' },
      { f: 'parts', label: '측정 부품', type: 'multi', opts: ['용기', '펌프', '숄더', '캡'], def: ['용기', '펌프', '숄더', '캡'] },
      { f: 'tests', label: '끝난 시험', type: 'multi', opts: ['치수', '결합', '누액', '고온', '저온'], def: [], hint: '진행하면서 수정으로 체크' },
      { f: 'result', label: '판정', type: 'chips', opts: ['진행 중', '적합', '부적합'], def: '진행 중' },
      { f: 'defect', label: '부적합 내용', type: 'text', ph: '예: 고온 48h 후 펌프부 누액', show: d => d.result === '부적합' },
    ],
    spec: [
      { f: 'item', label: '제품', type: 'text', req: true, ph: '예: 수분크림 50ml' },
      { f: 'partner', label: '고객사', type: 'text', ph: '예: OO코스메틱' },
      { f: 'kind', label: '검토 결과', type: 'chips', opts: ['이상 없음', '수정 요청', '추가 사항 전달'], def: '수정 요청' },
      { f: 'detail', label: '요청 내용', type: 'text', ph: '예: 박스 입수 24→20 변경', show: d => d.kind !== '이상 없음' },
      { f: 'status', label: '반영 여부', type: 'chips', opts: ['회신 대기', '반영 완료'], def: '회신 대기', show: d => d.kind !== '이상 없음' },
    ],
    std: [
      { f: 'item', label: '품목', type: 'text', req: true, ph: '예: 펌프 24/410 화이트' },
      { f: 'partner', label: '부자재 업체', type: 'text', ph: '예: 대한포장' },
      { f: 'steps', label: '처리', type: 'multi', opts: ['대장 등록', '라벨링', '보관'], def: ['대장 등록', '라벨링', '보관'], hint: '남은 단계는 미결로 표시' },
    ],
    smp: [
      { f: 'item', label: '제품', type: 'text', req: true, ph: '예: 수분크림 50ml' },
      { f: 'partner', label: '고객사', type: 'text', ph: '예: OO코스메틱' },
      { f: 'lot', label: '로트 번호', type: 'text', ph: '예: 261019A' },
      { f: 'kinds', label: '관리품 구분', type: 'multi', opts: ['고객사', '자사'], def: ['고객사', '자사'], req: true },
      { f: 'steps', label: '처리', type: 'multi', opts: smpSteps, def: ['관리대장 기록'] },
      { f: 'invoice', label: '송장 번호', type: 'text', ph: '택배 송장 번호', show: d => has(d.kinds, '고객사') },
    ],
    mk: [
      { f: 'item', label: '제품', type: 'text', req: true, ph: '예: 수분크림 50ml' },
      { f: 'partner', label: '고객사', type: 'text', ph: '예: OO코스메틱' },
      { f: 'purpose', label: '용도', type: 'chips', opts: ['고객 요청', '신규 개발', 'CT용', '기타'], def: '고객 요청' },
      { f: 'qty', label: '수량 (개)', type: 'num', ph: '예: 10' },
      { f: 'status', label: '상태', type: 'chips', opts: ['제작 중', '제작 완료', '발송 완료'], def: '제작 중' },
    ],
    pe: [
      { f: 'line', label: '설비 · 라인', type: 'text', req: true, ph: '예: A라인 캡핑기' },
      { f: 'kind', label: '작업', type: 'chips', opts: ['세팅값 조정', '신규 파트 검토', '설비 개선', '고장 대응'], def: '세팅값 조정' },
      { f: 'detail', label: '변경 내용', type: 'text', ph: '예: 캡핑 토크 12 → 14 kgf·cm' },
      { f: 'status', label: '상태', type: 'chips', opts: ['진행 중', '완료'], def: '완료' },
    ],
    cs: [
      { f: 'partner', label: '고객사', type: 'text', req: true, ph: '예: OO코스메틱' },
      { f: 'kind', label: '유형', type: 'chips', opts: ['클레임', '품질 문의', '심사 · 감사', '자료 제출'], def: '클레임' },
      { f: 'status', label: '상태', type: 'chips', opts: ['진행 중', '완료'], def: '진행 중' },
    ],
    sq: [
      { f: 'partner', label: '업체', type: 'text', req: true, ph: '예: 대한포장' },
      { f: 'ptype', label: '업체 구분', type: 'chips', opts: ['부자재', '기계 · 설비', '기타'], def: '부자재' },
      { f: 'kind', label: '유형', type: 'chips', opts: ['방문', '부적합 통보', '시정조치 요청', '개선 확인', '기술 협의'], def: '부적합 통보' },
      { f: 'status', label: '상태', type: 'chips', opts: ['진행 중', '완료'], def: '진행 중' },
    ],
    mtg: [
      { f: 'topic', label: '주제', type: 'text', req: true, ph: '예: 50ml 용기 누액 대책 회의' },
      { f: 'mtype', label: '구분', type: 'chips', opts: ['사내 회의', '고객사 미팅', '업체 미팅', '기타'], def: '사내 회의' },
      { f: 'partner', label: '상대 · 참석자', type: 'text', ph: '예: OO코스메틱 품질팀, 생산팀' },
      { f: 'detail', label: '결정 사항', type: 'text', ph: '예: 펌프 토크 기준 상향, 다음 주 재시험' },
      { f: 'followup', label: '후속 조치', type: 'chips', opts: ['없음', '있음'], def: '없음' },
      { f: 'action', label: '후속 조치 내용', type: 'text', ph: '예: 시험 성적서 금요일까지 회신', show: d => d.followup === '있음' },
      { f: 'status', label: '후속 조치 상태', type: 'chips', opts: ['진행 중', '완료'], def: '진행 중', show: d => d.followup === '있음' },
    ],
    etc: [
      { f: 'title', label: '업무명', type: 'text', req: true, ph: '예: 품질 교육 자료 작성' },
      { f: 'category', label: '분류', type: 'chips', opts: ['문서 작업', '교육', '현장 지원', '정리 · 청소', '기타'], def: '문서 작업' },
      { f: 'detail', label: '내용', type: 'text', ph: '예: 신입 대상 수입검사 기준 교육' },
      { f: 'status', label: '상태', type: 'chips', opts: ['완료', '진행 중'], def: '완료' },
    ],
  };

  function isOpen(l) {
    switch (l.type) {
      case 'ct': return l.result === '진행 중';
      case 'spec': return l.kind !== '이상 없음' && l.status !== '반영 완료';
      case 'std': return ['대장 등록', '라벨링', '보관'].some(s => !has(l.steps, s));
      case 'smp': return smpSteps(l).some(s => !has(l.steps, s));
      case 'mk': return l.status === '제작 중' || (l.status === '제작 완료' && l.purpose === '고객 요청');
      case 'pe': case 'cs': case 'sq': case 'etc': return l.status === '진행 중';
      case 'mtg': return l.followup === '있음' && l.status !== '완료';
      default: return false;
    }
  }
  function closers(l) {
    switch (l.type) {
      case 'ct': return [{ label: '적합 완료', cls: 'primary', patch: { result: '적합' } }, { label: '부적합', cls: 'neg', patch: { result: '부적합' } }];
      case 'spec': return [{ label: '반영 완료', cls: 'primary', patch: { status: '반영 완료' } }];
      case 'mtg': return [{ label: '후속 조치 완료', cls: 'primary', patch: { status: '완료' } }];
      case 'std': return [{ label: '모두 처리', cls: 'primary', patch: { steps: ['대장 등록', '라벨링', '보관'] } }];
      case 'smp': return [{ label: has(l.kinds, '고객사') ? '출고 완료' : '대장 기록 완료', cls: 'primary', patch: { steps: smpSteps(l) } }];
      case 'mk': return l.status === '제작 중'
        ? [{ label: '제작 완료', cls: 'primary', patch: { status: '제작 완료' } }, ...(l.purpose === '고객 요청' ? [{ label: '발송 완료', cls: 'primary', patch: { status: '발송 완료' } }] : [])]
        : [{ label: '발송 완료', cls: 'primary', patch: { status: '발송 완료' } }];
      default: return [{ label: '완료 처리', cls: 'primary', patch: { status: '완료' } }];
    }
  }

  // ---------- KPI ----------
  const KPI_DEFS = [
    { key: 'iqc_count',  g: 'insp', name: '수입검사 실시',     unit: '로트', kind: 'count', dir: 'up',   target: 60, weight: 1, desc: '검사한 부자재 로트 수' },
    { key: 'iqc_pass',   g: 'insp', name: '수입검사 합격률',   unit: '%',   kind: 'rate',  dir: 'up',   target: 98, weight: 1, desc: '합격 로트 ÷ 검사 로트' },
    { key: 'ipqc_count', g: 'insp', name: '공정검사 실시',     unit: '회',   kind: 'count', dir: 'up',   target: 40, weight: 1, desc: '공정검사 횟수' },
    { key: 'ipqc_ng',    g: 'insp', name: '공정 부적합',       unit: '건',   kind: 'count', dir: 'down', target: 3,  weight: 1, desc: '한도 이하로 유지' },
    { key: 'fqc_count',  g: 'insp', name: '완제품 검사 실시',  unit: '로트', kind: 'count', dir: 'up',   target: 20, weight: 1, desc: '검사한 완제품 로트 수' },
    { key: 'fqc_pass',   g: 'insp', name: '완제품 합격률',     unit: '%',   kind: 'rate',  dir: 'up',   target: 99, weight: 1, desc: '합격 로트 ÷ 검사 로트' },
    { key: 'ct_done',    g: 'insp', name: 'CT테스트 완료',     unit: '건',   kind: 'count', dir: 'up',   target: 4,  weight: 1, desc: '판정까지 끝난 CT테스트' },
    { key: 'spec_count', g: 'mgmt', name: '포장사양서 검토',   unit: '건',   kind: 'count', dir: 'up',   target: 8,  weight: 1, desc: '검토한 사양서 수' },
    { key: 'std_rate',   g: 'mgmt', name: '표준견본 정리율',   unit: '%',   kind: 'rate',  dir: 'up',   target: 100, weight: 1, desc: '대장 등록 · 라벨링 · 보관까지 끝난 비율' },
    { key: 'smp_rate',   g: 'mgmt', name: '관리품 처리율',     unit: '%',   kind: 'rate',  dir: 'up',   target: 100, weight: 1, desc: '대장 기록 · 출고까지 끝난 비율' },
    { key: 'mk_done',    g: 'mgmt', name: '샘플제작 완료',     unit: '건',   kind: 'count', dir: 'up',   target: 4,  weight: 1, desc: '제작 또는 발송까지 끝난 샘플' },
    { key: 'pe_count',   g: 'mgmt', name: '생산기술 개선',     unit: '건',   kind: 'count', dir: 'up',   target: 4,  weight: 1, desc: '세팅 조정 · 신규 파트 · 설비 개선 완료 건' },
    { key: 'cs_close',   g: 'resp', name: '고객 대응 완료율',  unit: '%',   kind: 'rate',  dir: 'up',   target: 95, weight: 1, desc: '고객사 대응 중 완료 비율' },
    { key: 'sq_close',   g: 'resp', name: '업체 대응 완료율',  unit: '%',   kind: 'rate',  dir: 'up',   target: 90, weight: 1, desc: '업체 대응 중 완료 비율' },
    { key: 'mtg_follow', g: 'etc',  name: '미팅 후속조치 완료율', unit: '%', kind: 'rate', dir: 'up',   target: 90, weight: 1, desc: '후속 조치가 있는 미팅 중 완료 비율' },
  ];

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const today = () => ymd(new Date());
  const curMonth = () => today().slice(0, 7);
  const optsOf = (x, d) => typeof x.opts === 'function' ? x.opts(d) : x.opts;
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  function fmtMins(m) {
    m = Math.round(m || 0); if (!m) return '0분';
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`;
  }
  const fmtHours = m => (Math.round((m || 0) / 6) / 10).toFixed(1) + 'h';
  function fmtClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }

  // ---------- local store (IndexedDB) ----------
  const Store = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('qalog', 2);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('logs')) d.createObjectStore('logs', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
          if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
        };
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    run(store, mode, fn) {
      return new Promise((res, rej) => {
        const t = this.db.transaction(store, mode); const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req ? req.result : undefined);
        t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    },
    all() { return this.run('logs', 'readonly', s => s.getAll()); },
    put(l) { return this.run('logs', 'readwrite', s => s.put(l)); },
    putMany(list) { return this.run('logs', 'readwrite', s => { list.forEach(l => s.put(l)); return null; }); },
    del(id) { return this.run('logs', 'readwrite', s => s.delete(id)); },
    get(k) { return this.run('kv', 'readonly', s => s.get(k)); },
    set(k, v) { return this.run('kv', 'readwrite', s => s.put(v, k)); },
    remove(k) { return this.run('kv', 'readwrite', s => s.delete(k)); },
    getPhoto(id) { return this.run('photos', 'readonly', s => s.get(id)); },
    putPhoto(p) { return this.run('photos', 'readwrite', s => s.put(p)); },
    delPhotos(ids) { return this.run('photos', 'readwrite', s => { ids.forEach(id => s.delete(id)); return null; }); },
  };

  // Every record is rebuilt from a whitelist of fields with fixed types, so a tampered
  // backup file cannot smuggle markup or unexpected fields into the app.
  const MAX_PHOTOS = 20, MAX_FOLLOWUPS = 20;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const STR_FIELDS = ['partner', 'item', 'defect', 'action', 'lot', 'detail', 'invoice', 'line', 'note', 'kind', 'status', 'result', 'purpose', 'ptype', 'doneDate', 'topic', 'mtype', 'followup', 'title', 'category'];
  const NUM_FIELDS = { lots: [1, 9999], ngCount: [1, 9999], qty: [0, 1000000], mins: [1, 100000] };
  const ARR_FIELDS = ['lines', 'parts', 'tests', 'steps', 'kinds'];
  const TIME_FIELDS = ['createdAt', 'updatedAt', 'startAt', 'endAt'];
  const isType = t => typeof t === 'string' && Object.prototype.hasOwnProperty.call(TYPES, t);
  function normalizeLog(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    if (!isType(r.type) || typeof r.id !== 'string' || !ID_RE.test(r.id) || typeof r.date !== 'string' || !DATE_RE.test(r.date)) return null;
    const l = { id: r.id, type: r.type, date: r.date, month: r.date.slice(0, 7) };
    STR_FIELDS.forEach(f => { const v = r[f]; if (typeof v === 'string' && v) l[f] = v.slice(0, f === 'note' ? 2000 : 300); });
    Object.entries(NUM_FIELDS).forEach(([f, [lo, hi]]) => { if (r[f] == null || r[f] === '') return; const n = Math.round(Number(r[f])); if (Number.isFinite(n) && n >= lo && n <= hi) l[f] = n; });
    ARR_FIELDS.forEach(f => { if (Array.isArray(r[f])) l[f] = r[f].filter(x => typeof x === 'string').map(x => x.slice(0, 50)).slice(0, 20); });
    if (Array.isArray(r.photos)) { const ph = r.photos.filter(x => typeof x === 'string' && ID_RE.test(x)).slice(0, MAX_PHOTOS); if (ph.length) l.photos = ph; }
    if (Array.isArray(r.followups)) { const fu = r.followups.slice(0, MAX_FOLLOWUPS).map(normalizeFollowup).filter(Boolean); if (fu.length) l.followups = fu; }
    TIME_FIELDS.forEach(f => { const n = Number(r[f]); if (Number.isFinite(n) && n > 0 && n < 1e14) l[f] = n; });
    if (l.doneDate && !DATE_RE.test(l.doneDate)) delete l.doneDate;
    if (!l.createdAt) l.createdAt = Date.now();
    l.open = isOpen(l);
    return l;
  }
  function normalizeFollowup(f) {
    if (!f || typeof f !== 'object' || typeof f.id !== 'string' || !ID_RE.test(f.id)) return null;
    const title = typeof f.title === 'string' ? f.title.trim().slice(0, 200) : '';
    if (!title || typeof f.due !== 'string' || !DATE_RE.test(f.due)) return null;
    const o = { id: f.id, title, due: f.due, done: f.done === true };
    if (typeof f.time === 'string' && TIME_RE.test(f.time)) o.time = f.time;
    const da = Number(f.doneAt); if (o.done && Number.isFinite(da) && da > 0) o.doneAt = da;
    return o;
  }
  function normalizeConfig(c) {
    const out = { targets: {}, weights: {} };
    if (!c || typeof c !== 'object') return out;
    if (Number.isFinite(Number(c.updatedAt)) && Number(c.updatedAt) > 0) out.updatedAt = Number(c.updatedAt);
    KPI_DEFS.forEach(k => {
      const t = Number(c.targets?.[k.key]), w = Number(c.weights?.[k.key]);
      if (Number.isFinite(t) && t >= 0 && t <= 1e6) out.targets[k.key] = t;
      if (Number.isFinite(w) && w >= 0 && w <= 100) out.weights[k.key] = w;
    });
    return out;
  }
  function normalizeTimer(t) {
    if (!t || !isType(t.type)) return null;
    const startAt = Number(t.startAt), endAt = t.endAt == null ? null : Number(t.endAt);
    if (!Number.isFinite(startAt) || startAt <= 0) return null;
    const out = { type: t.type, startAt };
    if (Number.isFinite(endAt) && endAt >= startAt) out.endAt = endAt;
    return out;
  }

  const state = {
    ok: false, month: curMonth(), tab: 'rec', filter: 'all', mix: 'time',
    logs: [], cfg: { targets: {}, weights: {} }, timer: null, lastExport: null,
    draftType: null, draft: {}, editing: null, pendingDelete: null, cancelArm: false,
  };
  const monthLogs = () => state.logs.filter(l => l.month === state.month);
  const todayLogs = () => state.logs.filter(l => l.date === today());
  const openLogs = () => state.logs.filter(l => l.open);
  const byId = id => state.logs.find(l => l.id === id);

  // ---------- helpers ----------
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function banner(msg) { const b = $('banner'); b.textContent = msg || ''; b.hidden = !msg; }
  function monthLabel(m) { const [y, mm] = m.split('-'); return `${y}. ${mm}`; }
  function shiftMonth(m, n) { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  function daysIn(m) { const [y, mm] = m.split('-').map(Number); return new Date(y, mm, 0).getDate(); }
  function dayLabel(date) {
    const d = new Date(date + 'T00:00:00'); const w = '일월화수목금토'[d.getDay()];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${w})`;
  }
  function target(k) { const v = state.cfg.targets?.[k.key]; return typeof v === 'number' ? v : k.target; }
  function weight(k) { const v = state.cfg.weights?.[k.key]; return typeof v === 'number' ? v : k.weight; }

  function recNo(log) {
    const same = state.logs.filter(l => l.type === log.type && l.date === log.date).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const i = same.findIndex(l => l.id === log.id);
    return `${TYPES[log.type].code}-${esc(String(log.date).slice(5).replace('-', ''))}-${pad(Math.max(i, 0) + 1)}`;
  }

  const P = (cls, t) => `<span class="pill ${cls}">${esc(t)}</span>`;
  const ticks = (opts, on) => `<span class="ticks">${opts.map(o => `<span class="${has(on, o) ? 'on' : ''}">${esc(o)}</span>`).join('')}</span>`;
  const joinT = (...a) => a.filter(Boolean).map(esc).join(' · ');

  function summary(l) { // plain-text title + detail, used by rows and CSV
    const lines = Array.isArray(l.lines) ? l.lines.join('·') : l.line;
    switch (l.type) {
      case 'iqc': return [[l.partner, l.item], [l.result, `${l.lots || 1}로트`, l.defect]];
      case 'ipqc': return [[lines], [l.result === 'NG' ? `NG ${l.ngCount || 1}건` : 'OK', l.action && '조치: ' + l.action]];
      case 'fqc': return [[l.item, l.partner], [l.result, `${l.lots || 1}로트`, l.lot && 'LOT ' + l.lot, l.defect]];
      case 'ct': return [[l.item, l.partner], [l.result, l.tests?.length ? '시험: ' + l.tests.join('/') : '', l.defect]];
      case 'spec': return [[l.item, l.partner], [l.kind, l.kind !== '이상 없음' && l.status, l.detail]];
      case 'std': return [[l.item, l.partner], [(l.steps || []).join('/')]];
      case 'smp': return [[l.item, l.partner], [(l.kinds || []).join('/'), l.lot && 'LOT ' + l.lot, (l.steps || []).join('/'), l.invoice && '송장 ' + l.invoice]];
      case 'mk': return [[l.item, l.partner], [l.status, l.purpose, l.qty && l.qty + '개']];
      case 'pe': return [[l.line], [l.status, l.kind, l.detail]];
      case 'cs': return [[l.partner], [l.status, l.kind]];
      case 'sq': return [[l.partner], [l.status, l.ptype, l.kind]];
      case 'mtg': return [[l.topic, l.partner], [l.mtype, l.detail && '결정: ' + l.detail, l.followup === '있음' ? `후속(${l.status || '진행 중'}): ${l.action || ''}` : '후속 없음']];
      case 'etc': return [[l.title], [l.status, l.category, l.detail]];
    }
    return [[], []];
  }

  function describe(l) {
    const parts = [];
    let title = '';
    switch (l.type) {
      case 'iqc':
        title = joinT(l.partner, l.item);
        parts.push(l.result === '불합격' ? P('bad', '불합격') : P('ok', '합격'), `${esc(l.lots || 1)}로트`, esc(l.defect));
        break;
      case 'ipqc':
        title = esc((Array.isArray(l.lines) && l.lines.length ? l.lines.join(' · ') : l.line) || '');
        parts.push(l.result === 'NG' ? P('bad', `NG ${l.ngCount || 1}건`) : P('ok', 'OK'), l.action ? '조치: ' + esc(l.action) : '');
        break;
      case 'fqc':
        title = joinT(l.item, l.partner);
        parts.push(l.result === '불합격' ? P('bad', '불합격') : P('ok', '합격'), `${esc(l.lots || 1)}로트`, l.lot ? 'LOT ' + esc(l.lot) : '', esc(l.defect));
        break;
      case 'ct':
        title = joinT(l.item, l.partner);
        parts.push(l.result === '적합' ? P('ok', '적합') : l.result === '부적합' ? P('bad', '부적합') : P('warn', '진행 중'),
          ticks(['치수', '결합', '누액', '고온', '저온'], l.tests), esc(l.defect));
        break;
      case 'spec':
        title = joinT(l.item, l.partner);
        parts.push(l.kind === '이상 없음' ? P('ok', '이상 없음') : l.status === '반영 완료' ? P('ok', '반영 완료') : P('warn', '회신 대기'),
          l.kind !== '이상 없음' ? esc(l.kind) : '', esc(l.detail));
        break;
      case 'std':
        title = joinT(l.item, l.partner);
        parts.push(isOpen(l) ? P('warn', '정리 중') : P('ok', '정리 완료'), ticks(['대장 등록', '라벨링', '보관'], l.steps));
        break;
      case 'smp':
        title = joinT(l.item, l.partner);
        parts.push(isOpen(l) ? P('warn', has(l.kinds, '고객사') ? '출고 전' : '기록 전') : P('ok', has(l.kinds, '고객사') ? '출고 완료' : '기록 완료'),
          esc((l.kinds || []).join(' · ')), l.lot ? 'LOT ' + esc(l.lot) : '', ticks(smpSteps(l), l.steps), l.invoice ? '송장 ' + esc(l.invoice) : '');
        break;
      case 'mk':
        title = joinT(l.item, l.partner);
        parts.push(l.status === '발송 완료' ? P('ok', '발송 완료') : l.status === '제작 완료' ? P(l.purpose === '고객 요청' ? 'warn' : 'ok', '제작 완료') : P('warn', '제작 중'),
          esc(l.purpose), l.qty ? `${esc(l.qty)}개` : '');
        break;
      case 'pe':
        title = esc(l.line);
        parts.push(l.status === '완료' ? P('ok', '완료') : P('warn', '진행 중'), esc(l.kind), esc(l.detail));
        break;
      case 'cs': case 'sq':
        title = esc(l.partner);
        parts.push(l.status === '완료' ? P('ok', '완료' + (l.doneDate ? ' ' + l.doneDate.slice(5).replace('-', '/') : '')) : P('warn', '진행 중'),
          l.type === 'sq' && l.ptype ? esc(l.ptype) : '', esc(l.kind));
        break;
      case 'mtg':
        title = joinT(l.topic, l.partner);
        parts.push(l.followup === '있음' ? (l.status === '완료' ? P('ok', '후속 완료') : P('warn', '후속 진행 중')) : P('mute', '후속 없음'),
          esc(l.mtype), l.detail ? '결정: ' + esc(l.detail) : '', l.action ? '후속: ' + esc(l.action) : '');
        break;
      case 'etc':
        title = esc(l.title);
        parts.push(l.status === '진행 중' ? P('warn', '진행 중') : P('ok', '완료'), esc(l.category), esc(l.detail));
        break;
    }
    if (l.mins) parts.push(P('time', fmtMins(l.mins)));
    return { title, sub: parts.filter(Boolean).map(x => x.startsWith('<') ? x : `<span>${x}</span>`).join('') };
  }

  // ---------- photos ----------
  const photoCache = new Map(); // `${id}:t|f` -> object URL
  async function photoUrl(id, full) {
    const key = id + (full ? ':f' : ':t');
    if (photoCache.has(key)) return photoCache.get(key);
    const rec = state.draftNew?.get(id) || await Store.getPhoto(id);
    if (!rec) return '';
    const blob = full ? rec.blob : (rec.thumb || rec.blob);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    photoCache.set(key, url);
    return url;
  }
  function dropPhotoUrls(ids) {
    ids.forEach(id => ['t', 'f'].forEach(k => { const u = photoCache.get(id + ':' + k); if (u) { URL.revokeObjectURL(u); photoCache.delete(id + ':' + k); } }));
  }
  function hydratePhotos(root) {
    (root || document).querySelectorAll('img[data-ph]:not([src])').forEach(async img => {
      const url = await photoUrl(img.dataset.ph, false).catch(() => '');
      if (url) img.src = url; else img.alt = '사진 없음';
    });
  }
  function photoStrip(l) {
    const ids = l.photos || []; if (!ids.length) return '';
    const shown = ids.slice(0, 4);
    return `<div class="row-photos">${shown.map((id, i) => `<div class="ph"><button class="ph-open" data-view="${esc(l.id)}" data-vi="${i}" aria-label="사진 ${i + 1} 크게 보기"><img data-ph="${esc(id)}" alt=""></button>${i === 3 && ids.length > 4 ? `<span class="more">+${ids.length - 4}</span>` : ''}</div>`).join('')}</div>`;
  }
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => res({ img, url }); img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }
  async function drawScaled(src, w0, h0, max, quality) {
    const sc = Math.min(1, max / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error('encode');
    return { blob, w, h };
  }
  // Re-encodes every photo: shrinks it for storage and strips camera metadata such as GPS location.
  async function processImage(file) {
    let src, w0, h0, cleanup = () => {};
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w0 = src.width; h0 = src.height;
      cleanup = () => src.close && src.close();
    } catch {
      const { img, url } = await loadImage(file); src = img; w0 = img.naturalWidth; h0 = img.naturalHeight;
      cleanup = () => URL.revokeObjectURL(url);
    }
    try {
      if (!w0 || !h0) throw new Error('empty');
      const full = await drawScaled(src, w0, h0, 1600, 0.82);
      const thumb = await drawScaled(src, w0, h0, 360, 0.75);
      return { blob: full.blob, thumb: thumb.blob, w: full.w, h: full.h };
    } finally { cleanup(); }
  }
  async function addPhotos(files) {
    const list = Array.from(files || []).filter(f => f && (!f.type || f.type.startsWith('image/')));
    if (!list.length) return;
    const d = state.draft; d.photos = d.photos || [];
    const room = MAX_PHOTOS - d.photos.length - state.draftNew.size;
    if (room <= 0) { toast(`사진은 한 기록에 ${MAX_PHOTOS}장까지 넣을 수 있어요`); return; }
    const busy = $('photoBusy'); if (busy) busy.hidden = false;
    let failed = 0;
    for (const f of list.slice(0, room)) {
      try { const p = await processImage(f); const id = newId(); state.draftNew.set(id, { id, ...p, createdAt: Date.now() }); }
      catch { failed++; }
    }
    if (list.length > room) toast(`사진은 한 기록에 ${MAX_PHOTOS}장까지라 ${list.length - room}장은 빼고 넣었어요`);
    else if (failed) toast(`${failed}장은 열 수 없는 형식이에요. 카메라 설정에서 HEIF 대신 JPG로 저장해 주세요`);
    renderPhotoField();
  }
  function renderFollowupField(focusId) {
    const box = $('fuList'); if (!box) return;
    const list = state.draft.followups || [];
    box.innerHTML = list.map(f => `<div class="fu-edit ${f.done ? 'done' : ''}">
      <div class="fu-row1"><button type="button" class="fu-check" data-futoggle="${esc(f.id)}" aria-pressed="${!!f.done}" aria-label="완료">✓</button>
        <input type="text" data-fuf="title" data-fuid="${esc(f.id)}" value="${esc(f.title || '')}" placeholder="예: 시험 성적서 고객사 회신" maxlength="200" aria-label="후속 업무 내용">
        <button type="button" class="fu-del" data-fudel="${esc(f.id)}" aria-label="후속 업무 빼기">×</button></div>
      <div class="fu-row2"><input type="date" data-fuf="due" data-fuid="${esc(f.id)}" value="${esc(f.due || '')}" aria-label="마감일">
        <input type="time" data-fuf="time" data-fuid="${esc(f.id)}" value="${esc(f.time || '')}" aria-label="알림 시간(선택)">
        <span class="fu-quick">${[[1, '내일'], [3, '3일 후'], [7, '1주 후']].map(([n, t]) => `<button type="button" data-fudue="${esc(f.id)}" data-days="${n}">${t}</button>`).join('')}</span></div>
    </div>`).join('');
    if (focusId) { const el = box.querySelector(`input[data-fuf="title"][data-fuid="${focusId}"]`); if (el) el.focus(); }
  }
  function draftPhotoIds() { return [...(state.draft.photos || []), ...state.draftNew.keys()]; }
  function renderPhotoField() {
    const box = $('formPhotos'); if (!box) return;
    const ids = draftPhotoIds();
    box.innerHTML = ids.map((id, i) => `<div class="ph"><button class="ph-open" type="button" data-view="__draft" data-vi="${i}" aria-label="사진 ${i + 1} 크게 보기"><img data-ph="${esc(id)}" alt=""></button><button type="button" class="del" data-phdel="${esc(id)}" aria-label="사진 ${i + 1} 빼기">×</button></div>`).join('');
    $('photoCount').textContent = ids.length ? `${ids.length}장` : '';
    const busy = $('photoBusy'); if (busy) busy.hidden = true;
    hydratePhotos(box);
  }
  const viewer = { ids: [], i: 0 };
  async function showViewer() {
    const id = viewer.ids[viewer.i]; if (!id) return;
    $('viewer').hidden = false;
    $('viewerCount').textContent = viewer.ids.length > 1 ? `${viewer.i + 1} / ${viewer.ids.length}` : '';
    document.querySelector('.vprev').hidden = document.querySelector('.vnext').hidden = viewer.ids.length < 2;
    $('viewerImg').src = await photoUrl(id, true).catch(() => '') || await photoUrl(id, false).catch(() => '');
  }
  function openViewer(ids, i) { viewer.ids = ids; viewer.i = Math.max(0, Math.min(i, ids.length - 1)); showViewer(); }
  function closeViewer() { $('viewer').hidden = true; $('viewerImg').removeAttribute('src'); }

  function rowHTML(l, opts = {}) {
    const t = TYPES[l.type]; if (!t) return '';
    const d = describe(l);
    const confirming = state.pendingDelete === l.id;
    const when = l.startAt && l.endAt ? ` · ${hm(l.startAt)}–${hm(l.endAt)}` : '';
    return `<div class="row" style="--tc:${t.color}">
      <span class="chip-code">${t.code}</span>
      <div class="row-main">
        <div class="row-title">${d.title || '(이름 없음)'}</div>
        <div class="row-sub">${d.sub}</div>
        ${l.note ? `<div class="row-note">${esc(l.note)}</div>` : ''}
        ${rowFollowups(l)}
        ${photoStrip(l)}
        <div class="row-sub num" style="font-size:11px">${recNo(l)}${opts.showDate ? ' · ' + dayLabel(l.date) : ''}${when}</div>
        <div class="row-acts">
          ${l.open ? closers(l).map((c, i) => `<button class="mini ${c.cls}" data-close="${esc(l.id)}" data-ci="${i}">${c.label}</button>`).join('') : ''}
          <button class="mini" data-edit="${esc(l.id)}">수정</button>
          <button class="mini ${confirming ? 'danger' : ''}" data-del="${esc(l.id)}">${confirming ? '정말 삭제' : '삭제'}</button>
        </div>
      </div>
    </div>`;
  }

  function compute(logs) {
    const of = t => logs.filter(l => l.type === t);
    const lotsSum = (arr, pass) => arr.filter(l => !pass || l.result !== '불합격').reduce((s, l) => s + (l.lots || 1), 0);
    const iqc = of('iqc'), fqc = of('fqc'), ipqc = of('ipqc');
    const iL = lotsSum(iqc), iP = lotsSum(iqc, true), fL = lotsSum(fqc), fP = lotsSum(fqc, true);
    const rate = arr => { const done = arr.filter(l => !isOpen(l)).length; return { v: arr.length ? done / arr.length * 100 : null, extra: `${done}/${arr.length} 건` }; };
    return {
      iqc_count: { v: iL },
      iqc_pass: { v: iL ? iP / iL * 100 : null, extra: `${iP}/${iL} 로트` },
      ipqc_count: { v: ipqc.length },
      ipqc_ng: { v: ipqc.filter(l => l.result === 'NG').reduce((s, l) => s + (l.ngCount || 1), 0) },
      fqc_count: { v: fL },
      fqc_pass: { v: fL ? fP / fL * 100 : null, extra: `${fP}/${fL} 로트` },
      ct_done: { v: of('ct').filter(l => !isOpen(l)).length, extra: `진행 중 ${of('ct').filter(isOpen).length}건` },
      spec_count: { v: of('spec').length },
      std_rate: rate(of('std')),
      smp_rate: rate(of('smp')),
      mk_done: { v: of('mk').filter(l => l.status !== '제작 중').length, extra: `제작 중 ${of('mk').filter(l => l.status === '제작 중').length}건` },
      pe_count: { v: of('pe').filter(l => !isOpen(l)).length },
      cs_close: rate(of('cs')),
      sq_close: rate(of('sq')),
      mtg_follow: rate(of('mtg').filter(l => l.followup === '있음')),
    };
  }
  function elapsed(m) {
    const cm = curMonth();
    if (m < cm) return 1; if (m > cm) return 0;
    return new Date().getDate() / daysIn(m);
  }
  function judge(k, a, frac) {
    const t = target(k); const v = a.v;
    if (v === null) return { ach: null, status: 'none', label: '기록 없음' };
    if (k.dir === 'down') {
      const ach = v <= t ? 1 : t / v;
      if (v > t) return { ach, status: 'bad', label: '한도 초과' };
      if (frac < 1 && v > 0 && v >= t * Math.max(frac, .5)) return { ach, status: 'warn', label: '주의' };
      return { ach, status: 'ok', label: frac < 1 ? '유지 중' : '달성' };
    }
    const ach = t > 0 ? v / t : 1;
    if (ach >= 1) return { ach, status: 'ok', label: '달성' };
    if (k.kind === 'rate') return ach >= .97 ? { ach, status: 'warn', label: '근접' } : { ach, status: 'bad', label: '미달' };
    if (frac < 1) {
      const pace = t * frac;
      if (v >= pace * .9) return { ach, status: 'ok', label: '순항' };
      if (v >= pace * .7) return { ach, status: 'warn', label: '주의' };
      return { ach, status: 'bad', label: '뒤처짐' };
    }
    return { ach, status: ach >= .9 ? 'warn' : 'bad', label: ach >= .9 ? '근접' : '미달' };
  }
  const fmt = (v, unit) => v === null ? '–' : (unit === '%' ? (Math.round(v * 10) / 10).toFixed(1) : String(v));

  // ---------- timer ----------
  function renderTimer() {
    const bar = $('timerBar'); const tm = state.timer;
    if (!tm) { bar.hidden = true; return; }
    const t = TYPES[tm.type];
    const stopped = !!tm.endAt;
    bar.hidden = false; bar.classList.toggle('stopped', stopped);
    bar.innerHTML = `<span class="dot" aria-hidden="true"></span>
      <span class="what"><small>${t.code} · ${hm(tm.startAt)} 시작${stopped ? ' · 종료됨' : ''}</small><b>${t.label}</b></span>
      <span class="clock" id="timerClock">${fmtClock((tm.endAt || Date.now()) - tm.startAt)}</span>
      ${stopped ? `<button class="stop" data-timer="record">기록</button>` : `<button class="stop" data-timer="stop">종료</button>`}
      <button class="cancel ${state.cancelArm ? 'confirm' : ''}" data-timer="cancel" aria-label="타이머 버리기">${state.cancelArm ? '버리기' : '✕'}</button>`;
  }
  setInterval(() => {
    const tm = state.timer; if (!tm || tm.endAt) return;
    const c = $('timerClock'); if (c) c.textContent = fmtClock(Date.now() - tm.startAt);
  }, 1000);

  async function startTimer(type) {
    if (state.timer) { toast('진행 중인 타이머를 먼저 종료해 주세요'); return; }
    state.timer = { type, startAt: Date.now() };
    await Store.set('timer', state.timer);
    toast(`${TYPES[type].short} 시작`);
    render();
  }
  async function stopTimer() {
    const tm = state.timer; if (!tm) return;
    if (!tm.endAt) { tm.endAt = Date.now(); await Store.set('timer', tm); }
    render();
    const mins = Math.max(1, Math.round((tm.endAt - tm.startAt) / 60000));
    openForm(tm.type, null, { mins, startAt: tm.startAt, endAt: tm.endAt, date: ymd(new Date(tm.startAt)), _fromTimer: true });
  }
  async function discardTimer() {
    state.timer = null; state.cancelArm = false;
    await Store.remove('timer');
    toast('타이머를 버렸습니다'); render();
  }

  // ---------- follow-ups ----------
  function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
  function openFollowups() {
    const out = [];
    state.logs.forEach(l => (l.followups || []).forEach(f => { if (!f.done) out.push({ f, l }); }));
    return out.sort((a, b) => a.f.due < b.f.due ? -1 : a.f.due > b.f.due ? 1 : (a.f.time || '99') < (b.f.time || '99') ? -1 : 1);
  }
  function dueInfo(f) {
    const n = daysBetween(today(), f.due);
    const w = '일월화수목금토'[new Date(f.due + 'T00:00:00').getDay()];
    const md = `${Number(f.due.slice(5, 7))}/${Number(f.due.slice(8))}(${w})`;
    if (n < 0) return { cls: 'over', label: `${-n}일 지남` };
    if (n === 0) return { cls: 'today', label: '오늘' + (f.time ? ' ' + f.time : '') };
    if (n === 1) return { cls: 'soon', label: '내일' + (f.time ? ' ' + f.time : '') };
    return { cls: n <= 7 ? 'soon' : 'later', label: `${md} · D-${n}` };
  }
  function logTitleText(l) { const [t] = summary(l); return t.filter(Boolean).join(' · ') || TYPES[l.type].label; }
  function todoHTML({ f, l }) {
    const d = dueInfo(f), t = TYPES[l.type];
    const key = `${esc(l.id)}|${esc(f.id)}`;
    return `<div class="todo ${d.cls}" style="--tc:${t.color}">
      <button class="todo-check" data-fudone="${key}" aria-label="${esc(f.title)} 완료로 표시"></button>
      <div class="todo-main"><div class="todo-title">${esc(f.title)}</div>
        <div class="todo-sub"><span class="due ${d.cls}">${esc(d.label)}</span><span class="chip-code" style="--tc:${t.color}">${t.code}</span><span class="src">${esc(logTitleText(l))}</span></div></div>
      <div class="todo-acts">${d.cls === 'over' || d.cls === 'today' ? `<button class="mini" data-fusnooze="${key}">내일로</button>` : ''}<button class="mini" data-edit="${esc(l.id)}">열기</button></div>
    </div>`;
  }
  function renderTodo() {
    const box = $('todoBox'); if (!box) return;
    const all = openFollowups(), t0 = today(), week = addDays(t0, 7);
    const over = all.filter(x => x.f.due < t0), tod = all.filter(x => x.f.due === t0), soon = all.filter(x => x.f.due > t0 && x.f.due <= week);
    const shown = [...over, ...tod, ...soon];
    if (!shown.length) { box.hidden = true; box.innerHTML = ''; return; }
    const MAX = 6, rest = all.length - Math.min(shown.length, MAX);
    box.hidden = false;
    box.innerHTML = `<div class="todo-box"><div class="todo-head"><b>할 일 · 후속 업무</b><span class="chips">${over.length ? `<span class="pill bad">지남 ${over.length}</span>` : ''}${tod.length ? `<span class="pill warn">오늘 ${tod.length}</span>` : ''}${soon.length ? `<span class="pill mute">이번 주 ${soon.length}</span>` : ''}</span></div>
      ${shown.slice(0, MAX).map(todoHTML).join('')}
      ${rest > 0 ? `<div class="todo-more"><span>나머지 ${rest}건</span><button data-go="kpi">전체 보기</button></div>` : ''}</div>`;
  }
  function renderFollowupsAll() {
    const box = $('fuAll'); if (!box) return;
    const all = openFollowups();
    const doneThisMonth = state.logs.reduce((n, l) => n + (l.followups || []).filter(f => f.done && f.doneAt && ymd(new Date(f.doneAt)).slice(0, 7) === curMonth()).length, 0);
    $('fuCount').textContent = all.length ? `${all.length}건 남음` : '';
    box.innerHTML = all.length
      ? `<div class="todo-box">${all.map(todoHTML).join('')}${doneThisMonth ? `<div class="todo-more"><span>이번 달 완료 ${doneThisMonth}건</span></div>` : ''}</div>`
      : `<div class="empty">남은 후속 업무가 없어요.${doneThisMonth ? ` 이번 달 ${doneThisMonth}건 완료.` : ''}<br>기록을 열어 <b>+ 후속 업무 추가</b>로 마감일을 정하면 여기에 모입니다.</div>`;
  }
  function rowFollowups(l) {
    const fu = l.followups || []; if (!fu.length) return '';
    return `<div class="row-fu">${fu.map(f => { if (f.done) return `<span><s>↳ ${esc(f.title)}</s> ✓</span>`; const d = dueInfo(f); return `<span>↳ ${esc(f.title)} · <span class="${d.cls === 'over' || d.cls === 'today' ? d.cls : ''}">${esc(d.label)}</span></span>`; }).join('')}</div>`;
  }
  async function updateFollowup(logId, fid, patch, msg) {
    const l = byId(logId); if (!l) return;
    const next = { ...l, followups: (l.followups || []).map(f => f.id === fid ? { ...f, ...patch } : f), updatedAt: Date.now() };
    try { await Store.put(next); state.logs = state.logs.map(x => x.id === next.id ? next : x); markDirty(next.id); toast(msg); render(); }
    catch { toast('변경하지 못했습니다. 다시 시도해 주세요.'); }
  }

  // Android notifications (the web app shows follow-ups on screen only)
  const notif = { perm: 'unsupported', time: '09:00', lastKey: '' };
  const LN = () => (isNative() && window.Capacitor?.Plugins?.LocalNotifications) || null;
  function hashId(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return 1000 + ((h >>> 0) % 2000000000); }
  async function notifInit() {
    try { const t = await Store.get('notifTime'); if (typeof t === 'string' && TIME_RE.test(t)) notif.time = t; } catch { }
    const ln = LN(); if (!ln) return;
    try {
      notif.perm = (await ln.checkPermissions()).display;
      // Private lock-screen visibility: task names stay hidden until the phone is unlocked.
      await ln.createChannel({ id: 'followups', name: '후속 업무', description: '후속 업무 마감 알림', importance: 4, visibility: 0, vibration: true });
      ln.addListener('localNotificationActionPerformed', () => { if (state.draftType) closeForm(); setTab('rec'); });
    } catch (e) { rememberJsError('notif init: ' + (e && e.message)); }
  }
  async function askNotifPermission() {
    const ln = LN(); if (!ln) return false;
    try { notif.perm = (await ln.requestPermissions()).display; } catch { }
    notif.lastKey = ''; scheduleNotifs(); renderNotif();
    return notif.perm === 'granted';
  }
  let notifTimer = null;
  function scheduleNotifs() {
    if (!LN() || notif.perm !== 'granted') return;
    const all = openFollowups();
    const key = today() + '|' + notif.time + '|' + all.map(x => `${x.f.id}:${x.f.due}:${x.f.time || ''}:${x.f.title.length}`).join(',');
    if (key === notif.lastKey) return;
    clearTimeout(notifTimer);
    notifTimer = setTimeout(() => rescheduleNotifs(all, key).catch(e => rememberJsError('notif: ' + (e && e.message))), 700);
  }
  async function rescheduleNotifs(all, key) {
    const ln = LN(); if (!ln) return;
    const pending = (await ln.getPending()).notifications || [];
    if (pending.length) await ln.cancel({ notifications: pending.map(n => ({ id: n.id })) });
    const items = [], now = Date.now(), t0 = today();
    all.forEach(({ f }) => {
      if (!f.time) return;
      const at = new Date(`${f.due}T${f.time}:00`);
      if (at.getTime() > now + 30000) items.push({ id: hashId(f.id), title: '후속 업무 마감', body: `${f.title} · ${f.time}`, schedule: { at, allowWhileIdle: true }, channelId: 'followups', extra: { qalog: 1 } });
    });
    for (let d = 0; d < 14; d++) { // morning summary: due that day + still overdue
      const day = addDays(t0, d), at = new Date(`${day}T${notif.time}:00`);
      if (at.getTime() <= now + 30000) continue;
      const dueN = all.filter(x => x.f.due === day).length, overN = all.filter(x => x.f.due < day).length;
      if (!dueN && !overN) continue;
      items.push({ id: 100 + d, title: '오늘의 후속 업무', body: [dueN && `오늘 마감 ${dueN}건`, overN && `기한 지난 ${overN}건`].filter(Boolean).join(' · '),
        schedule: { at, allowWhileIdle: true }, channelId: 'followups', extra: { qalog: 1 } });
    }
    if (items.length) await ln.schedule({ notifications: items.slice(0, 64) });
    notif.lastKey = key;
  }
  function renderNotif() {
    const box = $('notifBox'); if (!box) return;
    if (!LN()) {
      box.innerHTML = `<div class="stat">이 기기에서는 화면 표시만 돼요</div>
        <p>아이폰 웹앱은 앱이 닫혀 있을 때 알림을 보낼 수 없어요. 앱을 열면 <b>기록</b> 탭 맨 위 "할 일"에 기한이 지난 것과 오늘 마감인 후속 업무가 먼저 보입니다.</p>`;
      return;
    }
    const st = { granted: ['on', '알림 켜짐'], denied: ['err', '알림 꺼짐'], prompt: ['', '알림 허용 전'], 'prompt-with-rationale': ['', '알림 허용 전'] }[notif.perm] || ['', '확인 중'];
    box.innerHTML = `<div class="sync-head"><span class="sync-dot ${st[0]}">${st[1]}</span></div>
      <label>매일 알림 시각<input type="time" id="notifTime" value="${esc(notif.time)}" style="border:1px solid var(--line);background:var(--paper);border-radius:10px;padding:10px 12px;font-size:16px;max-width:160px"></label>
      <p>이 시각에 그날 마감인 후속 업무와 기한이 지난 후속 업무 수를 알려 드려요. 시간을 정한 후속 업무는 그 시간에 따로 알려 드립니다. 잠금화면에서는 내용이 숨겨져요.</p>
      ${notif.perm === 'granted' ? '' : notif.perm === 'denied'
        ? '<div class="note-warn">알림이 꺼져 있어요. 휴대폰 <b>설정 → 애플리케이션 → QA 업무일지 → 알림</b>에서 켜 주세요.</div>'
        : '<button class="btn" id="notifAllow">알림 허용</button>'}`;
  }

  // ---------- render ----------
  function renderHeader() {
    $('mLabel').textContent = monthLabel(state.month);
    $('todayLabel').textContent = dayLabel(today());
    const atNow = state.month >= curMonth();
    $('mNext').disabled = atNow; $('mNext').style.opacity = atNow ? .3 : 1;
    const n = openLogs().length;
    $('navBadge').textContent = n; $('navBadge').hidden = !n;
    const t0 = today(), urgent = openFollowups().filter(x => x.f.due <= t0).length;
    $('navBadgeRec').textContent = urgent; $('navBadgeRec').hidden = !urgent;
    renderTimer();
  }

  function renderRec() {
    renderTodo();
    const mm = Number(state.month.slice(5)); const ml = monthLogs(); const ol = openLogs();
    $('tagGroups').innerHTML = GROUPS.map(g => `<div class="grp" style="--gc:${g.color}">
      <div class="grp-label">${g.label}</div>
      <div class="tags">${g.types.map(k => {
        const t = TYPES[k]; const n = ml.filter(l => l.type === k).length; const o = ol.filter(l => l.type === k).length;
        const running = state.timer && state.timer.type === k;
        return `<div class="tag ${running ? 'running' : ''}" style="--tc:${t.color}">
          <button class="tag-main" data-new="${k}">
            <span class="code">${t.code}</span><span class="label">${t.label}</span>
            <span class="cnt">${mm}월 <b>${n}</b>건${o ? `<span class="opn">· 미결 ${o}</span>` : ''}</span></button>
          <button class="tag-start" ${running ? 'data-timer="stop"' : `data-start="${k}"`} aria-label="${t.label} ${running ? '종료' : '시작'}">${running ? '종료' : '시작'}</button>
        </div>`;
      }).join('')}</div></div>`).join('');
    const list = todayLogs().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const mins = list.reduce((s, l) => s + (l.mins || 0), 0);
    $('todayCount').textContent = list.length ? `${list.length}건${mins ? ' · ' + fmtMins(mins) : ''}` : '';
    $('todayList').innerHTML = !state.ok ? '<div class="empty">기록을 불러오는 중…</div>'
      : list.length ? `<div class="list">${list.map(l => rowHTML(l)).join('')}</div>`
      : '<div class="empty">오늘은 아직 기록이 없어요.<br>카드를 누르면 바로 기록하고, <b>시작</b>을 누르면 시간을 잽니다.</div>';
  }

  function renderKpi() {
    renderFollowupsAll();
    const ml = monthLogs();
    const a = compute(ml); const frac = elapsed(state.month);
    let wsum = 0, asum = 0;
    const card = k => {
      const r = judge(k, a[k.key], frac); const w = weight(k);
      if (r.ach !== null && w > 0) { wsum += w; asum += Math.min(r.ach, 1) * w; }
      const t = target(k); const v = a[k.key].v;
      let fill, tick = null;
      if (k.dir === 'down') fill = t > 0 ? Math.min((v || 0) / t, 1) : (v ? 1 : 0);
      else fill = r.ach === null ? 0 : Math.min(r.ach, 1);
      if (k.kind === 'count' && k.dir === 'up' && frac > 0 && frac < 1) tick = frac;
      const pillCls = { ok: 'ok', warn: 'warn', bad: 'bad', none: 'mute' }[r.status];
      const note = (a[k.key].extra ? `${a[k.key].extra} · ` : '') + k.desc
        + (tick !== null ? ` · 오늘까지 목표 ${Math.round(t * frac)}${k.unit}` : '');
      return `<div class="kpi">
        <div class="kpi-head"><span class="kpi-name">${k.name}</span><span class="pill ${pillCls}">${r.label}</span></div>
        <div class="kpi-vals"><span class="act">${fmt(v, k.unit)}<small> ${k.unit}</small></span>
          <span class="tgt num">${k.dir === 'down' ? '한도 ≤ ' : '목표 '}${t}${k.unit}${r.ach !== null && k.dir === 'up' ? ` · ${Math.round(r.ach * 100)}%` : ''}</span></div>
        <div class="meter" role="img" aria-label="${k.name} 진행도"><i class="${r.status === 'none' ? '' : r.status}" style="width:${(fill * 100).toFixed(1)}%"></i>${tick !== null ? `<b style="left:calc(${(tick * 100).toFixed(1)}% - 1px)"></b>` : ''}</div>
        <div class="kpi-note">${note}</div>
      </div>`;
    };
    $('kpiList').innerHTML = GROUPS.filter(g => KPI_DEFS.some(k => k.g === g.id)).map(g => `<div class="grp" style="--gc:${g.color}"><div class="grp-label">${g.label}</div>${KPI_DEFS.filter(k => k.g === g.id).map(card).join('')}</div>`).join('');
    const overall = wsum ? asum / wsum * 100 : null;
    const totalMins = ml.reduce((s, l) => s + (l.mins || 0), 0);
    $('overallVal').innerHTML = overall === null ? '–' : `${Math.round(overall)}<small>%</small>`;
    $('hoursVal').textContent = fmtHours(totalMins);
    $('overallStatus').textContent = `${ml.length}건 기록`;
    $('timeFill').style.width = (frac * 100).toFixed(1) + '%';
    $('timeCap').textContent = frac >= 1 ? `${Number(state.month.slice(5))}월 마감` : frac === 0 ? '아직 시작 전인 달입니다' : `${daysIn(state.month)}일 중 ${new Date().getDate()}일 경과 (${Math.round(frac * 100)}%)`;

    const open = openLogs().sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
    $('openCount').textContent = open.length ? `${open.length}건` : '';
    $('openList').innerHTML = open.length ? `<div class="list">${open.map(l => rowHTML(l, { showDate: true })).join('')}</div>`
      : '<div class="empty">후속 처리가 남은 건이 없습니다.</div>';

    document.querySelectorAll('[data-mix]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mix === state.mix));
    const byTime = state.mix === 'time';
    const rows = Object.keys(TYPES).map(k => {
      const ls = ml.filter(l => l.type === k);
      return { k, n: ls.length, m: ls.reduce((s, l) => s + (l.mins || 0), 0) };
    }).sort((x, y) => byTime ? y.m - x.m : y.n - x.n);
    const val = r => byTime ? r.m : r.n;
    const total = rows.reduce((s, r) => s + val(r), 0); const max = Math.max(1, ...rows.map(val));
    $('mixBox').innerHTML = total ? `<div class="mix">${rows.map(r => `<div class="mix-row" style="--tc:${TYPES[r.k].color}">
      <span>${TYPES[r.k].short}</span><span class="bar"><i style="width:${(val(r) / max * 100).toFixed(1)}%"></i></span>
      <span class="n">${byTime ? fmtHours(r.m) : r.n + '건'}${total ? ` <span style="opacity:.6">${Math.round(val(r) / total * 100)}%</span>` : ''}</span></div>`).join('')}</div>`
      : `<div class="empty">${byTime ? '시작/종료 타이머로 기록하거나 소요 시간을 넣으면 업무별 시간 비중이 보입니다.' : '이 달의 기록이 쌓이면 업무별 건수 비중이 보입니다.'}</div>`;
  }

  function renderLog() {
    const fs = [['all', '전체'], ...Object.entries(TYPES).map(([k, t]) => [k, t.short])];
    $('filters').innerHTML = fs.map(([k, l]) => `<button class="fchip" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join('');
    const logs = monthLogs().filter(l => state.filter === 'all' || l.type === state.filter);
    if (!state.ok) { $('logList').innerHTML = '<div class="empty">기록을 불러오는 중…</div>'; return; }
    if (!logs.length) { $('logList').innerHTML = `<div class="empty">${monthLabel(state.month)}에 남긴 기록이 없습니다.</div>`; return; }
    const by = {};
    logs.forEach(l => (by[l.date] = by[l.date] || []).push(l));
    $('logList').innerHTML = Object.keys(by).sort().reverse().map(d => {
      const items = by[d].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const mins = items.reduce((s, l) => s + (l.mins || 0), 0);
      return `<div class="daylabel">${dayLabel(d)} · ${items.length}건${mins ? ' · ' + fmtMins(mins) : ''}</div><div class="list" style="margin-top:12px">${items.map(l => rowHTML(l)).join('')}</div>`;
    }).join('');
  }

  function renderSet() {
    $('setList').innerHTML = `<div class="set-row head"><span>KPI</span><span style="text-align:right">월 목표</span><span style="text-align:right">가중치</span></div>` +
      GROUPS.filter(g => KPI_DEFS.some(k => k.g === g.id)).map(g => `<div class="set-row sub" style="--gc:${g.color}"><span>${g.label}</span></div>` +
        KPI_DEFS.filter(k => k.g === g.id).map(k => `<div class="set-row">
          <label for="t_${k.key}">${k.name}<small>${k.dir === 'down' ? '한도 · ' : ''}${k.unit}</small></label>
          <input id="t_${k.key}" type="number" inputmode="decimal" min="0" step="any" value="${target(k)}">
          <input id="w_${k.key}" type="number" inputmode="decimal" min="0" step="any" value="${weight(k)}" aria-label="${k.name} 가중치">
        </div>`).join('')).join('');
    renderDataStat();
    renderDiag();
    renderSync();
    renderNotif();
    $('verLabel').textContent = `QA 업무일지 v${APP_VERSION} · ${isNative() ? '안드로이드 앱' : '웹앱'}`;
  }
  function renderDataStat() {
    const el = $('dataStat'); if (!el) return;
    const n = state.logs.length;
    if (!state.lastExport) { el.textContent = `저장된 기록 ${n}건 · 아직 백업한 적이 없습니다`; el.classList.toggle('warn', n > 0); return; }
    const days = Math.floor((Date.now() - state.lastExport) / 86400000);
    el.textContent = `저장된 기록 ${n}건 · 마지막 백업 ${days === 0 ? '오늘' : days + '일 전'}`;
    el.classList.toggle('warn', days >= 14);
  }

  function render() {
    renderHeader();
    if (state.tab === 'rec') renderRec();
    if (state.tab === 'kpi') renderKpi();
    if (state.tab === 'log') renderLog();
    if (state.tab === 'set') renderDataStat();
    hydratePhotos(document.querySelector(`[data-tab="${state.tab}"]`));
    scheduleNotifs();
  }

  function setTab(t) {
    state.tab = t; state.pendingDelete = null;
    document.querySelectorAll('[data-tab]').forEach(s => s.hidden = s.dataset.tab !== t);
    document.querySelectorAll('.nav button').forEach(b => { if (b.dataset.go === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (t === 'set') renderSet();
    render();
    window.scrollTo(0, 0);
  }

  // ---------- form ----------
  function suggestions(type, f) {
    let pool = state.logs.filter(l => l[f] && typeof l[f] === 'string');
    if (f === 'partner' && type === 'mtg') {
      // meetings can be with customers, suppliers or colleagues
    } else if (f === 'partner') {
      const sup = SUPPLIER_TYPES.includes(type);
      pool = pool.filter(l => SUPPLIER_TYPES.includes(l.type) === sup);
    } else if (f === 'line') {
      pool = pool.filter(l => l.type === 'pe');
    } else if (f === 'item') {
      const prod = ['fqc', 'spec', 'smp', 'mk'];
      pool = pool.filter(l => prod.includes(type) ? prod.includes(l.type) : l.type === type || (!prod.includes(l.type) && l.type !== 'ct'));
    } else return [];
    pool.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const out = [];
    for (const l of pool) { if (!out.includes(l[f])) out.push(l[f]); if (out.length >= 6) break; }
    return out;
  }

  function openForm(type, existing, prefill) {
    state.draftType = type; state.editing = existing || null;
    let d;
    if (existing) d = JSON.parse(JSON.stringify(existing));
    else {
      d = { date: today(), note: '' };
      FORMS[type].forEach(x => { if (x.def !== undefined) d[x.f] = Array.isArray(x.def) ? x.def.slice() : x.def; });
    }
    if (prefill) Object.assign(d, prefill);
    state.draft = d; state.draftNew = new Map();
    const t = TYPES[type];
    $('sheet').style.setProperty('--tc', t.color);
    $('sheetTitle').innerHTML = `<span class="code">${t.code}</span>${t.label} ${existing ? '수정' : '기록'}`;
    $('formSave').textContent = existing ? '수정 저장' : '저장';
    $('formErr').hidden = true;
    renderForm();
    $('scrim').hidden = false; $('sheet').hidden = false; $('sheet').scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }
  function closeForm() {
    if (state.draftNew && state.draftNew.size) { dropPhotoUrls([...state.draftNew.keys()]); }
    state.draftNew = new Map();
    $('scrim').hidden = true; $('sheet').hidden = true; state.draftType = null; state.editing = null;
    document.body.style.overflow = '';
  }
  function renderForm() {
    const type = state.draftType, d = state.draft;
    const fields = FORMS[type].filter(x => (!x.show || x.show(d)) && !(x.createOnly && state.editing));
    const html = fields.map(x => {
      const id = `fld_${x.f}`;
      const head = `<span>${x.label}${x.req ? '<em>*</em>' : ''}${x.hint ? `<i>${x.hint}</i>` : ''}</span>`;
      if (x.type === 'text') {
        const sg = suggestions(type, x.f).filter(s => s !== d[x.f]);
        return `<div class="field">${head}
          <input type="text" id="${id}" data-f="${x.f}" value="${esc(d[x.f] || '')}" placeholder="${esc(x.ph || '')}" autocomplete="off" maxlength="300">
          ${sg.length ? `<div class="sugg">${sg.map(s => `<button type="button" data-sugg="${x.f}" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>`;
      }
      if (x.type === 'num') {
        return `<div class="field">${head}
          <input type="text" inputmode="numeric" id="${id}" data-f="${x.f}" value="${esc(d[x.f] ?? '')}" placeholder="${esc(x.ph || '')}" autocomplete="off" maxlength="9" style="max-width:160px"></div>`;
      }
      if (x.type === 'chips') {
        return `<div class="field">${head}<div class="opts" role="group">${optsOf(x, d).map(o => {
          const cls = ['불합격', 'NG', '부적합'].includes(o) ? 'badc' : ['합격', 'OK', '완료', '적합', '이상 없음', '반영 완료', '발송 완료'].includes(o) ? 'good' : '';
          return `<button type="button" class="opt ${cls}" data-chip="${x.f}" data-v="${esc(o)}" aria-pressed="${d[x.f] === o}">${esc(o)}</button>`;
        }).join('')}</div></div>`;
      }
      if (x.type === 'multi') {
        return `<div class="field">${head}<div class="opts" role="group">${optsOf(x, d).map(o =>
          `<button type="button" class="opt chk" data-multi="${x.f}" data-v="${esc(o)}" aria-pressed="${has(d[x.f], o)}">${esc(o)}</button>`).join('')}</div></div>`;
      }
      if (x.type === 'step') {
        return `<div class="field">${head}<div class="stepper">
          <button type="button" data-step="${x.f}" data-d="-1" data-min="${x.min || 0}" aria-label="줄이기">−</button>
          <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" id="${id}" data-f="${x.f}" data-num="${x.min || 0}" value="${esc(d[x.f] ?? x.def)}" aria-label="${esc(x.label)}" autocomplete="off">
          <button type="button" data-step="${x.f}" data-d="1" data-min="${x.min || 0}" aria-label="늘리기">+</button></div></div>`;
      }
      return '';
    }).join('') + `
      <div class="field"><span>후속 업무<i>선택 · 마감일은 필수, 시간을 정하면 그 시간에 알려 드려요</i></span>
        <div class="fu-list" id="fuList"></div>
        <button type="button" class="mini" data-fuadd="1" style="align-self:flex-start">+ 후속 업무 추가</button></div>
      <div class="field"><span>사진<i>선택 · 여러 장 가능</i> <i id="photoCount"></i></span>
        <div class="photos" id="formPhotos"></div>
        <div class="quick"><button type="button" data-photo="camera">카메라로 찍기</button><button type="button" data-photo="pick">사진 선택</button><span class="photo-busy" id="photoBusy" hidden>사진 넣는 중…</span></div>
        <input type="file" id="photoCam" accept="image/*" capture="environment" hidden>
        <input type="file" id="photoPick" accept="image/*" multiple hidden></div>
      <div class="field"><span>소요 시간${d.startAt && d.endAt ? `<i>타이머 ${hm(d.startAt)}–${hm(d.endAt)}</i>` : ''}</span>
        <div class="dur"><input type="text" inputmode="numeric" maxlength="5" id="fld_mins" data-f="mins" value="${esc(d.mins ?? '')}" placeholder="0"><span class="unit">분</span><span class="read" id="minsRead">${d.mins ? fmtMins(Number(d.mins)) : ''}</span></div>
        <div class="quick">${[15, 30, 60, 90, 120, 240].map(m => `<button type="button" data-mins="${m}">${fmtMins(m)}</button>`).join('')}</div></div>
      <div class="field"><span>메모<i>키보드 마이크로 말해서 입력해도 돼요</i></span><textarea id="fld_note" data-f="note" maxlength="2000" placeholder="특이사항, 후속 조치 등">${esc(d.note || '')}</textarea></div>
      <div class="field"><span>날짜</span><input type="date" id="fld_date" data-f="date" value="${esc(d.date)}" max="${today()}"></div>`;
    $('formBody').innerHTML = html;
    renderPhotoField();
    renderFollowupField();
  }

  function buildDoc(type, d) {
    const doc = { type, date: d.date, month: d.date.slice(0, 7), note: (d.note || '').trim() };
    FORMS[type].forEach(x => {
      if (x.createOnly) return;
      if (x.show && !x.show(d)) return;
      let v = d[x.f];
      if (typeof v === 'string') v = v.trim();
      if (x.type === 'multi') { const allowed = optsOf(x, d); v = (Array.isArray(v) ? v : []).filter(o => allowed.includes(o)); }
      if (x.type === 'step') { const n = parseInt(String(v ?? ''), 10); v = Number.isFinite(n) ? Math.min(9999, Math.max(x.min || 0, n)) : (x.min || 1); }
      if (x.type === 'num') { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); v = String(v ?? '').trim() && isFinite(n) ? n : undefined; }
      if (v !== '' && v !== undefined && v !== null) doc[x.f] = v;
    });
    const mins = Number(String(d.mins ?? '').replace(/[^0-9]/g, ''));
    if (mins > 0) doc.mins = mins;
    if (d.startAt) doc.startAt = d.startAt;
    if (d.endAt) doc.endAt = d.endAt;
    doc.open = isOpen(doc);
    if ((type === 'cs' || type === 'sq') && doc.status === '완료') doc.doneDate = d.doneDate || d.date;
    return doc;
  }

  async function saveForm() {
    const type = state.draftType, d = state.draft;
    const badStep = FORMS[type].find(x => x.type === 'step' && (!x.show || x.show(d)) && !(parseInt(String(d[x.f] ?? ''), 10) >= (x.min || 0)));
    if (badStep) { $('formErr').textContent = `${badStep.label}는 ${badStep.min || 0} 이상의 숫자로 입력해 주세요.`; $('formErr').hidden = false; return; }
    const miss = FORMS[type].find(x => x.req && (!x.show || x.show(d)) && (x.type === 'multi' ? !(d[x.f] || []).length : !String(d[x.f] || '').trim()));
    const err = m => { $('formErr').textContent = m; $('formErr').hidden = false; };
    if (miss) return err(`${miss.label}을(를) ${miss.type === 'multi' ? '선택' : '입력'}해 주세요.`);
    if (!d.date) return err('날짜를 선택해 주세요.');
    if (!state.ok) return err('저장소를 열지 못해 저장할 수 없습니다. 앱을 다시 실행해 주세요.');
    const fuDraft = (d.followups || []).filter(f => String(f.title || '').trim());
    const fuBad = fuDraft.find(f => !DATE_RE.test(String(f.due || '')));
    if (fuBad) return err(`후속 업무 "${String(fuBad.title).trim().slice(0, 20)}"의 마감일을 정해 주세요.`);
    const doc = buildDoc(type, d);
    const fu = fuDraft.map(f => normalizeFollowup({ ...f, time: f.time || undefined, doneAt: f.done ? (f.doneAt || Date.now()) : undefined })).filter(Boolean);
    if (fu.length) doc.followups = fu;
    const photoIds = draftPhotoIds();
    if (photoIds.length) doc.photos = photoIds;
    $('formSave').disabled = true;
    try {
      let msg;
      for (const p of state.draftNew.values()) { await Store.putPhoto({ id: p.id, blob: p.blob, thumb: p.thumb, w: p.w, h: p.h, createdAt: p.createdAt }); markPhotoDirty(p.id); }
      if (state.editing) {
        Object.assign(doc, { id: state.editing.id, createdAt: state.editing.createdAt || Date.now(), updatedAt: Date.now() });
        await Store.put(doc);
        const removed = (state.editing.photos || []).filter(id => !photoIds.includes(id));
        if (removed.length) { await Store.delPhotos(removed); dropPhotoUrls(removed); queuePhotoDeletes(removed); }
        markDirty(doc.id);
        state.logs = state.logs.map(l => l.id === doc.id ? doc : l);
        msg = '수정했습니다';
      } else {
        const now = Date.now();
        Object.assign(doc, { id: newId(), createdAt: now, updatedAt: now });
        await Store.put(doc); state.logs.push(doc); markDirty(doc.id);
        msg = `${TYPES[type].short} 기록 저장됨`;
        if (type === 'fqc' && (d.samples || []).length) {
          const smp = { id: newId(), type: 'smp', date: doc.date, month: doc.month, item: doc.item, kinds: d.samples.slice(), steps: [], note: '', createdAt: Date.now() + 1 };
          if (doc.partner) smp.partner = doc.partner;
          if (doc.lot) smp.lot = doc.lot;
          smp.open = isOpen(smp);
          smp.updatedAt = smp.createdAt;
          await Store.put(smp); state.logs.push(smp); markDirty(smp.id);
          msg += ' · 관리품 건 추가';
        }
      }
      if (d._fromTimer) { state.timer = null; await Store.remove('timer'); }
      if (photoIds.length) msg += ` · 사진 ${photoIds.length}장`;
      if (fu.some(f => !f.done)) { msg += ` · 후속 업무 ${fu.filter(f => !f.done).length}건`; if (LN() && (notif.perm === 'prompt' || notif.perm === 'prompt-with-rationale')) setTimeout(askNotifPermission, 600); }
      state.draftNew = new Map(); // saved: keep their preview URLs cached
      closeForm(); toast(msg); render();
    } catch (e) {
      err('저장하지 못했습니다. 다시 눌러 주세요. 계속 안 되면 앱을 다시 실행해 주세요.');
    } finally { $('formSave').disabled = false; }
  }

  // ---------- export / import ----------
  async function shareFile(name, text, mime) {
    const C = window.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Filesystem && C.Plugins.Share) {
      const r = await C.Plugins.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      try { await C.Plugins.Share.share({ title: name, url: r.uri, dialogTitle: '파일 보내기' }); }
      catch (e) { if (!/cancel/i.test(String(e?.message || e))) throw e; }
      finally { setTimeout(() => C.Plugins.Filesystem.deleteFile({ path: name, directory: 'CACHE' }).catch(() => {}), 120000); }
      return;
    }
    const file = new File([text], name, { type: mime });
    if (navigator.canShare && navigator.share) {
      let ok = false; try { ok = navigator.canShare({ files: [file] }); } catch { ok = false; }
      if (ok) {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const csvCell = v => {
    let s = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  function buildCsv(logs) {
    const head = ['날짜', '업무', '코드', '대상', '내용', '미결', '소요(분)', '시작', '종료', '메모', '사진', '후속 업무', '기록번호'];
    const rows = logs.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)).map(l => {
      const [t, d] = summary(l);
      return [l.date, TYPES[l.type]?.label, TYPES[l.type]?.code, t.filter(Boolean).join(' / '), d.filter(Boolean).join(' / '), l.open ? '미결' : '',
        l.mins || '', l.startAt ? hm(l.startAt) : '', l.endAt ? hm(l.endAt) : '', l.note, l.photos?.length ? `${l.photos.length}장` : '',
        (l.followups || []).map(f => `${f.title}(${f.due.slice(5).replace('-', '/')}${f.time ? ' ' + f.time : ''}, ${f.done ? '완료' : f.due < today() ? '지남' : '진행'})`).join('; '), recNo(l)];
    });
    return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
  }
  async function exportCsv() {
    const ml = monthLogs();
    const extraOpen = openLogs().filter(l => l.month !== state.month);
    if (!ml.length && !extraOpen.length) { toast(`${monthLabel(state.month)} 기록이 없습니다`); return; }
    try { await shareFile(`QA업무일지_${state.month}.csv`, buildCsv([...ml, ...extraOpen]), 'text/csv'); }
    catch { toast('파일을 만들지 못했습니다'); }
  }
  const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  function b64ToBlob(b64) {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: 'image/jpeg' });
  }
  async function backupKey(pw, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', te.encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptBackup(text, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iterations = 600000;
    const key = await backupKey(pw, salt, iterations);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('qa-log-backup-v1') }, key, te.encode(text));
    return JSON.stringify({ app: 'qa-log', format: 'encrypted-backup', v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: u8b64(salt) }, iv: u8b64(iv), data: u8b64(new Uint8Array(ct)) });
  }
  async function decryptBackup(obj, pw) {
    const it = Number(obj.kdf && obj.kdf.iterations);
    if (obj.v !== 1 || !obj.kdf || obj.kdf.name !== 'PBKDF2' || obj.kdf.hash !== 'SHA-256' || !(it >= 100000 && it <= 5000000)
      || typeof obj.kdf.salt !== 'string' || typeof obj.iv !== 'string' || typeof obj.data !== 'string') throw new Error('format');
    const key = await backupKey(pw, b64u8(obj.kdf.salt), it);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u8(obj.iv), additionalData: te.encode('qa-log-backup-v1') }, key, b64u8(obj.data));
    return td.decode(pt);
  }
  async function exportJson(plain) {
    const pw = ($('bkPw') && $('bkPw').value) || '';
    if (!plain) {
      const weak = weakPassword(pw, '', 8);
      if (weak) { toast('백업 비밀번호: ' + weak); $('bkPw') && $('bkPw').focus(); return; }
    }
    const photos = [];
    const ids = [...new Set(state.logs.flatMap(l => l.photos || []))];
    for (const id of ids) {
      const rec = await Store.getPhoto(id).catch(() => null);
      if (rec && rec.blob) photos.push({ id, w: rec.w, h: rec.h, data: await blobToB64(rec.blob) });
    }
    const data = { app: 'qa-log', schema: 2, exportedAt: new Date().toISOString(), logs: state.logs, config: state.cfg, photos };
    toast(plain ? '백업 파일을 만드는 중…' : '백업 파일을 암호화하는 중…');
    try {
      const text = plain ? JSON.stringify(data) : await encryptBackup(JSON.stringify(data), pw);
      await shareFile(`QA업무일지_백업_${today()}${plain ? '_암호화안함' : ''}.json`, text, 'application/json');
      if ($('bkPw')) $('bkPw').value = '';
      state.lastExport = Date.now(); await Store.set('lastExport', state.lastExport); renderDataStat();
    } catch { toast('백업 파일을 만들지 못했습니다'); }
  }
  async function importJson(file) {
    try {
      if (file.size > 400 * 1024 * 1024) { toast('파일이 너무 큽니다'); return; }
      let data = JSON.parse(await file.text());
      if (data && data.app === 'qa-log' && data.format === 'encrypted-backup') {
        const pw = ($('bkPw') && $('bkPw').value) || '';
        if (!pw) { toast('암호화된 백업이에요. 백업 비밀번호를 입력한 뒤 다시 불러오세요'); $('bkPw') && $('bkPw').focus(); return; }
        toast('백업 파일을 여는 중…');
        try { data = JSON.parse(await decryptBackup(data, pw)); }
        catch { toast('백업 비밀번호가 맞지 않거나 파일이 손상됐어요'); return; }
        if ($('bkPw')) $('bkPw').value = '';
      }
      if (!data || data.app !== 'qa-log' || !Array.isArray(data.logs)) { toast('QA 업무일지 백업 파일이 아닙니다'); return; }
      const valid = data.logs.slice(0, 50000).map(normalizeLog).filter(Boolean);
      const skipped = Math.min(data.logs.length, 50000) - valid.length;
      await Store.putMany(valid);
      // Photos: only accept real images, re-encoded on this device (also regenerates thumbnails).
      let photoOk = 0;
      const wanted = new Set(valid.flatMap(l => l.photos || []));
      for (const p of Array.isArray(data.photos) ? data.photos.slice(0, 20000) : []) {
        if (!p || typeof p.id !== 'string' || !ID_RE.test(p.id) || !wanted.has(p.id)) continue;
        if (typeof p.data !== 'string' || p.data.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(p.data)) continue;
        if (await Store.getPhoto(p.id).catch(() => null)) { photoOk++; continue; }
        try { const img = await processImage(b64ToBlob(p.data)); await Store.putPhoto({ id: p.id, ...img, createdAt: Date.now() }); markPhotoDirty(p.id); photoOk++; } catch { }
      }
      if (data.config && !Object.keys(state.cfg.targets || {}).length) { state.cfg = normalizeConfig(data.config); state.cfg.updatedAt = Date.now(); await Store.set('config', state.cfg); markDirty('config'); }
      state.logs = (await Store.all()).map(normalizeLog).filter(Boolean);
      valid.forEach(l => markDirty(l.id));
      toast(`백업에서 ${valid.length}건${photoOk ? `, 사진 ${photoOk}장` : ''}을 불러왔습니다${skipped ? ` · 형식이 맞지 않는 ${skipped}건 제외` : ''}`); setTab(state.tab);
    } catch { toast('파일을 읽지 못했습니다. 백업 파일이 맞는지 확인해 주세요'); }
  }

  // ---------- events ----------
  document.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) return setTab(b.dataset.go);
    if (b.dataset.photo) { const inp = $(b.dataset.photo === 'camera' ? 'photoCam' : 'photoPick'); if (inp) inp.click(); return; }
    if (b.dataset.phdel) {
      const id = b.dataset.phdel;
      if (state.draftNew.has(id)) { state.draftNew.delete(id); dropPhotoUrls([id]); }
      else state.draft.photos = (state.draft.photos || []).filter(x => x !== id);
      return renderPhotoField();
    }
    if (b.dataset.view) {
      const ids = b.dataset.view === '__draft' ? draftPhotoIds() : (byId(b.dataset.view)?.photos || []);
      return openViewer(ids, Number(b.dataset.vi) || 0);
    }
    if (b.dataset.viewer) {
      const a = b.dataset.viewer;
      if (a === 'close') return closeViewer();
      viewer.i = (viewer.i + (a === 'next' ? 1 : -1) + viewer.ids.length) % viewer.ids.length; return showViewer();
    }
    if (b.dataset.new) return openForm(b.dataset.new);
    if (b.dataset.start) return startTimer(b.dataset.start);
    if (b.dataset.timer) {
      const a = b.dataset.timer;
      if (a === 'stop' || a === 'record') { state.cancelArm = false; return stopTimer(); }
      if (a === 'cancel') {
        if (!state.cancelArm) { state.cancelArm = true; renderTimer(); clearTimeout(state._cT); state._cT = setTimeout(() => { state.cancelArm = false; renderTimer(); }, 3000); return; }
        return discardTimer();
      }
    }
    if (b.dataset.mix) { state.mix = b.dataset.mix; return renderKpi(); }
    if (b.dataset.filter) { state.filter = b.dataset.filter; return renderLog(); }
    if (b.dataset.chip) { state.draft[b.dataset.chip] = b.dataset.v; return renderForm(); }
    if (b.dataset.multi) {
      const f = b.dataset.multi, v = b.dataset.v; const arr = Array.isArray(state.draft[f]) ? state.draft[f].slice() : [];
      state.draft[f] = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
      return renderForm();
    }
    if (b.dataset.mins) {
      state.draft.mins = Number(b.dataset.mins);
      $('fld_mins').value = state.draft.mins; $('minsRead').textContent = fmtMins(state.draft.mins); return;
    }
    if (b.dataset.sugg) { state.draft[b.dataset.sugg] = b.dataset.v; return renderForm(); }
    if (b.dataset.step) {
      const f = b.dataset.step; const min = Number(b.dataset.min || 1);
      const cur = parseInt(String(state.draft[f] ?? '').replace(/[^0-9]/g, ''), 10);
      state.draft[f] = Math.min(9999, Math.max(min, (Number.isFinite(cur) ? cur : min) + Number(b.dataset.d)));
      $('fld_' + f).value = state.draft[f]; return;
    }
    if (b.dataset.edit) { const l = byId(b.dataset.edit); if (l) openForm(l.type, l); return; }
    if (b.dataset.fuadd) {
      const list = state.draft.followups = state.draft.followups || [];
      if (list.length >= MAX_FOLLOWUPS) { toast(`후속 업무는 한 기록에 ${MAX_FOLLOWUPS}건까지예요`); return; }
      const id = newId(); list.push({ id, title: '', due: addDays(today(), 1), done: false });
      return renderFollowupField(id);
    }
    if (b.dataset.fudel) { state.draft.followups = (state.draft.followups || []).filter(f => f.id !== b.dataset.fudel); return renderFollowupField(); }
    if (b.dataset.futoggle) {
      const f = (state.draft.followups || []).find(x => x.id === b.dataset.futoggle);
      if (f) { f.done = !f.done; f.doneAt = f.done ? Date.now() : undefined; }
      return renderFollowupField();
    }
    if (b.dataset.fudue) {
      const f = (state.draft.followups || []).find(x => x.id === b.dataset.fudue);
      if (f) f.due = addDays(today(), Number(b.dataset.days) || 1);
      return renderFollowupField();
    }
    if (b.dataset.fudone) { const [lid, fid] = b.dataset.fudone.split('|'); return updateFollowup(lid, fid, { done: true, doneAt: Date.now() }, '후속 업무를 완료했습니다'); }
    if (b.dataset.fusnooze) { const [lid, fid] = b.dataset.fusnooze.split('|'); return updateFollowup(lid, fid, { due: addDays(today(), 1) }, '내일로 미뤘습니다'); }
    if (b.id === 'notifAllow') return askNotifPermission();
    if (b.dataset.del) {
      const id = b.dataset.del;
      if (state.pendingDelete !== id) { state.pendingDelete = id; render(); clearTimeout(state._delT); state._delT = setTimeout(() => { state.pendingDelete = null; render(); }, 3500); return; }
      state.pendingDelete = null;
      try {
        const gone = byId(id)?.photos || [];
        await Store.del(id); if (gone.length) { await Store.delPhotos(gone); dropPhotoUrls(gone); queuePhotoDeletes(gone); }
        markDeleted(id);
        state.logs = state.logs.filter(l => l.id !== id); toast('삭제했습니다'); render();
      }
      catch { toast('삭제하지 못했습니다. 다시 시도해 주세요.'); }
      return;
    }
    if (b.dataset.close) {
      const l = byId(b.dataset.close); if (!l) return;
      const c = closers(l)[Number(b.dataset.ci)];
      const next = { ...l, ...c.patch, updatedAt: Date.now() };
      if ((l.type === 'cs' || l.type === 'sq') && c.patch.status === '완료') next.doneDate = today();
      next.open = isOpen(next);
      try { await Store.put(next); state.logs = state.logs.map(x => x.id === next.id ? next : x); markDirty(next.id); toast(`${c.label} 처리했습니다`); render(); }
      catch { toast('변경하지 못했습니다. 다시 시도해 주세요.'); }
      return;
    }
  });
  document.addEventListener('focusin', e => { if (e.target && e.target.dataset && e.target.dataset.num !== undefined) setTimeout(() => e.target.select(), 0); });
  document.addEventListener('change', e => {
    if (e.target && (e.target.id === 'photoCam' || e.target.id === 'photoPick')) { addPhotos(e.target.files); e.target.value = ''; }
  });
  $('viewer').addEventListener('click', e => { if (e.target.id === 'viewer') closeViewer(); });
  document.addEventListener('input', e => {
    const fuf = e.target.dataset?.fuf;
    if (fuf && state.draftType) {
      const item = (state.draft.followups || []).find(x => x.id === e.target.dataset.fuid);
      if (item) item[fuf] = e.target.value;
      return;
    }
    if (e.target.id === 'notifTime' && TIME_RE.test(e.target.value)) { notif.time = e.target.value; Store.set('notifTime', notif.time).catch(() => {}); scheduleNotifs(); return; }
    const f = e.target.dataset?.f; if (!f || !state.draftType) return;
    if (e.target.dataset.num !== undefined) { const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4); if (v !== e.target.value) e.target.value = v; }
    state.draft[f] = e.target.value;
    if (f === 'mins') { const n = Number(e.target.value.replace(/[^0-9]/g, '')); $('minsRead').textContent = n ? fmtMins(n) : ''; }
  });
  $('sheetClose').onclick = closeForm; $('scrim').onclick = closeForm;
  document.addEventListener('keydown', e => {
    if (!$('viewer').hidden) { if (e.key === 'Escape') closeViewer(); else if (e.key === 'ArrowRight') document.querySelector('.vnext').click(); else if (e.key === 'ArrowLeft') document.querySelector('.vprev').click(); return; }
    if (e.key === 'Escape' && state.draftType) closeForm();
  });
  $('formSave').onclick = saveForm;
  $('mPrev').onclick = () => { state.month = shiftMonth(state.month, -1); render(); };
  $('mNext').onclick = () => { if (state.month < curMonth()) { state.month = shiftMonth(state.month, 1); render(); } };
  $('exportCsv').onclick = exportCsv;
  $('exportJson').onclick = () => exportJson(false);
  $('exportPlain').onclick = () => exportJson(true);
  $('importJson').onclick = () => $('importFile').click();
  $('importFile').onchange = e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; };
  $('saveSet').onclick = async () => {
    const targets = {}, weights = {};
    for (const k of KPI_DEFS) {
      const t = Number($('t_' + k.key).value), w = Number($('w_' + k.key).value);
      if (!isFinite(t) || t < 0 || !isFinite(w) || w < 0) { toast(`${k.name} 값을 확인해 주세요`); return; }
      targets[k.key] = t; weights[k.key] = w;
    }
    try { state.cfg = { targets, weights, updatedAt: Date.now() }; await Store.set('config', state.cfg); markDirty('config'); toast('목표를 저장했습니다'); }
    catch { toast('저장하지 못했습니다. 다시 시도해 주세요.'); }
  };

  // ---------- encrypted sync (Supabase) ----------
  // One password per person. On this device it is stretched (PBKDF2, 600k rounds) and split (HKDF) into
  //  - an auth secret that is the only thing Supabase ever receives, and
  //  - an AES-256-GCM key that never leaves the device.
  // Records and photos are encrypted before upload, so the server only stores ciphertext.
  const SB_URL = 'https://nfqweafoehbjbxtxtilt.supabase.co';
  const SB_KEY = 'sb_publishable_QvvH0UMbVb8VPOTHLzLK-A__uFmbET7';
  const PHOTO_BUCKET = 'vault-photos';
  const te = new TextEncoder(), td = new TextDecoder();
  const u8b64 = u8 => { let x = ''; for (let i = 0; i < u8.length; i += 0x8000) x += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(x); };
  const b64u8 = str => { const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const sync = { session: null, key: null, cursor: '1970-01-01T00:00:00+00:00', dirty: {}, dirtyPhotos: {}, photoDeletes: [], tombs: {}, seq: 0,
    lastSync: 0, lastError: '', running: false, again: false, mode: 'signup', notice: '', busyMsg: '', badRows: 0 };

  async function deriveKeys(email, password) {
    const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('qa-log/v1/' + email.trim().toLowerCase()), iterations: 600000 }, base, 256);
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
    const zero = new Uint8Array(32);
    const authBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: te.encode('qa-log auth v1') }, hk, 256);
    const encKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: te.encode('qa-log enc v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { authSecret: 'q1.' + u8b64(new Uint8Array(authBits)).replace(/=+$/, ''), encKey };
  }
  async function sealJson(obj, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, sync.key, te.encode(JSON.stringify(obj)));
    return { iv: u8b64(iv), data: u8b64(new Uint8Array(ct)) };
  }
  async function openJson(row, aad) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u8(row.iv), additionalData: te.encode(aad) }, sync.key, b64u8(row.data));
    return JSON.parse(td.decode(pt));
  }
  async function sealBytes(buf, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, sync.key, buf));
    const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12); return out;
  }
  async function openBytes(buf, aad) {
    const u = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12), additionalData: te.encode(aad) }, sync.key, u.slice(12));
  }
  const stampOf = l => Number(l.updatedAt || l.createdAt || 0);
  const rowAad = id => `${sync.session.uid}:${id}`;
  const photoAad = id => `${sync.session.uid}:photo:${id}`;
  const photoPath = id => `${PHOTO_BUCKET}/${sync.session.uid}/${encodeURIComponent(id)}`;

  async function saveSync() {
    const { session, cursor, dirty, dirtyPhotos, photoDeletes, tombs, seq, lastSync, lastError } = sync;
    await Store.set('sync', { session, cursor, dirty, dirtyPhotos, photoDeletes, tombs, seq, lastSync, lastError }).catch(() => {});
  }
  async function loadSync() {
    const v = await Store.get('sync').catch(() => null);
    const k = await Store.get('syncKey').catch(() => null);
    if (v && v.session && k) {
      Object.assign(sync, { session: v.session, cursor: v.cursor || sync.cursor, dirty: v.dirty || {}, dirtyPhotos: v.dirtyPhotos || {}, photoDeletes: v.photoDeletes || [],
        tombs: v.tombs || {}, seq: v.seq || 0, lastSync: v.lastSync || 0, lastError: v.lastError || '' });
      sync.key = k;
    }
  }
  function markDirty(id) { if (!sync.session) return; sync.dirty[id] = ++sync.seq; scheduleSync(); }
  function markPhotoDirty(id) { if (!sync.session) return; sync.dirtyPhotos[id] = ++sync.seq; scheduleSync(); }
  function queuePhotoDeletes(ids) { if (!sync.session || !ids.length) return; ids.forEach(id => { delete sync.dirtyPhotos[id]; if (!sync.photoDeletes.includes(id)) sync.photoDeletes.push(id); }); scheduleSync(); }
  function markDeleted(id) { if (!sync.session) return; sync.tombs[id] = Date.now(); markDirty(id); }
  let syncTimer = null;
  function scheduleSync(ms = 3000) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), ms); saveSync(); }

  function sbError(status, body) {
    const m = (body && (body.error_description || body.msg || body.message || body.error)) || '';
    const e = new Error(m || `서버 응답 ${status}`); e.status = status; e.raw = m; return e;
  }
  async function sbRaw(path, opts) {
    let res;
    try { res = await fetch(SB_URL + path, { cache: 'no-store', ...opts }); }
    catch { const e = new Error('인터넷에 연결되지 않았어요'); e.offline = true; throw e; }
    if (!res.ok) { let j = null; try { j = await res.json(); } catch { } throw sbError(res.status, j); }
    return res;
  }
  let refreshing = null;
  async function ensureToken() {
    const ss = sync.session; if (!ss) throw sbError(401, { msg: '로그인이 필요해요' });
    if (Date.now() < ss.expires_at * 1000 - 60000) return;
    if (!refreshing) refreshing = (async () => {
      try {
        const res = await sbRaw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: ss.refresh_token }) });
        sync.session = sessionFrom(await res.json()); await saveSync();
      } catch (e) {
        if (e.status === 400 || e.status === 401 || e.status === 403) { await disconnect('로그인이 만료됐어요. 다시 로그인해 주세요.'); }
        throw e;
      } finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function sb(path, { method = 'GET', json, bytes, headers = {} } = {}) {
    await ensureToken();
    const h = { apikey: SB_KEY, Authorization: 'Bearer ' + sync.session.access_token, ...headers };
    let body;
    if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (bytes !== undefined) { h['Content-Type'] = 'application/octet-stream'; body = bytes; }
    return sbRaw(path, { method, headers: h, body });
  }
  function sessionFrom(j) {
    if (!j || !j.access_token || !j.user) throw sbError(500, { msg: '로그인 응답이 올바르지 않아요' });
    return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Number(j.expires_at) || Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600),
      uid: String(j.user.id), email: String(j.user.email || '') };
  }

  async function connect(mode, email, pw) {
    sync.busyMsg = '비밀번호로 잠금 열쇠를 만드는 중…'; renderSync();
    const { authSecret, encKey } = await deriveKeys(email, pw);
    sync.busyMsg = mode === 'signup' ? '계정을 만드는 중…' : '로그인하는 중…'; renderSync();
    let j;
    if (mode === 'signup') {
      const res = await sbRaw('/auth/v1/signup', { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: authSecret }) });
      j = await res.json();
      if (!j.access_token) {
        sync.mode = 'login';
        sync.notice = `${email}로 확인 메일을 보냈어요. 메일의 링크를 누른 뒤, 같은 이메일과 비밀번호로 "로그인"을 눌러 주세요.`;
        return false;
      }
    } else {
      const res = await sbRaw('/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: authSecret }) });
      j = await res.json();
    }
    sync.session = sessionFrom(j); sync.key = encKey;
    Object.assign(sync, { cursor: '1970-01-01T00:00:00+00:00', dirty: {}, dirtyPhotos: {}, photoDeletes: [], tombs: {}, lastSync: 0, lastError: '', notice: '' });
    // First connection on this device: send everything this device already has. Newer copies win on both sides.
    state.logs.forEach(l => { sync.dirty[l.id] = ++sync.seq; (l.photos || []).forEach(pid => { sync.dirtyPhotos[pid] = ++sync.seq; }); });
    if (state.cfg.updatedAt) sync.dirty.config = ++sync.seq;
    await Store.set('syncKey', encKey);
    await saveSync();
    return true;
  }
  async function revokeSession(token) {
    if (!token) return;
    try { await fetch(SB_URL + '/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token }, cache: 'no-store' }); } catch { }
  }
  async function disconnect(msg, revoke) {
    clearTimeout(syncTimer);
    if (revoke && sync.session) await revokeSession(sync.session.access_token);
    Object.assign(sync, { session: null, key: null, cursor: '1970-01-01T00:00:00+00:00', dirty: {}, dirtyPhotos: {}, photoDeletes: [], tombs: {}, lastSync: 0, lastError: '', notice: msg || '' });
    await Store.remove('syncKey').catch(() => {}); await Store.remove('sync').catch(() => {});
    renderSync();
  }

  function handleAuthReturn() {
    if (!AUTH_RETURN) return;
    revokeSession(AUTH_RETURN.get('access_token'));
    const failed = AUTH_RETURN.get('error_description') || AUTH_RETURN.get('error_code');
    sync.mode = 'login';
    sync.notice = failed ? '메일 확인 링크가 만료됐거나 이미 사용됐어요. 앱에서 다시 로그인해 보세요.' : '메일 확인이 끝났어요. 연동할 기기의 앱에서 "로그인"으로 들어가 주세요.';
    banner(sync.notice);
  }
  function weakPassword(pw, email, min) {
    if (pw.length < min) return `비밀번호는 ${min}자 이상으로 정해 주세요.`;
    if (/^(.)\1+$/.test(pw)) return '같은 글자만 반복한 비밀번호는 쓸 수 없어요.';
    if (/^\d+$/.test(pw)) return '숫자만으로 된 비밀번호는 쓸 수 없어요. 글자를 섞어 주세요.';
    const low = pw.toLowerCase(), local = String(email || '').split('@')[0].toLowerCase();
    if (local && local.length >= 4 && low.includes(local)) return '이메일 아이디가 들어간 비밀번호는 쓸 수 없어요.';
    if (/(password|qwerty|asdf|1234|abcd|iloveyou|admin)/.test(low) && new Set(low).size < 8) return '너무 흔한 비밀번호예요. 다른 비밀번호를 정해 주세요.';
    return '';
  }
  async function applyRemoteDelete(id) {
    const local = byId(id);
    if (local) {
      await Store.del(id);
      const gone = local.photos || [];
      if (gone.length) { await Store.delPhotos(gone); dropPhotoUrls(gone); }
      state.logs = state.logs.filter(l => l.id !== id);
    }
  }
  async function pullRecords() {
    let changed = false;
    for (let guard = 0; guard < 200; guard++) {
      const q = `/rest/v1/vault_items?select=id,kind,updated_at,deleted,iv,data,server_updated&server_updated=gt.${encodeURIComponent(sync.cursor)}&order=server_updated.asc&limit=500`;
      const rows = await (await sb(q)).json();
      for (const r of rows) {
        sync.cursor = r.server_updated;
        // Plain columns (kind, updated_at, deleted) are hints only: anyone with database access could
        // change them. Every decision below uses the decrypted, authenticated payload.
        if (typeof r.id !== 'string' || (r.id !== 'config' && !ID_RE.test(r.id))) continue;
        let payload;
        try { payload = await openJson(r, rowAad(r.id)); } catch { sync.badRows++; continue; }
        if (!payload || typeof payload !== 'object') { sync.badRows++; continue; }
        if (r.id === 'config') {
          const c = normalizeConfig(payload);
          if (!c.updatedAt || c.updatedAt <= (state.cfg.updatedAt || 0)) continue;
          state.cfg = c; await Store.set('config', c); delete sync.dirty.config; changed = true;
          continue;
        }
        const local = byId(r.id);
        const localTs = local ? stampOf(local) : (sync.tombs[r.id] || 0);
        if (payload.del === true || r.deleted) {
          const at = Number(payload.at);
          if (payload.del !== true || payload.id !== r.id || !Number.isFinite(at) || at <= 0) { sync.badRows++; continue; }
          if (at <= localTs) continue;
          await applyRemoteDelete(r.id); sync.tombs[r.id] = at; delete sync.dirty[r.id]; changed = true;
          continue;
        }
        const rec = normalizeLog(payload);
        if (!rec || rec.id !== r.id) { sync.badRows++; continue; }
        if (stampOf(rec) <= localTs) continue;
        await Store.put(rec);
        const before = local?.photos || [];
        const dropped = before.filter(x => !(rec.photos || []).includes(x));
        if (dropped.length) { await Store.delPhotos(dropped); dropPhotoUrls(dropped); }
        state.logs = local ? state.logs.map(l => l.id === rec.id ? rec : l) : [...state.logs, rec];
        delete sync.tombs[r.id]; delete sync.dirty[r.id]; changed = true;
      }
      if (rows.length < 500) break;
    }
    return changed;
  }
  async function pushRecords() {
    const entries = Object.entries(sync.dirty);
    for (let i = 0; i < entries.length; i += 50) {
      const batch = entries.slice(i, i + 50), rows = [], sent = [];
      for (const [id, seq] of batch) {
        let row;
        if (id === 'config') {
          const ts = state.cfg.updatedAt || Date.now();
          row = { id, kind: 'config', updated_at: ts, deleted: false, ...(await sealJson(state.cfg, rowAad(id))) };
        } else {
          const l = byId(id);
          if (l) row = { id, kind: 'log', updated_at: stampOf(l), deleted: false, ...(await sealJson(l, rowAad(id))) };
          else if (sync.tombs[id]) row = { id, kind: 'log', updated_at: sync.tombs[id], deleted: true, ...(await sealJson({ del: true, id, at: sync.tombs[id] }, rowAad(id))) };
        }
        if (row) { row.user_id = sync.session.uid; rows.push(row); }
        sent.push([id, seq]);
      }
      if (rows.length) await sb('/rest/v1/vault_items?on_conflict=user_id,id', { method: 'POST', json: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      sent.forEach(([id, seq]) => { if (sync.dirty[id] === seq) delete sync.dirty[id]; });
    }
  }
  async function pushPhotos() {
    for (const [id, seq] of Object.entries(sync.dirtyPhotos)) {
      const rec = await Store.getPhoto(id).catch(() => null);
      if (rec && rec.blob) {
        const enc = await sealBytes(await rec.blob.arrayBuffer(), photoAad(id));
        await sb('/storage/v1/object/' + photoPath(id), { method: 'POST', bytes: enc, headers: { 'x-upsert': 'true' } });
      }
      if (sync.dirtyPhotos[id] === seq) delete sync.dirtyPhotos[id];
    }
  }
  async function pushPhotoDeletes() {
    for (const id of sync.photoDeletes.slice()) {
      try { await sb('/storage/v1/object/' + photoPath(id), { method: 'DELETE' }); }
      catch (e) { if (e.offline || e.status >= 500) throw e; }
      sync.photoDeletes = sync.photoDeletes.filter(x => x !== id);
    }
  }
  async function pullPhotos() {
    let got = 0;
    const wanted = [...new Set(state.logs.flatMap(l => l.photos || []))];
    for (const id of wanted) {
      if (sync.dirtyPhotos[id] || await Store.getPhoto(id).catch(() => null)) continue;
      let buf;
      try { buf = await (await sb('/storage/v1/object/authenticated/' + photoPath(id))).arrayBuffer(); }
      catch (e) { if (e.offline) throw e; continue; } // not uploaded yet by the other device
      try {
        const plain = await openBytes(buf, photoAad(id));
        const img = await processImage(new Blob([plain], { type: 'image/jpeg' }));
        await Store.putPhoto({ id, ...img, createdAt: Date.now() }); got++;
      } catch { sync.badRows++; }
    }
    return got;
  }
  async function syncNow(manual) {
    if (!sync.session || !sync.key || !state.ok) return;
    if (sync.running) { sync.again = true; return; }
    sync.running = true; sync.badRows = 0; renderSync();
    try {
      const pulled = await pullRecords();       // newer copies from other devices first
      await pushRecords();                      // then this device's changes
      await pushPhotoDeletes();
      await pushPhotos();
      const pulledAgain = await pullRecords();  // advance the cursor past our own upload
      const photos = await pullPhotos();
      sync.lastSync = Date.now(); sync.lastError = sync.badRows ? `${sync.badRows}건은 이 비밀번호로 열 수 없어 건너뛰었어요` : '';
      if (pulled || pulledAgain || photos) render();
      if (manual) toast('동기화했습니다');
    } catch (e) {
      sync.lastError = e.offline ? '인터넷에 연결되지 않아 나중에 다시 시도해요' : friendlySyncError(e);
      if (manual) toast(sync.lastError);
    } finally {
      sync.running = false; await saveSync(); renderSync();
      if (sync.again) { sync.again = false; scheduleSync(1500); }
    }
  }
  function friendlySyncError(e) {
    const m = String(e.raw || e.message || '');
    if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요';
    if (/email not confirmed/i.test(m)) return '아직 메일 확인이 안 됐어요. 메일의 링크를 누른 뒤 다시 로그인해 주세요';
    if (/already registered|already exists/i.test(m)) return '이미 있는 계정이에요. "로그인"으로 들어가 주세요';
    if (/signups? not allowed|signup.*disabled/i.test(m)) return '새 계정 만들기가 꺼져 있어요';
    if (/rate limit|too many/i.test(m)) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요';
    if (/relation .* does not exist|could not find the table/i.test(m)) return '서버 준비(SQL)가 아직 안 됐어요';
    return m ? `연동 오류: ${m}` : '연동 중 오류가 났어요';
  }
  function ago(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`;
  }
  function renderSync() {
    const box = $('syncBox'); if (!box) return;
    if (sync.session) {
      const pending = Object.keys(sync.dirty).length + Object.keys(sync.dirtyPhotos).length;
      const cls = sync.running ? 'busy' : sync.lastError ? 'err' : 'on';
      const label = sync.running ? '동기화 중…' : sync.lastError ? '확인 필요' : '연결됨';
      box.innerHTML = `<div class="sync-head"><span class="sync-dot ${cls}">${label}</span><span class="num" style="font-size:12px;color:var(--muted)">${esc(sync.session.email)}</span></div>
        <div class="stat">${sync.lastSync ? `마지막 동기화 ${ago(sync.lastSync)}` : '아직 동기화 전'}${pending ? ` · 보낼 변경 ${pending}건` : ''}</div>
        ${sync.lastError ? `<div class="note-warn">${esc(sync.lastError)}</div>` : ''}
        <button class="btn" id="syncNowBtn" ${sync.running ? 'disabled' : ''}>지금 동기화</button>
        <button class="btn ghost" id="syncOffBtn">이 기기 연동 해제</button>
        <p>같은 계정으로 로그인한 기기끼리 기록 · 사진 · KPI 목표가 맞춰집니다. 이 기기에서 잠근 뒤 보내므로 서버에서는 내용을 볼 수 없어요. 연동을 해제해도 이 기기 안의 기록은 그대로 남습니다.</p>`;
      return;
    }
    const su = sync.mode === 'signup';
    box.innerHTML = `<div class="sync-head"><span class="sync-dot">연동 안 함</span>
        <span class="seg" role="group" aria-label="연동 시작 방법"><button data-syncmode="signup" aria-pressed="${su}">처음 시작</button><button data-syncmode="login" aria-pressed="${!su}">로그인</button></span></div>
      <p>${su ? '연동할 계정을 새로 만듭니다. 처음 한 번만 하면 돼요.' : '다른 기기에서 만든 계정으로 들어갑니다. 그 기기와 같은 이메일 · 비밀번호를 입력하세요.'}</p>
      ${sync.notice ? `<div class="note-warn">${esc(sync.notice)}</div>` : ''}
      <label>이메일<input type="email" id="sbEmail" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="254"></label>
      <label>비밀번호 (10자 이상)<input type="password" id="sbPw" maxlength="200" autocomplete="${su ? 'new-password' : 'current-password'}"></label>
      ${su ? '<label>비밀번호 확인<input type="password" id="sbPw2" maxlength="200" autocomplete="new-password"></label>' : ''}
      <div class="note-warn">이 비밀번호로 기록을 잠급니다. <b>잊어버리면 서버에 있는 기록은 누구도 되살릴 수 없어요.</b> 기기 안의 기록은 남지만, 안전한 곳에 적어 두세요.</div>
      <div class="stat" id="syncBusy">${esc(sync.busyMsg)}</div>
      <button class="btn" id="syncGo">${su ? '계정 만들고 연동 시작' : '로그인하고 연동 시작'}</button>`;
  }
  async function onSyncGo() {
    const email = ($('sbEmail')?.value || '').trim(), pw = $('sbPw')?.value || '', pw2 = $('sbPw2')?.value;
    const say = m => { sync.notice = m; sync.busyMsg = ''; renderSync(); if ($('sbEmail')) $('sbEmail').value = email; };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say('이메일 주소를 확인해 주세요.');
    const weak = weakPassword(pw, email, 10);
    if (weak) return say(weak);
    if (sync.mode === 'signup' && pw !== pw2) return say('비밀번호 확인이 일치하지 않아요.');
    if (!(window.crypto && crypto.subtle)) return say('이 브라우저에서는 암호화를 쓸 수 없어요.');
    $('syncGo').disabled = true;
    try {
      const ok = await connect(sync.mode, email, pw);
      sync.busyMsg = '';
      if (ok) { renderSync(); toast('연동을 시작했습니다'); await syncNow(); }
      else renderSync();
    } catch (e) {
      sync.busyMsg = '';
      say(e.offline ? '인터넷에 연결되지 않았어요.' : friendlySyncError(e));
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.syncmode) { sync.mode = b.dataset.syncmode; sync.notice = ''; renderSync(); }
    else if (b.id === 'syncGo') onSyncGo();
    else if (b.id === 'syncNowBtn') syncNow(true);
    else if (b.id === 'syncOffBtn') {
      if (!sync.offArm) { sync.offArm = true; b.textContent = '한 번 더 누르면 연동을 해제합니다'; b.classList.add('danger'); setTimeout(() => { sync.offArm = false; renderSync(); }, 3500); return; }
      sync.offArm = false; disconnect('이 기기의 연동을 해제했어요. 기록은 그대로 남아 있습니다.', true).then(() => toast('연동을 해제했습니다'));
    }
  });

  // ---------- diagnostics ----------
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function rememberJsError(msg) {
    try {
      const list = JSON.parse(localStorage.getItem('qalog.jsErrors') || '[]');
      list.push(`${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${String(msg).slice(0, 400)}`);
      localStorage.setItem('qalog.jsErrors', JSON.stringify(list.slice(-10)));
    } catch { }
  }
  window.addEventListener('error', e => rememberJsError(`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', e => rememberJsError('promise: ' + (e.reason && (e.reason.message || e.reason))));
  async function loadDiag() {
    let nativeLog = '', jsLog = '';
    const FS = window.Capacitor?.Plugins?.Filesystem;
    if (isNative() && FS) {
      try { const r = await FS.readFile({ path: 'crash-log.txt', directory: 'DATA', encoding: 'utf8' }); nativeLog = String(r.data || '').trim(); } catch { }
    }
    try { jsLog = JSON.parse(localStorage.getItem('qalog.jsErrors') || '[]').join('\n'); } catch { }
    state.diag = [nativeLog && '[앱 종료 오류]\n' + nativeLog.slice(-8000), jsLog && '[화면 오류]\n' + jsLog].filter(Boolean).join('\n\n');
    let seen = null; try { seen = localStorage.getItem('qalog.diagSeen'); } catch { }
    if (nativeLog && seen !== String(nativeLog.length)) {
      $('banner').innerHTML = '지난번에 앱이 비정상 종료됐어요. <button data-go="set">설정 → 오류 기록</button>을 복사해 Claude에게 보내 주세요.';
      $('banner').hidden = false;
      state.diagNativeLen = nativeLog.length;
    }
  }
  function renderDiag() {
    const box = $('diagBox'); if (!box) return;
    box.hidden = !state.diag;
    $('diagText').textContent = state.diag || '';
    if (state.diagNativeLen) { try { localStorage.setItem('qalog.diagSeen', String(state.diagNativeLen)); } catch { } }
  }
  $('diagCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(state.diag || ''); toast('오류 기록을 복사했습니다'); }
    catch { const r = document.createRange(); r.selectNodeContents($('diagText')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('선택된 내용을 길게 눌러 복사해 주세요'); }
  };
  $('diagClear').onclick = async () => {
    const FS = window.Capacitor?.Plugins?.Filesystem;
    if (isNative() && FS) { try { await FS.deleteFile({ path: 'crash-log.txt', directory: 'DATA' }); } catch { } }
    try { localStorage.removeItem('qalog.jsErrors'); localStorage.removeItem('qalog.diagSeen'); } catch { }
    state.diag = ''; state.diagNativeLen = 0; banner(''); renderDiag(); toast('오류 기록을 지웠습니다');
  };
  function registerServiceWorker() {
    if (isNative() || !('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    navigator.serviceWorker.register('sw.js').catch(err => rememberJsError('sw: ' + err));
  }

  // Android back button: close sheet → go to 기록 tab → exit
  function hookBackButton() {
    const App = window.Capacitor?.Plugins?.App;
    if (!App || !App.addListener) return;
    App.addListener('backButton', () => {
      if (!$('viewer').hidden) return closeViewer();
      if (state.draftType) return closeForm();
      if (state.tab !== 'rec') return setTab('rec');
      App.exitApp();
    });
  }

  // ---------- boot ----------
  renderHeader(); renderRec();
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    render();
    if (sync.session && Date.now() - sync.lastSync > 60000) syncNow();
  });
  setInterval(() => { if (!document.hidden && sync.session) syncNow(); }, 5 * 60000);
  (async () => {
    try {
      await Store.open();
      state.logs = (await Store.all()).map(normalizeLog).filter(Boolean);
      state.cfg = normalizeConfig(await Store.get('config'));
      state.timer = normalizeTimer(await Store.get('timer'));
      state.lastExport = (await Store.get('lastExport')) || null;
      state.ok = true;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      state.ok = true;
      banner('저장소를 열지 못했습니다. 앱을 완전히 종료한 뒤 다시 실행해 주세요.');
    }
    hookBackButton();
    await notifInit();
    registerServiceWorker();
    await loadDiag();
    handleAuthReturn();
    if (state.ok) await loadSync();
    render();
    if (sync.session) syncNow();
  })();
})();
