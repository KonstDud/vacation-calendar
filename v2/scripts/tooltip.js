// scripts/tooltip.js — общая тёмная подсказка (вместо белых нативных title)

let tipNode = null;

function ensureTip() {
    if (!tipNode) {
        tipNode = document.createElement('div');
        tipNode.className = 'tip';
        document.body.appendChild(tipNode);
    }
    return tipNode;
}

export function showTip(target, text) {
    if (!text) {
        hideTip();
        return;
    }

    const node = ensureTip();
    node.textContent = text;
    node.classList.add('tip_visible');

    const rect = target.getBoundingClientRect();
    const width = node.offsetWidth;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));

    node.style.left = `${left}px`;
    node.style.top = `${rect.bottom + 6}px`;
}

export function hideTip() {
    if (tipNode) tipNode.classList.remove('tip_visible');
}

// Подсказка только когда текст реально обрезан — чтобы прочитать обрезанное значение
export function attachOverflowTip(element, getFullText, isTruncated) {
    element.addEventListener('mouseenter', () => {
        if (isTruncated && !isTruncated()) return;
        showTip(element, getFullText());
    });
    element.addEventListener('mouseleave', hideTip);
    element.addEventListener('mousedown', hideTip);
}

// Подсказка всегда (например, для карточки пользователя в шапке)
export function attachTip(element, getText) {
    element.addEventListener('mouseenter', () => showTip(element, getText()));
    element.addEventListener('mouseleave', hideTip);
}
