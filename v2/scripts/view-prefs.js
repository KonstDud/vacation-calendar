// scripts/view-prefs.js — личные настройки отображения (кто/что видно на календаре).
// Хранятся в localStorage отдельно для каждого пользователя: то, что скрыл один,
// не влияет на остальных.

import { getCurrentUserId } from './auth.js';

const KEY_PREFIX = 'vacationView';

function storageKey() {
    return `${KEY_PREFIX}_${getCurrentUserId() || 'anon'}`;
}

function read() {
    try {
        const raw = localStorage.getItem(storageKey());
        const data = raw ? JSON.parse(raw) : {};
        const orders = data.orders || {};
        return {
            hiddenUsers: Array.isArray(data.hiddenUsers) ? data.hiddenUsers : [],
            hiddenGroups: Array.isArray(data.hiddenGroups) ? data.hiddenGroups : [],
            collapsedGroups: Array.isArray(data.collapsedGroups) ? data.collapsedGroups : [],
            orders: {
                users: Array.isArray(orders.users) ? orders.users : [],
                groups: Array.isArray(orders.groups) ? orders.groups : []
            }
        };
    } catch (error) {
        return { hiddenUsers: [], hiddenGroups: [], collapsedGroups: [], orders: { users: [], groups: [] } };
    }
}

function write(view) {
    try {
        localStorage.setItem(storageKey(), JSON.stringify(view));
    } catch (error) {
        console.warn('[view-prefs] Не удалось сохранить настройки отображения', error);
    }
}

function toggle(list, id) {
    return list.includes(id) ? list.filter(item => item !== id) : [...list, id];
}

export function isUserHidden(userId) {
    return read().hiddenUsers.includes(userId);
}

export function isGroupHidden(groupId) {
    return read().hiddenGroups.includes(groupId);
}

// Возвращает новое состояние: true — сотрудник скрыт
export function toggleUserHidden(userId) {
    const view = read();
    view.hiddenUsers = toggle(view.hiddenUsers, userId);
    write(view);
    return view.hiddenUsers.includes(userId);
}

// Возвращает новое состояние: true — группа скрыта
export function toggleGroupHidden(groupId) {
    return setGroupHidden(groupId, !isGroupHidden(groupId));
}

export function setGroupHidden(groupId, hidden) {
    const view = read();
    view.hiddenGroups = hidden
        ? (view.hiddenGroups.includes(groupId) ? view.hiddenGroups : [...view.hiddenGroups, groupId])
        : view.hiddenGroups.filter(id => id !== groupId);
    write(view);
    return view.hiddenGroups.includes(groupId);
}

// --- свёрнута ли группа по умолчанию (тоже личная настройка) ---

export function isGroupCollapsed(groupId) {
    return read().collapsedGroups.includes(groupId);
}

export function setGroupCollapsed(groupId, collapsed) {
    const view = read();
    view.collapsedGroups = collapsed
        ? (view.collapsedGroups.includes(groupId) ? view.collapsedGroups : [...view.collapsedGroups, groupId])
        : view.collapsedGroups.filter(id => id !== groupId);
    write(view);
    return view.collapsedGroups.includes(groupId);
}

// Возвращает новое состояние: true — свёрнута
export function toggleGroupCollapsed(groupId) {
    return setGroupCollapsed(groupId, !isGroupCollapsed(groupId));
}

export function clearViewPrefs() {
    try {
        localStorage.removeItem(storageKey());
    } catch (error) {
        console.warn('[view-prefs] Не удалось очистить настройки отображения', error);
    }
}

// --- личный порядок карточек и групп ---

// kind: 'users' | 'groups'
export function getPersonalOrder(kind) {
    const orders = read().orders;
    return orders[kind] || [];
}

export function setPersonalOrder(kind, ids) {
    const view = read();
    view.orders[kind] = Array.isArray(ids) ? ids : [];
    write(view);
    return view.orders[kind];
}
