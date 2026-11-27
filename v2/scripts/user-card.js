// scripts/user-card.js
import { state, discardPendingRemote } from './state.js';
import { getCalendarDays, getWorkingDays, validateInternalOverlap, getExternalOverlaps, getIconEye, getIconEyeOff, getIconWarning, getIconDrag, getIconProfile, countDaysFromYearStart } from './utils.js';
import { highlightUserVacations, clearUserVacationHighlight, highlightVacationPeriod, clearVacationPeriodHighlight, getHighlightedVacationId, scrollToVacationPeriod, isUserShownOnCalendar } from './calendar-grid.js';
import { canEditUser, canManageUsers } from './auth.js';
import { isUserHidden, isGroupHidden, toggleUserHidden } from './view-prefs.js';
import { openProfileModal } from './profile-modal.js';
import { updateUserChip } from './user-chip.js';
import { getProfile, getEntitlement, isParentalLeave, formatOverDays, formatShortDays, composeShortName } from './profile.js';

// Норма ТК по умолчанию — 28 календарных дней; одна из частей — не менее 14
const MIN_LEAVE_PART = 14;

const escapeHtml = (value) => String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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

// --- Отпуска: порядок и выделение периода ---

// Отпуска всегда идут по дате начала (пустые даты — в конец).
// Поэтому ручное перетаскивание периодов больше не нужно.
function sortVacations(user) {
    if (!Array.isArray(user.vacations)) return;

    user.vacations.sort((a, b) => {
        const aStart = a.startDate || '9999-99-99';
        const bStart = b.startDate || '9999-99-99';
        return aStart.localeCompare(bStart) || String(a.endDate || '').localeCompare(String(b.endDate || ''));
    });
}

const reorderTimers = {};

// Переставляем блоки ТОЛЬКО когда пользователь закончил работать с отпуском.
// Пока он вводит дату руками или открыт нативный календарь — не двигаем ничего,
// иначе блок уезжает прямо во время ввода.
function scheduleReorder(vacList, user, block) {
    clearTimeout(reorderTimers[user.id]);

    reorderTimers[user.id] = setTimeout(() => {
        delete reorderTimers[user.id];

        const active = document.activeElement;
        if (active && block && block.contains(active)) return;

        reorderVacationBlocks(vacList, user);
    }, 250);
}

// Переставляем уже нарисованные блоки по дате — без полной перерисовки,
// чтобы не терять фокус в поле, где как раз выбирают дату
function reorderVacationBlocks(vacList, user) {
    if (!vacList) return;

    // Запоминаем, где стоял курсор: перенос узла в DOM сбрасывает фокус
    const active = document.activeElement;
    const wasInList = !!(active && vacList.contains(active));

    sortVacations(user);

    (user.vacations || []).forEach(vac => {
        const node = vacList.querySelector(`.form__vacation[data-id="${vac.id}"]`);
        if (node) vacList.appendChild(node);
    });

    if (wasInList && document.activeElement !== active) {
        active.focus({ preventScroll: true });
    }
}

// Помечаем активный блок отпуска (тот, что сейчас показан на календаре)
function markActiveVacation() {
    const activeId = getHighlightedVacationId();

    document.querySelectorAll('.form__vacation').forEach(node => {
        node.classList.toggle('form__vacation_active', !!activeId && node.dataset.id === activeId);
    });
}

// Клик по блоку отпуска: показать период на календаре (и прокрутить к нему).
// Повторный клик — снять выделение.
function toggleVacationHighlight(user, vac) {
    if (getHighlightedVacationId() === vac.id) {
        clearVacationPeriodHighlight();
        markActiveVacation();
        return;
    }

    if (!isUserShownOnCalendar(user)) return;
    if (!vac.startDate || !vac.endDate || vac.endDate < vac.startDate) return;

    const startIndex = countDaysFromYearStart(vac.startDate, state.year);
    const endIndex = countDaysFromYearStart(vac.endDate, state.year);

    clearUserVacationHighlight();
    highlightVacationPeriod(startIndex, endIndex, user.color, { userId: user.id, vacId: vac.id });
    scrollToVacationPeriod(startIndex);
    markActiveVacation();
}

// Проблемы карточки: невалидные периоды и пересечения.
// Считаем всегда при отрисовке — иначе после сворачивания/обновления страницы
// ошибки «терялись» и невалидные периоды оставались незамеченными.
function collectUserProblems(user) {
    const vacations = user.vacations || [];
    const invalid = [];
    const overlaps = [];
    const external = [];

    vacations.forEach(vac => {
        if (!vac.startDate || !vac.endDate) {
            invalid.push(vac);
            return;
        }

        const { isOverlap, isInvalid } = validateInternalOverlap(user, vac.id);
        if (isInvalid) invalid.push(vac);
        if (isOverlap) overlaps.push(vac);

        const externalNames = getExternalOverlaps(user, vac, state.users);
        if (externalNames.length > 0 && !external.some(item => item.vacId === vac.id)) {
            external.push({ vacId: vac.id, names: externalNames.map(n => n.name).join(', ') });
        }
    });

    const title = [];
    if (invalid.length > 0) title.push(`Периодов с ошибкой в датах: ${invalid.length}`);
    if (overlaps.length > 0) title.push(`Пересекающихся своих периодов: ${overlaps.length}`);
    if (external.length > 0) title.push(`Пересечений с другими сотрудниками: ${external.length}`);

    return { invalid, overlaps, external, title: title.join('. '), hasError: invalid.length + overlaps.length > 0 };
}

function updateProblemsBadge(node, problems) {
    if (!node) return;

    const total = problems.invalid.length + problems.overlaps.length + problems.external.length;

    node.hidden = total === 0;
    node.textContent = total > 0 ? `! ${total}` : '';
    node.title = problems.title;
    node.classList.toggle('form__problems_warn', !problems.hasError && total > 0);
}

// Перебор/недобор дней относительно нормы — руководителю видно сразу.
// Показываем только когда есть что считать (иначе у всех «недобор 28»).
function getBalance(user) {
    const profile = getProfile(user);

    if (isParentalLeave(profile)) return null;

    const entitlement = getEntitlement(profile);
    if (entitlement <= 0) return null;

    const vacations = (user.vacations || [])
        .filter(vac => vac.startDate && vac.endDate && vac.endDate >= vac.startDate);

    const total = vacations.reduce((sum, vac) => sum + getCalendarDays(vac.startDate, vac.endDate), 0);
    const diff = total - entitlement;

    // Отпуска ещё не планировали — отдельное спокойное состояние
    if (vacations.length === 0) return { diff, entitlement, total, noPlan: true };

    if (diff === 0) return null;
    return { diff, entitlement, total, noPlan: false };
}

function updateBalanceBadge(node, balance) {
    if (!node) return;

    if (!balance) {
        node.hidden = true;
        node.textContent = '';
        node.title = '';
        node.classList.remove('form__balance_over', 'form__balance_short', 'form__balance_none');
        return;
    }

    const over = balance.diff > 0;

    node.hidden = false;
    node.textContent = over ? `+${balance.diff}` : `−${Math.abs(balance.diff)}`;

    if (balance.noPlan) {
        node.title = `Отпуска на ${state.year} год не запланированы. Норма ${balance.entitlement} календарных дней.`;
    } else {
        node.title = `${over ? 'Перебор' : 'Недобор'}: ${over ? formatOverDays(balance.diff) : formatShortDays(Math.abs(balance.diff))}. `
            + `Норма ${balance.entitlement}, запланировано ${balance.total}.`;
    }

    node.classList.toggle('form__balance_over', !balance.noPlan && over);
    node.classList.toggle('form__balance_short', !balance.noPlan && !over);
    node.classList.toggle('form__balance_none', balance.noPlan);
}

// Предупреждения внутри блока отпуска
function renderVacationProblems(vacDiv, user, vac) {
    const hasDates = !!(vac.startDate && vac.endDate);
    const { isOverlap, isInvalid } = hasDates
        ? validateInternalOverlap(user, vac.id)
        : { isOverlap: false, isInvalid: false };

    const datesInvalid = !hasDates || isInvalid;
    const externalOverlaps = hasDates ? getExternalOverlaps(user, vac, state.users) : [];
    const crossTitle = externalOverlaps.map(o => o.name).join(', ');

    vacDiv.classList.toggle('form__vacation_overlap', datesInvalid || isOverlap);
    vacDiv.querySelectorAll('.form__vacation-alert, .form__vacation-cross-alert').forEach(el => el.remove());

    const addAlert = (className, html, title) => {
        const alert = document.createElement('div');
        alert.className = className;
        alert.innerHTML = html;
        if (title) alert.title = title;
        vacDiv.appendChild(alert);
    };

    if (!hasDates) {
        addAlert('form__vacation-alert', `${getIconWarning()} Укажите даты начала и окончания`);
    } else if (isInvalid) {
        addAlert('form__vacation-alert', `${getIconWarning()} Дата окончания раньше начала!`);
    }

    if (isOverlap) {
        addAlert('form__vacation-alert', `${getIconWarning()} Пересекается с другим отпуском этого сотрудника!`);
    }

    if (externalOverlaps.length > 0) {
        addAlert('form__vacation-cross-alert', `${getIconWarning()} Пересечение: ${crossTitle}`, crossTitle);
    }
}

export function renderUserCard(user, requestRender, updateCalendarVacations) {
    const oldContainer = document.getElementById(`user-card-${user.id}`);
    if (!oldContainer) return;

    // Видимость — личная настройка (localStorage), у каждого своя
    const isVisible = !isUserHidden(user.id);
    const isHidden = user.isHidden === true;

    // Отпуска всегда по дате начала — ручное перетаскивание периодов больше не нужно
    sortVacations(user);
    const displayVacations = user.vacations || [];
    const groupIsVisible = !isGroupHidden(user.groupId || 'ungrouped');

    // В панели — коротко «Фамилия Имя», полное ФИО в подсказке при наведении
    const fullName = user.name;
    const shortName = composeShortName(getProfile(user), fullName);

    // Кто может править эту карточку: админ — любую, сотрудник — только свою
    const editable = canEditUser(user.id);
    const canManage = canManageUsers();

    const wrapper = document.createElement('div');
    wrapper.className = `form__user ${isHidden ? 'form__user_hidden' : ''}`;
    wrapper.id = `user-card-${user.id}`;

    // Цвет — вертикальная полоска слева от карточки: не отнимает место у имени.
    // Свой цвет меняется всегда (даже когда карточка свёрнута), чужой — только для просмотра.
    const colorElement = editable
        ? `<input type="color" class="form__color-bar" value="${user.color || '#888888'}" title="Цвет сотрудника" />`
        : `<span class="form__color-bar form__color-bar_static" style="background: ${user.color || '#888888'};" title="Цвет сотрудника"></span>`;

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
    const dragHandle = `<div class="form__drag-handle-user" title="Перетащите, чтобы изменить порядок">${getIconDrag()}</div>`;

    // «Глаз» доступен всем: это личный фильтр показа на календаре
    const eyeButton = `<button type="button" class="btn_icon eye-btn ${eyeClass}" title="${eyeTitle}">
                ${eyeIcon}
            </button>`;

    const deleteUserButton = canManage
        ? `<button type="button" class="btn_icon delete-user-btn" title="Удалить">✕</button>`
        : '';

    const profileButton = `<button type="button" class="btn_icon profile-btn" title="Профиль сотрудника">${getIconProfile()}</button>`;

    wrapper.innerHTML = `
        ${colorElement}
        <div class="form__user-header">
            ${dragHandle}
            ${profileButton}
            ${eyeButton}
            <div class="form__username-wrapper">
                <h2 class="form__username">${escapeHtml(shortName)}</h2>
                <div class="form__username-tooltip">${escapeHtml(fullName)}</div>
            </div>
            <span class="form__balance" id="balance-${user.id}" hidden></span>
            <span class="form__problems" id="problems-${user.id}" hidden></span>
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

    // Наведение на карточку подсвечивает на календаре все отпуска сотрудника.
    // Период, выбранный кликом, при этом не сбрасывается.
    wrapper.addEventListener('mouseenter', () => highlightUserVacations(user));
    wrapper.addEventListener('mouseleave', clearUserVacationHighlight);

    // Валидация должна быть видна всегда: и у свёрнутой карточки, и после
    // перерисовки страницы (раньше она жила только в обработчиках ввода дат).
    const problemsEl = wrapper.querySelector('.form__problems');
    const balanceEl = wrapper.querySelector('.form__balance');

    const refreshProblems = () => {
        const problems = collectUserProblems(user);
        updateProblemsBadge(problemsEl, problems);
        updateBalanceBadge(balanceEl, getBalance(user));

        (user.vacations || []).forEach(vac => {
            const node = wrapper.querySelector(`.form__vacation[data-id="${vac.id}"]`);
            if (node) renderVacationProblems(node, user, vac);
        });
    };

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

    // Цвет — полоска слева (класс .form__color-bar; раньше был .form__color)
    const colorInput = wrapper.querySelector('.form__color-bar');
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

    // Имя правим в профиле: там отдельные поля Фамилия / Имя / Отчество,
    // иначе в базе появляются варианты вроде «Имя Фамилия» и ФИО разъезжается
    wrapper.querySelector('.form__username').addEventListener('click', (e) => {
        e.stopPropagation();
        openProfileModal(user.id);
    });

    wrapper.querySelector('.toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        user.isHidden = !user.isHidden;
        scheduleSave(user.id, user, requestRender);
        renderUserCard(user, requestRender, updateCalendarVacations);
    });

    if (canManage) {
        wrapper.querySelector('.delete-user-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Удалить сотрудника «${user.name}»?\n\nВместе с ним удалятся все отпуска и доступ (пароль).`)) {
                state.users = state.users.filter(u => u.id !== user.id);
                window.firestore.deleteDoc(getUserDoc(state.year, user.id)).catch(console.error);
                window.firestore.deleteDoc(window.firestore.doc(window.db, 'access', user.id)).catch(console.error);
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

            // Ошибки в периодах видны и здесь, а не только внутри самих блоков
            const problems = collectUserProblems(user);
            if (problems.invalid.length > 0) {
                alerts.push({ text: `Периодов с ошибкой в датах: ${problems.invalid.length}`, error: true });
            }
            if (problems.overlaps.length > 0) {
                alerts.push({ text: `Пересекающихся периодов: ${problems.overlaps.length}`, error: true });
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

            vacDiv.innerHTML = `
                <div class="form__vacation-dates">
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
                // сортируем только данные — DOM не трогаем, чтобы не мешать вводу
                sortVacations(user);
                scheduleSave(user.id, user);
                updateCalendarVacations();
                refreshProblems();
                vacDiv.querySelector('.form__vacation-days').textContent = `${getCalendarDays(vac.startDate, vac.endDate)} кал. / ${getWorkingDays(vac.startDate, vac.endDate)} раб.`;
                refreshSummary();
            });

            inputs[1].addEventListener('input', (e) => {
                vac.endDate = e.target.value;
                sortVacations(user);
                scheduleSave(user.id, user);
                updateCalendarVacations();
                refreshProblems();
                vacDiv.querySelector('.form__vacation-days').textContent = `${getCalendarDays(vac.startDate, vac.endDate)} кал. / ${getWorkingDays(vac.startDate, vac.endDate)} раб.`;
                refreshSummary();
            });

            // Блок встаёт на место по дате, но только когда пользователь закончил:
            // увёл курсор из этого отпуска или закрыл нативный календарь.
            inputs.forEach(input => {
                input.addEventListener('change', () => scheduleReorder(vacList, user, vacDiv));
                input.addEventListener('blur', () => scheduleReorder(vacList, user, vacDiv));
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

            // Клик по блоку отпуска — показать именно этот период на календаре.
            // Подсветка держится, пока не кликнешь ещё раз.
            vacDiv.title = 'Нажмите, чтобы показать период на календаре';
            vacDiv.addEventListener('click', (event) => {
                if (event.target.closest('input, textarea, button')) return;
                toggleVacationHighlight(user, vac);
            });

            if (getHighlightedVacationId() === vac.id) vacDiv.classList.add('form__vacation_active');

            vacList.appendChild(vacDiv);
        });

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

    // Валидацию показываем сразу после отрисовки, а не только при правке даты
    refreshProblems();
}

