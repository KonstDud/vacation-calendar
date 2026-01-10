// Render Vacations

const isIos = /iP(ad|od|hone)/i.test(window.navigator.userAgent);

// --- Проверка пересечения двух периодов ---
const checkDateOverlap = (start1, end1, start2, end2) => {
  return start1 <= end2 && start2 <= end1;
};

// --- Найти все пересекающиеся отпуски у пользователя ---
const findOverlappingVacations = (currentVacDiv, userContainer) => {
  const overlaps = [];
  const currentStart = showVacationStart(currentVacDiv);
  const currentEnd = showVacationEnd(currentVacDiv);

  // Получаем все отпуски этого пользователя, кроме текущего
  const allVacDivs = userContainer.querySelectorAll('.form__vacation');
  allVacDivs.forEach(vacDiv => {
    if (vacDiv === currentVacDiv) return; // пропускаем текущий отпуск
    const otherStart = showVacationStart(vacDiv);
    const otherEnd = showVacationEnd(vacDiv);
    if (checkDateOverlap(currentStart, currentEnd, otherStart, otherEnd)) {
      overlaps.push(vacDiv);
    }
  });
  return overlaps;
};

// --- Найти пересечения со всеми пользователями ---
const findOverlappingWithAllUsers = (currentVacDiv, currentUserContainer) => {
  const overlaps = [];
  const currentStart = showVacationStart(currentVacDiv);
  const currentEnd = showVacationEnd(currentVacDiv);
  
  // Все пользователи
  const allUsers = document.querySelectorAll('.form__user');
  allUsers.forEach(userDiv => {
    if (userDiv === currentUserContainer) return; // своего пользователя пропускаем (уже проверено)
    const allVacDivs = userDiv.querySelectorAll('.form__vacation');
    allVacDivs.forEach(vacDiv => {
      const otherStart = showVacationStart(vacDiv);
      const otherEnd = showVacationEnd(vacDiv);
      if (checkDateOverlap(currentStart, currentEnd, otherStart, otherEnd)) {
        overlaps.push({
          vacationDiv: vacDiv,
          userDiv: userDiv,
          userName: userDiv.querySelector('.form__username').textContent,
          userColor: userDiv.querySelector('.form__color').value
        });
      }
    });
  });
  return overlaps;
};

// --- Основная функция рендера отпуска ---
const renderVacationPeriod = (eOrDiv) => {
  // Если передан event, берём родителя через target, иначе div сразу
  const parent = eOrDiv.target ? eOrDiv.target.parentNode : eOrDiv;
  const userContainer = parent.parentNode;

  // Удаляем старые спаны
  ["form__vacation-period", "form__vacation-period-working"].forEach(cls => {
    const el = parent.querySelector(`.${cls}`);
    if (el) el.remove();
  });
  ["form__user-total", "form__user-total-workdays"].forEach(cls => {
    const el = userContainer.querySelector(`.${cls}`);
    if (el) el.remove();
  });

  const currentVacationId = parent.id;
  const vacationSelector = `.${currentVacationId}`;
  if (document.querySelectorAll(vacationSelector).length > 0) {
    removePrevVacationSpans(vacationSelector);
  }

  // Получаем даты начала и конца
  const vacationStartDay = showVacationStart(parent);
  const vacationEndDay = showVacationEnd(parent);
  const currentColor = userContainer.querySelector(".form__color").value;

  // Находим пересекающиеся отпуски
  const overlappingVacations = findOverlappingVacations(parent, userContainer);

  // Удаляем класс подсветки со всех отпусков пользователя (очистка перед пересчётом)
  userContainer.querySelectorAll('.form__vacation').forEach(vacDiv => {
    vacDiv.classList.remove('form__vacation_overlap');
  });

  // Добавляем класс подсветки и уведомление об ошибке, если есть пересечения
  if (overlappingVacations.length > 0) {
    parent.classList.add('form__vacation_overlap');
    overlappingVacations.forEach(vacDiv => {
      vacDiv.classList.add('form__vacation_overlap');
    });

    // Уведомление об ошибке
    const existingAlert = parent.querySelector('.form__vacation-alert');
    if (existingAlert) existingAlert.remove();
    const alertDiv = document.createElement('div');
    alertDiv.className = 'form__vacation-alert';
    alertDiv.textContent = `❌ Ошибка: пересекается с ${overlappingVacations.length} другим(ими) отпуском(ами) этого пользователя`;
    parent.appendChild(alertDiv);

    return; // Выходим из функции, отпуск не рисуется на календаре
  } else {
    // Убираем возможное старое уведомление
    const existingAlert = parent.querySelector('.form__vacation-alert');
    if (existingAlert) existingAlert.remove();
    
    // Проверяем пересечения с другими пользователями (только если внутри пользователя нет пересечений)
    const overlapsWithOthers = findOverlappingWithAllUsers(parent, userContainer);
    
    // Удаляем старое предупреждение о пересечениях с другими
    const existingCrossAlert = parent.querySelector('.form__vacation-cross-alert');
    if (existingCrossAlert) existingCrossAlert.remove();
    
    if (overlapsWithOthers.length > 0) {
      const crossAlert = document.createElement('div');
      crossAlert.className = 'form__vacation-cross-alert';
      crossAlert.innerHTML = `⚠️ <strong>Пересекается с отпусками:</strong><br>` +
        overlapsWithOthers.map(ov => 
          `<span style="color:${ov.userColor}">${ov.userName}</span>`
        ).join(', ');
      parent.appendChild(crossAlert);
    }
  }

  for (let i = vacationStartDay; i <= vacationEndDay; i++) {
    const dayDiv = document.querySelector(`#dayid_${i}`);
    if (!dayDiv) continue; // защита от отсутствующих дней

    const newDivSpan = document.createElement("span");
    newDivSpan.classList.add("calendar__span", currentVacationId, userContainer.id);
    newDivSpan.textContent = ".";
    const sibCount = countSpanSiblings(newDivSpan);
    newDivSpan.style.color = currentColor;
    newDivSpan.style.left = setVacationSpanPositionLeft(sibCount);
    if (sibCount > 3) {
      newDivSpan.style.bottom = setVacationSpanPositionBottom(sibCount);
    }
    dayDiv.append(newDivSpan);

    if (i === vacationStartDay) scrollToVacationStartDiv(dayDiv);
  }

  // После добавления всех точек перераспределяем их
  arrangeVacationSpans();

  // Отображение количества дней
  insertVacationTime(parent, countVacationTime(vacationStartDay, vacationEndDay));
  insertVacationTimeWorking(parent, countVacationTimeWorking(vacationStartDay, vacationEndDay));
  insertUserTotal(eOrDiv);
};

// --- Даты начала и конца отпуска ---
const showVacationStart = (vacDiv) => {
  const dateVal = vacDiv.querySelector(".form__date_type_start").value;
  const vacationStartDate = new Date(dateVal);
  return countDaysFromYearStart(vacationStartDate);
};

const showVacationEnd = (vacDiv) => {
  const dateVal = vacDiv.querySelector(".form__date_type_end").value;
  const vacationEndDate = new Date(dateVal);
  return countDaysFromYearStart(vacationEndDate);
};

// --- Количество дней от начала года ---
const countDaysFromYearStart = (currentDate) => {
  const yearStart = new Date(window.VACATION_YEAR, 0, 1);
  const diffMs = currentDate - yearStart;
  const days = Math.floor(diffMs / (1000 * 3600 * 24)) + 1;
  return days;
};

// --- Удаление старых спанов ---
const removePrevVacationSpans = (selector) => {
  document.querySelectorAll(selector).forEach(el => el.remove());
  arrangeVacationSpans(); // перераспределяем оставшиеся точки
};

// --- Прокрутка к дню отпуска ---
const scrollToVacationStartDiv = (dayDiv) => {
  dayDiv.parentNode.scrollIntoView({ behavior: "smooth" });
};

// --- Подсчет дней ---
const countVacationTime = (startDay, endDay) => endDay - startDay + 1;

const countVacationTimeWorking = (startDay, endDay) => {
  const calDays = document.querySelectorAll('.calendar__day[id^="dayid"]');
  let working = 0;
  for (let i = startDay - 1; i <= endDay - 1; i++) {
    if (calDays[i] && !calDays[i].classList.contains("calendar__day_dayoff")) working++;
  }
  return working;
};

// --- Вставка информации об отпуске ---
const insertVacationTime = (vacDiv, days) => {
  const span = document.createElement("span");
  span.classList.add("form__vacation-period");
  span.textContent = `Кол-во календарных дней: `;
  const spanDays = document.createElement("span");
  spanDays.classList.add("form__vacation-period-days");
  spanDays.textContent = days;
  span.append(spanDays);
  vacDiv.append(span);
};

const insertVacationTimeWorking = (vacDiv, workingDays) => {
  const span = document.createElement("span");
  span.classList.add("form__vacation-period-working");
  span.textContent = `Кол-во рабочих дней: `;
  const spanDays = document.createElement("span");
  spanDays.classList.add("form__vacation-period-days-working");
  spanDays.textContent = workingDays;
  span.append(spanDays);
  vacDiv.append(span);
};

// --- Подсчет общего отпуска пользователя ---
const countUserTotal = (eOrDiv) => {
  const currentUser = eOrDiv.target ? eOrDiv.target.parentNode.parentNode : eOrDiv.parentNode;
  return Array.from(currentUser.querySelectorAll(".form__vacation-period-days"))
    .reduce((sum, el) => sum + Number(el.textContent), 0);
};

const countUserTotalWorkdays = (eOrDiv) => {
  const currentUser = eOrDiv.target ? eOrDiv.target.parentNode.parentNode : eOrDiv.parentNode;
  return Array.from(currentUser.querySelectorAll(".form__vacation-period-days-working"))
    .reduce((sum, el) => sum + Number(el.textContent), 0);
};

const insertUserTotal = (eOrDiv) => {
  const userContainer = eOrDiv.target ? eOrDiv.target.parentNode.parentNode : eOrDiv.parentNode;
  const total = countUserTotal(eOrDiv);
  const totalWorking = countUserTotalWorkdays(eOrDiv);
  const spanTotal = document.createElement("span");
  spanTotal.classList.add("form__user-total");
  spanTotal.textContent = `Всего календарных дней: ${total}`;
  const spanTotalWorking = document.createElement("span");
  spanTotalWorking.classList.add("form__user-total-workdays");
  spanTotalWorking.textContent = `Всего рабочих дней: ${totalWorking}`;
  userContainer.append(spanTotal, spanTotalWorking);
};

// --- Распределение точек отпусков по позициям ---
const arrangeVacationSpans = () => {
  // Получаем все дни календаря
  const allDays = document.querySelectorAll('.calendar__day[id^="dayid"]');

  allDays.forEach(dayDiv => {
    // Все точки отпусков в этом дне
    const spans = dayDiv.querySelectorAll('.calendar__span');
    if (spans.length === 0) return;

    // Сбрасываем позиции
    spans.forEach(span => {
      span.style.left = '';
      span.style.bottom = '';
    });

    // Распределяем позиции
    spans.forEach((span, index) => {
      const pos = index % 4; // 0,1,2,3 - горизонтальные позиции
      const row = Math.floor(index / 4); // ряды (если больше 4 точек)
      span.style.left = `${pos * 10}px`; // шаг 10px
      if (row > 0) {
        span.style.bottom = `${row * 10}px`;
      }
    });
  });
};

// --- CSS для спанов ---
const countSpanSiblings = (span) => {
  if (!span.parentNode) return 0;
  return Array.from(span.parentNode.children).filter(sib => sib !== span).length;
};

const setVacationSpanPositionBottom = (sibCount) => `${2 * Math.floor(sibCount / 4)}px`;
const setVacationSpanPositionLeft = (sibCount) => `${8 * (3 - (sibCount % 4))}px`;
