// scripts/user-card.js
import { state, discardPendingRemote } from './state.js';
import { getCalendarDays, getWorkingDays, validateInternalOverlap, getExternalOverlaps, getIconEye, getIconEyeOff, getIconWarning, getIconDrag, getIconProfile } from './utils.js';
import { highlightUserVacations, clearUserVacationHighlight } from './calendar-grid.js';
import { canEditUser, canManageUsers } from './auth.js';
import { isUserHidden, isGroupHidden, toggleUserHidden } from './view-prefs.js';
import { openProfileModal } from './profile-modal.js';
import { updateUserChip } from './user-chip.js';
import { getProfile, getEntitlement, isParentalLeave, formatOverDays, formatShortDays } from './profile.js';

// Норма ТК по умолчанию — 28 календарных дней; одна из частей — не менее 14
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

    // Видимость — личная настройка (localStorage), у каждого своя
    const isVisible = !isUserHidden(user.id);
    const isHidden = user.isHidden === true;
    const displayVacations = user.vacations || [];
    const groupIsVisible = !isGroupHidden(user.groupId || 'ungrouped');

    // Кто может править эту карточку: админ — любую, сотрудник — только свою
    const editable = canEditUser(user.id);
    const canManage = canManageUsers();

    const wrapper = document.createElement('div');
    wrapper.className = `form__user ${isHidden ? 'form__user_hidden' : ''}`;
    wrapper.id = `user-card-${user.id}`;

    // Свой цвет меняется всегда (даже когда карточка свёрнута), чужой — только точка для просмотра
    const colorElement = editable
        ? `<input type="color" class="form__color" value="${user.color}" />`
        : `<span class="form__color-dot" style="background: ${user.color || '#888888'};"></span>`;

    // «Глаз» — личный показ на календаре. Скрытая группа только приглушает кнопку,
    // но не блокирует её: иначе состояние «залипает» и включить обратно нельзя.
    let eyeIcon = isVisible
        ? `<span style="color: var(--accent-green);">${getIconEye()}</span>`
        : getIconEyeOff();
    let eyeClass = isVisible ? '' : 'hidden';
    let eyeTitle = isVisible ? 'Скрыть с календаря' : 'Показать на календаре';

    if (!groupIsVisible) {
        eyeClass = `${eyeClass} btn_icon_dim`.trim();
        eyeTitle += ' (группа скрыта)';
    }

    // Ручку показываем всем: переставлять карточки можно каждому у себя (личный порядок)
    const dragHandle = `<div class="form__drag-handle-user" title="Перетащите, чтобы изменить порядок" style="cursor: grab; opacity: 0.5; margin-right: 8px;">${getIconDrag()}</div>`;

    // «Глаз» доступен всем: это личный фильтр показа на календаре
    const eyeButton = `<button type="button" class="btn_icon eye-btn ${eyeClass}" title="${eyeTitle}">
                ${eyeIcon}
            </button>`;

    const deleteUserButton = canManage
        ? `<button type="button" class="btn_icon delete-user-btn" title="Удалить">✕</button>`
        : '';

    const profileButton = `<button type="button" class="btn_icon profile-btn" title="Профиль сотрудника">${getIconProfile()}</button>`;

    wrapper.innerHTML = `
        <div class="form__user-header">
            ${dragHandle}
            ${profileButton}
            ${eyeButton}
            ${colorElement}
            <div class="form__username-wrapper">
                <h2 class="form__username"${editable ? '' : ' style="cursor: default;"'}>${user.name}</h2>
                <div class="form__username-tooltip">${user.name}</div>
            </div>
            <div class="form__user-actions">
                <button type="button" class="btn_icon toggle-btn" title="${isHidden ? 'Развернуть' : 'Свернуть'}">${isHidden ? '▼' : '▲'}</button>
                ${deleteUserButton}
            </div>
        </div>
        ${!isHidden ? `
            <div class="form__vacations-list" id="vacations-list-${user.id}"></div>
            <div class="form__vacations-empty" id="vacations-empty-${user.id}">Отпусков пока нет</div>
            ${editable ? '<button type="button" class="btn btn_small add-vac-btn">+ Добавить отпуск</button>' : ''}
            <div class="form__user-alerts" id="user-alerts-${user.id}"></div>
            <div class="form__user-totals" id="user-totals-${user.id}"></div>
        ` : ''}
    `;

    oldContainer.replaceWith(wrapper);

    // Наведение на карточку подсвечивает на календаре все отпуска сотрудника
    wrapper.addEventListener('mouseenter', () => highlightUserVacations(user));
    wrapper.addEventListener('mouseleave', clearUserVacationHighlight);

    wrapper.querySelector('.profile-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openProfileModal(user.id);
    });

    const eyeBtn = wrapper.querySelector('.eye-btn');
    if (eyeBtn) {
        eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleUserHidden(user.id);
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
            updateUserChip();
        });
    }

    if (editable) {
        wrapper.querySelector('.form__username').addEventListener('click', (e) => {
            e.stopPropagation();
            const newName = prompt('Введите новое имя:', user.name);
            if (newName && newName !== user.name) {
                user.name = newName;
                scheduleSave(user.id, user, requestRender);
                renderUserCard(user, requestRender, updateCalendarVacations);
                updateCalendarVacations();
                updateUserChip();
            }
        });
    }

    wrapper.querySelector('.toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        user.isHidden = !user.isHidden;
        scheduleSave(user.id, user, requestRender);
        renderUserCard(user, requestRender, updateCalendarVacations);
    });

    if (canManage) {
        wrapper.querySelector('.delete-user-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Удалить ${user.name}?`)) {
                state.users = state.users.filter(u => u.id !== user.id);
                window.firestore.deleteDoc(getUserDoc(state.year, user.id)).catch(console.error);
                requestRender();
                updateCalendarVacations();
            }
        });
    }

    if (!isHidden) {
        const vacList = wrapper.querySelector('.form__vacations-list');
        const alertsEl = wrapper.querySelector('.form__user-alerts');
        const totalsEl = wrapper.querySelector('.form__user-totals');
        const emptyEl = wrapper.querySelector('.form__vacations-empty');

        // Итого по сотруднику + валидация по ТК. Ничего не запрещаем —
        // просто пишем в предупреждения то же, что шаблон Excel пишет в «Примечание».
        const refreshSummary = () => {
            const parts = displayVacations
                .filter(v => v.startDate && v.endDate && v.endDate >= v.startDate)
                .map(v => getCalendarDays(v.startDate, v.endDate));

            const totalCalDays = parts.reduce((sum, n) => sum + n, 0);
            const totalWorkDays = displayVacations.reduce((sum, v) => sum + getWorkingDays(v.startDate, v.endDate), 0);

            const profile = getProfile(user);
            const entitlement = getEntitlement(profile);
            const parental = isParentalLeave(profile);

            // Явно показываем, что отпусков нет, и держим итоги с нулями
            emptyEl.style.display = displayVacations.length === 0 ? 'block' : 'none';

            totalsEl.style.display = 'flex';
            totalsEl.innerHTML = `
                    <span title="Основной ${profile.annualDays} + северный ${profile.northernDays} + ненормированный ${profile.irregularDays}">Календарных: <b>${totalCalDays}</b> / ${entitlement}</span>
                    <span>Рабочих: <b>${totalWorkDays}</b></span>
                `;

            const alerts = [];

            if (parental) {
                alerts.push({ text: 'В отпуске по уходу за ребенком — норму не считаем', error: false });
            } else if (parts.length > 0) {
                const diff = totalCalDays - entitlement;
                if (diff > 0) alerts.push({ text: formatOverDays(diff), error: true });
                else if (diff < 0) alerts.push({ text: formatShortDays(-diff), error: false });
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
                    ${editable ? `<div class="form__drag-handle" title="Перетащите, чтобы изменить порядок">${getIconDrag()}</div>` : ''}
                    <input type="date" class="form__date" min="${state.year}-01-01" max="${state.year}-12-31" value="${vac.startDate || ''}"${editable ? '' : ' disabled'} />
                    <span class="form__date-sep">—</span>
                    <input type="date" class="form__date" min="${state.year}-01-01" max="${state.year}-12-31" value="${vac.endDate || ''}"${editable ? '' : ' disabled'} />
                </div>
                <div class="form__vacation-info">
                    <span class="form__vacation-days">${getCalendarDays(vac.startDate, vac.endDate)} кал. / ${getWorkingDays(vac.startDate, vac.endDate)} раб.</span>
                    ${editable ? '<button type="button" class="btn_icon delete" title="Удалить">✕</button>' : ''}
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

            if (editable) {
                vacDiv.querySelector('.btn_icon.delete').addEventListener('click', (e) => {
                    e.stopPropagation();
                    user.vacations = user.vacations.filter(v => v.id !== vac.id);
                    scheduleSave(user.id, user, requestRender);
                    renderUserCard(user, requestRender, updateCalendarVacations);
                    updateCalendarVacations();
                });
            }

            vacList.appendChild(vacDiv);
        });

        if (typeof Sortable !== 'undefined' && editable) {
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

        if (editable) {
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
}

