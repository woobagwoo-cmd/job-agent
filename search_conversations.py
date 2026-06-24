import sqlite3
import re
import glob

for db_path in glob.glob(r"C:\Users\MyDream\.gemini\antigravity\conversations\*.db"):
    print(f"\nSearching in {db_path}...")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("SELECT idx, step_payload FROM steps ORDER BY idx ASC")
    for idx, payload in cur.fetchall():
        if not payload:
            continue
        text = payload.decode('utf-8', errors='ignore')
        
        app_pw_spaced = re.findall(r'\b[a-z]{4}\s[a-z]{4}\s[a-z]{4}\s[a-z]{4}\b', text)
        app_pw_joined = re.findall(r'\b[a-z]{16}\b', text)
        
        if app_pw_spaced:
            print(f"--- Step {idx} (spaced match): {app_pw_spaced}")
        if app_pw_joined:
            # filter out common words like programmatically
            filtered_joined = [w for w in app_pw_joined if w != "programmatically"]
            if filtered_joined:
                print(f"--- Step {idx} (joined match): {filtered_joined}")
            
        if "smtp_pass" in text or "smtp.gmail.com" in text:
            matches = re.findall(r'"smtp_pass"\s*:\s*"([^"]+)"', text)
            if matches:
                print(f"--- Step {idx} smtp_pass: {matches}")
            matches_user = re.findall(r'"smtp_user"\s*:\s*"([^"]+)"', text)
            if matches_user:
                print(f"--- Step {idx} smtp_user: {matches_user}")

    conn.close()
