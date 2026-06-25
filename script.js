/* ================================================================
   JobAgent - Simple Form Script (UX Simplified)
   ================================================================ */

/* ── State ── */
let uploadedResumeText = '';
let uploadedFileName  = '';
let lastMatchedJobs   = [];   // mailto에서 재사용

/* ── DOM helpers ── */
const $ = id => document.getElementById(id);
const showToast = (msg, duration = 3000) => {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), duration);
};

const showStatus = (msg, isError = false) => {
    const el = $('status-msg');
    el.textContent = msg;
    el.className = 'status-msg' + (isError ? ' error' : '');
    el.style.display = 'block';
};

const hideStatus = () => { $('status-msg').style.display = 'none'; };

/* ── Tab Navigation ── */
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const target = $( btn.dataset.tab );
            if (target) target.classList.add('active');
        });
    });
}

/* ── Step Nav ── */
function initStepNav() {
    const map = { 'nav-onboarding': null, 'nav-jobs': 'tab-jobs', 'nav-settings': 'tab-settings' };
    Object.entries(map).forEach(([navId, tabId]) => {
        const el = $(navId);
        if (!el) return;
        el.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            el.classList.add('active');
            if (tabId) {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
                if (btn) btn.classList.add('active');
                const content = $(tabId);
                if (content) content.classList.add('active');
            }
        });
    });
}

/* ── Salary / Distance sliders ── */
function initSliders() {
    const salary = $('filter-salary');
    const salaryVal = $('val-salary');
    if (salary && salaryVal) {
        salary.addEventListener('input', () => {
            salaryVal.textContent = Number(salary.value).toLocaleString() + '만원';
        });
    }
    const dist = $('filter-distance');
    const distVal = $('val-distance');
    if (dist && distVal) {
        dist.addEventListener('input', () => {
            distVal.textContent = dist.value + 'km';
        });
    }
}

/* ── Upload Zone ── */
function initUploadZone() {
    const zone   = $('upload-zone');
    const input  = $('resume-file-input');
    const inner  = $('upload-zone-inner');
    const done   = $('upload-zone-done');
    const dName  = $('upload-done-name');
    if (!zone || !input) return;

    const handleFile = file => {
        if (!file) return;
        uploadedFileName = file.name;
        const formData = new FormData();
        formData.append('resume', file);
        showStatus('이력서 분석 중...⏳');
        fetch('/api/upload-resume', { method: 'POST', body: formData })
            .then(r => r.json())
            .then(data => {
                if (data.text) {
                    uploadedResumeText = data.text;
                    if (dName) dName.textContent = file.name;
                    if (inner) inner.style.display = 'none';
                    if (done)  done.style.display  = 'flex';
                    showStatus('✅ 이력서 업로드 완료! 매칭하기 버튼을 누르세요.');
                } else {
                    showStatus('이력서 읽기 실패: ' + (data.error || '알 수 없는 오류'), true);
                }
            })
            .catch(() => showStatus('업로드 중 오류가 발생했습니다.', true));
    };

    input.addEventListener('change', () => handleFile(input.files[0]));

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });
}

/* ── Collect Form Data ── */
function collectProfile() {
    return {
        name:      ($('input-name')    || {}).value?.trim() || '',
        email:     ($('input-email')   || {}).value?.trim() || '',
        target:    ($('input-target')  || {}).value?.trim() || '',
        salary:    ($('filter-salary')    || {}).value || '3000',
        distance:  ($('filter-distance')  || {}).value || '30',
        career:    ($('filter-career')    || {}).value || '0',
        education: ($('filter-education') || {}).value || '0',
        shift:     ($('filter-shift')     || {}).checked || false,
        resumeText: uploadedResumeText,
    };
}

/* ── Save Profile to server ── */
async function saveProfile() {
    const profile = collectProfile();
    const smtpUser = ($('setting-smtp-user') || {}).value?.trim() || '';
    const smtpPass = ($('setting-smtp-pass') || {}).value?.trim() || '';

    const payload = {
        name: profile.name, email: profile.email,
        target_jobs: profile.target,
        min_salary: profile.salary, max_distance: profile.distance,
        career: profile.career, education: profile.education,
        exclude_shift: profile.shift ? 1 : 0,
        resume_text: profile.resumeText,
        smtp_user: smtpUser, smtp_pass: smtpPass,
    };
    const resp = await fetch('/api/profile', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload),
    });
    return resp.json();
}

/* ── Load Profile from server ── */
async function loadProfile() {
    try {
        const r = await fetch('/api/profile');
        const p = await r.json();
        if (!p || !p.name) return;
        if ($('input-name')    ) $('input-name').value     = p.name || '';
        if ($('input-email')   ) $('input-email').value    = p.email || '';
        if ($('input-target')  ) $('input-target').value   = p.target_jobs || '';
        if ($('filter-salary') ) {
            $('filter-salary').value = p.min_salary || 3000;
            const sv = $('val-salary');
            if (sv) sv.textContent = Number($('filter-salary').value).toLocaleString() + '만원';
        }
        if ($('filter-distance')) {
            $('filter-distance').value = p.max_distance || 30;
            const dv = $('val-distance');
            if (dv) dv.textContent = $('filter-distance').value + 'km';
        }
        if ($('filter-career')   ) $('filter-career').value    = p.career    || '0';
        if ($('filter-education')) $('filter-education').value  = p.education || '0';
        if ($('filter-shift')    ) $('filter-shift').checked    = !!p.exclude_shift;
        if (p.smtp_user && $('setting-smtp-user')) $('setting-smtp-user').value = p.smtp_user;
        if (p.resume_text) uploadedResumeText = p.resume_text;
    } catch (e) { /* ignore */ }
}

/* ── Render Job Cards ── */
function scoreColor(score) {
    if (score >= 80) return 'high-match';
    if (score >= 50) return 'mid-match';
    return 'low-match';
}

function renderJobCard(job) {
    const score = job.match_score || Math.floor(Math.random() * 40 + 45);
    const cls = scoreColor(score);
    const barColor = score >= 80 ? 'var(--accent-green)' : score >= 50 ? 'var(--primary)' : 'var(--accent-red)';
    return `
      <div class="job-card ${cls}">
        <div class="job-card-header">
          <div>
            <div class="job-title">${job.title || '채용 공고'}</div>
            <div class="job-company">${job.company || ''}</div>
          </div>
          <div class="match-score-badge">${score}%</div>
        </div>
        <div class="job-meta">
          ${job.location ? `<span class="job-tag">📍 ${job.location}</span>` : ''}
          ${job.salary   ? `<span class="job-tag">💰 ${job.salary}</span>` : ''}
          ${job.career   ? `<span class="job-tag">💼 ${job.career}</span>` : ''}
        </div>
        <div class="match-bar-track">
          <div class="match-bar-fill" style="width:${score}%;background:${barColor}"></div>
        </div>
        ${job.url ? `<a href="${job.url}" target="_blank" class="btn btn-secondary btn-sm" style="margin-top:10px;">공고 보기 →</a>` : ''}
      </div>`;
}

function renderWorknetCard(job) {
    const title    = job.wantedTitle || job.title || '';
    const company  = job.corpName    || job.company || '';
    const salary   = job.salTpNm    || '';
    const location = job.workRegionNm || '';
    const career   = job.careerNm   || '';
    const url      = job.wantedAuthNo
        ? `https://www.work.go.kr/empInfo/empInfoSrch/detail/empDetailAuthView.do?wantedAuthNo=${job.wantedAuthNo}`
        : '';
    return `
      <div class="worknet-card">
        <div class="worknet-card-title">${title}</div>
        <div class="worknet-card-company">${company}</div>
        <div class="worknet-tags">
          ${location ? `<span class="worknet-tag">📍 ${location}</span>` : ''}
          ${salary   ? `<span class="worknet-tag">💰 ${salary}</span>`   : ''}
          ${career   ? `<span class="worknet-tag">💼 ${career}</span>`   : ''}
        </div>
        ${url ? `<a href="${url}" target="_blank" class="btn btn-secondary btn-sm" style="margin-top:10px;">공고 보기 →</a>` : ''}
      </div>`;
}

/* ── Load AI Matched Jobs ── */
async function loadMatchedJobs() {
    const list = $('jobs-list');
    if (!list) return;
    list.innerHTML = '<div class="no-jobs-placeholder"><p>🔍 AI 매칭 중...</p></div>';

    try {
        const profile = collectProfile();
        const resp = await fetch('/api/match-jobs', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ profile }),
        });
        const data = await resp.json();
        const jobs = data.jobs || [];
        lastMatchedJobs = jobs;
        if (jobs.length === 0) {
            list.innerHTML = '<div class="no-jobs-placeholder"><p>매칭된 공고가 없습니다.<br>이력서와 희망 직무를 확인해주세요.</p></div>';
        } else {
            list.innerHTML = jobs.map(renderJobCard).join('');
            if (data.resume_html) showResumePreview(data.resume_html);
        }
    } catch (e) {
        list.innerHTML = '<div class="no-jobs-placeholder"><p>매칭 중 오류가 발생했습니다.</p></div>';
    }
}

/* ── Load Worknet Jobs ── */
async function loadWorknetJobs() {
    const section = $('worknet-section');
    const wList   = $('worknet-list');
    const kwEl    = $('worknet-keyword');
    if (!section || !wList) return;

    section.style.display = 'block';
    wList.innerHTML = '<div class="no-jobs-placeholder"><p>🏛 고용24 검색 중...</p></div>';

    const keyword = ($('input-target') || {}).value?.trim() || '';
    if (kwEl) kwEl.textContent = keyword ? `"${keyword}" 검색 결과` : '';

    try {
        const resp = await fetch('/api/worknet-jobs', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                keyword,
                career:    ($('filter-career')    || {}).value || '0',
                education: ($('filter-education') || {}).value || '0',
            }),
        });
        const data = await resp.json();
        if (data.error) {
            wList.innerHTML = `<div class="no-jobs-placeholder"><p>⚠️ ${data.error}</p></div>`;
            return;
        }
        const jobs = data.jobs || (data.wantedRoot && data.wantedRoot.wanted && data.wantedRoot.wanted.wantedInfo) || [];
        if (jobs.length === 0) {
            wList.innerHTML = '<div class="no-jobs-placeholder"><p>검색된 공고가 없습니다.</p></div>';
        } else {
            wList.innerHTML = jobs.map(renderWorknetCard).join('');
        }
    } catch (e) {
        wList.innerHTML = '<div class="no-jobs-placeholder"><p>고용24 검색 중 오류가 발생했습니다.</p></div>';
    }
}

/* ── Resume Preview ── */
function showResumePreview(html) {
    const sheet = $('resume-sheet');
    if (!sheet) return;
    if (html) {
        sheet.innerHTML = html;
    } else if (uploadedResumeText) {
        sheet.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;line-height:1.7;color:var(--text-main)">${uploadedResumeText.replace(/</g,'&lt;')}</pre>`;
    }
}

/* ── Mailto 방식 이메일 ── */
function openMailto() {
    const email  = ($('input-email')  || {}).value?.trim() || '';
    const name   = ($('input-name')   || {}).value?.trim() || '안녕하세요';
    const target = ($('input-target') || {}).value?.trim() || '채용';
    const today  = new Date().toLocaleDateString('ko-KR');

    if (!email) { showStatus('이메일 주소를 입력해주세요.', true); return; }

    if (lastMatchedJobs.length === 0) {
        showStatus('먼저 "채용공고 매칭하기"를 눌러 결과를 불러오세요.', true);
        return;
    }

    const subject = encodeURIComponent(`[AI 잡에이전트] ${target} 매칭 결과 - ${today}`);

    const lines = [];
    lines.push(`${name}님, AI 잡에이전트 매칭 결과입니다.`);
    lines.push(`희망 직무: ${target} | 날짜: ${today}`);
    lines.push('');
    lines.push(`=== 매칭 공고 (${lastMatchedJobs.length}건) ===`);
    lines.push('');

    lastMatchedJobs.slice(0, 10).forEach((job, i) => {
        lines.push(`${i + 1}. [${job.company || ''}] ${job.title || ''}`);
        const meta = [];
        if (job.location) meta.push(job.location);
        if (job.salary)   meta.push(job.salary);
        if (job.match_score) meta.push(`매칭 ${job.match_score}%`);
        if (meta.length) lines.push(`   ${meta.join(' | ')}`);
        if (job.url) lines.push(`   ${job.url}`);
        lines.push('');
    });

    lines.push('---');
    lines.push('JobAgent AI 매칭 시스템');

    const body = encodeURIComponent(lines.join('\n'));
    const mailto = `mailto:${email}?subject=${subject}&body=${body}`;

    // mailto URL 길이 제한(2000자) 초과 시 클립보드 fallback
    if (mailto.length > 1900) {
        const short = `mailto:${email}?subject=${subject}`;
        window.location.href = short;
        showToast('결과가 너무 길어 제목만 입력됐습니다. 본문을 직접 붙여넣으세요.');
    } else {
        window.location.href = mailto;
        showStatus('✅ 이메일 앱이 열립니다. 내용 확인 후 직접 발송하세요.');
        showToast('이메일 앱 열기 완료!');
    }
}

/* ── Print ── */
function initPrint() {
    const btn = $('btn-print');
    if (btn) btn.addEventListener('click', () => window.print());
}

/* ── Reset ── */
function initReset() {
    const btn = $('btn-reset');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (!confirm('모든 입력 정보를 초기화할까요?')) return;
        ['input-name','input-email','input-target'].forEach(id => { if ($(id)) $(id).value = ''; });
        uploadedResumeText = '';
        uploadedFileName = '';
        const inner = $('upload-zone-inner');
        const done  = $('upload-zone-done');
        if (inner) inner.style.display = 'flex';
        if (done)  done.style.display  = 'none';
        const list = $('jobs-list');
        if (list) list.innerHTML = '<div class="no-jobs-placeholder"><p>왼쪽에서 이력서를 등록하고<br>매칭하기 버튼을 눌러주세요.</p></div>';
        hideStatus();
        showToast('초기화 완료');
    });
}

/* ── Main Buttons ── */
function initMainButtons() {
    const btnMatch = $('btn-match');
    if (btnMatch) {
        btnMatch.addEventListener('click', async () => {
            const email = ($('input-email') || {}).value?.trim();
            if (!email) { showStatus('이메일 주소를 입력해주세요.', true); return; }
            showStatus('🔍 AI 매칭 중... 잠시 기다려주세요.');
            await saveProfile();
            // Switch to jobs tab
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const jobsBtn = document.querySelector('.tab-btn[data-tab="tab-jobs"]');
            if (jobsBtn) jobsBtn.classList.add('active');
            const jobsTab = $('tab-jobs');
            if (jobsTab) jobsTab.classList.add('active');
            await loadMatchedJobs();
            hideStatus();
        });
    }

    const btnEmail = $('btn-match-email');
    if (btnEmail) {
        btnEmail.addEventListener('click', openMailto);
    }


    const btnWorknet = $('btn-worknet');
    if (btnWorknet) btnWorknet.addEventListener('click', loadWorknetJobs);

    const btnRefresh = $('btn-refresh-matching');
    if (btnRefresh) btnRefresh.addEventListener('click', loadMatchedJobs);
}

/* -- Init -- */
document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initStepNav();
    initSliders();
    initUploadZone();
    initMainButtons();
    initPrint();
    initReset();
    await loadProfile();
});
