(() => {
  const calendarContainer = document.querySelector(".calendar");

  // Устанавливаем год из глобальной переменной или используем текущий
  // if (!window.VACATION_YEAR) {
  //   window.VACATION_YEAR = new Date().getFullYear();
  // }
  if (!window.VACATION_YEAR) {
    window.VACATION_YEAR = 2027; // Принудительно 2026 для тестирования
  }
  const currentYear = window.VACATION_YEAR;

  // --- Обновляем min/max для всех date-полей ---
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.min = `${currentYear}-01-01`;
    input.max = `${currentYear}-12-31`;
  });

  // --- Глобальные даты для vacations.js ---
  window.startDate = new Date(`${currentYear}-01-01`);
  window.endDate = new Date(`${currentYear}-12-31`);

  const months = {
    0: "Январь", 1: "Февраль", 2: "Март", 3: "Апрель",
    4: "Май", 5: "Июнь", 6: "Июль", 7: "Август",
    8: "Сентябрь", 9: "Октябрь", 10: "Ноябрь", 11: "Декабрь",
  };

  function createMonth(monthName) {
    const monthDiv = document.createElement("div");
    monthDiv.classList.add("calendar__month");

    const title = document.createElement("h2");
    title.classList.add("calendar__title");
    title.textContent = monthName;

    const area = document.createElement("div");
    area.classList.add("calendar__area");

    monthDiv.append(title, area);
    return monthDiv;
  }

  function insertMonth(monthDiv) {
    calendarContainer.append(monthDiv);
  }

  function createDay(dayNumber) {
    const dayDiv = document.createElement("div");
    dayDiv.classList.add("calendar__day");
    dayDiv.textContent = dayNumber;
    return dayDiv;
  }

  function insertDay(dayDiv, monthNumber) {
    const monthElement = document.querySelectorAll(".calendar__month")[monthNumber];
    monthElement.querySelector(".calendar__area").append(dayDiv);
  }

  function renderCalendar(prodCalList) {
    // Очищаем календарь перед перерисовкой
    calendarContainer.innerHTML = '';

    let dayIndex = 0;

    for (let d = new Date(window.startDate); d <= window.endDate; d.setDate(d.getDate() + 1)) {
      const dayOfMonth = d.getDate();
      const monthNumber = d.getMonth();
      const dayOfWeek = d.getDay();

      if (dayOfMonth === 1) {
        const monthDiv = createMonth(months[monthNumber]);
        insertMonth(monthDiv);

        const emptyDays = dayOfWeek > 0 ? dayOfWeek - 1 : 6;
        for (let i = 0; i < emptyDays; i++) insertDay(createDay(""), monthNumber);
      }

      const dayDiv = createDay(dayOfMonth);

      if (prodCalList[dayIndex] === "1") dayDiv.classList.add("calendar__day_dayoff");

      dayDiv.id = `dayid_${dayIndex + 1}`;
      dayDiv.addEventListener("click", e => {
        renderPopupContent(e);
        openPopup(popup);
      });

      insertDay(dayDiv, monthNumber);
      dayIndex++;
    }

    // Событие "календарь готов" для restore.js
    window.dispatchEvent(new Event("calendarReady"));
  }

  // --- Получаем календарь рабочих/выходных ---
  fetch(`https://isdayoff.ru/api/getdata?year=${currentYear}`)
    .then(response => response.text())
    .then(data => {
      const prodCalList = data.split("");
      renderCalendar(prodCalList);
    })
    .catch(err => {
      console.error("Ошибка получения календаря:", err);
      const fallbackCal = "0000000".repeat(52);
      renderCalendar(fallbackCal.split(""));
    });
})();
