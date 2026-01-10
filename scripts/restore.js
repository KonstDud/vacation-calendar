// restore.js с Firebase Firestore (версия 12.x)
// Этот файл заменяет localStorage на облачную базу Firestore

// Год отпуска
if (!window.VACATION_YEAR) {
  window.VACATION_YEAR = 2026;
  console.log('VACATION_YEAR set to:', window.VACATION_YEAR);
}

// --- Firestore функции ---

// Сохранить всё состояние в Firestore
const saveToFirestore = async () => {
  try {
    const form = document.querySelector('.form');
    const users = [];

    // Собираем данные всех пользователей
    form.querySelectorAll('.form__user').forEach(userDiv => {
      const user = {
        id: userDiv.id,
        name: userDiv.querySelector('.form__username').textContent,
        color: userDiv.querySelector('.form__color').value,
        isHidden: userDiv.classList.contains('form__user_hidden'),
        vacations: []
      };

      // Собираем отпуски пользователя
      userDiv.querySelectorAll('.form__vacation').forEach(vacDiv => {
        const vacation = {
          id: vacDiv.id,
          startDate: vacDiv.querySelector('.form__date_type_start').value,
          endDate: vacDiv.querySelector('.form__date_type_end').value
        };
        user.vacations.push(vacation);
      });

      users.push(user);
    });

    // Сохраняем в Firestore
    await window.firestore.setDoc(
      window.firestore.doc(window.db, 'vacationData', 'current'),
      {
        year: window.VACATION_YEAR,
        users: users,
        timestamp: new Date()
      }
    );

    console.log('Данные сохранены в Firestore');
  } catch (error) {
    console.error('Ошибка сохранения в Firestore:', error);
  }
};

// Загрузить данные из Firestore
const loadFromFirestore = async () => {
  try {
    const docRef = window.firestore.doc(window.db, 'vacationData', 'current');
    const docSnap = await window.firestore.getDoc(docRef);

    if (!docSnap.exists()) {
      console.log('Нет сохранённых данных в Firestore');
      return null;
    }

    const data = docSnap.data();

    // Проверяем год
    if (data.year !== window.VACATION_YEAR) {
      console.log(`Год изменился: был ${data.year}, сейчас ${window.VACATION_YEAR}. Данные не загружаем.`);
      return null;
    }

    console.log('Данные загружены из Firestore');
    return data.users;
  } catch (error) {
    console.error('Ошибка загрузки из Firestore:', error);
    return null;
  }
};

// --- Восстановление интерфейса ---

const restoreContent = async () => {
  const form = document.querySelector('.form');

  // Загружаем данные из Firestore
  const usersData = await loadFromFirestore();
  if (!usersData) return;

  // Временный массив для созданных пользователей
  const createdUsers = [];

  // 1. Создаём всех пользователей (без отпусков)
  usersData.forEach(userData => {
    const addUserEvent = { target: document.querySelector('.form__button_type_user-add') };
    hideAllUsers(addUserEvent);
    addUser(addUserEvent);

    const allUsers = form.querySelectorAll('.form__user');
    const newUser = allUsers[allUsers.length - 1];

    newUser.id = userData.id;
    newUser.querySelector('.form__username').textContent = userData.name;
    newUser.querySelector('.form__color').value = userData.color;

    createdUsers.push({
      element: newUser,
      isHidden: userData.isHidden,
      vacations: userData.vacations
    });
  });

  // 2. Восстанавливаем отпуски для каждого пользователя
  createdUsers.forEach(user => {
    user.vacations.forEach(vacData => {
      const addVacBtn = user.element.querySelector('.form__button_type_vac-add');
      addVacBtn.click();
      const vacDiv = user.element.querySelector('.form__vacation:last-child');
      vacDiv.id = vacData.id;
      vacDiv.querySelector('.form__date_type_start').value = vacData.startDate;
      vacDiv.querySelector('.form__date_type_end').value = vacData.endDate;

      const applyBtn = vacDiv.querySelector('.form__button_type_vac-apply');
      applyBtn.click();
    });

    // 3. Применяем свёртывание ПОСЛЕ создания отпусков
    if (user.isHidden) {
      hideUser(user.element, user.element.querySelector('.form__color'));
    }
  });

  // Восстанавливаем ID‑счётчики
  currentUserId = Math.max(...usersData.map(u => parseInt(u.id.replace('userid_', ''))), 0) + 1;
  currentVacationId = Math.max(...usersData.flatMap(u =>
    u.vacations.map(v => parseInt(v.id.replace('vacationid_', '')))
  ), 0) + 1;

  console.log('Восстановление завершено');
};

// --- Автосохранение ---

let saveTimeout;
const scheduleSave = () => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveToFirestore, 1000);
};

// Вешаем обработчики на изменения
document.addEventListener('input', scheduleSave);
document.addEventListener('click', scheduleSave);

// Восстанавливаем при загрузке
document.addEventListener('DOMContentLoaded', restoreContent);

// --- Сброс данных ---

const resetData = async () => {
  if (confirm('Вы уверены? Все данные будут удалены и в Firebase тоже.')) {
    try {
      // Удаляем документ из Firestore
      await window.firestore.deleteDoc(window.firestore.doc(window.db, 'vacationData', 'current'));
      console.log('Данные удалены из Firestore');
    } catch (error) {
      console.error('Ошибка удаления из Firestore:', error);
    }

    // Очищаем интерфейс
    document.querySelectorAll('.form__vacation').forEach(el => el.remove());
    document.querySelectorAll('.form__user').forEach(el => el.remove());
    currentUserId = 1;
    currentVacationId = 1;

    // Перезагружаем страницу
    window.location.reload();
  }
};

const btnReset = document.querySelector('.form__button_type_reset');
if (btnReset) btnReset.addEventListener('click', resetData);