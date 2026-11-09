// scripts/app.js — v2 (Без автосортировки, стабильная версия)

import { state, initState, stateEvents, setYear, getAvailableYears } from './state.js';
import { renderCalendar } from './calendar.js';
import { initCalendarInteractions } from './calendar-interactions.js';
import { html, render } from 'https://cdn.jsdelivr.net/npm/lit-html@3.1.2/lit-html.js';

let saveTimeout;

const getUserDoc = (year, userId) => window.firestore.doc(window.db, "vacationData_v2", String(year), "users", userId);
const getUsersCollection = (year) => window.firestore.collection(window.db, "vacationData_v2", String(year), "users");

const scheduleSave = (userId, userData) => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            const { id, ...dataToSave } = userData;
            await window.firestore.setDoc(getUserDoc(state.year, userId), dataToSave, { merge: true });
        } catch (e) {
            console.error('[app] Ошибка сохранения:', e);
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
const iconEye = html`
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
`;

const iconEyeOff = html`
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
`;

const iconWarning = html`
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
`;

// --- Lit-html Шаблоны ---

const vacationTemplate = (user, vac) => {
    const calDays = getCalendarDays(vac.startDate, vac.endDate);
    const workDays = getWorkingDays(vac.startDate, vac.endDate);

    const { isOverlap, isInvalid } = validateInternalOverlap(user, vac.id);
    const externalOverlaps = getExternalOverlaps(user, vac);

    const hasError = isOverlap || isInvalid;
    const crossTitle = externalOverlaps.map(o => o.name).join(', ');

    return html`
        <div class="form__vacation ${hasError ? 'form__vacation_overlap' : ''}">
            <div class="form__vacation-dates">
                <input type="date" class="form__date" .value=${vac.startDate} 
                    @change=${(e) => {
            vac.startDate = e.target.value;
            scheduleSave(user.id, user);
            updateCalendarVacations();
        }} 
                />
                <span class="form__date-sep">—</span>
                <input type="date" class="form__date" .value=${vac.endDate} 
                    @change=${(e) => {
            vac.endDate = e.target.value;
            scheduleSave(user.id, user);
            updateCalendarVacations();
        }} 
                />
            </div>
            <div class="form__vacation-info">
                <span>${calDays} кал. / ${workDays} раб.</span>
                <button type="button" class="btn_icon delete" title="Удалить отпуск"
                    @click=${() => {
            user.vacations = user.vacations.filter(v => v.id !== vac.id);
            scheduleSave(user.id, user);
            requestRender();
        }}>✕</button>
            </div>
            
            ${isInvalid ? html`
                <div class="form__vacation-alert">
                    ${iconWarning} Дата окончания раньше даты начала!
                </div>
            ` : ''}

            ${isOverlap ? html`
                <div class="form__vacation-alert">
                    ${iconWarning} Пересечение с другим отпуском этого сотрудника!
                </div>
            ` : ''}

            ${externalOverlaps.length > 0 ? html`
                <div class="form__vacation-cross-alert" title="Пересекается с: ${crossTitle}">
                    ${iconWarning} 
                    <span class="form__vacation-cross-text">
                        Пересекается с: 
                        ${externalOverlaps.map((o, i) => html`
                            <span class="form__vacation-cross-name" style="color: ${o.color}">
                                ${o.name}${i < externalOverlaps.length - 1 ? ', ' : ''}
                            </span>
                        `)}
                    </span>
                </div>
            ` : ''}
        </div>
    `;
};

const userTemplate = (user) => {
    const isVisible = user.isVisible !== false;
    const isHidden = user.isHidden === true;

    // Никакой сортировки — как есть
    const displayVacations = user.vacations || [];

    return html`
    <div class="form__user ${isHidden ? 'form__user_hidden' : ''}" id="${user.id}" style="${isHidden ? `border-left-color: ${user.color};` : ''}">
        <div class="form__user-header">
            <button type="button" class="btn_icon ${isVisible ? '' : 'hidden'}" title="${isVisible ? 'Скрыть с календаря' : 'Показать на календаре'}"
                @click=${() => { user.isVisible = !isVisible; scheduleSave(user.id, user); requestRender(); }}>
                ${isVisible ? iconEye : iconEyeOff}
            </button>

            <input type="color" class="form__color" .value=${user.color} 
                @input=${(e) => { user.color = e.target.value; scheduleSave(user.id, user); requestRender(); }} 
                style="${isHidden ? 'display: none;' : ''}"
            />
            
            <div class="form__username-wrapper">
                <h2 class="form__username" @click=${() => {
            if (!isHidden) {
                const newName = prompt('Введите новое имя:', user.name);
                if (newName) { user.name = newName; scheduleSave(user.id, user); requestRender(); }
            }
        }}>${user.name}</h2>
                
                ${!isHidden ? html`
                    <div class="form__username-tooltip">${user.name}</div>
                ` : ''}
            </div>
            
            <div class="form__user-actions">
                <button type="button" class="btn_icon" title="${isHidden ? 'Развернуть' : 'Свернуть'}"
                    @click=${() => { user.isHidden = !user.isHidden; scheduleSave(user.id, user); requestRender(); }}>
                    ${isHidden ? '▼' : '▲'}
                </button>
                
                <button type="button" class="btn_icon delete" title="Удалить"
                    @click=${() => {
            if (confirm(`Удалить ${user.name}?`)) {
                state.users = state.users.filter(u => u.id !== user.id);
                window.firestore.deleteDoc(getUserDoc(state.year, user.id)).catch(console.error);
                requestRender();
            }
        }}>✕</button>
            </div>
        </div>
        
        ${!isHidden ? html`
            <div class="form__vacations-list">
                ${displayVacations.map(vac => vacationTemplate(user, vac))}
                <button type="button" class="btn btn_small" 
                    @click=${() => {
                if (!user.vacations) user.vacations = [];
                user.vacations.push({ id: `vacationid_${Date.now()}`, startDate: `${state.year}-01-01`, endDate: `${state.year}-01-01` });
                scheduleSave(user.id, user);
                requestRender();
            }}>+ Добавить отпуск</button>
            </div>
        ` : ''}
    </div>
`};

const usersListTemplate = () => html`
    <div class="form">
        ${state.users.map(user => userTemplate(user))}
    </div>
`;

// --- Логика рендера ---

const usersContainer = document.getElementById('users-container');

function requestRender() {
    render(usersListTemplate(), usersContainer);
    updateCalendarVacations();
    initSortable();
}

function updateCalendarVacations() {
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
                dayData[i].push({ name: user.name, color: user.color });
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
            item.append(dot, name);
            tooltip.appendChild(item);
        });

        dayDiv.appendChild(tooltip);
    });
}

// --- Sortable (Drag and Drop) ---

let sortableInstance = null;

function initSortable() {
    const form = document.querySelector('.form');
    if (!form) return;

    if (sortableInstance) {
        sortableInstance.destroy();
    }

    sortableInstance = new Sortable(form, {
        animation: 150,
        handle: '.form__user-header',
        ghostClass: 'form__user-sortable-ghost',
        onEnd: async function (evt) {
            const newOrderIds = Array.from(form.children).map(el => el.id);
            const newUsers = [];
            newOrderIds.forEach(id => {
                const user = state.users.find(u => u.id === id);
                if (user) newUsers.push(user);
            });

            newUsers.forEach((user, index) => {
                if (user.order !== index) {
                    user.order = index;
                    const { id, ...dataToSave } = user;
                    window.firestore.setDoc(getUserDoc(state.year, user.id), { order: index }, { merge: true }).catch(console.error);
                }
            });

            state.users = newUsers;
            requestRender();
        }
    });
}

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

    state.users.push(newUser);
    requestRender();
    window.firestore.setDoc(newDocRef, newUser).catch(console.error);
});

document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('Точно удалить всех пользователей за этот год?')) return;
    for (const u of state.users) {
        await window.firestore.deleteDoc(getUserDoc(state.year, u.id));
    }
    state.users = [];
    requestRender();
});

document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('vacationAuth');
    window.location.href = 'login.html';
});

// --- Заполнение селекта годов ---
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

    yearSelect.addEventListener('change', async (e) => {
        const newYear = Number(e.target.value);
        if (newYear !== state.year) {
            await setYear(newYear);
            document.getElementById('calendar-container').innerHTML = '';
            renderCalendar(newYear);
            requestRender();
        }
    });
}

initCalendarInteractions();
initState();