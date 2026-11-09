import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_project-dump.txt"

# Оставляем только эти папки и файлы
INCLUDE_DIRS = {"scripts"}
INCLUDE_EXTS = {".html", ".css", ".js"}

collected = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    # Пропускаем папки, которые нам не нужны
    if Path(dirpath) != ROOT and Path(dirpath).name not in INCLUDE_DIRS:
        continue
        
    for name in filenames:
        p = Path(dirpath) / name
        if p.name == "_project-dump.txt" or p.name == "test.py":
            continue
        if p.suffix.lower() not in INCLUDE_EXTS:
            continue
            
        # Если файл в корне, но это не index.html/login.html и не style.css - пропускаем
        if Path(dirpath) == ROOT and p.name not in ["index.html", "login.html", "style.css"]:
            continue

        collected.append(p)

collected.sort(key=lambda p: str(p).lower())

with open(OUT, "w", encoding="utf-8") as f:
    for p in collected:
        rel = p.relative_to(ROOT)
        f.write("=" * 80 + "\n")
        f.write(f"FILE: {rel}\n")
        f.write("=" * 80 + "\n")
        try:
            content = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            f.write("<<не удалось прочитать как UTF-8>>\n")
            content = ""
        f.write(content)
        if not content.endswith("\n"):
            f.write("\n")
        f.write("\n")

print(f"Done: {OUT}")
print(f"Files collected: {len(collected)}")