// state.js — v3 (Группы + Пользователи)

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function isValidYear(y) { return Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR; }

function resolveInitialYear() {
    const params = new URLSearchParams(window.location.search);
    const urlYear = Number(params.get("year"));
    if (isValidYear(urlYear)) return urlYear;
    const lsYear = Number(localStorage.getItem("vacationYear"));
    if (isValidYear(lsYear)) return lsYear;
    return new Date().getFullYear();
}

export const state = {
    year: resolveInitialYear(),
    users: [],
    groups: [],
    loading: true,
    error: null,
    _unsubscribeUsers: null,
    _unsubscribeGroups: null,
    _pendingRemote: null,
    _localEditing: false,
};

export const stateEvents = new EventTarget();

function emitChange() {
    stateEvents.dispatchEvent(new Event('statechange'));
}

function usersCollection(year) {
    return window.firestore.collection(window.db, "vacationData_v2", String(year), "users");
}

function groupsCollection(year) {
    return window.firestore.collection(window.db, "vacationData_v2", String(year), "groups");
}

function isUserTypingNow() {
    const el = document.activeElement;
    if (!el) return false;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
    if (el.isContentEditable) return true;
    return false;
}

function applyRemoteUsers(users) {
    if (isUserTypingNow() || state._localEditing) {
        state._pendingRemote = users;
        return;
    }
    state.users = users;
    state.loading = false;
    emitChange();
}

function flushPendingRemote() {
    if (state._pendingRemote) {
        state.users = state._pendingRemote;
        state._pendingRemote = null;
        emitChange();
    }
}

document.addEventListener("focusout", () => setTimeout(flushPendingRemote, 50), true);

async function startSubscription(year) {
    if (state._unsubscribeUsers) state._unsubscribeUsers();
    if (state._unsubscribeGroups) state._unsubscribeGroups();

    await window.firebaseReady;

    state.year = year;
    state.loading = true;
    state.users = [];
    state.groups = [];
    emitChange();

    const { onSnapshot, query } = window.firestore;

    state._unsubscribeUsers = onSnapshot(query(usersCollection(year)), (snapshot) => {
        const users = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.order) data.order = 0;
            if (!data.groupId) data.groupId = '';
            users.push({ id: doc.id, ...data });
        });

        users.sort((a, b) => a.order - b.order);

        if (state._localEditing) {
            console.log('[state] localEditing, skipping snapshot');
            return;
        }

        applyRemoteUsers(users);
    }, (error) => {
        console.error("[state] Ошибка синхронизации пользователей:", error);
        state.error = error.message;
        state.loading = false;
        emitChange();
    });

    state._unsubscribeGroups = onSnapshot(query(groupsCollection(year)), (snapshot) => {
        const groups = [];
        snapshot.forEach(doc => {
            groups.push({ id: doc.id, ...doc.data() });
        });

        groups.sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));

        state.groups = groups;
        emitChange();
    }, (error) => {
        console.error("[state] Ошибка синхронизации групп:", error);
    });
}

export async function initState() {
    const year = state.year;
    localStorage.setItem("vacationYear", String(year));
    const url = new URL(window.location.href);
    url.searchParams.set("year", String(year));
    window.history.replaceState({}, "", url);

    await startSubscription(year);
}

export async function setYear(newYear) {
    if (newYear === state.year) return;
    localStorage.setItem("vacationYear", String(newYear));
    const url = new URL(window.location.href);
    url.searchParams.set("year", String(newYear));
    window.history.pushState({}, "", url);
    await startSubscription(newYear);
}

export function getAvailableYears() {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear - 2; y <= currentYear + 3; y++) {
        years.push(y);
    }
    return years;
}

export async function addGroup(name, color, showIfEmpty = false) {
    const colRef = groupsCollection(state.year);
    const newDocRef = window.firestore.doc(colRef);

    const newGroup = {
        name: name,
        color: color || '#808080',
        isVisible: true,
        showIfEmpty: showIfEmpty,
        isCollapsed: false,
        order: Date.now()
    };

    try {
        await window.firestore.setDoc(newDocRef, newGroup);
        return newDocRef.id;
    } catch (e) {
        console.error("Ошибка создания группы:", e);
    }
}

export async function updateGroup(groupId, data) {
    const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "groups", groupId);
    try {
        await window.firestore.setDoc(docRef, data, { merge: true });
    } catch (e) {
        console.error("Ошибка обновления группы:", e);
    }
}

export async function deleteGroup(groupId) {
    const docRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "groups", groupId);
    try {
        await window.firestore.deleteDoc(docRef);

        const usersToUpdate = state.users.filter(u => u.groupId === groupId);
        for (const u of usersToUpdate) {
            const userDocRef = window.firestore.doc(window.db, "vacationData_v2", String(state.year), "users", u.id);
            await window.firestore.setDoc(userDocRef, { groupId: '' }, { merge: true });
        }
    } catch (e) {
        console.error("Ошибка удаления группы:", e);
    }
}