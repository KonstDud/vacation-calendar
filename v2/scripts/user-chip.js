// scripts/user-chip.js — карточка вошедшего пользователя в правом верхнем углу

import { state } from './state.js';
import { getCurrentUserId, getCurrentUserName, getRoleLabel, getRole, ROLES } from './auth.js';
import { getProfile } from './profile.js';
import { attachTip } from './tooltip.js';

function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

// Щит вместо инициалов — у входа «Администратор» нет своей карточки и имени
const shieldIcon = () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;

export function getChipInfo() {
    const userId = getCurrentUserId();
    const user = userId ? state.users.find(item => item.id === userId) : null;
    const profile = user ? getProfile(user) : null;
    const admin = getRole() === ROLES.ADMIN;

    return {
        name: user ? user.name : (getCurrentUserName() || 'Администратор'),
        sub: (profile && profile.position) || getRoleLabel() || 'Сотрудник',
        color: (user && user.color) || '#10b981',
        admin,
        root: !userId
    };
}

export function updateUserChip() {
    const nameNode = document.getElementById('user-chip-name');
    const subNode = document.getElementById('user-chip-sub');
    const avatarNode = document.getElementById('user-chip-avatar');
    if (!nameNode || !subNode || !avatarNode) return;

    const info = getChipInfo();

    nameNode.textContent = info.name;
    subNode.textContent = info.sub;

    // У администратора — свой вид: градиент и звёздочка, а у входа «Администратор» щит
    avatarNode.classList.toggle('user-chip__avatar_admin', !!info.admin);
    avatarNode.classList.toggle('user-chip__avatar_root', !!info.admin && !!info.root);

    if (info.admin && info.root) {
        avatarNode.innerHTML = shieldIcon();
        avatarNode.style.background = '';
    } else {
        avatarNode.textContent = initialsOf(info.name);
        avatarNode.style.background = info.color;
    }
}

export function initUserChip() {
    const chip = document.getElementById('btn-profile');
    if (chip) {
        // полное имя и должность тёмной подсказкой вместо обрезанного текста
        attachTip(chip, () => {
            const info = getChipInfo();
            return info.sub ? `${info.name} — ${info.sub}` : info.name;
        });
    }

    updateUserChip();
}
