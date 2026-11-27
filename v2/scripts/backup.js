// scripts/backup.js — резервные копии данных года.
// Используется перед опасными операциями: сброс и (в будущем) импорт.

import { state } from './state.js';
import { getCurrentUserId, getCurrentUserName } from './auth.js';

// Путь обязательно с нечётным числом сегментов (коллекция/документ/коллекция),
// иначе Firestore считает это документом и падает с «Invalid collection reference»
const BACKUPS_PATH = ['vacationData_v2', 'meta', 'backups'];

// Больше не держим: снимок — это полный слепок данных, они копятся быстрее журнала
const MAX_BACKUPS = 5;

function backupsCollection() {
    return window.firestore.collection(window.db, ...BACKUPS_PATH);
}

// Имя файла копии — с датой и временем, чтобы копии не перезаписывали друг друга
export function snapshotFileName(snapshot, label) {
    const date = new Date((snapshot && snapshot.createdAt) || Date.now());
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} `
        + `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    const year = (snapshot && snapshot.year) || '';
    const suffix = label ? ` ${label}` : '';

    return `Резервная копия график ${year}${suffix} (${stamp}).json`;
}

// Слепок текущих данных: то, что можно восстановить вручную
export function collectSnapshot() {
    return {
        createdAt: Date.now(),
        year: state.year,
        users: (state.users || []).map(user => JSON.parse(JSON.stringify(user))),
        groups: (state.groups || []).map(group => ({ ...group }))
    };
}

export function snapshotToJson(snapshot) {
    return JSON.stringify(snapshot, null, 2);
}

export function downloadSnapshot(snapshot, label) {
    const blob = new Blob([snapshotToJson(snapshot)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = snapshotFileName(snapshot, label);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Снимок в базе: vacationData_v2/backups/{id}
export async function saveSnapshotToDb(snapshot, reason) {
    const colRef = backupsCollection();
    const ref = window.firestore.doc(colRef);

    await window.firestore.setDoc(ref, {
        createdAt: snapshot.createdAt,
        year: snapshot.year,
        reason: reason || '',
        actorId: getCurrentUserId(),
        actorName: getCurrentUserName(),
        users: snapshot.users,
        groups: snapshot.groups
    });

    // Держим только последние снимки, чтобы они не накапливались
    await pruneBackups();

    return ref.id;
}

// Сколько снимков храним
export async function pruneBackups(limit = MAX_BACKUPS) {
    const { query, orderBy, getDocs, deleteDoc } = window.firestore;
    const colRef = backupsCollection();

    try {
        const snapshot = await getDocs(query(colRef, orderBy('createdAt', 'desc')));

        const docs = [];
        snapshot.forEach(item => docs.push(item));

        const extra = docs.slice(limit).map(item => item.ref).filter(Boolean);
        await Promise.all(extra.map(ref => deleteDoc(ref)));

        if (extra.length > 0) {
            console.info(`[backup] удалено старых снимков: ${extra.length}`);
        }
        return extra.length;
    } catch (error) {
        console.warn('[backup] не удалось почистить старые снимки:', error);
        return 0;
    }
}

// Список снимков — пригодится, чтобы показать, что есть
export async function listBackups() {
    const { query, orderBy, getDocs } = window.firestore;
    const colRef = backupsCollection();

    const snapshot = await getDocs(query(colRef, orderBy('createdAt', 'desc')));
    const items = [];
    snapshot.forEach(item => {
        const data = item.data();
        items.push({
            id: item.id,
            createdAt: data.createdAt,
            year: data.year,
            reason: data.reason,
            actorName: data.actorName,
            users: (data.users || []).length
        });
    });

    return items;
}
