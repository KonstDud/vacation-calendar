// scripts/app.js — v32 (Автовосстановление "Без группы")

import { state, initState, stateEvents, getAvailableYears, updateGroup } from './state.js';
import { renderCalendar } from './calendar.js';
import { initCalendarInteractions } from './calendar-interactions.js';
import { initGroupsUI } from './groups.js';
import { renderUserCard, scheduleSave, getUserDoc } from './user-card.js';
import { updateCalendarVacations as renderCalendarVacations } from './calendar-grid.js';
import { getIconEye, getIconEyeOff } from './utils.js';

const usersContainer = document.getElementById('users-container');

const updateCalendarVacations = () => renderCalendarVacations(scheduleSave, requestRender, renderUserCard);

// Восстанавливаем "Без группы", если её нет
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

    const sortedGroups = [...state.groups].sort((a, b) => (a.order || 0) - (b.order || 0));

    sortedGroups.forEach(group => {
        const isUngrouped = group.id === 'ungrouped';
        const usersInGroup = isUngrouped ? ungroupedUsers : (groupedUsers[group.id] || []);

        if (usersInGroup.length === 0 && !group.showIfEmpty && !isUngrouped) return;

        const groupBlock = document.createElement('div');
        groupBlock.className = 'group-block';
        groupBlock.dataset.groupId = group.id;

        const groupHeader = document.createElement('div');
        groupHeader.className = 'group-header';

        const colorPicker = isUngrouped
            ? `<div class="group-color-picker-inline" style="background: #555; cursor: default;"></div>`
            : `<input type="color" class="group-color-picker-inline" value="${group.color}" title="Изменить цвет группы">`;

        groupHeader.innerHTML = `
            ${colorPicker}
            <div class="group-name">${group.name} (${usersInGroup.length})</div>
            <div class="group-actions">
                <button class="btn_icon toggle-group-btn" title="Свернуть/Развернуть">▼</button>
                <button class="btn_icon btn_icon-group toggle-group-visibility" title="${group.isVisible ? 'Скрыть группу' : 'Показать группу'}" style="color: ${group.isVisible ? 'var(--accent-green)' : 'var(--text-muted)'}">
                    ${group.isVisible ? getIconEye() : getIconEyeOff()}
                </button>
            </div>
        `;

        if (!isUngrouped) {
            groupHeader.querySelector('.group-color-picker-inline').addEventListener('change', async (e) => {
                await updateGroup(group.id, { color: e.target.value });
            });
        }

        const groupUsersContainer = document.createElement('div');
        groupUsersContainer.className = 'group-users';
        groupUsersContainer.dataset.groupId = isUngrouped ? '' : group.id;

        const isCollapsed = group.isCollapsed === true;
        groupUsersContainer.style.display = isCollapsed ? 'none' : 'flex';

        const toggleBtn = groupHeader.querySelector('.toggle-group-btn');
        toggleBtn.textContent = isCollapsed ? '▼' : '▲';

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHiddenNow = groupUsersContainer.style.display === 'none';
            groupUsersContainer.style.display = isHiddenNow ? 'flex' : 'none';
            e.target.textContent = isHiddenNow ? '▼' : '▲';
        });

        groupHeader.querySelector('.toggle-group-visibility').addEventListener('click', async (e) => {
            e.stopPropagation();
            const newVisibility = !group.isVisible;
            const btn = e.currentTarget;

            group.isVisible = newVisibility;

            btn.style.color = newVisibility ? 'var(--accent-green)' : 'var(--text-muted)';
            btn.innerHTML = newVisibility ? getIconEye() : getIconEyeOff();

            updateCalendarVacations();

            await updateGroup(group.id, { isVisible: newVisibility });
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
        ghostClass: 'group-block-ghost',
        onEnd: async function (evt) {
            if (evt.oldIndex === evt.newIndex) return;
            const newOrderIds = Array.from(usersContainer.children).map(el => el.dataset.groupId).filter(id => id !== undefined);
            newOrderIds.forEach((groupId, index) => {
                const group = state.groups.find(g => g.id === groupId);
                if (group && group.order !== index) {
                    group.order = index;
                    const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "groups", groupId);
                    window.firestore.setDoc(docRef, { order: index }, { merge: true }).catch(console.error);
                }
            });
        }
    });
}

// --- Перетаскивание сотрудников ---
function initUserDragAndDrop() {
    const containers = document.querySelectorAll('.group-users');
    containers.forEach(container => {
        new Sortable(container, {
            group: 'shared-users',
            animation: 150,
            handle: '.form__drag-handle-user',
            ghostClass: 'form__user-sortable-ghost',
            onEnd: async function (evt) {
                const itemEl = evt.item;
                const newContainer = evt.to;
                const userId = itemEl.id.replace('user-card-', '');
                const newGroupId = newContainer.dataset.groupId;

                const user = state.users.find(u => u.id === userId);
                if (user && user.groupId !== newGroupId) {
                    user.groupId = newGroupId;
                    const { id, ...dataToSave } = user;
                    const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", userId);
                    await window.firestore.setDoc(docRef, dataToSave, { merge: true });
                    requestRender();
                }
            }
        });
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

document.getElementById('btn-add-user').addEventListener('click', () => {
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
            url.searchParams.set("year", String(newYear));
            window.location.href = url.toString();
        }
    });
}

ensureUngroupedGroup().then(() => {
    initGroupsUI();
    initCalendarInteractions();
    initState();
});