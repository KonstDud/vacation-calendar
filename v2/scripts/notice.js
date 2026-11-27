// scripts/notice.js — короткие всплывающие подсказки внизу экрана.
// Используется в app.js (правила перетаскивания) и при экспорте/импорте Excel.

let hintTimeout = null;

export function showNotice(text) {
    let node = document.getElementById('app-hint');
    if (!node) {
        node = document.createElement('div');
        node.id = 'app-hint';
        node.className = 'app-hint';
        document.body.appendChild(node);
    }

    node.textContent = text;
    node.classList.add('app-hint_visible');

    clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => node.classList.remove('app-hint_visible'), 2600);
}

// Долгая подсказка — для операций, которые не стоит пропустить (импорт, экспорт)
export function showNoticeLong(text) {
    showNotice(text);
    clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => {
        const node = document.getElementById('app-hint');
        if (node) node.classList.remove('app-hint_visible');
    }, 6000);
}
