// scripts/backup.js — резервные копии данных года.
// Используется перед опасными операциями: сброс и (в будущем) импорт.

import { state } from './state.js';
import { getCurrentUserId, getCurrentUserName } from './auth.js';

const BACKUPS_COLLECTION = 'backups';

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
    link.download = `Резервная копия график ${snapshot.year}${label ? ' ' + label : ''}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Снимок в базе: vacationData_v2/backups/{id}
export async function saveSnapshotToDb(snapshot, reason) {
    const colRef = window.firestore.collection(window.db, 'vacationData_v2', BACKUPS_COLLECTION);
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

    return ref.id;
}
