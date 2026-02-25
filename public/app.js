document.querySelectorAll("[data-countdown]").forEach((el) => {
  const end = new Date(el.getAttribute("data-countdown"));
  const tick = () => {
    const diff = end.getTime() - Date.now();
    if (diff <= 0) {
      el.textContent = "Завершено";
      return;
    }
    const total = Math.floor(diff / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    el.textContent = d > 0 ? `${d}д ${h}ч ${m}м` : `${h}ч ${m}м ${s}с`;
    setTimeout(tick, 1000);
  };
  tick();
});

const surveyTemplates = {
  customer_feedback: {
    title: "Оценка качества обслуживания",
    description: "Короткая анкета для оценки качества сервиса и выявления зон улучшения.",
    questions: [
      { text: "Насколько вы довольны качеством обслуживания?", type: "scale", required: true, options: [] },
      { text: "Что понравилось больше всего?", type: "text", required: false, options: [] },
      {
        text: "Какие аспекты стоит улучшить?",
        type: "multi",
        required: false,
        options: ["Скорость обслуживания", "Качество консультации", "Интерфейс сайта", "Коммуникация поддержки"]
      },
      { text: "Порекомендуете ли вы нас знакомым?", type: "single", required: true, options: ["Да", "Нет"] }
    ]
  },
  education_quality: {
    title: "Анкета по качеству обучения",
    description: "Сбор обратной связи о программе и преподавании.",
    questions: [
      { text: "Оцените доступность материала", type: "scale", required: true, options: [] },
      { text: "Оцените работу преподавателя", type: "scale", required: true, options: [] },
      { text: "Что было наиболее полезным в курсе?", type: "text", required: false, options: [] },
      {
        text: "Какие форматы обучения для вас удобнее?",
        type: "multi",
        required: true,
        options: ["Лекции", "Практика", "Домашние задания", "Проектная работа"]
      }
    ]
  },
  event_feedback: {
    title: "Обратная связь по мероприятию",
    description: "Анкета для оценки организации и содержания мероприятия.",
    questions: [
      { text: "Оцените организацию мероприятия", type: "scale", required: true, options: [] },
      { text: "Оцените полезность контента", type: "scale", required: true, options: [] },
      {
        text: "Какой формат вам понравился больше?",
        type: "single",
        required: true,
        options: ["Доклады", "Панельная дискуссия", "Практические сессии"]
      },
      { text: "Ваши предложения по улучшению", type: "text", required: false, options: [] }
    ]
  }
};

const questionsWrap = document.getElementById("questions");
const addQuestionBtn = document.getElementById("add-question");
const questionTemplate = document.getElementById("question-template");
const applyTemplateBtn = document.getElementById("apply-template");
const clearQuestionsBtn = document.getElementById("clear-questions");
const templateSelect = document.getElementById("template-select");

function bindQuestionBlock(block) {
  const select = block.querySelector(".question-type");
  const optionsBlock = block.querySelector(".options-block");
  const removeBtn = block.querySelector(".remove-question");

  const toggleOptions = () => {
    const needOptions = select.value === "single" || select.value === "multi";
    optionsBlock.style.display = needOptions ? "grid" : "none";
  };

  select.addEventListener("change", toggleOptions);
  removeBtn.addEventListener("click", () => block.remove());
  toggleOptions();
}

function addQuestion(questionData) {
  if (!questionTemplate || !questionsWrap) return null;
  const content = questionTemplate.content.cloneNode(true);
  questionsWrap.appendChild(content);
  const inserted = questionsWrap.lastElementChild;
  if (!inserted) return null;

  if (questionData) {
    const textInput = inserted.querySelector('input[name="question_texts"]');
    const typeSelect = inserted.querySelector('select[name="question_types"]');
    const requiredInput = inserted.querySelector('input[name="question_required"]');
    const optionsInput = inserted.querySelector('textarea[name="question_options"]');
    const nextOrderInput = inserted.querySelector('input[name="question_next_orders"]');

    if (textInput) textInput.value = questionData.text || "";
    if (typeSelect) typeSelect.value = questionData.type || "text";
    if (requiredInput) requiredInput.checked = questionData.required !== false;
    if (optionsInput) optionsInput.value = (questionData.options || []).join("\n");
    if (nextOrderInput) nextOrderInput.value = questionData.next || "";
  }

  bindQuestionBlock(inserted);
  return inserted;
}

function clearQuestions() {
  if (!questionsWrap) return;
  questionsWrap.innerHTML = "";
}

function applyTemplate() {
  if (!templateSelect) return;
  const key = templateSelect.value;
  const template = surveyTemplates[key];
  if (!template) return;

  const titleInput = document.querySelector('input[name="title"]');
  const descriptionInput = document.querySelector('textarea[name="description"]');
  if (titleInput) titleInput.value = template.title;
  if (descriptionInput) descriptionInput.value = template.description;

  clearQuestions();
  template.questions.forEach((q) => addQuestion(q));
}

if (addQuestionBtn) {
  addQuestionBtn.addEventListener("click", () => addQuestion());
}
if (clearQuestionsBtn) {
  clearQuestionsBtn.addEventListener("click", clearQuestions);
}
if (applyTemplateBtn) {
  applyTemplateBtn.addEventListener("click", applyTemplate);
}
if (questionsWrap && questionTemplate && !questionsWrap.children.length) {
  addQuestion();
}

const hasDeadlineToggle = document.getElementById("has-deadline-toggle");
const deadlineWrap = document.getElementById("deadline-wrap");
const endAtInput = document.getElementById("end-at-input");
if (hasDeadlineToggle && deadlineWrap && endAtInput) {
  const syncDeadlineState = () => {
    const enabled = hasDeadlineToggle.checked;
    deadlineWrap.style.display = enabled ? "grid" : "none";
    if (enabled) endAtInput.setAttribute("required", "required");
    else endAtInput.removeAttribute("required");
  };
  hasDeadlineToggle.addEventListener("change", syncDeadlineState);
  syncDeadlineState();
}

const responseForm = document.getElementById("survey-response-form");
const progressText = document.getElementById("form-progress-text");
const progressBar = document.getElementById("form-progress-bar");
if (responseForm && progressText && progressBar) {
  const questionBlocks = Array.from(responseForm.querySelectorAll("[data-question-block]"));
  const readBlockProgress = (block) => {
    const radios = Array.from(block.querySelectorAll('input[type="radio"]'));
    const checks = Array.from(block.querySelectorAll('input[type="checkbox"]'));
    const selects = Array.from(block.querySelectorAll("select"));
    const texts = Array.from(block.querySelectorAll("textarea"));

    if (radios.length) return radios.some((el) => el.checked);
    if (checks.length) return checks.some((el) => el.checked);
    if (selects.length) return selects.some((el) => String(el.value || "").trim() !== "");
    if (texts.length) return texts.some((el) => String(el.value || "").trim() !== "");
    return false;
  };

  const updateProgress = () => {
    if (!questionBlocks.length) return;
    const completed = questionBlocks.filter(readBlockProgress).length;
    const percent = Math.round((completed / questionBlocks.length) * 100);
    progressText.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;
  };

  responseForm.addEventListener("input", updateProgress);
  responseForm.addEventListener("change", updateProgress);
  updateProgress();
}

const shareLinkInput = document.getElementById("share-link");
const copyLinkBtn = document.getElementById("copy-link-btn");
if (shareLinkInput && copyLinkBtn) {
  copyLinkBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareLinkInput.value);
      copyLinkBtn.textContent = "Скопировано";
      setTimeout(() => {
        copyLinkBtn.textContent = "Копировать";
      }, 1500);
    } catch (_err) {
      shareLinkInput.select();
      document.execCommand("copy");
    }
  });
}
