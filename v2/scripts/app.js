// scripts/app.js — Фикс сброса сворачивания при перерисовке

import { state, initState, stateEvents, getAvailableYears, updateGroup } from './state.js';
import { renderCalendar } from './calendar.js';
import { initCalendarInteractions } from './calendar-interactions.js';
import { initGroupsUI } from './groups.js';
import { renderUserCard, scheduleSave, getGroupEyeState } from './user-card.js';
import { updateCalendarVacations as renderCalendarVacations } from './calendar-grid.js';
import { getIconEye, getIconEyeOff } from './utils.js';
import { clearSession, getCurrentUserId, isAdmin, isAuthenticated } from './auth.js';
import { isGroupHidden, isUserHidden, setUserHidden, toggleGroupHidden, isGroupCollapsed, setGroupCollapsed, toggleGroupCollapsed, getPersonalOrder, setPersonalOrder } from './view-prefs.js';
import { initProfileModal, openProfileModal } from './profile-modal.js';
import { updateUserChip, initUserChip } from './user-chip.js';
import { showNotice } from './notice.js';
import { MONTH_NAMES, getViewMonth, setViewMonth, filterUsersByViewMonth, getCalendarMonthRange, isViewMonthActive } from './view-month.js';
import { initExportDialog, openExportDialog } from './export-dialog.js';
import { initJournal } from './journal-window.js';
import { initResetDialog } from './reset-dialog.js';
import { initImportDialog } from './import-dialog.js';
import { logEvent, schedulePrune } from './log.js';

const usersContainer = document.getElementById('users-container');
const updateCalendarVacations = () => renderCalendarVacations(scheduleSave, requestRender, renderUserCard);

// Личный порядок важнее общего: если пользователь что-то перетащил,
// порядок хранится у него в localStorage и на других не влияет.
function sortByPersonal(items, personalIds, getId, getOrder) {
    return [...items].sort((a, b) => {
        const ai = personalIds.indexOf(getId(a));
        const bi = personalIds.indexOf(getId(b));

        if (ai === -1 && bi === -1) return (getOrder(a) || 0) - (getOrder(b) || 0);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });
}

// Порядок карточек в панели (сверху вниз, по всем группам)
function collectUserOrder() {
    const ids = [];
    usersContainer.querySelectorAll('.group-block').forEach(block => {
        block.querySelectorAll('.group-users > .form__user').forEach(card => {
            ids.push(card.id.replace('user-card-', ''));
        });
    });
    return ids;
}

async function ensureUngroupedGroup() {
    const ungroupedDocRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "groups", "ungrouped");
    const docSnap = await window.firestore.getDoc(ungroupedDocRef);
    if (!docSnap.exists()) {
        await window.firestore.setDoc(ungroupedDocRef, {
            name: 'Без группы',
            color: '#555',
            isVisible: true,
            showIfEmpty: true,
            isCollapsed: false,
            order: 9999
        });
    }
}

function requestRender() {
    usersContainer.replaceChildren();

    // При активном фильтре по месяцу показываем только тех, у кого отпуск в этом месяце
    const filterActive = isViewMonthActive();
    const visibleUsers = filterUsersByViewMonth(state.users);

    const groupedUsers = {}; const ungroupedUsers = [];
    visibleUsers.forEach(user => {
        if (user.groupId && state.groups.some(g => g.id === user.groupId)) {
            if (!groupedUsers[user.groupId]) groupedUsers[user.groupId] = [];
            groupedUsers[user.groupId].push(user);
        } else {
            ungroupedUsers.push(user);
        }
    });

    const personalUsers = getPersonalOrder('users');
    const sortedGroups = sortByPersonal(state.groups, getPersonalOrder('groups'), g => g.id, g => g.order);
    const admin = isAdmin();

    sortedGroups.forEach(group => {
        const isUngrouped = group.id === 'ungrouped';
        const usersInGroup = sortByPersonal(
            isUngrouped ? ungroupedUsers : (groupedUsers[group.id] || []),
            personalUsers,
            u => u.id,
            u => u.order
        );

        // Пустые группы при активном фильтре не показываем:
        // они пусты из-за фильтра, а не сами по себе
        if (filterActive) {
            if (usersInGroup.length === 0) return;
        } else if (usersInGroup.length === 0 && !group.showIfEmpty && !isUngrouped) {
            return;
        }

        const groupBlock = document.createElement('div');
        groupBlock.className = 'group-block';
        groupBlock.dataset.groupId = group.id;

        const groupHeader = document.createElement('div');
        groupHeader.className = 'group-header';

        // Цвет группы меняет только админ, остальные видят его точкой
        const colorPicker = isUngrouped
            ? `<div class="group-color-picker-inline" style="background: #555; cursor: default;"></div>`
            : (admin
                ? `<input type="color" class="group-color-picker-inline" value="${group.color}" title="Изменить цвет группы">`
                : `<div class="group-color-picker-inline" style="background: ${group.color}; cursor: default;" title="Цвет группы (меняет администратор)"></div>`);

        // Видимость сотрудников группы — личные «глаза». Кнопка в шапке группы
        // скрывает/показывает сразу всех, чтобы не прокликивать каждого.
        const groupMembers = usersInGroup.map(user => user.id);
        const eyeState = getGroupEyeState(isUngrouped ? 'ungrouped' : group.id);

        groupBlock.dataset.groupHidden = eyeState.dim ? 'true' : 'false';

        groupHeader.innerHTML = `
            ${colorPicker}
            <div class="group-name">${group.name} (${usersInGroup.length})</div>
            <div class="group-actions">
                <button class="btn_icon toggle-group-btn" title="Свернуть/Развернуть">▼</button>
                <button class="btn_icon btn_icon-group toggle-group-visibility" title="${eyeState.title}" style="color: ${eyeState.color}">
                    ${eyeState.icon}
                </button>
            </div>
        `;

        groupHeader.querySelector('.toggle-group-visibility').addEventListener('click', (e) => {
            e.stopPropagation();

            // состояние считаем в момент клика: после ручных кликов по глазам
            // подпись обновилась, а сохранённое значение — уже устарело
            const current = getGroupEyeState(isUngrouped ? 'ungrouped' : group.id);
            groupMembers.forEach(id => setUserHidden(id, current.allVisible));

            requestRender();
            updateCalendarVacations();
        });

        if (!isUngrouped && admin) {
            groupHeader.querySelector('.group-color-picker-inline').addEventListener('change', async (e) => {
                await updateGroup(group.id, { color: e.target.value });
            });
        }

        const groupUsersContainer = document.createElement('div');
        groupUsersContainer.className = 'group-users';
        groupUsersContainer.dataset.groupId = isUngrouped ? '' : group.id;

        // Свёрнутость группы — личная настройка (localStorage), у каждого своя
        const isCollapsed = isGroupCollapsed(group.id);

        if (isCollapsed) {
            groupUsersContainer.classList.add('collapsed');
        }

        const toggleBtn = groupHeader.querySelector('.toggle-group-btn');
        toggleBtn.textContent = isCollapsed ? '▼' : '▲';

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newIsCollapsed = toggleGroupCollapsed(group.id);

            if (newIsCollapsed) {
                groupUsersContainer.classList.add('collapsed');
                e.target.textContent = '▼';
            } else {
                groupUsersContainer.classList.remove('collapsed');
                e.target.textContent = '▲';
            }
        });

        usersInGroup.forEach(user => {
            const div = document.createElement('div');
            div.id = `user-card-${user.id}`;
            groupUsersContainer.appendChild(div);
        });

        groupBlock.appendChild(groupHeader);
        groupBlock.appendChild(groupUsersContainer);
        usersContainer.appendChild(groupBlock);

        usersInGroup.forEach(user => renderUserCard(user, requestRender, updateCalendarVacations));
    });

    updateCalendarVacations();
    initGroupSortable();
    initUserDragAndDrop();
}

// --- Сортировка групп ---
let groupSortableInstance = null;
function initGroupSortable() {
    if (groupSortableInstance) groupSortableInstance.destroy();
    groupSortableInstance = new Sortable(usersContainer, {
        animation: 150,
        handle: '.group-header',
        filter: '.toggle-group-btn, .toggle-group-visibility, .group-color-picker-inline',
        preventOnFilter: false,
        ghostClass: 'group-block-ghost',

        onStart: function (evt) {
            const item = evt.item;
            const usersContainer = item.querySelector('.group-users');
            if (usersContainer) {
                usersContainer.classList.add('collapsed');
            }
        },

        onEnd: async function (evt) {
            if (evt.oldIndex === evt.newIndex) {
                const item = evt.item;
                const usersContainer = item.querySelector('.group-users');
                const groupId = item.dataset.groupId;
                if (usersContainer && !isGroupCollapsed(groupId)) {
                    usersContainer.classList.remove('collapsed');
                }
                return;
            }

            const newOrderIds = Array.from(usersContainer.children).map(el => el.dataset.groupId).filter(id => id !== undefined);

            if (isAdmin()) {
                // Админ задаёт порядок групп для всех
                newOrderIds.forEach((groupId, index) => {
                    const group = state.groups.find(g => g.id === groupId);
                    if (group && group.order !== index) {
                        group.order = index;
                        const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "groups", groupId);
                        window.firestore.setDoc(docRef, { order: index }, { merge: true }).catch(console.error);
                    }
                });
            } else {
                // Остальные запоминают порядок только у себя
                setPersonalOrder('groups', newOrderIds);
            }

            requestRender();
        }
    });
}

// --- Перетаскивание сотрудников ---
let userSortableInstances = [];

function initUserDragAndDrop() {
    userSortableInstances.forEach(instance => {
        if (instance && typeof instance.destroy === 'function') instance.destroy();
    });
    userSortableInstances = [];

    const admin = isAdmin();
    const containers = document.querySelectorAll('.group-users');
    containers.forEach(container => {
        const sortable = new Sortable(container, {
            // Перетаскивать между группами может только админ (это меняет данные),
            // остальные переставляют карточки только у себя
            group: admin ? 'shared-users' : { name: 'shared-users', pull: false, put: false },
            animation: 150,
            handle: '.form__drag-handle-user',
            ghostClass: 'form__user-sortable-ghost',

            onMove: function (evt) {
                const related = evt.related;
                if (!related) return;

                const groupBlock = related.closest('.group-block');
                if (!groupBlock) return;

                const groupId = groupBlock.dataset.groupId;

                // Порядок карточек личный — переставлять можно кого угодно.
                // А вот перенести чужого сотрудника в ДРУГУЮ группу может только админ.
                if (!admin) {
                    const draggedId = evt.dragged && evt.dragged.id ? evt.dragged.id.replace('user-card-', '') : '';
                    const fromGroupId = evt.from ? (evt.from.dataset.groupId || '') : '';
                    const toGroupId = evt.to ? (evt.to.dataset.groupId || '') : '';

                    if (draggedId !== getCurrentUserId() && fromGroupId !== toGroupId) {
                        showNotice('Перенести сотрудника в другую группу может только администратор. Себя — можно.');
                        return false;
                    }
                }

                // Если целевая группа свёрнута — разворачиваем
                if (isGroupCollapsed(groupId)) {
                    const usersContainer = groupBlock.querySelector('.group-users');
                    if (usersContainer) {
                        usersContainer.classList.remove('collapsed');
                        const toggleBtn = groupBlock.querySelector('.toggle-group-btn');
                        if (toggleBtn) toggleBtn.textContent = '▲';
                        setGroupCollapsed(groupId, false);
                    }
                }
            },

            onEnd: async function (evt) {
                // личный порядок карточек сохраняем каждому в localStorage
                setPersonalOrder('users', collectUserOrder());

                const itemEl = evt.item;
                const newGroupId = evt.to.dataset.groupId;
                const userId = itemEl.id.replace('user-card-', '');
                const user = state.users.find(u => u.id === userId);

                // смена группы: админ — кому угодно, сотрудник — только себе
                const canMove = admin || userId === getCurrentUserId();
                if (canMove && user && user.groupId !== newGroupId) {
                    user.groupId = newGroupId;
                    const { id, ...dataToSave } = user;
                    const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", userId);
                    await window.firestore.setDoc(docRef, dataToSave, { merge: true });
                }

                requestRender();
            }
        });
        userSortableInstances.push(sortable);
    });
}

// --- Фильтр «показать отпуска за месяц» ---

const viewMonthSelect = document.getElementById('view-month');

if (viewMonthSelect) {
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'Весь год';
    viewMonthSelect.appendChild(allOption);

    MONTH_NAMES.forEach((name, index) => {
        const monthOption = document.createElement('option');
        monthOption.value = String(index);
        monthOption.textContent = name;
        viewMonthSelect.appendChild(monthOption);
    });

    viewMonthSelect.value = '';
    viewMonthSelect.addEventListener('change', (event) => {
        setViewMonth(event.target.value === '' ? null : Number(event.target.value));
    });
}

// Календарь рисуем на выбранный месяц (плюс соседние, если задевают отпуска)
function renderCalendarForView() {
    const { from, to } = getCalendarMonthRange(state.users);
    renderCalendar(state.year, from, to);
    updateViewBanner();
}

function updateViewBanner() {
    const banner = document.getElementById('view-banner');
    const text = document.getElementById('view-banner-text');
    const chip = document.getElementById('side-filter');
    const chipText = document.getElementById('side-filter-text');

    const month = getViewMonth();
    const shown = month === null ? state.users.length : filterUsersByViewMonth(state.users).length;

    if (month === null) {
        if (banner) banner.hidden = true;
        if (chip) chip.hidden = true;
        if (viewMonthSelect) viewMonthSelect.classList.remove('year-select_view-active');
        return;
    }

    const monthName = MONTH_NAMES[month].toLowerCase();

    if (banner && text) {
        banner.hidden = false;
        text.textContent = `Показаны отпуска за ${monthName}: сотрудников ${shown} из ${state.users.length}`;
    }

    // Дублируем прямо над списком сотрудников — иначе фильтр легко не заметить
    if (chip && chipText) {
        chip.hidden = false;
        chipText.textContent = `Фильтр: ${monthName} · ${shown} из ${state.users.length}`;
    }

    if (viewMonthSelect) {
        viewMonthSelect.value = String(month);
        viewMonthSelect.classList.add('year-select_view-active');
    }
}

const viewBannerReset = document.getElementById('view-banner-reset');
if (viewBannerReset) {
    viewBannerReset.addEventListener('click', () => setViewMonth(null));
}

const sideFilterReset = document.getElementById('side-filter-reset');
if (sideFilterReset) {
    sideFilterReset.addEventListener('click', () => setViewMonth(null));
}

stateEvents.addEventListener('viewfilterchange', () => {
    renderCalendarForView();
    requestRender();
});

// Журнал не должен разрастаться: подрезаем старые записи один раз за сессию
let pruneScheduled = false;
stateEvents.addEventListener('statechange', () => {
    if (pruneScheduled || !isAdmin()) return;
    pruneScheduled = true;
    schedulePrune(state.year);
});

// --- Инициализация ---

stateEvents.addEventListener('statechange', () => {
    document.getElementById('header-title').textContent = `График отпусков`;
    document.getElementById('header-year').textContent = state.year;
    const yearSelect = document.getElementById('year-select');
    if (yearSelect) yearSelect.value = state.year;
    if (!document.querySelector('.calendar__month')) renderCalendarForView();

    updateUserChip();
    requestRender();
});

window.addEventListener('calendarReady', () => updateCalendarVacations());

// Имя по умолчанию не должно повторяться: иначе сотрудников не различить,
// а вход «Кто вы?» склеит одинаковые имена в одного человека.
function buildNewUserName() {
    const base = 'Новый сотрудник';
    const taken = new Set(state.users.map(user => String(user.name || '').trim().toLowerCase()));

    if (!taken.has(base.toLowerCase())) return base;

    let index = 2;
    while (taken.has(`${base} ${index}`.toLowerCase())) index += 1;
    return `${base} ${index}`;
}

document.getElementById('btn-add-user').addEventListener('click', async () => {
    const colRef = window.firestore.collection(window.db, "vacationData_v2", String(state.year), "users");
    const newDocRef = window.firestore.doc(colRef);

    const newUser = {
        id: newDocRef.id,
        name: buildNewUserName(),
        // Пустые поля ФИО: заполняются сразу в открывшемся профиле
        profile: { lastName: '', firstName: '', middleName: '' },
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        vacations: [],
        order: Date.now(),
        isHidden: false,
        isVisible: true,
        groupId: ''
    };

    if (isGroupCollapsed('ungrouped')) {
        setGroupCollapsed('ungrouped', false);
        const ungroupedBlock = document.querySelector(`.group-block[data-group-id="ungrouped"]`);
        if (ungroupedBlock) {
            const container = ungroupedBlock.querySelector('.group-users');
            if (container) container.classList.remove('collapsed');
            const btn = ungroupedBlock.querySelector('.toggle-group-btn');
            if (btn) btn.textContent = '▲';
        }
    }

    state.users = [...state.users, newUser];
    requestRender();
    window.firestore.setDoc(newDocRef, newUser).catch(console.error);

    logEvent({
        action: 'user.add',
        message: `Добавил сотрудника «${newUser.name}»`,
        targetId: newUser.id,
        targetName: newUser.name
    });

    // Сразу открываем профиль: без ФИО сотрудник в графике бесполезен
    openProfileModal(newUser.id);
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    logEvent({ action: 'auth.logout', message: 'Вышел из системы' });
    clearSession();
    window.location.href = 'login.html';
});

const exportButton = document.getElementById('btn-export-excel');
if (exportButton) {
    // Открываем окно выгрузки: кого выгружать, месяцы, пропуск сотрудников без отпусков
    exportButton.addEventListener('click', () => openExportDialog());
}

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
            url.searchParams.set("year", String(newYear));
            window.location.href = url.toString();
        }
    });
}

// --- Кто вошёл и что ему можно ---

function applyAccessRules() {
    updateUserChip();

    if (isAdmin()) return;

    // Сотрудник не добавляет сотрудников и не может сбросить данные.
    // Шестерёнка настроек остаётся — там его личные настройки групп.
    ['btn-add-user'].forEach(id => {
        const node = document.getElementById(id);
        if (node) node.style.display = 'none';
    });

    // «Сбросить всё» — только администратор. Выгрузка в Excel доступна всем.
    const resetButton = document.getElementById('btn-reset');
    if (resetButton) resetButton.style.display = 'none';

    // Журнал действий — тоже только администратор
    const journalButton = document.getElementById('btn-journal');
    if (journalButton) journalButton.style.display = 'none';

    // Загрузка из Excel — только администратор
    const importButton = document.getElementById('btn-import');
    if (importButton) importButton.style.display = 'none';
}

applyAccessRules();

// Без авторизации приложение не инициализируем (index.html уже уводит на login.html)
if (isAuthenticated()) {
    ensureUngroupedGroup().then(() => {
        initUserChip();
        initProfileModal();
        initGroupsUI();
        initExportDialog();
        initJournal();
        initResetDialog();
        initImportDialog();
        initCalendarInteractions();
        initState();
    });
}