// scripts/app.js — Фикс сброса сворачивания при перерисовке

import { state, initState, stateEvents, getAvailableYears, updateGroup } from './state.js';
import { renderCalendar } from './calendar.js';
import { initCalendarInteractions } from './calendar-interactions.js';
import { initGroupsUI } from './groups.js';
import { renderUserCard, scheduleSave } from './user-card.js';
import { updateCalendarVacations as renderCalendarVacations } from './calendar-grid.js';
import { getIconEye, getIconEyeOff } from './utils.js';
import { clearSession, getCurrentUserName, getCurrentUserId, getRoleLabel, isAdmin, isAuthenticated } from './auth.js';
import { isGroupHidden, toggleGroupHidden, isGroupCollapsed, setGroupCollapsed, toggleGroupCollapsed, getPersonalOrder, setPersonalOrder } from './view-prefs.js';

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

// Короткая всплывающая подсказка
let hintTimeout = null;
function showHint(text) {
    let node = document.getElementById('app-hint');
    if (!node) {
        node = document.createElement('div');
        node.id = 'app-hint';
        node.className = 'app-hint';
        document.body.appendChild(node);
    }

    node.textContent = text;
    node.classList.add('app-hint_visible');

    clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => node.classList.remove('app-hint_visible'), 2600);
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

    const groupedUsers = {}; const ungroupedUsers = [];
    state.users.forEach(user => {
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

        if (usersInGroup.length === 0 && !group.showIfEmpty && !isUngrouped) return;

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

        // Видимость группы — тоже личная настройка (у каждого своя)
        const groupHidden = isGroupHidden(group.id);
        groupBlock.dataset.groupHidden = groupHidden ? 'true' : 'false';

        groupHeader.innerHTML = `
            ${colorPicker}
            <div class="group-name">${group.name} (${usersInGroup.length})</div>
            <div class="group-actions">
                <button class="btn_icon toggle-group-btn" title="Свернуть/Развернуть">▼</button>
                <button class="btn_icon btn_icon-group toggle-group-visibility" title="${groupHidden ? 'Показать группу' : 'Скрыть группу'}" style="color: ${groupHidden ? 'var(--text-muted)' : 'var(--accent-green)'}">
                    ${groupHidden ? getIconEyeOff() : getIconEye()}
                </button>
            </div>
        `;

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

        groupHeader.querySelector('.toggle-group-visibility').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGroupHidden(group.id);
            // Перерисовываем панель: иначе у карточек остаётся старое состояние
            requestRender();
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
                        showHint('Перенести сотрудника в другую группу может только администратор. Себя — можно.');
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

// --- Инициализация ---

stateEvents.addEventListener('statechange', () => {
    document.getElementById('header-title').textContent = `График отпусков`;
    document.getElementById('header-year').textContent = state.year;
    const yearSelect = document.getElementById('year-select');
    if (yearSelect) yearSelect.value = state.year;
    if (!document.querySelector('.calendar__month')) renderCalendar(state.year);

    requestRender();
});

window.addEventListener('calendarReady', () => updateCalendarVacations());

document.getElementById('btn-add-user').addEventListener('click', async () => {
    const colRef = window.firestore.collection(window.db, "vacationData_v2", String(state.year), "users");
    const newDocRef = window.firestore.doc(colRef);

    const newUser = {
        id: newDocRef.id,
        name: 'Новый сотрудник',
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
});

document.getElementById('btn-logout').addEventListener('click', () => {
    clearSession();
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
            url.searchParams.set("year", String(newYear));
            window.location.href = url.toString();
        }
    });
}

// --- Кто вошёл и что ему можно ---

function applyAccessRules() {
    const userLabel = document.getElementById('header-user');
    if (userLabel) {
        const name = getCurrentUserName();
        const roleLabel = getRoleLabel();
        userLabel.textContent = name ? `${name} · ${roleLabel}` : roleLabel;
    }

    if (isAdmin()) return;

    // Сотрудник не добавляет сотрудников и не может сбросить данные.
    // Шестерёнка настроек остаётся — там его личные настройки групп.
    ['btn-add-user'].forEach(id => {
        const node = document.getElementById(id);
        if (node) node.style.display = 'none';
    });

    const sideFooter = document.querySelector('.side-footer');
    if (sideFooter) sideFooter.style.display = 'none';
}

applyAccessRules();

// Без авторизации приложение не инициализируем (index.html уже уводит на login.html)
if (isAuthenticated()) {
    ensureUngroupedGroup().then(() => {
        initGroupsUI();
        initCalendarInteractions();
        initState();
    });
}