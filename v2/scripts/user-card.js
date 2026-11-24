// scripts/user-card.js
import { state, discardPendingRemote } from './state.js';
import { getCalendarDays, getWorkingDays, validateInternalOverlap, getExternalOverlaps, getIconEye, getIconEyeOff, getIconWarning, getIconDrag } from './utils.js';
import { highlightUserVacations, clearUserVacationHighlight } from './calendar-grid.js';

// Нормы ТК РФ: 28 календарных дней отпуска в году, одна из частей — не менее 14
const ANNUAL_LEAVE_DAYS = 28;
const MIN_LEAVE_PART = 14;

export const getUserDoc = (year, userId) => window.firestore.doc(window.db, "vacationData_v2", String(year), "users", userId);

const SAVE_DEBOUNCE_MS = 800;
const saveTimeouts = {};    // userId -> id таймера (есть отложенная запись)
const pendingData = {};     // userId -> объект пользователя с несохранёнными правками
const inFlight = new Set(); // userId, для которых запись уже выполняется

const isSavingIdle = () => Object.keys(saveTimeouts).length === 0 && inFlight.size === 0;

const writeUser = async (userId) => {
    const userData = pendingData[userId];
    delete pendingData[userId];
    if (!userData) return;

    const { id, ...dataToSave } = userData;
    inFlight.add(userId);
    try {
        await window.firestore.setDoc(getUserDoc(state.year, userId), dataToSave, { merge: true });
    } catch (e) {
        console.error('[user-card] Ошибка сохранения:', e);
    } finally {
        inFlight.delete(userId);
        // Блокировку снимаем только когда не осталось ни таймеров, ни записей
        state._localEditing = !isSavingIdle();
        if (!state._localEditing) {
            // Снапшот, пришедший во время правок, устарел — свежий придёт после записи
            discardPendingRemote();
        }
    }
};

export const scheduleSave = (userId, userData) => {
    state._localEditing = true;
    pendingData[userId] = userData;

    if (saveTimeouts[userId]) clearTimeout(saveTimeouts[userId]);

    saveTimeouts[userId] = setTimeout(() => {
        delete saveTimeouts[userId];
        writeUser(userId);
    }, SAVE_DEBOUNCE_MS);
};

// Не теряем недописанные правки при уходе со страницы или переключении вкладки
const flushPendingSavesNow = () => {
    Object.keys(saveTimeouts).forEach(userId => {
        clearTimeout(saveTimeouts[userId]);
        delete saveTimeouts[userId];
        writeUser(userId);
    });
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSavesNow();
});
window.addEventListener('pagehide', flushPendingSavesNow);

export function renderUserCard(user, requestRender, updateCalendarVacations) {
    const oldContainer = document.getElementById(`user-card-${user.id}`);
    if (!oldContainer) return;

    const isVisible = user.isVisible !== false;
    const isHidden = user.isHidden === true;
    const displayVacations = user.vacations || [];

    // Проверяем видимость группы
    let groupIsVisible = true;
    if (user.groupId) {
        const group = state.groups.find(g => g.id === user.groupId);
        if (group) groupIsVisible = group.isVisible !== false;
    } else {
        const ungrouped = state.groups.find(g => g.id === 'ungrouped');
        if (ungrouped) groupIsVisible = ungrouped.isVisible !== false;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `form__user ${isHidden ? 'form__user_hidden' : ''}`;
    wrapper.id = `user-card-${user.id}`;

    const colorOrPlaceholder = !isHidden
        ? `<input type="color" class="form__color" value="${user.color}" />`
        : `<div style="width: 16px; height: 16px; flex-shrink: 0;"></div>`;

    let eyeIcon = '';
    let eyeClass = '';
    let eyeDisabled = false;

    if (!groupIsVisible) {
        // Если группа выключена, глаз блеклый и неактивный
        eyeIcon = getIconEye();
        eyeClass = 'inactive-group';
        eyeDisabled = true;
    } else {
        // Если группа включена, показываем нормальное состояние
        if (isVisible) {
            eyeIcon = `<span style="color: var(--accent-green);">${getIconEye()}</span>`;
        } else {
            eyeIcon = getIconEyeOff();
            eyeClass = 'hidden';
        }
    }

    wrapper.innerHTML = `
        <div class="form__user-header">
            <div class="form__drag-handle-user" title="Перетащите, чтобы изменить порядок" style="cursor: grab; opacity: 0.5; margin-right: 8px;">${getIconDrag()}</div>
            <button type="button" class="btn_icon eye-btn ${eyeClass}" title="${eyeDisabled ? 'Группа скрыта' : (isVisible ? 'Скрыть' : 'Показать')}" ${eyeDisabled ? 'disabled' : ''}>
                ${eyeIcon}
            </button>
            ${colorOrPlaceholder}
            <div class="form__username-wrapper">
                <h2 class="form__username">${user.name}</h2>
                <div class="form__username-tooltip">${user.name}</div>
            </div>
            <div class="form__user-actions">
                <button type="button" class="btn_icon toggle-btn" title="${isHidden ? 'Развернуть' : 'Свернуть'}">${isHidden ? '▼' : '▲'}</button>
                <button type="button" class="btn_icon delete-user-btn" title="Удалить">✕</button>
            </div>
        </div>
        ${!isHidden ? `
            <div class="form__vacations-list" id="vacations-list-${user.id}"></div>
            <button type="button" class="btn btn_small add-vac-btn">+ Добавить отпуск</button>
            <div class="form__user-alerts" id="user-alerts-${user.id}"></div>
            <div class="form__user-totals" id="user-totals-${user.id}"></div>
        ` : ''}
    `;

    oldContainer.replaceWith(wrapper);

    // Наведение на карточку подсвечивает на календаре все отпуска сотрудника
    wrapper.addEventListener('mouseenter', () => highlightUserVacations(user));
    wrapper.addEventListener('mouseleave', clearUserVacationHighlight);

    const eyeBtn = wrapper.querySelector('.eye-btn');
    if (eyeBtn && !eyeDisabled) {
        eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            user.isVisible = !user.isVisible;
            scheduleSave(user.id, user, requestRender);
            renderUserCard(user, requestRender, updateCalendarVacations);
            updateCalendarVacations();
        });
    }

    const colorInput = wrapper.querySelector('.form__color');
    if (colorInput) {
        colorInput.addEventListener('change', (e) => {
            e.stopPropagation();
            user.color = e.target.value;
            scheduleSave(user.id, user, requestRender);
            renderUserCard(user, requestRender, updateCalendarVacations);
            updateCalendarVacations();
        });
    }

    wrapper.querySelector('.form__username').addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('Введите новое имя:', user.name);
        if (newName && newName !== user.name) {
            user.name = newName;
            scheduleSave(user.id, user, requestRender);
            renderUserCard(user, requestRender, updateCalendarVacations);
            updateCalendarVacations();
        }
    });

    wrapper.querySelector('.toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        user.isHidden = !user.isHidden;
        scheduleSave(user.id, user, requestRender);
        renderUserCard(user, requestRender, updateCalendarVacations);
    });

    wrapper.querySelector('.delete-user-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Удалить ${user.name}?`)) {
            state.users = state.users.filter(u => u.id !== user.id);
            window.firestore.deleteDoc(getUserDoc(state.year, user.id)).catch(console.error);
            requestRender();
            updateCalendarVacations();
        }
    });

    if (!isHidden) {
        const vacList = wrapper.querySelector('.form__vacations-list');
        const alertsEl = wrapper.querySelector('.form__user-alerts');
        const totalsEl = wrapper.querySelector('.form__user-totals');

        // Итого по сотруднику + валидация требований ТК
        const refreshSummary = () => {
            const parts = displayVacations
                .filter(v => v.startDate && v.endDate && v.endDate >= v.startDate)
                .map(v => getCalendarDays(v.startDate, v.endDate));

            const totalCalDays = parts.reduce((sum, n) => sum + n, 0);
            const totalWorkDays = displayVacations.reduce((sum, v) => sum + getWorkingDays(v.startDate, v.endDate), 0);

            if (parts.length === 0) {
                totalsEl.style.display = 'none';
            } else {
                totalsEl.style.display = 'flex';
                totalsEl.innerHTML = `
                    <span>Календарных: <b>${totalCalDays}</b> / ${ANNUAL_LEAVE_DAYS}</span>
                    <span>Рабочих: <b>${totalWorkDays}</b></span>
                `;
            }

            const alerts = [];
            if (totalCalDays > ANNUAL_LEAVE_DAYS) {
                alerts.push({ text: `Превышение: ${totalCalDays} из ${ANNUAL_LEAVE_DAYS} календарных дней.`, error: true });
            }
            if (parts.length > 1 && !parts.some(n => n >= MIN_LEAVE_PART)) {
                alerts.push({ text: `Одна из частей отпуска должна быть не менее ${MIN_LEAVE_PART} календарных дней.`, error: false });
            }

            alertsEl.innerHTML = alerts
                .map(a => `<div class="form__user-alert${a.error ? ' form__user-alert_error' : ''}">${getIconWarning()} ${a.text}</div>`)
                .join('');
        };

        refreshSummary();

        displayVacations.forEach(vac => {
            const vacDiv = document.createElement('div');
            vacDiv.className = `form__vacation`;
            vacDiv.dataset.id = vac.id;

            const updateValidation = () => {
                const { isOverlap, isInvalid } = validateInternalOverlap(user, vac.id);
                const externalOverlaps = getExternalOverlaps(user, vac, state.users);
                const hasError = isOverlap || isInvalid;
                const crossTitle = externalOverlaps.map(o => o.name).join(', ');

                vacDiv.classList.toggle('form__vacation_overlap', hasError);

                vacDiv.querySelectorAll('.form__vacation-alert, .form__vacation-cross-alert').forEach(el => el.remove());

                if (isInvalid) {
                    const alert = document.createElement('div');
                    alert.className = 'form__vacation-alert';
                    alert.innerHTML = `${getIconWarning()} Дата окончания раньше начала!`;
                    vacDiv.appendChild(alert);
                }
                if (isOverlap) {
                    const alert = document.createElement('div');
                    alert.className = 'form__vacation-alert';
                    alert.innerHTML = `${getIconWarning()} Пересечение!`;
                    vacDiv.appendChild(alert);
                }
                if (externalOverlaps.length > 0) {
                    const alert = document.createElement('div');
                    alert.className = 'form__vacation-cross-alert';
                    alert.title = crossTitle;
                    alert.innerHTML = `${getIconWarning()} Пересечение: ${crossTitle}`;
                    vacDiv.appendChild(alert);
                }
            };

            vacDiv.innerHTML = `
                <div class="form__vacation-dates">
                    <div class="form__drag-handle" title="Перетащите, чтобы изменить порядок">${getIconDrag()}</div>
                    <input type="date" class="form__date" min="${state.year}-01-01" max="${state.year}-12-31" value="${vac.startDate || ''}" />
                    <span class="form__date-sep">—</span>
                    <input type="date" class="form__date" min="${state.year}-01-01" max="${state.year}-12-31" value="${vac.endDate || ''}" />
                </div>
                <div class="form__vacation-info">
                    <span class="form__vacation-days">${getCalendarDays(vac.startDate, vac.endDate)} кал. / ${getWorkingDays(vac.startDate, vac.endDate)} раб.</span>
                    <button type="button" class="btn_icon delete" title="Удалить">✕</button>
                </div>
            `;

            const inputs = vacDiv.querySelectorAll('input[type="date"]');

            inputs[0].addEventListener('input', (e) => {
                vac.startDate = e.target.value;
                scheduleSave(user.id, user);
                updateCalendarVacations();
                updateValidation();
                vacDiv.querySelector('.form__vacation-days').textContent = `${getCalendarDays(vac.startDate, vac.endDate)} кал. / ${getWorkingDays(vac.startDate, vac.endDate)} раб.`;
                refreshSummary();
            });

            inputs[1].addEventListener('input', (e) => {
                vac.endDate = e.target.value;
                scheduleSave(user.id, user);
                updateCalendarVacations();
                updateValidation();
                vacDiv.querySelector('.form__vacation-days').textContent = `${getCalendarDays(vac.startDate, vac.endDate)} кал. / ${getWorkingDays(vac.startDate, vac.endDate)} раб.`;
                refreshSummary();
            });

            vacDiv.querySelector('.btn_icon.delete').addEventListener('click', (e) => {
                e.stopPropagation();
                user.vacations = user.vacations.filter(v => v.id !== vac.id);
                scheduleSave(user.id, user, requestRender);
                renderUserCard(user, requestRender, updateCalendarVacations);
                updateCalendarVacations();
            });

            vacList.appendChild(vacDiv);
        });

        if (typeof Sortable !== 'undefined') {
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
                    scheduleSave(user.id, user, requestRender);
                }
            });
        }

        wrapper.querySelector('.add-vac-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!user.vacations) user.vacations = [];
            user.vacations.push({ id: `vacationid_${Date.now()}`, startDate: `${state.year}-01-01`, endDate: `${state.year}-01-01` });
            scheduleSave(user.id, user, requestRender);
            renderUserCard(user, requestRender, updateCalendarVacations);
            updateCalendarVacations();
        });
    }
}