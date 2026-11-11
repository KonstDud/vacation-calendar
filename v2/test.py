import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "_project-dump.txt"

EXCLUDE_DIRS = {".git", "node_modules", "images", "vendor"}
EXCLUDE_EXTS = {
    ".ttf",
    ".woff",
    ".woff2",
    ".eot",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".svg",
    ".zip",
    ".pdf",
}
EXCLUDE_FILES = {"_project-dump.txt", "test.py", ".gitignore"}

collected = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

    for name in filenames:
        p = Path(dirpath) / name
        if p.suffix.lower() in EXCLUDE_EXTS:
            continue
        if p.name in EXCLUDE_FILES:
            continue
        collected.append(p)

collected.sort(key=lambda p: str(p).lower())

with open(OUT, "w", encoding="utf-8") as f:
    f.write("=== ИНСТРУКЦИЯ ДЛЯ НЕЙРОСЕТИ ===\n")
    f.write("1. Это проект 'График отпусков v2'.\n")
    f.write(
        "2. РАБОТАЕМ ТОЛЬКО В ПАПКЕ 'v2'. НЕ ТРОГАЕМ корень и папку '2027'.\n"
    )
    f.write(
        "3. Данные хранятся в Firebase (Firestore). Коллекция: vacationData_v2/{year}/users.\n"
    )
    f.write(
        "4. У нас есть общая авторизация через пароль (login.html). Ролей пока нет.\n"
    )
    f.write(
        "5. Архитектура: index.html (интерфейс), app.js (логика DOM), state.js (данные и onSnapshot), calendar.js (сетка), calendar-interactions.js (клики по дням).\n"
    )
    f.write(
        "6. Стили разделены на 01-base.css, 02-layout.css, 03-components.css, 04-calendar.css, 05-popup.css.\n"
    )
    f.write(
        "7. Не используем React/Vue, только чистый JS + lit-html для некоторых частей, и SortableJS.\n"
    )
    f.write(
        "8. Текущая задача: добавление групп сотрудников, фильтрация, производительность для 50+ человек.\n"
    )
    f.write("\n=== ПЛАН НА БУДУЩЕЕ (что мы обсуждали) ===\n")
    f.write(
        "1. Группы: добавить коллекцию 'groups' в Firebase. В левой панели сделать фильтр по группам (выпадающий список). В модалке управления группами (создать, переименовать, удалить, выбрать цвет) сделать переключатель 'Показывать на календаре' для всей группы.\n"
    )
    f.write(
        "2. Производительность: по умолчанию все карточки сотрудников свернуты (показывают только имя). Виртуализация списка или ленивая загрузка (IntersectionObserver) для 50+ человек.\n"
    )
    f.write(
        "3. Точки на календаре: если больше 3 отпускников в один день, показывать 3 точки и текст '+N'.\n"
    )
    f.write(
        "4. Роли (следующая задача): при входе спрашивать 'Кто вы?' и запоминать в sessionStorage. Админ видит все кнопки (удалить, добавить, сброс). Обычный сотрудник может редактировать только себя.\n"
    )
    f.write("\n=== ИСХОДНЫЙ КОД ===\n\n")

    for p in collected:
        rel = p.relative_to(ROOT)
        f.write("=" * 80 + "\n")
        f.write(f"FILE: {rel}\n")
        f.write("=" * 80 + "\n")
        try:
            content = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            try:
                content = p.read_text(encoding="utf-16")
            except Exception:
                f.write("<<не удалось прочитать файл>>\n")
                content = ""
        f.write(content)
        if not content.endswith("\n"):
            f.write("\n")
        f.write("\n")

print(f"Done: {OUT}")
print(f"Files collected: {len(collected)}")
