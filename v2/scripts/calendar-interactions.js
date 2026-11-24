// scripts/calendar-interactions.js

import { state, stateEvents } from './state.js';

let selectionStart = null;

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Группирует сотрудников по группам для выпадающего списка.
// query — фильтр по имени, selectedId — выбранный сотрудник (его не скрываем даже при фильтре).
function buildUserGroups(query = '', selectedId = '') {
    const UNGROUPED_ID = 'ungrouped';
    const normalized = String(query || '').trim().toLowerCase();
    const isMatch = (user) => !normalized
        || String(user.name || '').toLowerCase().includes(normalized)
        || user.id === selectedId;

    const groups = [...state.groups].sort((a, b) => (a.order || 0) - (b.order || 0));
    const knownIds = new Set(groups.map(g => g.id));

    const byGroup = new Map();
    state.users.forEach(user => {
        if (!isMatch(user)) return;
        const groupId = (user.groupId && knownIds.has(user.groupId)) ? user.groupId : UNGROUPED_ID;
        if (!byGroup.has(groupId)) byGroup.set(groupId, []);
        byGroup.get(groupId).push(user);
    });

    const result = [];
    groups.forEach(group => {
        const users = byGroup.get(group.id) || [];
        if (users.length > 0) result.push({ label: group.name, users });
    });

    // Сотрудники без группы (в т.ч. если документа 'ungrouped' ещё нет в базе)
    if (!knownIds.has(UNGROUPED_ID)) {
        const rest = byGroup.get(UNGROUPED_ID) || [];
        if (rest.length > 0) result.push({ label: 'Без группы', users: rest });
    }

    return result;
}

// HTML выпадающего списка: заголовки групп + кликабельные строки сотрудников
function buildUsersListHtml(groups, activeIndex) {
    let flatIndex = -1;

    const html = groups.map(group => {
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

// Комбобокс выбора сотрудника: поиск по имени, группировка, мышь и клавиатура
function setupUserCombobox(root) {
    const input = root.querySelector('#popup-user-input');
    const list = root.querySelector('#popup-user-list');
    const clearBtn = root.querySelector('#popup-user-clear');

    let selectedId = '';
    let groups = [];
    let flatUsers = [];
    let activeIndex = -1;

    const isOpen = () => list.classList.contains('userselect__list_opened');

    const renderList = () => {
        list.innerHTML = buildUsersListHtml(groups, activeIndex);
        const active = list.querySelector('.userselect__option_active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    };

    const openList = (resetActive) => {
        groups = buildUserGroups(input.value, selectedId);
        flatUsers = groups.flatMap(group => group.users);
        if (resetActive) activeIndex = -1;
        if (activeIndex > flatUsers.length - 1) activeIndex = flatUsers.length - 1;
        renderList();
        list.classList.add('userselect__list_opened');
    };

    const closeList = () => {
        list.classList.remove('userselect__list_opened');
        activeIndex = -1;
    };

    const selectUser = (user) => {
        selectedId = user.id;
        input.value = user.name;
        clearBtn.classList.add('userselect__clear_visible');
        closeList();
        input.blur();
    };

    input.addEventListener('focus', () => openList(false));

    input.addEventListener('input', () => {
        selectedId = '';
        clearBtn.classList.toggle('userselect__clear_visible', input.value.length > 0);
        openList(true);
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
            if (user) selectUser(user);
        } else if (e.key === 'Escape') {
            closeList();
        }
    });

    // mousedown, а не click: поле ввода не теряет фокус до обработки выбора
    list.addEventListener('mousedown', (e) => {
        const option = e.target.closest('.userselect__option[data-id]');
        if (!option) return;
        e.preventDefault();
        const user = state.users.find(u => u.id === option.dataset.id);
        if (user) selectUser(user);
    });

    clearBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectedId = '';
        input.value = '';
        clearBtn.classList.remove('userselect__clear_visible');
        input.focus();
    });

    const onDocumentMouseDown = (e) => {
        if (!root.contains(e.target)) closeList();
    };
    document.addEventListener('mousedown', onDocumentMouseDown);

    return {
        getSelectedId: () => selectedId,
        getTypedValue: () => input.value,
        destroy: () => document.removeEventListener('mousedown', onDocumentMouseDown)
    };
}

export function initCalendarInteractions() {
    const calendarContainer = document.getElementById('calendar-container');
    if (!calendarContainer) return;

    calendarContainer.addEventListener('click', (e) => {
        const dayDiv = e.target.closest('.calendar__day[id^="dayid"]');
        if (!dayDiv) return;

        const dayIndex = parseInt(dayDiv.id.replace('dayid_', ''), 10);
        if (!dayIndex) return;

        if (selectionStart === null) {
            selectionStart = dayIndex;
            highlightRange(selectionStart, selectionStart);
            return;
        }

        let start = Math.min(selectionStart, dayIndex);
        let end = Math.max(selectionStart, dayIndex);

        highlightRange(start, end);

        const yearStart = new Date(state.year, 0, 1);

        const sDate = new Date(yearStart);
        sDate.setDate(sDate.getDate() + start - 1);
        const sStr = `${sDate.getFullYear()}-${String(sDate.getMonth() + 1).padStart(2, '0')}-${String(sDate.getDate()).padStart(2, '0')}`;

        const eDate = new Date(yearStart);
        eDate.setDate(eDate.getDate() + end - 1);
        const eStr = `${eDate.getFullYear()}-${String(eDate.getMonth() + 1).padStart(2, '0')}-${String(eDate.getDate()).padStart(2, '0')}`;

        openCreateVacationPopup(sStr, eStr, start, end);
        selectionStart = null;
    });
}

function highlightRange(startIndex, endIndex) {
    document.querySelectorAll('.calendar__day.selected').forEach(el => el.classList.remove('selected'));
    for (let i = startIndex; i <= endIndex; i++) {
        const dayDiv = document.getElementById(`dayid_${i}`);
        if (dayDiv) dayDiv.classList.add('selected');
    }
}

function clearSelection() {
    document.querySelectorAll('.calendar__day.selected').forEach(el => el.classList.remove('selected'));
    selectionStart = null;
}

// Функция для поиска отпусков в выбранном диапазоне
function getVacationsInRange(startIdx, endIdx) {
    const result = [];
    state.users.forEach(user => {
        (user.vacations || []).forEach(vac => {
            if (!vac.startDate || !vac.endDate) return;
            const dStart = new Date(vac.startDate);
            const dEnd = new Date(vac.endDate);
            const yearStart = new Date(state.year, 0, 1);
            const vStart = Math.floor((dStart - yearStart) / (1000 * 3600 * 24)) + 1;
            const vEnd = Math.floor((dEnd - yearStart) / (1000 * 3600 * 24)) + 1;

            if (startIdx <= vEnd && endIdx >= vStart) {
                result.push({ user, vac });
            }
        });
    });
    return result;
}

function openCreateVacationPopup(startStr, endStr, startIdx, endIdx) {
    const popup = document.querySelector('.popup');
    const popupTitle = popup.querySelector('.popup__title');
    const popupContent = popup.querySelector('.popup__content');

    const totalDays = endIdx - startIdx + 1;
    const displayStart = startStr.split('-').reverse().join('.');
    const displayEnd = endStr.split('-').reverse().join('.');

    const existingVacations = getVacationsInRange(startIdx, endIdx);

    popupTitle.textContent = `Период: ${displayStart} — ${displayEnd} (${totalDays} дн.)`;

    let existingHTML = '';
    if (existingVacations.length > 0) {
        existingHTML = `
            <div class="popup__existing-vacations">
                <div class="popup__existing-title">Уже в отпуске:</div>
                ${existingVacations.map(({ user, vac }) => {
            // Форматируем даты отпуска для отображения
            const vacStart = new Date(vac.startDate);
            const vacEnd = new Date(vac.endDate);
            const startStrShort = `${String(vacStart.getDate()).padStart(2, '0')}.${String(vacStart.getMonth() + 1).padStart(2, '0')}`;
            const endStrShort = `${String(vacEnd.getDate()).padStart(2, '0')}.${String(vacEnd.getMonth() + 1).padStart(2, '0')}`;
            return `
                        <div class="popup__existing-item" data-vac-id="${vac.id}" data-user-id="${user.id}">
                            <div class="popup__existing-dot" style="background: ${user.color};"></div>
                            <span class="popup__existing-name">${user.name} <span class="popup__existing-dates">(${startStrShort} – ${endStrShort})</span></span>
                            <button type="button" class="popup__existing-delete" title="Удалить этот отпуск">✕</button>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    popupContent.innerHTML = `
        ${existingHTML}
        
        <div class="popup__add-form">
            <div class="popup__add-title">${existingVacations.length > 0 ? 'Добавить еще один отпуск' : 'Оформить отпуск'}</div>
            <label style="font-size: 13px; color: var(--text-muted);">Выберите сотрудника</label>
            <div class="userselect">
                <input type="text" class="userselect__input" id="popup-user-input" placeholder="Начните вводить имя..." autocomplete="off" />
                <button type="button" class="userselect__clear" id="popup-user-clear" title="Очистить">✕</button>
                <div class="userselect__list" id="popup-user-list"></div>
            </div>
            <div id="popup-error" style="color: var(--accent-red); font-size: 12px; display: none;"></div>

            <button id="popup-save-btn" class="btn btn_add" style="margin-top: 8px;">Добавить отпуск</button>
        </div>
    `;

    // Комбобокс выбора сотрудника (нужен closePopup для снятия слушателей)
    const combo = setupUserCombobox(popupContent);

    popup.classList.add('popup_opened');

    const closePopup = () => {
        popup.classList.remove('popup_opened');
        clearSelection();
        popup.removeEventListener('mousedown', onMouseDown);
        combo.destroy();
    };

    const onMouseDown = (e) => {
        if (e.target.classList.contains('popup_opened') || e.target.classList.contains('popup__close-button')) {
            closePopup();
        }
    };
    popup.addEventListener('mousedown', onMouseDown);

    popupContent.querySelectorAll('.popup__existing-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const item = e.target.closest('.popup__existing-item');
            const vacId = item.dataset.vacId;
            const userId = item.dataset.userId;
            const user = state.users.find(u => u.id === userId);
            if (!user) return;

            user.vacations = user.vacations.filter(v => v.id !== vacId);

            try {
                const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", userId);
                const { id, ...dataToSave } = user;
                await window.firestore.setDoc(docRef, dataToSave, { merge: true });
                stateEvents.dispatchEvent(new Event('statechange'));
                item.remove();
            } catch (error) {
                console.error('Ошибка удаления:', error);
            }
        });
    });

    const saveBtn = document.getElementById('popup-save-btn');
    saveBtn.onclick = async () => {
        const errorDiv = document.getElementById('popup-error');
        errorDiv.style.display = 'none';

        // Сотрудник должен быть выбран из списка; если введено точное имя — принимаем его
        let userId = combo.getSelectedId();
        if (!userId) {
            const typed = combo.getTypedValue().trim().toLowerCase();
            const exact = typed ? state.users.filter(u => String(u.name).toLowerCase() === typed) : [];
            if (exact.length === 1) userId = exact[0].id;
        }

        if (!userId) {
            errorDiv.textContent = 'Выберите сотрудника из списка';
            errorDiv.style.display = 'block';
            return;
        }

        const user = state.users.find(u => u.id === userId);
        if (!user) return;

        let userOverlap = false;
        (user.vacations || []).forEach(vac => {
            if (!vac.startDate || !vac.endDate) return;
            const dStart = new Date(vac.startDate);
            const dEnd = new Date(vac.endDate);
            const yearStart = new Date(state.year, 0, 1);
            const vStart = Math.floor((dStart - yearStart) / (1000 * 3600 * 24)) + 1;
            const vEnd = Math.floor((dEnd - yearStart) / (1000 * 3600 * 24)) + 1;
            if (startIdx <= vEnd && endIdx >= vStart) userOverlap = true;
        });

        if (userOverlap) {
            errorDiv.textContent = `У сотрудника ${user.name} уже есть отпуск в этот период.`;
            errorDiv.style.display = 'block';
            return;
        }

        if (!user.vacations) user.vacations = [];
        user.vacations.push({
            id: `vacationid_${Date.now()}`,
            startDate: startStr,
            endDate: endStr
        });

        try {
            const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", userId);
            const { id, ...dataToSave } = user;
            await window.firestore.setDoc(docRef, dataToSave, { merge: true });

            closePopup();
            stateEvents.dispatchEvent(new Event('statechange'));

        } catch (error) {
            console.error('Ошибка сохранения:', error);
            errorDiv.textContent = 'Ошибка при сохранении в базу данных.';
            errorDiv.style.display = 'block';
        }
    };
}