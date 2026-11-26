// scripts/profile.js — поля профиля сотрудника: единое описание для карточки,
// регистрации и выгрузки в Excel (колонки A–I, J–L, Q из шаблона).

export const PROFILE_SECTIONS = ['Организация', 'Данные', 'Нормы отпуска', 'Прочее'];

export const PROFILE_FIELDS = [
    { section: 'Организация', key: 'legalEntity', label: 'ЮЛ', placeholder: 'ООО «…»', suggest: 'text' },
    { section: 'Организация', key: 'city', label: 'Город', placeholder: 'Москва', suggest: 'text' },
    { section: 'Организация', key: 'department', label: 'Департамент', suggest: 'text' },
    { section: 'Организация', key: 'division', label: 'Отдел', suggest: 'text' },
    { section: 'Организация', key: 'direction', label: 'Направление / Группа', suggest: 'text' },
    { section: 'Организация', key: 'position', label: 'Должность', suggest: 'text' },

    { section: 'Данные', key: 'personnelNumber', label: 'Табельный номер', placeholder: '00ЗИ-00000' },
    { section: 'Данные', key: 'hireDate', label: 'Дата приёма', type: 'date' },
    { section: 'Данные', key: 'email', label: 'Почта', type: 'email', placeholder: 'name@company.ru' },

    { section: 'Нормы отпуска', key: 'annualDays', label: 'Основной ежегодный', type: 'number', min: 0, max: 365, defaultValue: 28 },
    { section: 'Нормы отпуска', key: 'northernDays', label: 'Северный', type: 'number', min: 0, max: 365, defaultValue: 0 },
    { section: 'Нормы отпуска', key: 'irregularDays', label: 'За ненормированный день', type: 'number', min: 0, max: 365, defaultValue: 0 },

    { section: 'Прочее', key: 'substitute', label: 'Замещающий', suggest: 'users' },
    { section: 'Прочее', key: 'note', label: 'Примечание', type: 'textarea', placeholder: 'Например: в отпуске по уходу за ребенком' }
];

export const PROFILE_KEYS = PROFILE_FIELDS.map(field => field.key);

// Разбивка по секциям для отрисовки
export function getFieldsBySection() {
    return PROFILE_SECTIONS.map(section => ({
        section,
        fields: PROFILE_FIELDS.filter(field => field.section === section)
    })).filter(group => group.fields.length > 0);
}

export function getField(key) {
    return PROFILE_FIELDS.find(field => field.key === key) || null;
}

// Профиль сотрудника со значениями по умолчанию (старые записи могут быть без profile)
export function getProfile(user) {
    const source = (user && user.profile) || {};
    const profile = {};

    PROFILE_FIELDS.forEach(field => {
        const value = source[field.key];
        if (field.type === 'number') {
            profile[field.key] = value === undefined || value === null || value === ''
                ? (field.defaultValue || 0)
                : Math.max(0, Math.round(Number(value) || 0));
        } else {
            profile[field.key] = value === undefined || value === null ? '' : String(value);
        }
    });

    return profile;
}

// Лимит по ТК: основной + северный + ненормированный
export function getEntitlement(profile) {
    const p = profile || {};
    return (Number(p.annualDays) || 0) + (Number(p.northernDays) || 0) + (Number(p.irregularDays) || 0);
}

export function isParentalLeave(profile) {
    const note = ((profile && profile.note) || '').toLowerCase();
    return note.includes('уходу за ребенком') || note.includes('уходу за ребёнком') || note.includes('декрет');
}

// «лишний 1 день» / «лишние 2 дня» / «лишние 18 дней» — как в шаблоне
export function formatOverDays(count) {
    const word = pluralDays(count, false);
    return count === 1 ? `лишний 1 ${word}` : `лишние ${count} ${word}`;
}

// «не хватает 1 дня» / «не хватает 4 дня» / «не хватает 9 дней» — как в шаблоне
export function formatShortDays(count) {
    return `не хватает ${count} ${pluralDays(count, true)}`;
}

function pluralDays(count, genitive) {
    const abs = Math.abs(Math.round(count)) % 100;
    const last = abs % 10;

    if (abs > 10 && abs < 20) return 'дней';
    if (genitive) return last === 1 || (last >= 2 && last <= 4) ? 'дня' : 'дней';
    if (last === 1) return 'день';
    return last >= 2 && last <= 4 ? 'дня' : 'дней';
}

// Варианты для подсказок: берём уже введённые значения у сотрудников
export function getSuggestions(users, field) {
    if (!field || !field.suggest) return [];

    if (field.suggest === 'users') {
        return (users || [])
            .map(user => user.name)
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, 'ru'));
    }

    const values = new Set();
    (users || []).forEach(user => {
        const value = getProfile(user)[field.key];
        if (value) values.add(value);
    });

    return [...values].sort((a, b) => a.localeCompare(b, 'ru'));
}

// dd.mm.yyyy — так даты лежат в шаблоне Excel
export function toTemplateDate(isoDate) {
    if (!isoDate) return '';
    const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(isoDate);
    return `${match[3]}.${match[2]}.${match[1]}`;
}

export function fromTemplateDate(text) {
    if (!text) return '';
    const match = String(text).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return '';
    return `${match[3]}-${match[2]}-${match[1]}`;
}
