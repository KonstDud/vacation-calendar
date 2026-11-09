// Forms Logic

const form = document.querySelector(".form");
const buttonAddUser = document.querySelector(".form__button_type_user-add");
const templateUser = document.querySelector("#template-user").content;
const templateVacation = document.querySelector("#template-vacation").content;

let currentUserId = 1;
let currentVacationId = 1;

// --- User / Vacation Functions ---

const addVacation = (e) => {
  const newVacationDiv = templateVacation.querySelector(".form__vacation").cloneNode(true);
  const buttonApplyVacation = newVacationDiv.querySelector(".form__button_type_vac-apply");
  buttonApplyVacation.addEventListener("click", renderVacationPeriod);

  const buttonDeleteVacation = newVacationDiv.querySelector(".form__button_type_vac-del");
  buttonDeleteVacation.addEventListener("click", deleteVacation);

  newVacationDiv.id = `vacationid_${currentVacationId}`;
  currentVacationId += 1;

  // Устанавливаем по умолчанию даты на VACATION_YEAR
  const startInput = newVacationDiv.querySelector(".form__date_type_start");
  const endInput = newVacationDiv.querySelector(".form__date_type_end");
  startInput.value = `${window.VACATION_YEAR}-01-01`;
  endInput.value = `${window.VACATION_YEAR}-01-01`;

  e.target.parentNode.append(newVacationDiv);

  enableValidation(newVacationDiv, validationConfig);

  // Удаляем старые итоги пользователя
  const totalElems = ["form__user-total", "form__user-total-workdays"];
  totalElems.forEach(cls => {
    const elem = e.target.parentNode.querySelector(`.${cls}`);
    if (elem) elem.remove();
  });
};

const deleteVacation = (e) => {
  const vacationIdString = `.${e.target.parentNode.id}`;
  removePrevVacationSpans(vacationIdString);

  const totalElems = ["form__user-total", "form__user-total-working"];
  totalElems.forEach(cls => {
    const elem = e.target.parentNode.parentNode.querySelector(`.${cls}`);
    if (elem) elem.remove();
  });

  e.target.parentNode.remove();
};

const hideUserByHideButton = (e) => {
  const div = e.target.parentNode;
  div.classList.add("form__user_hidden");
  div.style = `color: #fff; background-color: ${div.querySelector(".form__color").value};`;
  for (const child of div.children) {
    if (!child.classList.contains("form__username")) {
      child.style = `visibility: collapse; opacity: 0;`;
    }
  }
};

const addUser = (e) => {
  const newUserDiv = templateUser.querySelector(".form__user").cloneNode(true);

  // Delete user
  const buttonDeleteUser = newUserDiv.querySelector(".form__button_type_user-del");
  buttonDeleteUser.addEventListener("click", deleteUser);

  // Edit username
  const buttonEditUser = newUserDiv.querySelector(".form__button_type_user-edit");
  buttonEditUser.addEventListener("click", (e) => editUserNameOnAddUser(e, newUserDiv));

  // Add vacation button
  const buttonAddVacation = newUserDiv.querySelector(".form__button_type_vac-add");
  buttonAddVacation.addEventListener("click", addVacation);

  newUserDiv.id = `userid_${currentUserId}`;
  currentUserId += 1;

  // Random color
  const userColor = newUserDiv.querySelector(".form__color");
  userColor.value = returnRandomHexColorString();

  const btnHide = newUserDiv.querySelector(".form__button_type_user-hide");
  btnHide.addEventListener("click", hideUserByHideButton);

  newUserDiv.querySelector(".form__username").addEventListener("click", (e) => {
    if (e.target.parentNode.classList.contains("form__user_hidden")) {
      hideAllUsers(e);
      showUser(newUserDiv);
    }
  });

  form.append(newUserDiv);
  editUserNameOnAddUser(e, newUserDiv);
};

const deleteUser = (e) => {
  const userIdString = `.${e.target.parentNode.id}`;
  if (document.querySelectorAll(userIdString).length > 0) {
    removePrevVacationSpans(userIdString);
  }
  e.target.parentNode.remove();
};

// --- Username Editing ---
const editUserNameOnAddUser = (e, newUserDiv) => {
  const textElement = newUserDiv.querySelector(".form__username");
  textElement.addEventListener("keydown", checkContentEditableLength);
  textElement.contentEditable = true;
  textElement.focus();
  window.getSelection().selectAllChildren(textElement);

  const editUserName = (e) => {
    e.preventDefault();
    textElement.contentEditable = false;
    textElement.removeEventListener("blur", editUserName);
  };

  textElement.addEventListener("blur", editUserName);
  textElement.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editUserName(e);
    }
  });
};

// --- Show/Hide Users ---
const hideUser = (div, userColor) => {
  div.classList.add("form__user_hidden");
  div.style = `color: #fff; background-color: ${userColor.value};`;
  for (const child of div.children) {
    if (!child.classList.contains("form__username")) {
      child.style = `visibility: collapse; opacity: 0;`;
    }
  }
  // Скрываем блоки итогов, если они есть
  const totalBlocks = div.querySelectorAll('.form__user-total, .form__user-total-workdays');
  totalBlocks.forEach(block => {
    block.style.visibility = 'collapse';
    block.style.opacity = '0';
  });
};

const showUser = (div) => {
  div.classList.remove("form__user_hidden");
  div.style = "color: --color-text-primary; background-color: --color-bg-forms";
  for (const child of div.children) {
    if (!child.classList.contains("form__username")) {
      child.style = "visibility: visible; opacity: 1;";
    }
  }
  // Показываем блоки итогов, если они есть
  const totalBlocks = div.querySelectorAll('.form__user-total, .form__user-total-workdays');
  totalBlocks.forEach(block => {
    block.style.visibility = 'visible';
    block.style.opacity = '1';
  });
};

// --- Random Color ---
const hex = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "A", "B", "C", "D", "E", "F"];
const getRandomNumber = () => Math.floor(Math.random() * hex.length);
const returnRandomHexColorString = () => {
  let hexColor = "#";
  let hexColorIndexes = [];
  for (let i = 0; i < 6; i++) {
    const num = getRandomNumber();
    hexColor += hex[num];
    hexColorIndexes.push(num);
  }
  if (hexColorIndexes[0] >= 10 && hexColorIndexes[2] >= 10 && hexColorIndexes[4] >= 10) {
    return returnRandomHexColorString();
  }
  return hexColor;
};

// --- Prevent long names ---
function checkContentEditableLength(event) {
  const isValidShortcut = event.ctrlKey && event.keyCode !== 86;
  const isValidKeyCode = [8, 16, 17, 37, 38, 39, 40, 46].includes(event.keyCode);
  const maxLength = parseInt(event.srcElement.getAttribute("maxlength"));
  const text = event.srcElement.innerText;
  if (text.length >= maxLength && !isValidKeyCode && !isValidShortcut) {
    event.preventDefault();
  }
}

// --- Hide/Show All Users ---
const hideAllUsers = (e) => {
  const usersTemp = document.querySelectorAll(".form__user");
  if (e.target.classList.contains("form__button_type_user-add") && usersTemp.length !== 0) {
    usersTemp.forEach(u => hideUser(u, u.querySelector(".form__color")));
  } else {
    usersTemp.forEach((u) => {
      if (e.target.currentTarget !== u) hideUser(u, u.querySelector(".form__color"));
      else showUser(u);
    });
  }
};

// --- Add User Button ---
buttonAddUser.addEventListener("click", (e) => {
  hideAllUsers(e);
  addUser();
});
