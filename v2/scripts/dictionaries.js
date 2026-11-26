// scripts/dictionaries.js — справочники (ЮЛ, города, департаменты, отделы, направления, должности).
// Хранятся в Firestore, чтобы у всех были одинаковые значения без опечаток.
// Начальные значения взяты из шаблона Excel.

const DOC_PATH = ['vacationData_v2', 'dictionaries'];

export const DEFAULT_DICTIONARIES = {
    legalEntities: [
        'ООО «Интеллектуальные системы»'
    ],
    cities: [
        'Администрация_Москва',
        'Обособленное подразделение в г. Москва',
        'Обособленное подразделение в г. Санкт-Петербург Граффити',
        'Обособленное подразделение в г. Екатеринбург'
    ],
    departments: [
        'Департамент решений АСТУ'
    ],
    divisions: [
        'Отдел аналитики',
        'Отдел геоинформационных систем',
        'Отдел промышленных решений',
        'Отдел решений по автоматизации расчетов технических условий',
        'Отдел систем диспетчерского управления',
        'Отдел систем сбора технологической информации',
        'Отдел управления проектами'
    ],
    directions: [],
    positions: [
        'Администратор проектов',
        'Аналитик данных',
        'Ведущий администратор проектов',
        'Ведущий аналитик',
        'Ведущий дизайнер',
        'Ведущий инженер',
        'Ведущий инженер-администратор баз данных',
        'Ведущий инженер-тестировщик',
        'Ведущий программист',
        'Ведущий разработчик',
        'Ведущий разработчик программного обеспечения',
        'Ведущий системный аналитик',
        'Ведущий специалист по системному анализу данных',
        'Ведущий эксперт',
        'Главный инженер проекта',
        'Главный инженер проектов',
        'Главный программист',
        'Главный специалист',
        'Дизайнер',
        'Директор департамента',
        'Заместитель директора департамента',
        'Инженер',
        'Инженер внедрения',
        'Инженер ГИС',
        'Инженер технической поддержки',
        'Инженер-программист',
        'Инженер-тестировщик',
        'Младший аналитик',
        'Младший инженер',
        'Младший инженер-тестировщик',
        'Младший программист',
        'Младший системный аналитик',
        'Начальник отдела',
        'Программист',
        'Разработчик',
        'Разработчик программного обеспечения',
        'Руководитель группы',
        'Руководитель группы внедрения и поддержки',
        'Руководитель группы разработки',
        'Руководитель группы тестирования',
        'Руководитель направления',
        'Руководитель программ проектов',
        'Руководитель проектов',
        'Системный аналитик',
        'Старший аналитик',
        'Старший инженер автоматизации инфраструктуры разработки',
        'Старший инженер по анализу данных',
        'Технический писатель',
        'Эксперт'
    ]
};

let cache = null;

function sortValues(values) {
    return [...values].sort((a, b) => a.localeCompare(b, 'ru'));
}

function mergeWithDefaults(data) {
    const result = {};

    Object.keys(DEFAULT_DICTIONARIES).forEach(kind => {
        const stored = Array.isArray((data || {})[kind]) ? data[kind] : [];
        const merged = new Set([...DEFAULT_DICTIONARIES[kind], ...stored]);
        result[kind] = sortValues(merged);
    });

    return result;
}

export async function loadDictionaries() {
    if (cache) return cache;

    try {
        const ref = window.firestore.doc(window.db, ...DOC_PATH);
        const snap = await window.firestore.getDoc(ref);
        cache = mergeWithDefaults(snap.exists() ? snap.data() : null);

        // первый запуск — сразу создаём документ, чтобы значения можно было дополнять
        if (!snap.exists()) {
            window.firestore.setDoc(ref, cache).catch(error => console.error('[dictionaries] Не удалось создать справочники:', error));
        }
    } catch (error) {
        console.error('[dictionaries] Ошибка загрузки справочников:', error);
        cache = mergeWithDefaults(null);
    }

    return cache;
}

export function getDictionaries() {
    return cache || mergeWithDefaults(null);
}

export function getDictionary(kind) {
    const list = getDictionaries()[kind];
    return Array.isArray(list) ? list : [];
}

// Дополняем справочник новым значением («своё» в форме профиля)
export async function addDictionaryValue(kind, value) {
    const trimmed = String(value || '').trim();
    const current = getDictionary(kind);

    if (!trimmed || current.some(item => item.toLowerCase() === trimmed.toLowerCase())) return current;

    const next = sortValues([...current, trimmed]);
    cache = { ...getDictionaries(), [kind]: next };

    try {
        await window.firestore.setDoc(window.firestore.doc(window.db, ...DOC_PATH), { [kind]: next }, { merge: true });
    } catch (error) {
        console.error('[dictionaries] Не удалось сохранить значение:', error);
    }

    return next;
}
