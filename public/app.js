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

const questionsWrap = document.getElementById("questions");
const addQuestionBtn = document.getElementById("add-question");
const questionTemplate = document.getElementById("question-template");

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

function addQuestion() {
  if (!questionTemplate || !questionsWrap) return;
  const content = questionTemplate.content.cloneNode(true);
  const block = content.querySelector(".question-builder");
  questionsWrap.appendChild(content);
  const inserted = questionsWrap.lastElementChild;
  bindQuestionBlock(inserted || block);
}

if (addQuestionBtn) {
  addQuestionBtn.addEventListener("click", addQuestion);
  addQuestion();
}
