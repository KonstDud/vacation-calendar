// restore.js с Realtime Sync (Multi-user Firestore v2)
const COLLECTION_NAME = 'vacationData_v2';
const DOC_ID = 'current'; // Или можно привязать к году, например `current_${state.year}`

let isLocalEditing = false;
let unsubscribe = null;

// Сбор данных формы в массив пользователей
const gatherFormData = () => {
  const form = document.querySelector('.form');
  if (!form) return [];

  const usersData = [];
  const userElements = form.querySelectorAll('.form__user');

  userElements.forEach(userEl => {
    const username = userEl.querySelector('.form__username')?.value || '';
    const color = userEl.querySelector('.form__color')?.value || '#000000';
    const userId = userEl.id;

    const vacations = [];
    const vacationElements = userEl.querySelectorAll('.form__vacation');
    vacationElements.forEach(vacEl => {
      const startDate = vacEl.querySelector('.form__date_start')?.value || '';
      const endDate = vacEl.querySelector('.form__date_end')?.value || '';
      vacations.push({ startDate, endDate });
    });

    usersData.push({ userId, username, color, vacations });
  });

  return usersData;
};

// Рендер данных из базы на страницу (при изменениях извне)
const renderUsersData = (usersData) => {
  // Если пользователь сейчас сам что-то вводит/кликает — не перерисовываем, чтобы не сбивать фокус
  if (isLocalEditing) return;

  const form = document.querySelector('.form');
  if (!form) return;

  // Очищаем текущие элементы формы перед отрисовкой свежих данных
  document.querySelectorAll('.form__vacation').forEach(el => el.remove());
  document.querySelectorAll('.form__user').forEach(el => el.remove());

  if (!usersData || usersData.length === 0) {
    if (typeof updateCalendar === 'function') updateCalendar();
    return;
  }

  usersData.forEach(userData => {
    const addUserBtn = document.querySelector('.form__button_type_user-add');
    if (!addUserBtn) return;

    addUserBtn.click();

    const userElements = form.querySelectorAll('.form__user');
    const currentUserEl = userElements[userElements.length - 1];

    if (userData.userId) currentUserEl.id = userData.userId;
    const nameInput = currentUserEl.querySelector('.form__username');
    const colorInput = currentUserEl.querySelector('.form__color');
    if (nameInput) nameInput.value = userData.username;
    if (colorInput) colorInput.value = userData.color;

    const addVacationBtn = currentUserEl.querySelector('.form__button_type_vac-add');

    userData.vacations.forEach(vac => {
      if (addVacationBtn) addVacationBtn.click();
      const vacElements = currentUserEl.querySelectorAll('.form__vacation');
      const currentVacEl = vacElements[vacElements.length - 1];

      const startInput = currentVacEl.querySelector('.form__date_start');
      const endInput = currentVacEl.querySelector('.form__date_end');
      if (startInput) startInput.value = vac.startDate;
      if (endInput) endInput.value = vac.endDate;
    });
  });

  if (typeof updateCalendar === 'function') {
    updateCalendar();
  }
};

// Сохранение в Firestore (вызывается с дебаунсом)
const saveToFirestore = async () => {
  try {
    const usersData = gatherFormData();
    await window.firestore.setDoc(
      window.firestore.doc(window.db, COLLECTION_NAME, DOC_ID),
      { users: usersData },
      { merge: true } // merge: true защищает от затирания полей, если структура расширится
    );
    console.log('Данные синхронизированы с Firestore (v2)');
  } catch (error) {
    console.error('Ошибка сохранения в Firestore:', error);
  } finally {
    isLocalEditing = false; // Снимаем флаг блокировки рендеринга после отправки
  }
};

// Настройка Realtime подписки (onSnapshot)
const initRealtimeSync = () => {
  const docRef = window.firestore.doc(window.db, COLLECTION_NAME, DOC_ID);

  // Слушаем изменения в базе в реальном времени для всех пользователей
  unsubscribe = window.firestore.onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      console.log('Получено обновление от другого пользователя (Realtime)');
      renderUsersData(data.users);
    } else {
      console.log('Документ пуст или удален.');
    }
  }, (error) => {
    console.error("Ошибка в onSnapshot подписке:", error);
  });
};

// Первичная загрузка при старте страницы
const restoreContent = async () => {
  try {
    const docRef = window.firestore.doc(window.db, COLLECTION_NAME, DOC_ID);
    const docSnap = await window.firestore.getDoc(docRef);

    if (docSnap.exists() && docSnap.data().users) {
      renderUsersData(docSnap.data().users);
    }
  } catch (error) {
    console.error('Ошибка первичной загрузки:', error);
  }

  // Запускаем постоянный реалтайм-слушатель
  initRealtimeSync();
};

let saveTimeout = null;
const scheduleSave = () => {
  isLocalEditing = true; // Блокируем входящий рендер, пока пользователь вводит данные
  clearTimeout(saveTimeout);
  // Отправляем на сервер через 800мс после того, как пользователь перестал кликать/писать
  saveTimeout = setTimeout(saveToFirestore, 800);
};

// Слушаем любые изменения формы
document.addEventListener('input', scheduleSave);
document.addEventListener('click', scheduleSave);
document.addEventListener('DOMContentLoaded', restoreContent);

// Кнопка сброса
const btnReset = document.querySelector('.form__button_type_reset');
if (btnReset) {
  btnReset.addEventListener('click', async () => {
    if (confirm('Точно сбросить все данные для всех?')) {
      try {
        isLocalEditing = true;
        await window.firestore.deleteDoc(window.firestore.doc(window.db, COLLECTION_NAME, DOC_ID));
        console.log('Данные удалены из Firestore (v2)');
      } catch (error) {
        console.error('Ошибка удаления:', error);
      } finally {
        isLocalEditing = false;
      }

      document.querySelectorAll('.form__vacation').forEach(el => el.remove());
      document.querySelectorAll('.form__user').forEach(el => el.remove());
      if (typeof updateCalendar === 'function') {
        updateCalendar();
      }
    }
  });
}