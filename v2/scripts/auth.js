// scripts/auth.js — вход, роли и права доступа
//
// Этап A: роли живут в Firestore (коллекция access), проверка паролей — на клиенте.
// Это разграничение прав и удобство, а не защита от недобросовестного пользователя
// (клиентские проверки всегда можно обойти через DevTools).
// Этап B: Firebase Auth + правила Firestore сделают то же самое по-настоящему —
// тогда меняется только этот модуль, остальной код остаётся как есть.

const SESSION_KEY = 'vacationAuth';
const USER_ID_KEY = 'vacationUserId';
const USER_NAME_KEY = 'vacationUserName';
const ROLE_KEY = 'vacationUserRole';

export const ROLES = {
    ADMIN: 'admin',
    USER: 'user',
    VIEWER: 'viewer'
};

export const ROLE_LABELS = {
    admin: 'Администратор',
    user: 'Сотрудник',
    viewer: 'Только просмотр'
};

export const ACCESS_COLLECTION = 'access';

// --- сессия ---

export function isAuthenticated() {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
}

export function getCurrentUserId() {
    return sessionStorage.getItem(USER_ID_KEY) || '';
}

export function getCurrentUserName() {
    return sessionStorage.getItem(USER_NAME_KEY) || '';
}

export function getRole() {
    return sessionStorage.getItem(ROLE_KEY) || '';
}

export function getRoleLabel() {
    return ROLE_LABELS[getRole()] || '';
}

export function isAdmin() {
    return getRole() === ROLES.ADMIN;
}

// Полные права на управление сотрудниками (добавление, удаление, роли)
export function canManageUsers() {
    return isAdmin();
}

// Редактирование отпусков/имени/цвета: админ — всех, сотрудник — только себя
export function canEditUser(userId) {
    const role = getRole();
    if (role === ROLES.ADMIN) return true;
    if (role === ROLES.USER) return !!userId && getCurrentUserId() === userId;
    return false;
}

export function saveSession({ userId = '', name = '', role = ROLES.USER } = {}) {
    sessionStorage.setItem(SESSION_KEY, 'true');
    sessionStorage.setItem(USER_ID_KEY, userId);
    sessionStorage.setItem(USER_NAME_KEY, name);
    sessionStorage.setItem(ROLE_KEY, role);
}

export function clearSession() {
    [SESSION_KEY, USER_ID_KEY, USER_NAME_KEY, ROLE_KEY].forEach(key => sessionStorage.removeItem(key));
}

// --- пароли ---

const textEncoder = new TextEncoder();
const PBKDF2_ITERATIONS = 100000;

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (b64) => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));

async function deriveHash(password, salt) {
    const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        key,
        256
    );
}

export async function makePasswordRecord(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await deriveHash(password, salt);
    return { salt: toBase64(salt), hash: toBase64(hash) };
}

export async function verifyPassword(password, record) {
    if (!record || !record.salt || !record.hash) return false;
    const hash = await deriveHash(password, fromBase64(record.salt));
    return toBase64(hash) === record.hash;
}

// SHA-256 в hex — в таком виде хранится уже существующий общий пароль команды
export async function sha256Hex(text) {
    const buffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Firestore ---

const docRef = (...segments) => window.firestore.doc(window.db, ...segments);

export async function verifyTeamPassword(password) {
    const snap = await window.firestore.getDoc(docRef('auth', 'password'));
    const expected = snap.exists() ? (snap.data().hash || '') : '';
    if (!expected) return false;
    return (await sha256Hex(password)) === expected;
}

export async function hasAdminPassword() {
    const snap = await window.firestore.getDoc(docRef('auth', 'adminPassword'));
    return snap.exists() && !!snap.data().hash;
}

// Пока отдельный админский пароль не задан, как запасной путь работает общий пароль команды,
// чтобы можно было войти и назначить настоящий (меняется на странице админки).
export async function verifyAdminPassword(password) {
    const snap = await window.firestore.getDoc(docRef('auth', 'adminPassword'));
    if (snap.exists() && snap.data().hash) return verifyPassword(password, snap.data());
    return verifyTeamPassword(password);
}

export async function setAdminPassword(password) {
    const record = await makePasswordRecord(password);
    await window.firestore.setDoc(docRef('auth', 'adminPassword'), { ...record, updatedAt: Date.now() }, { merge: true });
}

// Общий пароль команды хранится как SHA-256 (так его проверяет verifyTeamPassword)
export async function setTeamPassword(password) {
    const hash = await sha256Hex(password);
    await window.firestore.setDoc(docRef('auth', 'password'), { hash, updatedAt: Date.now() }, { merge: true });
    return hash;
}

// --- доступы сотрудников ---

export async function getAccessRecord(userId) {
    const snap = await window.firestore.getDoc(docRef(ACCESS_COLLECTION, userId));
    return snap.exists() ? snap.data() : null;
}

// password === null — меняем только имя/роль, пароль не трогаем
export async function saveUserAccess(userId, name, password, role = ROLES.USER) {
    const data = { name, role, updatedAt: Date.now() };

    if (password) {
        const record = await makePasswordRecord(password);
        data.salt = record.salt;
        data.hash = record.hash;
    }

    await window.firestore.setDoc(docRef(ACCESS_COLLECTION, userId), data, { merge: true });
    return data;
}

// Сброс пароля: удаляем запись доступа (роль сохраняем отдельно) —
// сотрудник задаст пароль заново при следующем входе.
export async function resetUserPassword(userId, name, role = ROLES.USER) {
    const ref = docRef(ACCESS_COLLECTION, userId);
    await window.firestore.deleteDoc(ref);
    await window.firestore.setDoc(ref, { name, role, updatedAt: Date.now() });
}

export async function listAccessRecords() {
    const snap = await window.firestore.getDocs(window.firestore.collection(window.db, ACCESS_COLLECTION));
    const records = {};
    snap.forEach(doc => { records[doc.id] = doc.data(); });
    return records;
}

// --- кто из сотрудников администратор (для значков в интерфейсе) ---

let adminIds = null;
let adminIdsPromise = null;

// Один запрос на всю страницу; повторные вызовы используют результат
export function loadAdminIds() {
    if (adminIdsPromise) return adminIdsPromise;

    adminIdsPromise = window.firestore.getDocs(window.firestore.collection(window.db, ACCESS_COLLECTION))
        .then(snapshot => {
            adminIds = new Set();
            snapshot.forEach(doc => {
                if ((doc.data() || {}).role === ROLES.ADMIN) adminIds.add(doc.id);
            });
            return adminIds;
        })
        .catch(error => {
            console.warn('[auth] не удалось прочитать роли сотрудников:', error);
            adminIds = new Set();
            return adminIds;
        });

    return adminIdsPromise;
}

// Значки показываем только если роли уже загрузились
export function isKnownAdmin(userId) {
    if (!adminIds || !userId) return false;
    return adminIds.has(userId);
}
