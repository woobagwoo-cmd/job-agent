document.addEventListener("DOMContentLoaded", () => {
    const API_BASE = "";

    // DOM Elements
    const chatMessages   = document.getElementById("chat-messages");
    const chatInput      = document.getElementById("chat-input");
    const btnSend        = document.getElementById("btn-send");
    const btnReset       = document.getElementById("btn-reset");
    const chatSuggestions = document.getElementById("chat-suggestions");
    const resumeSheet    = document.getElementById("resume-sheet");

    const tabButtons  = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    const navItems    = document.querySelectorAll(".nav-item");

    const filterSalary    = document.getElementById("filter-salary");
    const valSalary       = document.getElementById("val-salary");
    const filterDistance  = document.getElementById("filter-distance");
    const valDistance     = document.getElementById("val-distance");
    const filterShift     = document.getElementById("filter-shift");
    const filterCareer    = document.getElementById("filter-career");
    const filterEducation = document.getElementById("filter-education");
    const btnSaveFilters  = document.getElementById("btn-save-filters");
    const btnRefreshMatching = document.getElementById("btn-refresh-matching");
    const btnWorknet      = document.getElementById("btn-worknet");
    const jobsList        = document.getElementById("jobs-list");
    const worknetSection  = document.getElementById("worknet-section");
    const worknetList     = document.getElementById("worknet-list");
    const worknetKeyword  = document.getElementById("worknet-keyword");

    // 이력서 업로드
    const resumeFileInput = document.getElementById("resume-file-input");
    const uploadFilename  = document.getElementById("upload-filename");
    const btnUploadGo     = document.getElementById("btn-upload-go");
    let   uploadedFile    = null;

    const settingGeminiKey  = document.getElementById("setting-gemini-key");
    const settingWorknetKey = document.getElementById("setting-worknet-key");
    const settingSaraminKey = document.getElementById("setting-saramin-key");
    const settingSmtpUser   = document.getElementById("setting-smtp-user");
    const settingSmtpPass   = document.getElementById("setting-smtp-pass");
    const btnSaveSettings   = document.getElementById("btn-save-settings");
    const btnTestMail       = document.getElementById("btn-test-mail");
    const btnPrint          = document.getElementById("btn-print");
    const toast             = document.getElementById("toast");
    const progressBar       = document.getElementById("onboarding-progress");

    let currentStep = "start";
    let userProfile = {};

    // ── Progress bar step mapping ──────────────────────────────────
    const STEP_MAP = {
        "start":        0,
        "ask_name":     1,
        "ask_contact":  2,
        "ask_target":   3,
        "ask_skills":   4,
        "ask_experience": 5,
        "ask_education": 6,
        "done":         7,
    };

    function updateProgressBar(step) {
        const idx = STEP_MAP[step] ?? 0;
        if (idx >= 7) {
            progressBar.classList.add("hidden");
            return;
        }
        progressBar.classList.remove("hidden");

        for (let i = 1; i <= 6; i++) {
            const dot = document.getElementById(`pdot-${i}`);
            const lbl = document.getElementById(`plbl-${i}`);
            const con = document.getElementById(`pcon-${i}`);

            dot.classList.remove("active", "done");
            lbl.classList.remove("active", "done");
            if (con) con.classList.remove("done");

            if (i < idx) {
                dot.classList.add("done");
                dot.textContent = "✓";
                lbl.classList.add("done");
                if (con) con.classList.add("done");
            } else if (i === idx) {
                dot.classList.add("active");
                dot.textContent = i;
                lbl.classList.add("active");
            } else {
                dot.textContent = i;
            }
        }
    }

    // ── Toast ──────────────────────────────────────────────────────
    function showToast(message, type = "success") {
        toast.textContent = message;
        toast.style.background = type === "error" ? "var(--accent-red)" : "var(--primary)";
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3200);
    }

    // ── Tab switching ──────────────────────────────────────────────
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetTab = btn.getAttribute("data-tab");
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            tabContents.forEach(c => {
                c.classList.remove("active");
                if (c.id === targetTab) c.classList.add("active");
            });
            if (targetTab === "tab-jobs") loadMatchedJobs();
        });
    });

    // ── Nav indicators ─────────────────────────────────────────────
    function updateStepNav(step) {
        navItems.forEach(item => item.classList.remove("active"));
        if (step === "done") {
            document.getElementById("nav-filters").classList.add("active");
        } else {
            document.getElementById("nav-onboarding").classList.add("active");
        }
    }

    // ── Chat: append bot message with avatar ───────────────────────
    function appendBotMessage(text) {
        const wrapper = document.createElement("div");
        wrapper.classList.add("bot-message-wrapper");

        const avatar = document.createElement("div");
        avatar.classList.add("bot-avatar");
        avatar.textContent = "🤖";

        const bubble = document.createElement("div");
        bubble.classList.add("chat-bubble", "bot");
        bubble.innerHTML = text.replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        wrapper.appendChild(avatar);
        wrapper.appendChild(bubble);
        chatMessages.appendChild(wrapper);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function appendUserMessage(text) {
        const bubble = document.createElement("div");
        bubble.classList.add("chat-bubble", "user");
        bubble.textContent = text;
        chatMessages.appendChild(bubble);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showTypingIndicator() {
        const wrapper = document.createElement("div");
        wrapper.classList.add("typing-indicator-wrapper");
        wrapper.id = "typing-wrapper";

        const avatar = document.createElement("div");
        avatar.classList.add("bot-avatar");
        avatar.textContent = "🤖";

        const indicator = document.createElement("div");
        indicator.classList.add("typing-indicator");
        indicator.id = "typing-indicator";
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement("span");
            dot.classList.add("typing-dot");
            indicator.appendChild(dot);
        }

        wrapper.appendChild(avatar);
        wrapper.appendChild(indicator);
        chatMessages.appendChild(wrapper);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function removeTypingIndicator() {
        const wrapper = document.getElementById("typing-wrapper");
        if (wrapper) wrapper.remove();
    }

    // ── Suggestion chips ───────────────────────────────────────────
    const suggestionsForStep = {
        "start":           ["이력서 새로 작성하기"],
        "ask_contact":     ["010-1234-5678/email@example.com"],
        "ask_target":      ["IT 프론트엔드 개발자", "일반 사무 행정 및 회계", "생산 관리 엔지니어"],
        "ask_skills":      ["React, TypeScript, CSS", "엑셀, 세무회계, ERP", "기계가공, 도면해독"],
        "ask_experience":  ["신입", "관련 분야 2년 근무 경력"],
        "ask_education":   ["대학교 졸업", "고등학교 졸업"]
    };

    function renderSuggestionChips(step) {
        chatSuggestions.innerHTML = "";
        const chips = suggestionsForStep[step] || [];
        chips.forEach(text => {
            const chip = document.createElement("div");
            chip.classList.add("suggestion-chip");
            chip.textContent = text;
            chip.addEventListener("click", () => {
                chatInput.value = text;
                sendMessage();
            });
            chatSuggestions.appendChild(chip);
        });
    }

    // ── Send message ───────────────────────────────────────────────
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        appendUserMessage(text);
        chatInput.value = "";
        chatSuggestions.innerHTML = "";
        showTypingIndicator();

        try {
            const res = await fetch(`${API_BASE}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: text, step: currentStep })
            });
            const data = await res.json();
            removeTypingIndicator();
            appendBotMessage(data.reply);
            currentStep = data.step;
            updateStepNav(currentStep);
            updateProgressBar(currentStep);
            renderSuggestionChips(currentStep);
            if (currentStep === "done") loadProfile();
        } catch (e) {
            removeTypingIndicator();
            appendBotMessage("서버 통신 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
            console.error(e);
        }
    }

    // ── Reset ──────────────────────────────────────────────────────
    let resetPending = false;
    btnReset.addEventListener("click", async () => {
        if (!resetPending) {
            resetPending = true;
            btnReset.textContent = "❗ 한 번 더 누르면 초기화";
            btnReset.style.color = "var(--accent-red)";
            setTimeout(() => {
                resetPending = false;
                btnReset.textContent = "🔄 초기화";
                btnReset.style.color = "";
            }, 3000);
            return;
        }
        resetPending = false;
        btnReset.textContent = "🔄 초기화";
        btnReset.style.color = "";
        try {
            await fetch(`${API_BASE}/api/reset`, { method: "POST" });
            chatMessages.innerHTML = "";
            chatSuggestions.innerHTML = "";
            userProfile = {};
            currentStep = "start";
            resumeSheet.innerHTML = `
                <div class="resume-placeholder">
                    <p class="placeholder-icon">📄</p>
                    <p>챗봇과의 대화를 완료하면<br>여기에 인쇄용 AI 맞춤 이력서가 생성됩니다.</p>
                </div>`;
            showToast("초기화 완료! 처음부터 다시 시작합니다.");
            updateProgressBar("ask_name");
            initChat();
        } catch (e) {
            showToast("초기화 실패", "error");
        }
    });

    // ── 이력서 파일 업로드 ─────────────────────────────────────────
    resumeFileInput.addEventListener("change", () => {
        uploadedFile = resumeFileInput.files[0];
        if (uploadedFile) {
            uploadFilename.textContent = uploadedFile.name;
            btnUploadGo.style.display = "block";
        }
    });

    btnUploadGo.addEventListener("click", async () => {
        if (!uploadedFile) return;
        btnUploadGo.textContent = "분석 중...";
        btnUploadGo.disabled = true;
        const formData = new FormData();
        formData.append("file", uploadedFile);
        try {
            const res  = await fetch(`${API_BASE}/api/upload-resume`, { method: "POST", body: formData });
            const data = await res.json();
            if (data.error) { showToast(data.error, "error"); return; }
            const text = data.text || "";
            // 추출된 텍스트를 챗봇 입력에 반영 (첫 200자 미리보기)
            appendBotMessage(`이력서 파일을 분석했습니다. 내용을 바탕으로 온보딩을 진행합니다.\n\n📄 추출된 텍스트 (앞부분 미리보기):\n${text.slice(0, 200)}...`);
            showToast("이력서 업로드 완료! 챗봇에 내용이 반영됩니다.");
            // 업로드 텍스트를 userProfile에 저장
            userProfile._resumeText = text;
        } catch (e) {
            showToast("업로드 실패", "error");
        } finally {
            btnUploadGo.textContent = "분석 시작";
            btnUploadGo.disabled = false;
        }
    });

    btnSend.addEventListener("click", sendMessage);
    chatInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });

    // ── Init chat ──────────────────────────────────────────────────
    async function initChat() {
        showTypingIndicator();
        try {
            const res = await fetch(`${API_BASE}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "", step: "start" })
            });
            const data = await res.json();
            removeTypingIndicator();
            appendBotMessage(data.reply);
            currentStep = data.step;
            updateProgressBar(currentStep);
            renderSuggestionChips(currentStep);
        } catch (e) {
            removeTypingIndicator();
            appendBotMessage("컨설턴트 챗봇을 연결할 수 없습니다. 서버(server.py)가 실행 중인지 확인해 주세요.");
            console.error(e);
        }
    }

    // ── Load profile ───────────────────────────────────────────────
    async function loadProfile() {
        try {
            const res = await fetch(`${API_BASE}/api/profile`);
            const profile = await res.json();
            if (profile && profile.name) {
                userProfile = profile;
                filterSalary.value = profile.min_salary || 3000;
                valSalary.textContent = `${(profile.min_salary || 3000).toLocaleString()} 만원 이상`;
                filterDistance.value = profile.max_distance || 30;
                valDistance.textContent = `${profile.max_distance || 30} km 이내`;
                filterShift.checked = profile.exclude_shift === 1;
                if (filterCareer)    filterCareer.value    = profile.career    || "0";
                if (filterEducation) filterEducation.value = profile.education || "0";
                settingGeminiKey.value = profile.gemini_api_key || "";
                if (settingWorknetKey) settingWorknetKey.value = profile.worknet_api_key || "";
                if (settingSaraminKey) settingSaraminKey.value = profile.saramin_api_key || "";
                settingSmtpUser.value = profile.smtp_user || "";
                settingSmtpPass.value = profile.smtp_pass || "";
                if (profile.polished_resume) {
                    resumeSheet.innerHTML = profile.polished_resume;
                } else {
                    resumeSheet.innerHTML = `
                        <div class="resume-placeholder">
                            <p class="placeholder-icon">📄</p>
                            <p>이력서 정보가 존재하지만 문서가 아직 생성되지 않았습니다.<br>좌측 챗봇과의 온보딩 대화를 끝까지 마쳐주세요.</p>
                        </div>`;
                }
            }
        } catch (e) { console.error("Error loading profile", e); }
    }

    // ── Filter UI ──────────────────────────────────────────────────
    filterSalary.addEventListener("input", () => {
        valSalary.textContent = `${parseInt(filterSalary.value).toLocaleString()} 만원 이상`;
    });
    filterDistance.addEventListener("input", () => {
        valDistance.textContent = `${filterDistance.value} km 이내`;
    });

    btnSaveFilters.addEventListener("click", async () => {
        const payload = {
            ...userProfile,
            min_salary:    parseInt(filterSalary.value),
            max_distance:  parseInt(filterDistance.value),
            exclude_shift: filterShift.checked ? 1 : 0,
            career:        filterCareer    ? filterCareer.value    : "0",
            education:     filterEducation ? filterEducation.value : "0",
        };
        try {
            const res  = await fetch(`${API_BASE}/api/profile`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.status === "success") {
                showToast("필터링 조건이 성공적으로 저장되었습니다!");
                loadProfile();
            }
        } catch (e) { showToast("필터링 조건 저장 실패", "error"); }
    });

    // ── Load matched jobs ──────────────────────────────────────────
    async function loadMatchedJobs() {
        jobsList.innerHTML = "<div class='no-jobs-placeholder'><p>🔍 AI 채용 공고 매칭 중...</p></div>";
        try {
            const res  = await fetch(`${API_BASE}/api/scrape`, { method: "POST" });
            const data = await res.json();
            if (data.error) {
                jobsList.innerHTML = `<div class='no-jobs-placeholder'><p>⚠️ ${data.error}</p></div>`;
                return;
            }
            const jobs = data.matched_jobs;
            if (!jobs || jobs.length === 0) {
                jobsList.innerHTML = "<div class='no-jobs-placeholder'><p>현재 조건에 부합하는 매칭 공고가 없습니다.</p></div>";
                return;
            }
            jobsList.innerHTML = "";
            jobs.forEach(job => {
                const score = job.match_score;
                const tier  = score >= 75 ? "high" : score >= 55 ? "mid" : "low";
                const card  = document.createElement("div");
                card.classList.add("job-card", `${tier}-match`);

                const shiftBadge = job.shift_work === 1
                    ? '<span class="badge badge-shift">교대근무</span>'
                    : "";

                card.innerHTML = `
                    <div class="job-card-header">
                        <div class="job-card-title-block">
                            <h4>${job.title}</h4>
                            <span class="company-meta">${job.company} &nbsp;|&nbsp; ${job.location}</span>
                        </div>
                        <div class="match-score-block">
                            <span class="match-percentage ${tier}">${score}% 일치</span>
                            <div class="match-bar-track">
                                <div class="match-bar-fill ${tier}" style="width: 0%" data-target="${score}"></div>
                            </div>
                        </div>
                    </div>
                    <div class="job-tags">
                        <span class="job-tag tag-highlight">💵 연봉 ${job.salary.toLocaleString()}만원</span>
                        <span class="job-tag">📍 ${job.distance}km</span>
                        ${shiftBadge}
                    </div>
                    <p class="job-description">${job.description}</p>
                    <p class="job-requirements">📋 요구사항: ${job.requirements}</p>
                    <div class="job-card-footer">
                        <a href="${job.url}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;">상세 공고 보기 →</a>
                    </div>
                `;
                jobsList.appendChild(card);
            });

            // Animate match bars after render
            requestAnimationFrame(() => {
                document.querySelectorAll(".match-bar-fill").forEach(bar => {
                    setTimeout(() => {
                        bar.style.width = bar.dataset.target + "%";
                    }, 100);
                });
            });
        } catch (e) {
            jobsList.innerHTML = "<div class='no-jobs-placeholder'><p>매칭 채용공고 로드 오류</p></div>";
            console.error(e);
        }
    }

    btnRefreshMatching.addEventListener("click", loadMatchedJobs);

    // ── 고용24 실시간 채용공고 ─────────────────────────────────────
    if (btnWorknet) {
        btnWorknet.addEventListener("click", async () => {
            worknetSection.style.display = "block";
            jobsList.style.display = "none";
            worknetList.innerHTML = "<div class='no-jobs-placeholder'><p>🏛 고용24 실시간 채용공고 검색 중...</p></div>";
            try {
                const res  = await fetch(`${API_BASE}/api/worknet-jobs`, { method: "POST" });
                const data = await res.json();
                if (data.error) {
                    worknetList.innerHTML = `<div class='no-jobs-placeholder'><p>⚠️ ${data.error}</p></div>`;
                    return;
                }
                const jobs = data.jobs || [];
                if (worknetKeyword) worknetKeyword.textContent = `키워드: "${data.keyword}"`;
                if (jobs.length === 0) {
                    worknetList.innerHTML = "<div class='no-jobs-placeholder'><p>검색 결과가 없습니다. 필터 조건을 조정해 보세요.</p></div>";
                    return;
                }
                worknetList.innerHTML = "";
                jobs.forEach(job => {
                    const card = document.createElement("div");
                    card.classList.add("worknet-card");
                    card.innerHTML = `
                        <h4>${job.title}</h4>
                        <span class="company-meta">${job.company} &nbsp;|&nbsp; ${job.location}</span>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <span class="worknet-tag">💼 ${job.career || '경력무관'}</span>
                            <span class="worknet-tag">🎓 ${job.education || '학력무관'}</span>
                            ${job.salary ? `<span class="worknet-tag">💵 ${job.salary}</span>` : ""}
                            ${job.close_date ? `<span class="job-tag">📅 마감 ${job.close_date}</span>` : ""}
                        </div>
                        <div style="display:flex;justify-content:flex-end;">
                            <a href="${job.url}" target="_blank" class="btn btn-success btn-sm" style="text-decoration:none;">고용24에서 보기 →</a>
                        </div>
                    `;
                    worknetList.appendChild(card);
                });
            } catch (e) {
                worknetList.innerHTML = "<div class='no-jobs-placeholder'><p>고용24 연결 오류</p></div>";
                console.error(e);
            }
        });
    }

    // ── Save settings ──────────────────────────────────────────────
    btnSaveSettings.addEventListener("click", async () => {
        const payload = {
            ...userProfile,
            gemini_api_key:  settingGeminiKey.value.trim(),
            worknet_api_key: settingWorknetKey ? settingWorknetKey.value.trim() : "",
            saramin_api_key: settingSaraminKey ? settingSaraminKey.value.trim() : "",
            smtp_user:       settingSmtpUser.value.trim(),
            smtp_pass:       settingSmtpPass.value.trim()
        };
        try {
            const res  = await fetch(`${API_BASE}/api/profile`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.status === "success") {
                showToast("에이전트 환경 설정이 완료되었습니다!");
                loadProfile();
            }
        } catch (e) { showToast("에이전트 설정 저장 실패", "error"); }
    });

    // ── Test email ─────────────────────────────────────────────────
    btnTestMail.addEventListener("click", async () => {
        btnTestMail.disabled = true;
        btnTestMail.textContent = "📧 이메일 발송 중...";
        try {
            const res  = await fetch(`${API_BASE}/api/send-email`, { method: "POST" });
            const data = await res.json();
            btnTestMail.disabled = false;
            btnTestMail.innerHTML = "📧 즉시 메일 발송 테스트";
            if (data.success) {
                showToast("오늘의 매칭 채용공고가 이메일로 발송되었습니다!");
            } else {
                showToast(`이메일 발송 실패: ${data.message}`, "error");
            }
        } catch (e) {
            btnTestMail.disabled = false;
            btnTestMail.innerHTML = "📧 즉시 메일 발송 테스트";
            showToast("네트워크 오류로 메일 발송에 실패했습니다.", "error");
        }
    });

    // ── Print ──────────────────────────────────────────────────────
    btnPrint.addEventListener("click", () => window.print());

    // ── Init ───────────────────────────────────────────────────────
    loadProfile().then(() => {
        if (userProfile && userProfile.name) {
            appendBotMessage(`반갑습니다, **${userProfile.name}**님! 기존에 등록된 이력서가 로드되었습니다.\n우측 이력서 시트 및 추천 채용공고 탭들을 확인해 주세요.`);
            currentStep = "done";
            updateStepNav("done");
            updateProgressBar("done");
        } else {
            updateProgressBar("ask_name");
            initChat();
        }
    });
});
