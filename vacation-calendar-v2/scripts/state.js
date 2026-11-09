// state.js — v2 (Event-Driven + фикс onSnapshot)

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
    loading: true,
    error: null,
    _unsubscribe: null,
    _pendingRemote: null,
    _localEditing: false, // Флаг блокировки входящих обновлений
};

export const stateEvents = new EventTarget();

function emitChange() {
    stateEvents.dispatchEvent(new Event('statechange'));
}

function usersCollection(year) {
    return window.firestore.collection(window.db, "vacationData_v2", String(year), "users");
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
    if (state._unsubscribe) state._unsubscribe();
    await window.firebaseReady;

    state.year = year;
    state.loading = true;
    state.users = [];
    emitChange();

    const { onSnapshot, query } = window.firestore;
    state._unsubscribe = onSnapshot(query(usersCollection(year)), (snapshot) => {
        const users = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.order) data.order = 0;
            users.push({ id: doc.id, ...data });
        });

        users.sort((a, b) => a.order - b.order);

        // Если мы сейчас сохраняем локальные изменения — игнорируем
        if (state._localEditing) {
            console.log('[state] localEditing, skipping snapshot');
            return;
        }

        applyRemoteUsers(users);
    }, (error) => {
        console.error("[state] Ошибка синхронизации:", error);
        state.error = error.message;
        state.loading = false;
        emitChange();
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