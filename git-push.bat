@echo off
cd /d C:\Users\MyDream\Documents\antigravity\jolly-hypatia
git config --global user.email "woobagwoo@gmail.com"
git config --global user.name "woobagwoo-cmd"
git init
git add .
git commit -m "first commit"
git remote remove origin 2>nul
git remote add origin https://github.com/woobagwoo-cmd/job-agent.git
git push -u origin master
pause
