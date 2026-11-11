// scripts/app.js — v2 (С подсветкой при наведении)

import { state, initState, stateEvents, setYear, getAvailableYears } from './state.js';
import { renderCalendar } from './calendar.js';
import { initCalendarInteractions } from './calendar-interactions.js';
import { html, render } from 'https://cdn.jsdelivr.net/npm/lit-html@3.1.2/lit-html.js';
import { repeat } from 'https://cdn.jsdelivr.net/npm/lit-html@3.1.2/directives/repeat.js';

const saveTimeouts = {};

const getUserDoc = (year, userId) => window.firestore.doc(window.db, "vacationData_v2", String(year), "users", userId);
const getUsersCollection = (year) => window.firestore.collection(window.db, "vacationData_v2", String(year), "users");

const scheduleSave = (userId, userData) => {
    state._localEditing = true;

    if (saveTimeouts[userId]) {
        clearTimeout(saveTimeouts[userId]);
    }

    saveTimeouts[userId] = setTimeout(async () => {
        try {
            const { id, ...dataToSave } = userData;
            await window.firestore.setDoc(getUserDoc(state.year, userId), dataToSave, { merge: true });
        } catch (e) {
            console.error('[app] Ошибка сохранения:', e);
        } finally {
            delete saveTimeouts[userId];
            if (Object.keys(saveTimeouts).length === 0) {
                state._localEditing = false;
                if (state._pendingRemote) {
                    state.users = state._pendingRemote;
                    state._pendingRemote = null;
                    requestRender();
                }
            }
        }
    }, 800);
};

// --- Утилиты ---
const getCalendarDays = (startStr, endStr) => {
    if (!startStr || !endStr) return 0;
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (end < start) return 0;
    return Math.floor((end - start) / (1000 * 3600 * 24)) + 1;
};

const getWorkingDays = (startStr, endStr) => {
    if (!startStr || !endStr) return 0;
    let count = 0;
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (end < start) return 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
    }
    return count;
};

const validateInternalOverlap = (user, currentVacId) => {
    const vacs = user.vacations || [];
    const target = vacs.find(v => v.id === currentVacId);
    if (!target) return { isOverlap: false, isInvalid: false };

    if (target.startDate && target.endDate && target.endDate < target.startDate) {
        return { isOverlap: false, isInvalid: true };
    }

    const isOverlap = vacs.some(v => {
        if (v.id === currentVacId) return false;
        if (!v.startDate || !v.endDate || !target.startDate || !target.endDate) return false;

        const vStart = parseInt(v.startDate.replace(/-/g, ''), 10);
        const vEnd = parseInt(v.endDate.replace(/-/g, ''), 10);
        const tStart = parseInt(target.startDate.replace(/-/g, ''), 10);
        const tEnd = parseInt(target.endDate.replace(/-/g, ''), 10);

        return tStart <= vEnd && vStart <= tEnd;
    });

    return { isOverlap, isInvalid: false };
};

const getExternalOverlaps = (currentUser, currentVac) => {
    if (!currentVac.startDate || !currentVac.endDate) return [];
    if (currentVac.endDate < currentVac.startDate) return [];

    const tStart = parseInt(currentVac.startDate.replace(/-/g, ''), 10);
    const tEnd = parseInt(currentVac.endDate.replace(/-/g, ''), 10);
    const overlaps = [];

    state.users.forEach(otherUser => {
        if (otherUser.id === currentUser.id) return;
        if (otherUser.isVisible === false) return;

        (otherUser.vacations || []).forEach(otherVac => {
            if (!otherVac.startDate || !otherVac.endDate) return;

            const oStart = parseInt(otherVac.startDate.replace(/-/g, ''), 10);
            const oEnd = parseInt(otherVac.endDate.replace(/-/g, ''), 10);

            if (tStart <= oEnd && oStart <= tEnd) {
                if (!overlaps.find(o => o.name === otherUser.name)) {
                    overlaps.push({ name: otherUser.name, color: otherUser.color });
                }
            }
        });
    });

    return overlaps;
};

const countDaysFromYearStart = (dateStr) => {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    const yearStart = new Date(state.year, 0, 1);
    return Math.floor((d - yearStart) / (1000 * 3600 * 24)) + 1;
};

// --- SVG Иконки ---
const getIconEye = () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const getIconEyeOff = () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const getIconWarning = () => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
const getIconDrag = () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="cursor: grab; opacity: 0.5;"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>`;

// --- Ручной рендер отпусков ---
function renderVacation(user, vac) {
    const calDays = getCalendarDays(vac.startDate, vac.endDate);
    const workDays = getWorkingDays(vac.startDate, vac.endDate);
    const { isOverlap, isInvalid } = validateInternalOverlap(user, vac.id);
    const externalOverlaps = getExternalOverlaps(user, vac);
    const hasError = isOverlap || isInvalid;
    const crossTitle = externalOverlaps.map(o => o.name).join(', ');

    const div = document.createElement('div');
    div.className = `form__vacation ${hasError ? 'form__vacation_overlap' : ''}`;
    div.dataset.id = vac.id;
    div.innerHTML = `
        <div class="form__vacation-dates">
            <div class="form__drag-handle" title="Перетащите, чтобы изменить порядок">${getIconDrag()}</div>
            <input type="date" class="form__date" value="${vac.startDate || ''}" />
            <span class="form__date-sep">—</span>
            <input type="date" class="form__date" value="${vac.endDate || ''}" />
        </div>
        <div class="form__vacation-info">
            <span>${calDays} кал. / ${workDays} раб.</span>
            <button type="button" class="btn_icon delete" title="Удалить отпуск">✕</button>
        </div>
        ${isInvalid ? `<div class="form__vacation-alert">${getIconWarning()} Дата окончания раньше даты начала!</div>` : ''}
        ${isOverlap ? `<div class="form__vacation-alert">${getIconWarning()} Пересечение с другим отпуском этого сотрудника!</div>` : ''}
        ${externalOverlaps.length > 0 ? `<div class="form__vacation-cross-alert" title="Пересекается с: ${crossTitle}">${getIconWarning()} <span class="form__vacation-cross-text">Пересекается с: ${externalOverlaps.map((o, i) => `<span class="form__vacation-cross-name" style="color: ${o.color}">${o.name}${i < externalOverlaps.length - 1 ? ', ' : ''}</span>`).join('')}</span></div>` : ''}
    `;

    const inputs = div.querySelectorAll('input[type="date"]');
    inputs[0].addEventListener('change', (e) => {
        vac.startDate = e.target.value;
        scheduleSave(user.id, user);
        updateCalendarVacations();
        renderUserCard(user);
    });
    inputs[1].addEventListener('change', (e) => {
        vac.endDate = e.target.value;
        scheduleSave(user.id, user);
        updateCalendarVacations();
        renderUserCard(user);
    });

    div.querySelector('.btn_icon.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        user.vacations = user.vacations.filter(v => v.id !== vac.id);
        scheduleSave(user.id, user);
        renderUserCard(user);
        updateCalendarVacations();
    });

    return div;
}

// --- Ручной рендер карточки ---
function renderUserCard(user) {
    const oldContainer = document.getElementById(`user-card-${user.id}`);
    if (!oldContainer) return;

    const isVisible = user.isVisible !== false;
    const isHidden = user.isHidden === true;
    const displayVacations = user.vacations || [];

    let totalCalDays = 0;
    let totalWorkDays = 0;
    displayVacations.forEach(vac => {
        if (vac.startDate && vac.endDate && vac.endDate >= vac.startDate) {
            totalCalDays += getCalendarDays(vac.startDate, vac.endDate);
            totalWorkDays += getWorkingDays(vac.startDate, vac.endDate);
        }
    });

    const wrapper = document.createElement('div');
    wrapper.className = `form__user ${isHidden ? 'form__user_hidden' : ''}`;
    wrapper.id = `user-card-${user.id}`;
    wrapper.style = isHidden ? `border-left-color: ${user.color};` : '';

    wrapper.innerHTML = `
        <div class="form__user-header">
            <div class="form__drag-handle-user" title="Перетащите, чтобы изменить порядок" style="cursor: grab; opacity: 0.5; margin-right: 8px;">${getIconDrag()}</div>
            <button type="button" class="btn_icon eye-btn ${isVisible ? '' : 'hidden'}" title="${isVisible ? 'Скрыть с календаря' : 'Показать на календаре'}">
                ${isVisible ? getIconEye() : getIconEyeOff()}
            </button>
            <input type="color" class="form__color" value="${user.color}" style="${isHidden ? 'display: none;' : ''}" />
            <div class="form__username-wrapper">
                <h2 class="form__username">${user.name}</h2>
                ${!isHidden ? `<div class="form__username-tooltip">${user.name}</div>` : ''}
            </div>
            <div class="form__user-actions">
                <button type="button" class="btn_icon toggle-btn" title="${isHidden ? 'Развернуть' : 'Свернуть'}">${isHidden ? '▼' : '▲'}</button>
                <button type="button" class="btn_icon delete-user-btn" title="Удалить">✕</button>
            </div>
        </div>
        ${!isHidden ? `
            <div class="form__vacations-list" id="vacations-list-${user.id}"></div>
            <button type="button" class="btn btn_small add-vac-btn">+ Добавить отпуск</button>
            ${displayVacations.length > 0 ? `
                <div class="form__user-totals">
                    <span>Итого календарных: <b>${totalCalDays}</b></span>
                    <span>Итого рабочих: <b>${totalWorkDays}</b></span>
                </div>
            ` : ''}
        ` : ''}
    `;

    oldContainer.replaceWith(wrapper);

    wrapper.querySelector('.eye-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        user.isVisible = !user.isVisible;
        scheduleSave(user.id, user);
        const eyeBtn = wrapper.querySelector('.eye-btn');
        eyeBtn.innerHTML = user.isVisible ? getIconEye() : getIconEyeOff();
        eyeBtn.classList.toggle('hidden', !user.isVisible);
        eyeBtn.title = user.isVisible ? 'Скрыть с календаря' : 'Показать на календаре';
        updateCalendarVacations();
    });

    wrapper.querySelector('.form__color').addEventListener('change', (e) => {
        e.stopPropagation();
        user.color = e.target.value;
        scheduleSave(user.id, user);
        renderUserCard(user);
    });

    wrapper.querySelector('.form__username').addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('Введите новое имя:', user.name);
        if (newName) { user.name = newName; scheduleSave(user.id, user); renderUserCard(user); }
    });

    wrapper.querySelector('.toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        user.isHidden = !user.isHidden;
        scheduleSave(user.id, user);
        renderUserCard(user);
    });

    wrapper.querySelector('.delete-user-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Удалить ${user.name}?`)) {
            state.users = state.users.filter(u => u.id !== user.id);
            window.firestore.deleteDoc(getUserDoc(state.year, user.id)).catch(console.error);
            requestRender();
        }
    });

    if (!isHidden) {
        const vacList = wrapper.querySelector('.form__vacations-list');
        displayVacations.forEach(vac => {
            vacList.appendChild(renderVacation(user, vac));
        });

        wrapper.querySelector('.add-vac-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!user.vacations) user.vacations = [];
            user.vacations.push({ id: `vacationid_${Date.now()}`, startDate: `${state.year}-01-01`, endDate: `${state.year}-01-01` });
            scheduleSave(user.id, user);
            renderUserCard(user);
        });

        new Sortable(vacList, {
            animation: 150,
            handle: '.form__drag-handle',
            ghostClass: 'form__vacation-sortable-ghost',
            onEnd: async function (evt) {
                if (evt.oldIndex === evt.newIndex) return;
                const vacs = [...user.vacations];
                const movedVac = vacs.splice(evt.oldIndex, 1)[0];
                vacs.splice(evt.newIndex, 0, movedVac);
                user.vacations = vacs;
                scheduleSave(user.id, user);
            }
        });
    }
}

// --- Логика рендера ---

const usersContainer = document.getElementById('users-container');

function requestRender() {
    usersContainer.replaceChildren();
    state.users.forEach(user => {
        const div = document.createElement('div');
        div.id = `user-card-${user.id}`;
        usersContainer.appendChild(div);
        renderUserCard(user);
    });
    updateCalendarVacations();
    initSortableUsers();
}

function updateCalendarVacations() {
    // Очищаем подсветку перед перерисовкой
    document.querySelectorAll('.calendar__day--highlighted, .calendar__day--to-delete').forEach(d => {
        d.classList.remove('calendar__day--highlighted', 'calendar__day--to-delete');
    });

    document.querySelectorAll('.calendar__span, .calendar__tooltip').forEach(el => el.remove());

    const dayData = {};

    state.users.forEach(user => {
        if (user.isVisible === false) return;

        (user.vacations || []).forEach(vac => {
            if (!vac.startDate || !vac.endDate) return;
            if (vac.endDate < vac.startDate) return;

            const startIndex = countDaysFromYearStart(vac.startDate);
            const endIndex = countDaysFromYearStart(vac.endDate);

            for (let i = startIndex; i <= endIndex; i++) {
                if (!dayData[i]) dayData[i] = [];
                dayData[i].push({ name: user.name, color: user.color, userId: user.id, vacId: vac.id, startIndex, endIndex });
            }
        });
    });

    Object.keys(dayData).forEach(dayIndexStr => {
        const dayIndex = Number(dayIndexStr);
        const dayDiv = document.getElementById(`dayid_${dayIndex}`);
        if (!dayDiv) return;

        dayData[dayIndex].forEach((person, idx) => {
            const span = document.createElement('span');
            span.classList.add('calendar__span');
            span.style.backgroundColor = person.color;
            span.style.left = `${20 + (idx % 4) * 20}%`;
            if (idx >= 4) span.style.bottom = '10px';
            dayDiv.appendChild(span);
        });

        const tooltip = document.createElement('div');
        tooltip.classList.add('calendar__tooltip');

        dayData[dayIndex].forEach(person => {
            const item = document.createElement('div');
            item.classList.add('calendar__tooltip-item');
            const dot = document.createElement('div');
            dot.classList.add('calendar__tooltip-dot');
            dot.style.backgroundColor = person.color;
            const name = document.createElement('span');
            name.textContent = person.name;
            const delBtn = document.createElement('button');
            delBtn.classList.add('calendar__tooltip-delete');
            delBtn.innerHTML = '✕';
            delBtn.title = 'Удалить отпуск';

            item.addEventListener('mouseenter', () => {
                for (let i = person.startIndex; i <= person.endIndex; i++) {
                    const d = document.getElementById(`dayid_${i}`);
                    if (d) d.classList.add('calendar__day--highlighted');
                }
            });
            item.addEventListener('mouseleave', () => {
                document.querySelectorAll('.calendar__day--highlighted').forEach(d => d.classList.remove('calendar__day--highlighted'));
            });

            delBtn.addEventListener('mouseenter', () => {
                for (let i = person.startIndex; i <= person.endIndex; i++) {
                    const d = document.getElementById(`dayid_${i}`);
                    if (d) d.classList.add('calendar__day--to-delete');
                }
            });
            delBtn.addEventListener('mouseleave', () => {
                document.querySelectorAll('.calendar__day--to-delete').forEach(d => d.classList.remove('calendar__day--to-delete'));
            });

            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                // Принудительно убираем подсветку перед удалением
                document.querySelectorAll('.calendar__day--highlighted, .calendar__day--to-delete').forEach(d => {
                    d.classList.remove('calendar__day--highlighted', 'calendar__day--to-delete');
                });

                const u = state.users.find(u => u.id === person.userId);
                if (!u) return;
                u.vacations = u.vacations.filter(v => v.id !== person.vacId);
                scheduleSave(u.id, u);
                updateCalendarVacations();
                const card = document.getElementById(`user-card-${u.id}`);
                if (card) renderUserCard(u);
            });

            item.append(dot, name, delBtn);
            tooltip.appendChild(item);
        });

        dayDiv.appendChild(tooltip);
    });
}

// --- Sortable для сотрудников ---

let sortableUsersInstance = null;

function initSortableUsers() {
    if (sortableUsersInstance) {
        sortableUsersInstance.destroy();
    }

    sortableUsersInstance = new Sortable(usersContainer, {
        animation: 150,
        handle: '.form__drag-handle-user',
        ghostClass: 'form__user-sortable-ghost',
        onEnd: async function (evt) {
            if (evt.oldIndex === evt.newIndex) return;

            const newOrderIds = Array.from(usersContainer.children).map(el => el.id.replace('user-card-', ''));
            const newUsers = [];
            newOrderIds.forEach(id => {
                const user = state.users.find(u => u.id === id);
                if (user) newUsers.push(user);
            });

            state.users = [...newUsers];

            newUsers.forEach((user, index) => {
                if (user.order !== index) {
                    user.order = index;
                    window.firestore.setDoc(getUserDoc(state.year, user.id), { order: index }, { merge: true }).catch(console.error);
                }
            });

            requestRender();
        }
    });
}

// --- Безопасный сброс ---
let resetConfirmMode = false;
let resetTimeout = null;

const resetBtn = document.getElementById('btn-reset');
const originalResetText = resetBtn.textContent;

resetBtn.addEventListener('click', async () => {
    if (!resetConfirmMode) {
        resetConfirmMode = true;
        resetBtn.textContent = 'Вы уверены? Нажмите еще раз';
        resetBtn.classList.add('danger-active');

        clearTimeout(resetTimeout);
        resetTimeout = setTimeout(() => {
            resetConfirmMode = false;
            resetBtn.textContent = originalResetText;
            resetBtn.classList.remove('danger-active');
        }, 5000);
        return;
    }

    clearTimeout(resetTimeout);
    resetConfirmMode = false;
    resetBtn.textContent = originalResetText;
    resetBtn.classList.remove('danger-active');

    for (const u of state.users) {
        await window.firestore.deleteDoc(getUserDoc(state.year, u.id));
    }
    state.users = [];
    requestRender();
});

// --- Инициализация ---

stateEvents.addEventListener('statechange', () => {
    document.getElementById('header-title').textContent = `График отпусков`;
    document.getElementById('header-year').textContent = state.year;

    const yearSelect = document.getElementById('year-select');
    if (yearSelect) yearSelect.value = state.year;

    if (!document.querySelector('.calendar__month')) {
        renderCalendar(state.year);
    }
    requestRender();
});

window.addEventListener('calendarReady', () => updateCalendarVacations());

document.getElementById('btn-add-user').addEventListener('click', () => {
    const colRef = getUsersCollection(state.year);
    const newDocRef = window.firestore.doc(colRef);

    const newUser = {
        id: newDocRef.id,
        name: 'Новый сотрудник',
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        vacations: [],
        order: Date.now(),
        isHidden: false,
        isVisible: true
    };

    state.users = [...state.users, newUser];
    requestRender();
    window.firestore.setDoc(newDocRef, newUser).catch(console.error);
});

document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('vacationAuth');
    window.location.href = 'login.html';
});

const yearSelect = document.getElementById('year-select');
if (yearSelect) {
    const years = getAvailableYears();
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    });

    yearSelect.value = state.year;

    yearSelect.addEventListener('change', (e) => {
        const newYear = Number(e.target.value);
        if (newYear !== state.year) {
            const url = new URL(window.location.href);
            url.searchParams.set('year', String(newYear));
            window.location.href = url.toString();
        }
    });
}

initCalendarInteractions();
initState();