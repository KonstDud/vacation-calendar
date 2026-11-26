// scripts/combo.js — тёмный выпадающий список для полей профиля:
// выбор из справочника, поиск по вводу и пункт «добавить своё».

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * @param {object} options
 * @param {string[]} options.options — значения справочника
 * @param {string} [options.value] — текущее значение
 * @param {string} [options.placeholder]
 * @param {boolean} [options.allowCustom] — показывать «добавить в словарь»
 * @param {Function} [options.onAddCustom] — async (value) => новый список значений
 * @param {Function} [options.onChange] — вызывается при изменении значения
 */
export function createCombo({ options = [], value = '', placeholder = '', allowCustom = false, onAddCustom, onChange } = {}) {
    const root = document.createElement('div');
    root.className = 'combo';
    root.innerHTML = `
        <input type="text" class="combo__input" placeholder="${escapeHtml(placeholder)}" autocomplete="off" value="${escapeHtml(value)}">
        <button type="button" class="combo__clear" title="Очистить">✕</button>
        <div class="combo__list" hidden></div>
    `;

    const input = root.querySelector('.combo__input');
    const clearBtn = root.querySelector('.combo__clear');
    const list = root.querySelector('.combo__list');

    let items = [...options];
    let current = value;
    let activeIndex = -1;

    const isOpen = () => !list.hidden;

    const commit = (next, notify) => {
        current = next;
        input.value = next;
        clearBtn.hidden = !next;
        if (notify && onChange) onChange(next);
    };

    commit(value, false);

    const renderList = () => {
        const query = input.value.trim().toLowerCase();
        const filtered = items.filter(item => !query || item.toLowerCase().includes(query));
        const hasExact = filtered.some(item => item.toLowerCase() === query);

        let html = filtered
            .map((item, index) => `<div class="combo__option${index === activeIndex ? ' combo__option_active' : ''}" data-value="${escapeHtml(item)}">${escapeHtml(item)}</div>`)
            .join('');

        if (allowCustom && input.value.trim() && !hasExact) {
            html = `<div class="combo__option combo__option_add" data-add="1">+ Добавить в справочник: «${escapeHtml(input.value.trim())}»</div>${html}`;
        }

        list.innerHTML = html || '<div class="combo__empty">Ничего не найдено</div>';
        list.hidden = false;
    };

    const closeList = () => {
        list.hidden = true;
        activeIndex = -1;
    };

    const optionElements = () => [...list.querySelectorAll('.combo__option[data-value]')];

    input.addEventListener('focus', () => {
        // пустой список не открываем — иначе показывается «ничего не найдено»
        if (items.length > 0) renderList();
    });

    input.addEventListener('input', () => {
        commit(input.value, true);
        renderList();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen()) renderList();
            activeIndex = Math.min(activeIndex + 1, optionElements().length - 1);
            renderList();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            renderList();
        } else if (e.key === 'Enter') {
            const options = optionElements();
            const pick = options[activeIndex] || options[0];
            if (pick) {
                e.preventDefault();
                commit(pick.dataset.value, true);
                closeList();
            }
        } else if (e.key === 'Escape') {
            closeList();
        }
    });

    list.addEventListener('mousedown', async (e) => {
        const addRow = e.target.closest('.combo__option_add');
        const option = e.target.closest('.combo__option[data-value]');
        if (!addRow && !option) return;

        e.preventDefault();

        if (addRow) {
            const typed = input.value.trim();
            if (onAddCustom) {
                const next = await onAddCustom(typed);
                if (Array.isArray(next)) items = [...next];
            }
            commit(typed, true);
            closeList();
            return;
        }

        commit(option.dataset.value, true);
        closeList();
    });

    clearBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        commit('', true);
        input.focus();
    });

    const onDocumentMouseDown = (e) => {
        if (!root.contains(e.target)) closeList();
    };
    document.addEventListener('mousedown', onDocumentMouseDown);

    return {
        element: root,
        getValue: () => current,
        setValue: (next) => commit(next || '', false),
        setOptions: (next) => { items = [...next]; },
        setDisabled: (disabled) => {
            input.disabled = disabled;
            clearBtn.hidden = disabled || !current;
        },
        destroy: () => document.removeEventListener('mousedown', onDocumentMouseDown)
    };
}
