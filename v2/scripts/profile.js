// scripts/profile.js — поля профиля сотрудника: единое описание для карточки,
// регистрации и выгрузки в Excel (колонки A–I, J–L, Q из шаблона).

export const PROFILE_SECTIONS = ['ФИО', 'Организация', 'Данные', 'Нормы отпуска', 'Прочее'];

// --- Поля профиля ---
// maxLength — чтобы списки и выгрузка в Excel не ломались на «полотне» текста
export const PROFILE_FIELDS = [
    // ФИО храним по частям, а в шаблон Excel уходит склейка «Фамилия Имя Отчество»
    { section: 'ФИО', key: 'lastName', label: 'Фамилия', required: true, requiredMessage: 'Укажите фамилию', maxLength: 60, placeholder: 'Например: Дудников' },
    { section: 'ФИО', key: 'firstName', label: 'Имя', required: true, requiredMessage: 'Укажите имя', maxLength: 60, placeholder: 'Например: Константин' },
    { section: 'ФИО', key: 'middleName', label: 'Отчество', maxLength: 60, placeholder: 'Если есть' },

    { section: 'Организация', key: 'legalEntity', label: 'ЮЛ', placeholder: 'ООО «…»', dict: 'legalEntities', maxLength: 150 },
    { section: 'Организация', key: 'city', label: 'Город / подразделение', placeholder: 'Например: Администрация_Москва', dict: 'cities', maxLength: 100 },
    { section: 'Организация', key: 'department', label: 'Департамент', placeholder: 'Например: Департамент решений АСТУ', dict: 'departments', maxLength: 100 },
    { section: 'Организация', key: 'division', label: 'Отдел', placeholder: 'Например: Отдел аналитики', dict: 'divisions', maxLength: 100 },
    { section: 'Организация', key: 'direction', label: 'Направление / Группа', placeholder: 'Можно оставить пустым', dict: 'directions', maxLength: 100 },
    { section: 'Организация', key: 'position', label: 'Должность', placeholder: 'Например: Инженер-тестировщик', dict: 'positions', maxLength: 100 },

    { section: 'Данные', key: 'personnelNumber', label: 'Табельный номер', placeholder: 'Например: 00ЗИ-02200', maxLength: 30 },
    { section: 'Данные', key: 'hireDate', label: 'Дата приёма', type: 'date' },
    { section: 'Данные', key: 'email', label: 'Почта', type: 'email', placeholder: 'Например: name@company.ru', maxLength: 100 },

    { section: 'Нормы отпуска', key: 'annualDays', label: 'Основной ежегодный', short: 'Основной', type: 'number', min: 0, max: 365, defaultValue: 28 },
    { section: 'Нормы отпуска', key: 'northernDays', label: 'Северный', short: 'Северный', type: 'number', min: 0, max: 365, defaultValue: 0 },
    { section: 'Нормы отпуска', key: 'irregularDays', label: 'За ненормированный день', short: 'Ненормированный', type: 'number', min: 0, max: 365, defaultValue: 0 },

    { section: 'Прочее', key: 'substitute', label: 'Замещающий', placeholder: 'Начните вводить имя', maxLength: 120 },
    { section: 'Прочее', key: 'note', label: 'Примечание', type: 'textarea', wide: true, multiline: true, maxLength: 300, placeholder: 'Например: в отпуске по уходу за ребенком' }
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

    // У сотрудников, заведённых до появления полей ФИО, имя лежит одной строкой
    // в user.name — разбираем её на части (в том же порядке, что в шаблоне Excel).
    if (source.lastName === undefined && source.firstName === undefined && user && user.name) {
        const parts = splitFullName(user.name);
        profile.lastName = parts.lastName;
        profile.firstName = parts.firstName;
        profile.middleName = parts.middleName;
    }

    return profile;
}

// --- ФИО ---

// Порядок как в шаблоне Excel: «Фамилия Имя Отчество»
export function composeFullName(profile) {
    const source = profile || {};
    return [source.lastName, source.firstName, source.middleName]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
}

// «Фамилия Имя» — чтобы помещалось в узкой левой панели
export function composeShortName(profile, fallbackName) {
    const source = profile || {};
    const short = [source.lastName, source.firstName]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(' ');

    return short || shortenFullName(fallbackName);
}

// Разбираем «Фамилия Имя Отчество» на части (порядок как в шаблоне Excel)
export function splitFullName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);

    return {
        lastName: parts[0] || '',
        firstName: parts[1] || '',
        middleName: parts.slice(2).join(' ')
    };
}

// «Фамилия Имя» из одной строки (когда отдельных полей ещё нет)
export function shortenFullName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).join(' ') || String(fullName || '');
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

// --- Проверка и очистка значений профиля ---

// Достаточно строгая и без ложных срабатываний: имя@домен.зона
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-zА-Яа-яЁё0-9]{2,}$/;

// Убираем «мусорные» пробелы, обрезаем по лимиту длины.
// Применяем перед сохранением, чтобы в базе и в Excel не было «полотна».
export function sanitizeProfile(profile) {
    const result = {};

    PROFILE_FIELDS.forEach(field => {
        const value = (profile || {})[field.key];

        if (field.type === 'number') {
            const number = Math.round(Number(value) || 0);
            result[field.key] = Math.min(Math.max(number, field.min || 0), field.max || 365);
            return;
        }

        let text = value === undefined || value === null ? '' : String(value);

        // В примечании сохраняем переносы строк, в остальных полях — одна строка
        text = field.multiline
            ? text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
            : text.replace(/\s+/g, ' ').trim();

        if (field.maxLength && text.length > field.maxLength) {
            text = text.slice(0, field.maxLength).trim();
        }

        result[field.key] = text;
    });

    return result;
}

// Возвращает { ключ: сообщение }. Пустой объект — ошибок нет.
export function validateProfile(profile) {
    const errors = {};

    PROFILE_FIELDS.forEach(field => {
        const value = (profile || {})[field.key];

        if (field.required && !String(value || '').trim()) {
            errors[field.key] = field.requiredMessage || `Заполните поле «${field.label}»`;
            return;
        }

        if (field.type === 'email' && value && !EMAIL_RE.test(String(value))) {
            errors[field.key] = 'Почта в формате name@company.ru';
            return;
        }

        if (field.maxLength && String(value || '').length > field.maxLength) {
            errors[field.key] = `Не больше ${field.maxLength} символов`;
        }
    });

    return errors;
}

export function hasProfileErrors(errors) {
    return Object.keys(errors || {}).length > 0;
}

// --- служебные пометки в «Примечании» ---
// Их дописывает выгрузка в Excel («не хватает 9 дней», «лишний 1 день» и т.п.).
// Хранить их в профиле не нужно, иначе при следующей выгрузке они задвоятся.
// Классы намеренно БЕЗ кириллицы: «\w» в JS её не матчит, а буква «й» может быть
// записана составной (и + бревис), поэтому вместо букв берём «любой не-разделитель».
export const AUTO_NOTE_RE = /(?:не\s+хватает\s+\d*\s*дн[^0-9;,\s]{0,6}|лишн[^0-9;,\s]{0,6}\s*\d*\s*дн[^0-9;,\s]{0,6}|\d+\s+дн[^0-9;,\s]{0,6}\s+лишн[^0-9;,\s]{0,6})/gi;

export function stripAutoNotes(note) {
    return String(note || '')
        .replace(AUTO_NOTE_RE, '')
        .replace(/\s*;\s*(?=;|$)/g, '')
        .replace(/^\s*[;,]\s*/, '')
        .replace(/\s*[;,]\s*$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
