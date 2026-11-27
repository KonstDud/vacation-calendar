// scripts/user-combobox.js — переиспользуемый выбор сотрудника: поиск, группы, клавиатура

export const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Группирует сотрудников по группам (в порядке групп, пустые группы пропускаем).
// query — фильтр по имени, selectedId — выбранный сотрудник (его не скрываем даже при фильтре).
export function buildUserGroups(users, groups, query = '', selectedId = '') {
    const UNGROUPED_ID = 'ungrouped';
    const normalized = String(query || '').trim().toLowerCase();
    const isMatch = (user) => !normalized
        || String(user.name || '').toLowerCase().includes(normalized)
        || user.id === selectedId;

    const sortedGroups = [...(groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const knownIds = new Set(sortedGroups.map(g => g.id));

    const byGroup = new Map();
    (users || []).forEach(user => {
        if (!isMatch(user)) return;
        const groupId = (user.groupId && knownIds.has(user.groupId)) ? user.groupId : UNGROUPED_ID;
        if (!byGroup.has(groupId)) byGroup.set(groupId, []);
        byGroup.get(groupId).push(user);
    });

    const result = [];
    sortedGroups.forEach(group => {
        const inGroup = byGroup.get(group.id) || [];
        if (inGroup.length > 0) result.push({ label: group.name, users: inGroup });
    });

    // Сотрудники без группы (в т.ч. если документа 'ungrouped' ещё нет в базе)
    if (!knownIds.has(UNGROUPED_ID)) {
        const rest = byGroup.get(UNGROUPED_ID) || [];
        if (rest.length > 0) result.push({ label: 'Без группы', users: rest });
    }

    return result;
}

// HTML выпадающего списка: заголовки групп + кликабельные строки сотрудников
export function buildUsersListHtml(grouped, activeIndex) {
    let flatIndex = -1;

    const html = grouped.map(group => {
        const options = group.users.map(user => {
            flatIndex += 1;
            const active = flatIndex === activeIndex ? ' userselect__option_active' : '';
            const color = escapeHtml(user.color || '#888888');
            return `<div class="userselect__option${active}" role="option" data-id="${escapeHtml(user.id)}">
                <span class="userselect__dot" style="background:${color}"></span>${escapeHtml(user.name)}
            </div>`;
        }).join('');

        return `<div class="userselect__group">${escapeHtml(group.label)}</div>${options}`;
    }).join('');

    return html || '<div class="userselect__empty">Ничего не найдено</div>';
}

/**
 * Комбобокс выбора сотрудника.
 * @param {HTMLElement} root — контейнер с .userselect__input / .userselect__list / .userselect__clear
 * @param {object} options
 * @param {Function} options.getUsers  — () => массив сотрудников {id, name, color, groupId}
 * @param {Function} options.getGroups — () => массив групп {id, name, order}
 * @param {Function} [options.onSelect] — вызывается при выборе/сбросе (user | null)
 */
export function setupUserCombobox(root, { getUsers, getGroups, onSelect } = {}) {
    const input = root.querySelector('.userselect__input');
    const list = root.querySelector('.userselect__list');
    const clearBtn = root.querySelector('.userselect__clear');

    if (!input || !list || !clearBtn) {
        return {
            getSelectedId: () => '',
            getSelectedUser: () => null,
            getTypedValue: () => '',
            clear: () => { },
            destroy: () => { }
        };
    }

    const users = () => (getUsers ? getUsers() : []) || [];
    const groups = () => (getGroups ? getGroups() : []) || [];

    let selectedId = '';
    let grouped = [];
    let flatUsers = [];
    let activeIndex = -1;

    const isOpen = () => list.classList.contains('userselect__list_opened');

    const renderList = () => {
        list.innerHTML = buildUsersListHtml(grouped, activeIndex);
        const active = list.querySelector('.userselect__option_active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    };

    const openList = (resetActive) => {
        grouped = buildUserGroups(users(), groups(), input.value, selectedId);
        flatUsers = grouped.flatMap(group => group.users);
        if (resetActive) activeIndex = -1;
        if (activeIndex > flatUsers.length - 1) activeIndex = flatUsers.length - 1;
        renderList();
        list.classList.add('userselect__list_opened');
    };

    const closeList = () => {
        list.classList.remove('userselect__list_opened');
        activeIndex = -1;
    };

    const setSelected = (user, silent) => {
        selectedId = user ? user.id : '';
        input.value = user ? user.name : '';
        clearBtn.classList.toggle('userselect__clear_visible', !!selectedId || input.value.length > 0);
        closeList();
        if (!silent && onSelect) onSelect(user || null);
    };

    // Список открываем по клику (mousedown), а не по фокусу: иначе он
    // раскрывается сам, когда поле получает фокус программно
    input.addEventListener('mousedown', () => openList(false));

    input.addEventListener('input', () => {
        selectedId = '';
        clearBtn.classList.toggle('userselect__clear_visible', input.value.length > 0);
        openList(true);
        if (onSelect) onSelect(null);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen()) openList(true);
            activeIndex = Math.min(activeIndex + 1, flatUsers.length - 1);
            renderList();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            renderList();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const user = flatUsers[activeIndex] || flatUsers[0];
            if (user) setSelected(user);
        } else if (e.key === 'Escape') {
            closeList();
        }
    });

    // mousedown, а не click: поле ввода не теряет фокус до обработки выбора
    list.addEventListener('mousedown', (e) => {
        const option = e.target.closest('.userselect__option[data-id]');
        if (!option) return;
        e.preventDefault();
        const user = users().find(u => u.id === option.dataset.id);
        if (user) setSelected(user);
    });

    clearBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        setSelected(null);
        input.focus();
    });

    const onDocumentMouseDown = (e) => {
        if (!root.contains(e.target)) closeList();
    };
    document.addEventListener('mousedown', onDocumentMouseDown);

    return {
        getSelectedId: () => selectedId,
        getSelectedUser: () => users().find(u => u.id === selectedId) || null,
        getTypedValue: () => input.value,
        select: (user) => setSelected(user),
        clear: () => setSelected(null, true),
        destroy: () => document.removeEventListener('mousedown', onDocumentMouseDown)
    };
}
