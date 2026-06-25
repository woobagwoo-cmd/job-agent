import http.server
import socketserver
import json
import sqlite3
import urllib.request
import urllib.parse
import os
import re
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import datetime
import threading
import time

PORT = int(os.environ.get('PORT', 3000))
DB_FILE = "db.sqlite"

# ------------------------------------------------------------------
# SMTP provider auto-detection (Gmail / Naver / Daum-Kakao / Outlook 등)
# ------------------------------------------------------------------
SMTP_PROVIDERS = {
    "gmail.com":   {"host": "smtp.gmail.com",   "port": 587},
    "googlemail.com": {"host": "smtp.gmail.com", "port": 587},
    "naver.com":   {"host": "smtp.naver.com",    "port": 587},
    "daum.net":    {"host": "smtp.daum.net",     "port": 465, "ssl": True},
    "kakao.com":   {"host": "smtp.kakao.com",    "port": 465, "ssl": True},
    "hanmail.net": {"host": "smtp.daum.net",     "port": 465, "ssl": True},
    "outlook.com": {"host": "smtp.office365.com", "port": 587},
    "hotmail.com": {"host": "smtp.office365.com", "port": 587},
    "nate.com":    {"host": "smtp.mail.nate.com", "port": 465, "ssl": True},
}

def get_smtp_config(sender_email):
    """발신 이메일 주소의 도메인을 보고 SMTP 서버 설정을 자동으로 고른다."""
    if not sender_email or "@" not in sender_email:
        return None
    domain = sender_email.split("@", 1)[1].strip().lower()
    return SMTP_PROVIDERS.get(domain)

# ------------------------------------------------------------------
# Validation helpers
# ------------------------------------------------------------------
EMAIL_RE = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')
PHONE_RE = re.compile(r'^0\d{1,2}-?\d{3,4}-?\d{4}$')

def is_valid_email(s):
    return bool(EMAIL_RE.match(s.strip())) if s else False

def is_valid_phone(s):
    return bool(PHONE_RE.match(s.strip())) if s else False

# Helper to execute DB queries
def query_db(query, args=(), one=False):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(query, args)
    rv = cur.fetchall()
    conn.commit()
    conn.close()
    return (rv[0] if rv else None) if one else rv

# Initialize Database
def init_db():
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()

    # Create profiles table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT,
        phone TEXT,
        skills TEXT,
        experience TEXT,
        education TEXT,
        target_jobs TEXT,
        polished_resume TEXT,
        keywords TEXT,
        min_salary INTEGER DEFAULT 0,
        max_distance INTEGER DEFAULT 50,
        exclude_shift INTEGER DEFAULT 0,
        gemini_api_key TEXT,
        saramin_api_key TEXT,
        worknet_api_key TEXT,
        smtp_user TEXT,
        smtp_pass TEXT,
        career TEXT DEFAULT '0',
        education TEXT DEFAULT '0',
        onboarding_step TEXT DEFAULT 'start'
    )
    """)

    # Add new columns if upgrading from older schema
    for col, default in [
        ("saramin_api_key", "TEXT"),
        ("worknet_api_key", "TEXT"),
        ("career", "TEXT DEFAULT '0'"),
        ("education", "TEXT DEFAULT '0'"),
    ]:
        try:
            cur.execute(f"ALTER TABLE profiles ADD COLUMN {col} {default}")
            conn.commit()
        except Exception:
            pass

    # Create jobs table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        company TEXT,
        salary INTEGER, -- in ten-thousand KRW (e.g., 3600 = 36,000,000 KRW)
        distance INTEGER, -- in km
        shift_work INTEGER, -- 0 = No, 1 = Yes
        description TEXT,
        location TEXT,
        requirements TEXT,
        url TEXT,
        is_active INTEGER DEFAULT 1
    )
    """)

    # Create sent_jobs table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS sent_jobs (
        user_id INTEGER,
        job_id INTEGER,
        sent_at TEXT,
        PRIMARY KEY (user_id, job_id)
    )
    """)

    # Insert Mock Jobs if table is empty
    cur.execute("SELECT COUNT(*) FROM jobs")
    if cur.fetchone()[0] == 0:
        mock_jobs = [
            ("AI 프론트엔드 개발자", "테크하이브", 4800, 8, 0, "React/TypeScript 기반 프론트엔드 개발 및 AI 서비스 인터페이스 구축", "서울 강남구", "React 3년 이상, RESTful API 연동 경험", "https://example.com/jobs/1"),
            ("백엔드 파이썬 엔지니어", "알고소프트", 5500, 15, 0, "Python/Django 기반 데이터 파이프라인 개발 및 API 서버 고도화", "서울 서초구", "Python 개발 2년 이상, SQL 최적화 가능자", "https://example.com/jobs/2"),
            ("사무 행정 및 회계 담당자", "한결세무회계", 2800, 5, 0, "세무기장 대행, 매출입 관리, 부가세 신고 보조 및 사무 행정 지원", "경기 성남시", "엑셀 숙련자, 관련 자격증 소지자 우대", "https://example.com/jobs/3"),
            ("데이터 라벨링 검수원 (단기)", "네오데이터", 2400, 2, 0, "AI 학습 데이터 검수 및 텍스트/이미지 라벨링 품질 검사", "경기 성남시", "컴퓨터 활용 능력 기본, 성실하고 꼼꼼한 분", "https://example.com/jobs/4"),
            ("물류 센터 운영 및 관리원", "에이치 로지스", 3200, 28, 1, "물류 창고 재고 관리, 상품 분류 및 입출고 검수 (주야 2교대)", "경기 이천시", "교대 근무 가능자, 인근 거주자 우대, 체력 우수자", "https://example.com/jobs/5"),
            ("시스템 엔지니어 (인프라)", "클라우드웍스", 4200, 18, 0, "Linux 서버 관리, 네트워크 장애 대응 및 클라우드(AWS) 마이그레이션", "서울 마포구", "Linux 시스템 운영 1년 이상, 정보처리기사 우대", "https://example.com/jobs/6"),
            ("식음료 매장 바리스타", "카페 라온", 2500, 3, 0, "커피 제조 및 음료 서비스, 매장 결제 및 청결 관리", "경기 성남시", "바리스타 자격증 소지자 우대, 고객 서비스 마인드", "https://example.com/jobs/7"),
            ("정밀 부품 가공 엔지니어", "신흥정밀", 3800, 35, 1, "CNC 선반 조작, 부품 가공 및 품질 검사 (3조 2교대)", "인천 남동구", "기계 가공 경력 1년 이상, 도면 해독 가능자", "https://example.com/jobs/8"),
            ("스마트팩토리 제어 소프트웨어 개발", "미래솔루션", 4600, 22, 0, "C#/C++ 기반 설비 제어 및 스마트팩토리 MES 연동 프로그램 개발", "경기 수원시", "C# 및 C++ 개발 경력 2년 이상, PLC 제어 경험 우대", "https://example.com/jobs/9")
        ]
        cur.executemany("INSERT INTO jobs (title, company, salary, distance, shift_work, description, location, requirements, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", mock_jobs)

    conn.commit()
    conn.close()
    print("Database initialized successfully.")

# AI Resume Polishing & Keyword Extraction
def run_ai_polishing(api_key, raw_info):
    if not api_key:
        # Fallback simulated AI response
        return simulate_ai(raw_info)

    prompt = f"""
    You are an elite Korean professional resume writer and recruitment agent.
    Optimize the raw resume information below to be professional, coherent, and rich with industry-appropriate keywords.

    Raw Information:
    {json.dumps(raw_info, ensure_ascii=False, indent=2)}

    Please output your response strictly as a JSON object with this structure:
    {{
        "polishedResume": "<HTML code representing a beautiful, print-ready, clean, modern resume layout>",
        "keywords": ["keyword1", "keyword2", "keyword3", "keyword4"]
    }}
    Do not include any markdown fences (like ```json) in your final output. Return ONLY the raw JSON string.
    """

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + api_key
    headers = {"Content-Type": "application/json"}
    data = {
        "contents": [{
            "parts": [{"text": prompt}]
        }]
    }

    try:
        req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            raw_text = res_data['candidates'][0]['content']['parts'][0]['text'].strip()
            # Strip markdown fences if Gemini added them despite instructions
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]
            return json.loads(raw_text.strip())
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return simulate_ai(raw_info)

# Simulated AI response when API key is missing
def simulate_ai(raw_info):
    name = raw_info.get("name", "홍길동")
    email = raw_info.get("email", "user@example.com")
    phone = raw_info.get("phone", "010-0000-0000")
    skills = raw_info.get("skills", "")
    experience = raw_info.get("experience", "")
    education = raw_info.get("education", "")
    target_jobs = raw_info.get("target_jobs", "")

    # Simple keyword extraction
    keywords = [k.strip() for k in skills.split(",") if k.strip()]
    if target_jobs:
        keywords.append(target_jobs)
    if not keywords:
        keywords = ["행정", "개발", "사무"]

    keywords = list(set(keywords))[:5]

    skill_tags = "".join([f'<span class="resume-skill-tag">{k}</span>' for k in keywords])

    polished_html = f"""
    <div class="resume-container">
        <header class="resume-header">
            <h1>{name}</h1>
            <p class="resume-contact">📞 {phone}&nbsp;&nbsp;✉️ {email}</p>
        </header>
        <section class="resume-section">
            <h2>🎯 희망 직무</h2>
            <p>{target_jobs if target_jobs else '사무 행정 및 일반 직무'}</p>
        </section>
        <section class="resume-section">
            <h2>🛠️ 핵심 역량 및 보유 기술</h2>
            <div class="resume-skills">{skill_tags}</div>
        </section>
        <section class="resume-section">
            <h2>💼 경력 사항</h2>
            <p>{experience if experience else '신입 / 경력 기술 예정'}</p>
        </section>
        <section class="resume-section">
            <h2>🎓 학력 사항</h2>
            <p>{education if education else '학력 사항 기술 예정'}</p>
        </section>
    </div>
    """
    return {
        "polishedResume": polished_html,
        "keywords": keywords
    }

# Job matching logic based on profile and filters
def match_jobs(user_profile, all_jobs):
    keywords = json.loads(user_profile["keywords"]) if user_profile["keywords"] else []
    min_salary = user_profile["min_salary"]
    max_distance = user_profile["max_distance"]
    exclude_shift = user_profile["exclude_shift"]

    matched = []
    for job in all_jobs:
        # 1. Salary check
        if job["salary"] < min_salary:
            continue
        # 2. Distance check
        if job["distance"] > max_distance:
            continue
        # 3. Shift work check
        if exclude_shift == 1 and job["shift_work"] == 1:
            continue

        # Calculate match score based on keyword intersections
        match_count = 0
        job_text = (job["title"] + " " + job["description"] + " " + job["requirements"]).lower()
        for kw in keywords:
            if kw.lower() in job_text:
                match_count += 1

        # Matching score out of 100
        score = 50 + (match_count * 15)
        if score > 100:
            score = 100
        # If no keywords match, let's give a baseline or skip if user target is highly specific
        if len(keywords) > 0 and match_count == 0:
            score = 40  # Low match

        matched.append({
            "id": job["id"],
            "title": job["title"],
            "company": job["company"],
            "salary": job["salary"],
            "distance": job["distance"],
            "shift_work": job["shift_work"],
            "description": job["description"],
            "location": job["location"],
            "requirements": job["requirements"],
            "url": job["url"],
            "match_score": score
        })

    # Sort by match score descending
    matched.sort(key=lambda x: x["match_score"], reverse=True)
    return matched

# Send match report email
def send_email_report(user_profile, matched_jobs):
    if not user_profile["smtp_user"] or not user_profile["smtp_pass"]:
        return False, "SMTP 발송 계정/비밀번호가 설정되지 않았습니다."

    sender_email = user_profile["smtp_user"]
    receiver_email = user_profile["email"]

    if not is_valid_email(receiver_email or ""):
        return False, f"수신 이메일 주소가 올바르지 않습니다: '{receiver_email}'. 챗봇에서 연락처를 다시 입력해 주세요."

    smtp_config = get_smtp_config(sender_email)
    if not smtp_config:
        domain = sender_email.split("@", 1)[1] if "@" in sender_email else sender_email
        return False, f"'{domain}' 메일 서비스는 지원되지 않습니다. Gmail, Naver, Daum/Kakao, Outlook/Hotmail, Nate 중 하나의 발신 계정을 사용해 주세요."

    smtp_server = smtp_config["host"]
    smtp_port = smtp_config["port"]
    use_ssl = smtp_config.get("ssl", False)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"🎯 [AI 맞춤 일자리 안내] {user_profile['name']}님을 위한 오늘의 추천 공고"
    msg["From"] = sender_email
    msg["To"] = receiver_email

    # Build HTML email body
    job_rows = ""
    for idx, job in enumerate(matched_jobs[:3]): # Top 3 jobs
        shift_badge = '<span style="background-color: #E74C3C; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px;">교대근무</span>' if job["shift_work"] == 1 else ""
        job_rows += f"""
        <div style="border: 1px solid #E2E8F0; padding: 16px; border-radius: 8px; margin-bottom: 12px; background-color: #F8FAFC;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; color: #1E3A8A;">{job['title']}</h3>
                <span style="font-weight: bold; color: #10B981; font-size: 16px;">매칭도 {job['match_score']}%</span>
            </div>
            <p style="margin: 4px 0 8px 0; font-weight: bold; color: #475569;">{job['company']} | {job['location']}</p>
            <p style="margin: 4px 0; font-size: 13px;">💵 연봉: <strong>{job['salary']}만원</strong> | 📍 거리: <strong>{job['distance']}km</strong> {shift_badge}</p>
            <p style="margin: 8px 0; font-size: 13px; color: #334155;">{job['description']}</p>
            <p style="margin: 4px 0; font-size: 12px; color: #64748B;">📄 요구사항: {job['requirements']}</p>
            <a href="{job['url']}" style="display: inline-block; background-color: #4F46E5; color: white; padding: 6px 12px; text-decoration: none; border-radius: 4px; font-size: 12px; margin-top: 8px;">상세 공고 보기</a>
        </div>
        """

    html = f"""
    <html>
        <body style="font-family: 'Malgun Gothic', dotum, sans-serif; padding: 20px; color: #333333; line-height: 1.6;">
            <div style="max-width: 600px; margin: 0 auto; border: 1px solid #CBD5E1; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                <div style="background-color: #4F46E5; padding: 24px; color: white; text-align: center;">
                    <h1 style="margin: 0; font-size: 22px;">AI 맞춤 일자리 안내 에이전트</h1>
                    <p style="margin: 8px 0 0 0; font-size: 14px;">{user_profile['name']}님께 매칭된 최적의 채용 정보입니다.</p>
                </div>
                <div style="padding: 24px;">
                    <p>안녕하세요, {user_profile['name']}님!</p>
                    <p>작성하신 이력서와 스크리닝 필터 조건(연봉 {user_profile['min_salary']}만 이상, 거리 {user_profile['max_distance']}km 이내, 교대무관)을 기반으로 오늘 아침 매칭된 최적의 공고들을 안내해 드립니다.</p>

                    <h2 style="font-size: 18px; border-bottom: 2px solid #E2E8F0; padding-bottom: 8px; color: #1E293B;">🎯 오늘의 추천 일자리 TOP 3</h2>
                    {job_rows if job_rows else "<p style='color: #64748B;'>오늘 매칭되는 공고가 없습니다. 조건을 조금 넓혀보시면 더 많은 매칭이 가능합니다.</p>"}

                    <hr style="border: 0; border-top: 1px solid #E2E8F0; margin: 24px 0;">
                    <p style="font-size: 12px; color: #64748B; text-align: center;">본 메일은 개인 맞춤형 AI 일자리 안내 에이전트를 통해 발송되었습니다.<br>설정 및 매칭 정보 수정은 챗봇 인터페이스에서 진행할 수 있습니다.</p>
                </div>
            </div>
        </body>
    </html>
    """
    msg.attach(MIMEText(html, "html"))

    try:
        if use_ssl:
            server = smtplib.SMTP_SSL(smtp_server, smtp_port)
        else:
            server = smtplib.SMTP(smtp_server, smtp_port)
            server.starttls()
        server.login(sender_email, user_profile["smtp_pass"])
        server.sendmail(sender_email, receiver_email, msg.as_string())
        server.quit()
        return True, "Email sent successfully."
    except Exception as e:
        print(f"Error sending email: {e}")
        return False, str(e)

# REST Handler
class Handler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        # Allow CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # Route API requests
        if path == "/api/profile":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            profile = query_db("SELECT * FROM profiles ORDER BY id DESC LIMIT 1", one=True)
            if profile:
                self.wfile.write(json.dumps(dict(profile), ensure_ascii=False).encode('utf-8'))
            else:
                self.wfile.write(json.dumps({}, ensure_ascii=False).encode('utf-8'))
            return

        elif path == "/api/jobs":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            jobs = query_db("SELECT * FROM jobs")
            self.wfile.write(json.dumps([dict(j) for j in jobs], ensure_ascii=False).encode('utf-8'))
            return

        # Serve static assets
        if path == "/":
            path = "/index.html"

        local_path = "." + path
        if os.path.exists(local_path) and os.path.isfile(local_path):
            self.send_response(200)
            if path.endswith(".html"):
                self.send_header("Content-Type", "text/html; charset=utf-8")
            elif path.endswith(".css"):
                self.send_header("Content-Type", "text/css")
            elif path.endswith(".js"):
                self.send_header("Content-Type", "application/javascript")
            self.end_headers()
            with open(local_path, "rb") as f:
                self.wfile.write(f.read())
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"File not found")

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        content_length = int(self.headers['Content-Length'])
        body = self.rfile.read(content_length).decode('utf-8')
        data = json.loads(body) if body else {}

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

        if path == "/api/profile":
            # Save or update profile
            name = data.get("name", "")
            email = data.get("email", "")
            phone = data.get("phone", "")
            skills = data.get("skills", "")
            experience = data.get("experience", "")
            education = data.get("education", "")
            target_jobs = data.get("target_jobs", "")
            min_salary = data.get("min_salary", 0)
            max_distance = data.get("max_distance", 50)
            exclude_shift = data.get("exclude_shift", 0)
            gemini_api_key  = data.get("gemini_api_key", "")
            saramin_api_key = data.get("saramin_api_key", "")
            worknet_api_key = data.get("worknet_api_key", "")
            smtp_user       = data.get("smtp_user", "")
            smtp_pass       = data.get("smtp_pass", "")
            career          = data.get("career", "0")
            education       = data.get("education", "0")

            # Check if profile exists
            profile = query_db("SELECT id FROM profiles ORDER BY id DESC LIMIT 1", one=True)

            if profile:
                # Update existing profile
                query_db("""
                UPDATE profiles SET
                    name=?, email=?, phone=?, skills=?, experience=?, education=?,
                    target_jobs=?, min_salary=?, max_distance=?, exclude_shift=?,
                    gemini_api_key=?, saramin_api_key=?, worknet_api_key=?,
                    smtp_user=?, smtp_pass=?, career=?
                WHERE id=?
                """, (name, email, phone, skills, experience, education, target_jobs,
                      min_salary, max_distance, exclude_shift,
                      gemini_api_key, saramin_api_key, worknet_api_key,
                      smtp_user, smtp_pass, career, profile["id"]))
                prof_id = profile["id"]
            else:
                # Insert new profile
                query_db("""
                INSERT INTO profiles (
                    name, email, phone, skills, experience, education,
                    target_jobs, min_salary, max_distance, exclude_shift,
                    gemini_api_key, saramin_api_key, worknet_api_key,
                    smtp_user, smtp_pass, career
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (name, email, phone, skills, experience, education, target_jobs,
                      min_salary, max_distance, exclude_shift,
                      gemini_api_key, saramin_api_key, worknet_api_key,
                      smtp_user, smtp_pass, career))
                new_prof = query_db("SELECT id FROM profiles ORDER BY id DESC LIMIT 1", one=True)
                prof_id = new_prof["id"] if new_prof else 1

            self.wfile.write(json.dumps({"status": "success", "profile_id": prof_id}).encode('utf-8'))

        elif path == "/api/chat":
            # Chatbot conversation endpoint
            message = data.get("message", "").strip()
            step = data.get("step", "start")

            # Always work against a single in-progress profile row.
            # We never INSERT a brand new row mid-conversation anymore;
            # we create (or reuse) exactly one "active" row at the start
            # and UPDATE it field-by-field as the conversation proceeds.
            profile = query_db("SELECT * FROM profiles ORDER BY id DESC LIMIT 1", one=True)
            api_key = profile["gemini_api_key"] if profile else ""

            next_step = "start"
            bot_reply = ""

            if step == "start":
                # Create the single working row only if none exists yet,
                # or if the previous row already completed onboarding
                # (in that case we still just keep editing the same row;
                # the UI's "loadProfile" already short-circuits past onboarding
                # when polished_resume exists, so this path mainly fires once).
                if not profile:
                    query_db("INSERT INTO profiles (name, onboarding_step) VALUES (?, ?)", ("", "ask_name"))
                bot_reply = "안녕하세요! AI 일자리 매칭 에이전트 Onboarding을 시작합니다. 먼저 성함을 입력해 주세요."
                next_step = "ask_name"

            elif step == "ask_name":
                if not message:
                    bot_reply = "성함을 입력해 주세요."
                    next_step = "ask_name"
                else:
                    query_db("UPDATE profiles SET name=?, onboarding_step=? WHERE id=(SELECT max(id) FROM profiles)",
                              (message, "ask_contact"))
                    bot_reply = (f"감사합니다, {message}님. 연락처와 이메일 주소를 입력해 주세요.\n"
                                 f"(예: 010-1234-5678/user@example.com — 순서는 바뀌어도 괜찮습니다)")
                    next_step = "ask_contact"

            elif step == "ask_contact":
                # Robustly extract phone & email regardless of order/format,
                # instead of assuming a fixed "phone/email" split position.
                parts = [p.strip() for p in re.split(r'[/,\s]+', message) if p.strip()]

                found_email = None
                found_phone = None
                for p in parts:
                    if is_valid_email(p) and not found_email:
                        found_email = p
                    elif is_valid_phone(p) and not found_phone:
                        found_phone = p

                # Fallback: maybe email/phone got glued without a clean separator
                if not found_email:
                    email_match = EMAIL_RE.search(message)
                    if email_match:
                        found_email = email_match.group(0)
                if not found_phone:
                    phone_match = PHONE_RE.search(message)
                    if phone_match:
                        found_phone = phone_match.group(0)

                if not found_email:
                    bot_reply = ("입력하신 내용에서 유효한 이메일 주소를 찾지 못했습니다. "
                                 "이메일 형식(예: user@example.com)으로 다시 입력해 주세요.\n"
                                 "(예: 010-1234-5678/user@example.com)")
                    next_step = "ask_contact"
                else:
                    phone_to_save = found_phone or ""
                    query_db("""UPDATE profiles SET phone=?, email=?, onboarding_step=?
                                WHERE id=(SELECT max(id) FROM profiles)""",
                              (phone_to_save, found_email, "ask_target"))
                    bot_reply = "희망하시는 직무나 분야를 말씀해 주세요. (예: 웹 프론트엔드 개발자, 사무 행정 및 회계)"
                    next_step = "ask_target"

            elif step == "ask_target":
                query_db("UPDATE profiles SET target_jobs=?, onboarding_step=? WHERE id=(SELECT max(id) FROM profiles)",
                          (message, "ask_skills"))
                bot_reply = "보유하고 계신 기술이나 주요 역량을 쉼표(,)로 구분해서 입력해 주세요. (예: React, TypeScript, 엑셀, 세무회계)"
                next_step = "ask_skills"

            elif step == "ask_skills":
                query_db("UPDATE profiles SET skills=?, onboarding_step=? WHERE id=(SELECT max(id) FROM profiles)",
                          (message, "ask_experience"))
                bot_reply = "업무 경력이나 프로젝트 경험을 간단히 작성해 주세요. (예: 네오테크 2년 프론트엔드 개발 경력, 세무사무소 1년 회계 보조 경력 등)"
                next_step = "ask_experience"

            elif step == "ask_experience":
                query_db("UPDATE profiles SET experience=?, onboarding_step=? WHERE id=(SELECT max(id) FROM profiles)",
                          (message, "ask_education"))
                bot_reply = "마지막으로, 최종 학력이나 전공 정보를 알려주세요. (예: 한국대학교 컴퓨터공학과 졸업)"
                next_step = "ask_education"

            elif step == "ask_education":
                query_db("UPDATE profiles SET education=?, onboarding_step=? WHERE id=(SELECT max(id) FROM profiles)",
                          (message, "done"))

                # Fetch profile and run AI polishing
                p = query_db("SELECT * FROM profiles ORDER BY id DESC LIMIT 1", one=True)
                raw_info = dict(p) if p else {}
                ai_res = run_ai_polishing(api_key, raw_info)

                # Save polished resume & keywords
                query_db("UPDATE profiles SET polished_resume=?, keywords=? WHERE id=?",
                         (ai_res["polishedResume"], json.dumps(ai_res["keywords"], ensure_ascii=False), raw_info["id"]))

                bot_reply = f"""이력서 작성이 성공적으로 완료되었습니다! 🎉
AI 분석을 통해 추출된 매칭 키워드는 **[{', '.join(ai_res['keywords'])}]** 입니다.
우측의 **'이력서 미리보기'** 탭에서 생성된 이력서를 확인하실 수 있습니다.

이제 **'스크리닝 필터'**를 설정하시어 원하지 않는 공고 조건(거리, 급여 등)을 제어해 주세요!"""
                next_step = "done"
            else:
                bot_reply = "대화 과정이 완료되었습니다. 화면 오른쪽 탭들에서 스크리닝 필터를 조절하시거나 일자리 추천 결과를 확인해 보세요!"
                next_step = "done"

            self.wfile.write(json.dumps({"reply": bot_reply, "step": next_step}, ensure_ascii=False).encode('utf-8'))

        elif path == "/api/scrape":
            # Scrape and match jobs
            profile = query_db("SELECT * FROM profiles ORDER BY id DESC LIMIT 1", one=True)
            if not profile:
                self.wfile.write(json.dumps({"error": "No user profile found. Please complete onboarding first."}, ensure_ascii=False).encode('utf-8'))
                return

            all_jobs = query_db("SELECT * FROM jobs")
            matched = match_jobs(dict(profile), [dict(j) for j in all_jobs])
            self.wfile.write(json.dumps({"matched_jobs": matched}, ensure_ascii=False).encode('utf-8'))

        elif path == "/api/send-email":
            # Trigger email report manually
            profile = query_db("SELECT * FROM profiles ORDER BY id DESC LIMIT 1", one=True)
            if not profile:
                self.wfile.write(json.dumps({"error": "No user profile found."}, ensure_ascii=False).encode('utf-8'))
                return

            all_jobs = query_db("SELECT * FROM jobs")
            matched = match_jobs(dict(profile), [dict(j) for j in all_jobs])

            # Send top 3 matched jobs
            success, msg = send_email_report(dict(profile), matched)
            self.wfile.write(json.dumps({"success": success, "message": msg}, ensure_ascii=False).encode('utf-8'))

        elif path == "/api/upload-resume":
            # 이력서 파일(PDF/TXT) 업로드 → 텍스트 추출
            import cgi, tempfile, os
            content_type = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type:
                self.wfile.write(json.dumps({"error": "multipart/form-data 형식으로 업로드해 주세요."}, ensure_ascii=False).encode('utf-8'))
                return
            form = cgi.FieldStorage(fp=self.rfile, headers=self.headers,
                                    environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type})
            file_item = form["file"] if "file" in form else None
            if not file_item:
                self.wfile.write(json.dumps({"error": "파일을 찾을 수 없습니다."}, ensure_ascii=False).encode('utf-8'))
                return

            file_data = file_item.file.read()
            filename  = file_item.filename or ""
            extracted = ""

            if filename.lower().endswith(".pdf"):
                try:
                    import pypdf, io
                    reader = pypdf.PdfReader(io.BytesIO(file_data))
                    for page in reader.pages:
                        extracted += (page.extract_text() or "") + "\n"
                except ImportError:
                    extracted = file_data.decode("utf-8", errors="ignore")
            else:
                extracted = file_data.decode("utf-8", errors="ignore")

            self.wfile.write(json.dumps({"text": extracted.strip()[:3000]}, ensure_ascii=False).encode('utf-8'))

        elif path == "/api/worknet-jobs":
            # 고용24(워크넷) 실제 채용공고 조회
            profile = query_db("SELECT * FROM profiles ORDER BY id DESC LIMIT 1", one=True)
            if not profile or not profile["worknet_api_key"]:
                self.wfile.write(json.dumps({"error": "고용24 API 키가 설정되지 않았습니다."}, ensure_ascii=False).encode('utf-8'))
                return

            api_key = profile["worknet_api_key"]
            keywords_raw = profile["keywords"] or "[]"
            try:
                kw_list = json.loads(keywords_raw)
                keyword = " ".join(kw_list[:2]) if kw_list else ""
            except Exception:
                keyword = profile.get("target_jobs", "") or ""

            career_val    = profile["career"]    if profile["career"]    else "0"
            education_val = profile["education"] if profile["education"] else "0"

            params = urllib.parse.urlencode({
                "authKey":    api_key,
                "callTp":     "L",
                "returnType": "JSON",
                "keyword":    keyword,
                "career":     career_val,
                "education":  education_val,
                "pageSize":   10,
                "startPage":  1,
            })
            worknet_url = f"https://openapi.work.go.kr/opi/opi/opia/wantedApi.do?{params}"
            try:
                req = urllib.request.Request(worknet_url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=10) as response:
                    raw = response.read().decode("utf-8")
                    wn_data = json.loads(raw)
                    jobs = wn_data.get("wantedRoot", {}).get("wanted", [])
                    result = []
                    for j in jobs:
                        result.append({
                            "title":    j.get("title", ""),
                            "company":  j.get("company", {}).get("companyName", ""),
                            "location": j.get("location", {}).get("region", ""),
                            "salary":   j.get("salary", {}).get("salaryName", ""),
                            "career":   j.get("career", {}).get("careerName", ""),
                            "education":j.get("education", {}).get("educationName", ""),
                            "url":      f"https://www.work.go.kr/empInfo/empInfoSrch/detail/wantedAuthDetail.do?wantedAuthNo={j.get('wantedAuthNo','')}",
                            "close_date": j.get("closeDate", ""),
                        })
                    self.wfile.write(json.dumps({"jobs": result, "keyword": keyword}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": f"고용24 API 호출 실패: {str(e)}"}, ensure_ascii=False).encode('utf-8'))

        elif path == "/api/saramin-jobs":
            # Fetch real jobs from Saramin Open API
            profile = query_db("SELECT saramin_api_key, keywords FROM profiles ORDER BY id DESC LIMIT 1", one=True)
            if not profile or not profile["saramin_api_key"]:
                self.wfile.write(json.dumps({"error": "사람인 API 키가 설정되지 않았습니다."}, ensure_ascii=False).encode('utf-8'))
                return

            api_key = profile["saramin_api_key"]
            keywords_raw = profile["keywords"] or "[]"
            try:
                kw_list = json.loads(keywords_raw)
                keyword = kw_list[0] if kw_list else ""
            except Exception:
                keyword = ""

            params = urllib.parse.urlencode({
                "access-key": api_key,
                "keywords": keyword,
                "count": 10,
                "fields": "job-title,company,salary,expiration-date,job-category,location-code",
            })
            saramin_url = f"https://oapi.saramin.co.kr/job-search?{params}"
            try:
                req = urllib.request.Request(saramin_url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=10) as response:
                    saramin_data = json.loads(response.read().decode("utf-8"))
                    jobs = saramin_data.get("jobs", {}).get("job", [])
                    self.wfile.write(json.dumps({"jobs": jobs, "count": len(jobs)}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({"error": f"사람인 API 호출 실패: {str(e)}"}, ensure_ascii=False).encode('utf-8'))

        elif path == "/api/reset":
            # Delete all profiles and sent_jobs to restart onboarding from scratch
            query_db("DELETE FROM sent_jobs")
            query_db("DELETE FROM profiles")
            self.wfile.write(json.dumps({"status": "reset_ok"}, ensure_ascii=False).encode('utf-8'))

        elif path == "/api/reset":
            # 이력서 정보만 초기화, API키/SMTP는 유지
            query_db("""
                UPDATE profiles SET
                    name=NULL, email=NULL, phone=NULL, skills=NULL,
                    experience=NULL, education=NULL, target_jobs=NULL,
                    polished_resume=NULL, keywords=NULL,
                    min_salary=0, max_distance=50, exclude_shift=0,
                    onboarding_step='ask_name'
                WHERE id=(SELECT max(id) FROM profiles)
            """)
            self.wfile.write(json.dumps({"status": "success"}, ensure_ascii=False).encode('utf-8'))

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"API endpoint not found")

# Initialize database on startup
init_db()

# Run HTTP Server
def run_server():
    # Allow port re-use
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving local job agent at http://localhost:{PORT}")
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()
