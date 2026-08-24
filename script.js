(function () {
  "use strict";

  const STORAGE_KEY = "financeTaskPlanner.v1";
  const STORAGE_VERSION = 1;
  const REFERENCE_SEED_VERSION = 2;
  const WORKDAY_NUMBERS = new Set([1, 2, 3, 4, 5, 6]);
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
  const TASK_TYPES = new Set(["current", "strategic"]);
  const TASK_PRIORITIES = new Set(Object.keys(PRIORITY_ORDER));
  const TASK_STATES = new Set(["pending", "completed"]);
  const URL_PROTOCOLS = new Set(["http:", "https:"]);
  const TYPE_LABELS = { current: "Текущие задачи", strategic: "Стратегические задачи" };
  const PRIORITY_LABELS = { high: "Высокий", medium: "Средний", low: "Низкий" };

  function createEmptyPlannerData() {
    return {
      version: STORAGE_VERSION,
      tasks: [],
      settings: {
        theme: "light",
        completedCollapsed: false,
        weeklyNotes: {},
        referenceSeeded: false,
        referenceSeedVersion: 0,
      },
    };
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function parseDateKey(dateKey) {
    if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return null;
    }

    const parts = dateKey.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (
      date.getFullYear() !== parts[0] ||
      date.getMonth() !== parts[1] - 1 ||
      date.getDate() !== parts[2]
    ) {
      return null;
    }
    return date;
  }

  function toDateKey(date) {
    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  }

  function addCalendarDays(date, amount) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + amount);
    return result;
  }

  function isWorkday(dateOrKey) {
    const date =
      typeof dateOrKey === "string" ? parseDateKey(dateOrKey) : new Date(dateOrKey);
    return Boolean(date) && WORKDAY_NUMBERS.has(date.getDay());
  }

  function getWeekStart(dateOrKey) {
    const source =
      typeof dateOrKey === "string" ? parseDateKey(dateOrKey) : new Date(dateOrKey);
    if (!source) {
      return null;
    }
    const weekday = source.getDay() || 7;
    return addCalendarDays(source, 1 - weekday);
  }

  function getNextWorkday(dateOrKey) {
    let result =
      typeof dateOrKey === "string" ? parseDateKey(dateOrKey) : new Date(dateOrKey);
    if (!result) {
      return null;
    }
    result = new Date(result.getFullYear(), result.getMonth(), result.getDate());
    while (!isWorkday(result)) {
      result = addCalendarDays(result, 1);
    }
    return result;
  }

  function isPastDate(dateKey, todayKey) {
    const date = parseDateKey(dateKey);
    const today = parseDateKey(todayKey);
    return Boolean(date && today) && date.getTime() < today.getTime();
  }

  function isValidTime(value) {
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
      return false;
    }
    const parts = value.split(":").map(Number);
    return parts[0] >= 0 && parts[0] <= 23 && parts[1] >= 0 && parts[1] <= 59;
  }

  function isValidDocumentUrl(value) {
    if (value === "") {
      return true;
    }
    try {
      return URL_PROTOCOLS.has(new URL(value).protocol);
    } catch {
      return false;
    }
  }

  function normalizeDuration(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }
    return typeof value === "number" ? value : Number(value);
  }

  function validateTaskInput(input, options) {
    const settings = options || {};
    const todayKey = settings.todayKey || toDateKey(new Date());
    const allowPastDate = Boolean(settings.allowPastDate);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const description =
      typeof input.description === "string" ? input.description.trim() : "";
    const documentUrl =
      typeof input.documentUrl === "string" ? input.documentUrl.trim() : "";
    const durationMinutes = normalizeDuration(input.durationMinutes);
    const errors = {};

    if (title.length < 1 || title.length > 120) {
      errors.title = "Название должно содержать от 1 до 120 символов.";
    }
    if (!TASK_TYPES.has(input.type)) {
      errors.type = "Выберите тип задачи.";
    }
    if (!isWorkday(input.date)) {
      errors.date = "Можно выбрать только рабочий день с понедельника по субботу.";
    } else if (!allowPastDate && isPastDate(input.date, todayKey)) {
      errors.date = "Для новой задачи нельзя выбрать прошедший день.";
    }
    if (!isValidTime(input.startTime)) {
      errors.startTime = "Укажите корректное время начала.";
    }
    if (
      durationMinutes !== null &&
      (!Number.isInteger(durationMinutes) ||
        durationMinutes < 5 ||
        durationMinutes > 720 ||
        durationMinutes % 5 !== 0)
    ) {
      errors.durationMinutes =
        "Длительность должна быть от 5 до 720 минут с шагом 5 минут.";
    }
    if (!TASK_PRIORITIES.has(input.priority)) {
      errors.priority = "Выберите приоритет задачи.";
    }
    if (description.length > 2000) {
      errors.description = "Описание не должно превышать 2000 символов.";
    }
    if (!isValidDocumentUrl(documentUrl)) {
      errors.documentUrl = "Укажите ссылку, начинающуюся с http:// или https://.";
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      value: {
        title,
        type: input.type,
        date: input.date,
        startTime: input.startTime,
        durationMinutes,
        priority: input.priority,
        description,
        documentUrl,
      },
    };
  }

  function normalizeWeekdays(weekdays) {
    if (!Array.isArray(weekdays)) {
      return [];
    }
    return Array.from(
      new Set(
        weekdays
          .map(Number)
          .filter(function (weekday) {
            return WORKDAY_NUMBERS.has(weekday);
          })
      )
    ).sort(function (first, second) {
      return first - second;
    });
  }

  function validateRecurrenceInput(input) {
    const weekdays = normalizeWeekdays(input.weekdays);
    const startDate = input.startDate;
    const endDate = input.endDate;
    const parsedStart = parseDateKey(startDate);
    const parsedEnd = parseDateKey(endDate);
    const errors = {};

    if (weekdays.length === 0) {
      errors.weekdays = "Выберите хотя бы один рабочий день повторения.";
    }
    if (!parsedEnd) {
      errors.endDate = "Укажите дату окончания повторения.";
    } else if (parsedStart && parsedEnd.getTime() < parsedStart.getTime()) {
      errors.endDate = "Дата окончания не может быть раньше даты начала.";
    }
    if (
      parsedStart &&
      weekdays.length > 0 &&
      !weekdays.includes(parsedStart.getDay())
    ) {
      errors.weekdays = "Дата первой задачи должна соответствовать выбранному дню повторения.";
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      value: {
        weekdays,
        startDate,
        endDate,
      },
    };
  }

  function validateStoredRecurrence(recurrence) {
    if (recurrence === null) {
      return true;
    }
    if (!isPlainObject(recurrence) || typeof recurrence.seriesId !== "string") {
      return false;
    }
    return validateRecurrenceInput(recurrence).valid;
  }

  function validateStoredTask(task) {
    if (!isPlainObject(task)) {
      return false;
    }
    const validation = validateTaskInput(task, {
      todayKey: task.date,
      allowPastDate: true,
    });
    return (
      validation.valid &&
      typeof task.id === "string" &&
      task.id.length > 0 &&
      TASK_STATES.has(task.state) &&
      typeof task.isOverdue === "boolean" &&
      (task.overdueFromDate === null || parseDateKey(task.overdueFromDate) !== null) &&
      (task.completedAt === null || typeof task.completedAt === "string") &&
      typeof task.createdAt === "string" &&
      typeof task.updatedAt === "string" &&
      validateStoredRecurrence(task.recurrence)
    );
  }

  function normalizeWeeklyNotes(value) {
    if (!isPlainObject(value)) {
      return {};
    }
    return Object.entries(value).reduce(function (notes, entry) {
      const weekStart = entry[0];
      const text = entry[1];
      if (
        parseDateKey(weekStart) &&
        toDateKey(getWeekStart(weekStart)) === weekStart &&
        typeof text === "string" &&
        text.length <= 2000
      ) {
        notes[weekStart] = text;
      }
      return notes;
    }, {});
  }

  function normalizeStoredData(data) {
    if (
      !isPlainObject(data) ||
      data.version !== STORAGE_VERSION ||
      !Array.isArray(data.tasks) ||
      !isPlainObject(data.settings) ||
      !data.tasks.every(validateStoredTask)
    ) {
      return null;
    }
    return {
      version: STORAGE_VERSION,
      tasks: data.tasks,
      settings: {
        theme: data.settings.theme === "dark" ? "dark" : "light",
        completedCollapsed: Boolean(data.settings.completedCollapsed),
        weeklyNotes: normalizeWeeklyNotes(data.settings.weeklyNotes),
        referenceSeeded: Boolean(data.settings.referenceSeeded),
        referenceSeedVersion:
          Number.isInteger(data.settings.referenceSeedVersion) &&
          data.settings.referenceSeedVersion >= 0
            ? data.settings.referenceSeedVersion
            : 0,
      },
    };
  }

  function serializePlannerData(data) {
    const normalized = normalizeStoredData(data);
    if (!normalized) {
      throw new Error("Нельзя подготовить резервную копию неизвестного формата.");
    }
    return JSON.stringify(normalized, null, 2);
  }

  function parseImportedPlannerData(text) {
    if (typeof text !== "string") {
      return { data: null, error: "Файл резервной копии не удалось прочитать." };
    }
    try {
      const normalized = normalizeStoredData(JSON.parse(text));
      return normalized
        ? { data: normalized, error: null }
        : { data: null, error: "Файл не соответствует формату резервной копии." };
    } catch {
      return { data: null, error: "Файл содержит некорректный JSON." };
    }
  }

  function loadPlannerData(storage) {
    let rawValue;
    try {
      rawValue = storage.getItem(STORAGE_KEY);
    } catch {
      return { status: "unavailable", data: null };
    }
    if (rawValue === null) {
      return { status: "empty", data: createReferencePlannerData(new Date()) };
    }
    try {
      const normalized = normalizeStoredData(JSON.parse(rawValue));
      if (
        normalized &&
        normalized.tasks.length === 0 &&
        !normalized.settings.referenceSeeded
      ) {
        const seeded = createReferencePlannerData(new Date());
        seeded.settings.theme = normalized.settings.theme;
        seeded.settings.completedCollapsed = normalized.settings.completedCollapsed;
        seeded.settings.weeklyNotes = normalized.settings.weeklyNotes;
        return { status: "empty", data: seeded };
      }
      return normalized
        ? { status: "loaded", data: normalized }
        : { status: "invalid", data: null };
    } catch {
      return { status: "invalid", data: null };
    }
  }

  function savePlannerData(storage, data) {
    const normalized = normalizeStoredData(data);
    if (!normalized) {
      throw new Error("Нельзя сохранить данные неизвестного формата.");
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function createTaskId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return "task-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function createTask(input, now) {
    const validation = validateTaskInput(input, {
      todayKey: toDateKey(now || new Date()),
    });
    if (!validation.valid) {
      return { task: null, errors: validation.errors };
    }
    const timestamp = (now || new Date()).toISOString();
    return {
      task: {
        id: createTaskId(),
        title: validation.value.title,
        type: validation.value.type,
        date: validation.value.date,
        startTime: validation.value.startTime,
        durationMinutes: validation.value.durationMinutes,
        priority: validation.value.priority,
        description: validation.value.description,
        documentUrl: validation.value.documentUrl,
        state: "pending",
        isOverdue: false,
        overdueFromDate: null,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        recurrence: null,
      },
      errors: {},
    };
  }

  function createReferencePlannerData(now) {
    const createdAt = now || new Date();
    const weekStart = getWeekStart(createdAt);
    const data = createEmptyPlannerData();
    const groups = [
      [
        "strategic",
        [
          ["Анализ исполнения бюджета за месяц", "medium"],
          ["Подготовка отчёта для руководства", "medium"],
          ["Оценка ключевых финансовых показателей", "medium"],
        ],
        [
          ["Стратегическая сессия по бюджету на 2027 год", "high"],
          ["Анализ инвестиционных проектов", "medium"],
          ["Оценка рисков и возможностей", "medium"],
        ],
        [
          ["Формирование финансовой модели на 2027–2029 гг.", "medium"],
          ["Оптимизация структуры затрат", "medium"],
          ["Подготовка предложений по повышению доходов", "high"],
        ],
        [
          ["Контроль исполнения стратегических инициатив", "medium"],
          ["Анализ эффективности направлений", "medium"],
          ["Подготовка управленческих решений", "medium"],
        ],
        [
          ["Подведение итогов недели по стратегии", "medium"],
          ["Корректировка планов и KPI", "medium"],
          ["Подготовка к совещанию руководства", "medium"],
        ],
        [["Время для анализа и стратегического планирования", "medium"]],
      ],
      [
        "current",
        [
          ["Обработка входящих платежей", "medium"],
          ["Сверка с банками", "medium"],
          ["Контроль дебиторской задолженности", "medium"],
          ["Обработка заявок на оплату", "medium"],
        ],
        [
          ["Проверка договоров на соответствие бюджету", "medium"],
          ["Согласование платежей", "medium"],
          ["Подготовка платёжного календаря", "medium"],
          ["Работа с поставщиками", "medium"],
        ],
        [
          ["Формирование отчётов по доходам и расходам", "medium"],
          ["Работа с первичной документацией", "medium"],
          ["Контроль кассовых разрывов", "medium"],
          ["Обновление реестров и баз данных", "medium"],
        ],
        [
          ["Сверка расчётов с контрагентами", "medium"],
          ["Контроль исполнения бюджета по статьям", "high"],
          ["Обработка входящих документов", "medium"],
          ["Подготовка оперативных отчётов", "medium"],
        ],
        [
          ["Закрытие недели: проверка документов", "medium"],
          ["Формирование отчётности", "medium"],
          ["Подготовка данных для бухгалтерии", "medium"],
          ["Ответы на запросы подразделений", "medium"],
        ],
        [["Резервное время для текущих задач", "medium"]],
      ],
    ];
    const times = ["09:00", "10:30", "13:00", "15:00"];

    groups.forEach(function (group) {
      const type = group[0];
      group.slice(1).forEach(function (dayTasks, dayOffset) {
        dayTasks.forEach(function (definition, taskOffset) {
          const dateKey = toDateKey(addCalendarDays(weekStart, dayOffset));
          const result = createTask(
            {
              title: definition[0],
              type,
              date: dateKey,
              startTime: times[taskOffset],
              durationMinutes: null,
              priority: definition[1],
              description: "",
              documentUrl: "",
            },
            parseDateKey(dateKey)
          );
          if (result.task) {
            data.tasks.push(result.task);
          }
        });
      });
    });
    data.settings.referenceSeeded = true;
    data.settings.referenceSeedVersion = REFERENCE_SEED_VERSION;
    return data;
  }

  function restoreMissingMondayReferenceTasks(data, now) {
    if (
      !data.settings.referenceSeeded ||
      data.settings.referenceSeedVersion >= REFERENCE_SEED_VERSION
    ) {
      return { added: 0, changed: false };
    }

    const referenceTasks = [
      ["strategic", "Анализ исполнения бюджета за месяц", "medium", "09:00"],
      ["strategic", "Подготовка отчёта для руководства", "medium", "10:30"],
      ["strategic", "Оценка ключевых финансовых показателей", "medium", "13:00"],
      ["current", "Обработка входящих платежей", "medium", "09:00"],
      ["current", "Сверка с банками", "medium", "10:30"],
      ["current", "Контроль дебиторской задолженности", "medium", "13:00"],
      ["current", "Обработка заявок на оплату", "medium", "15:00"],
    ];
    const titleSet = new Set(referenceTasks.map(function (task) { return task[1]; }));
    const hasMondayReferenceTask = data.tasks.some(function (task) {
      return titleSet.has(task.title);
    });
    data.settings.referenceSeedVersion = REFERENCE_SEED_VERSION;
    if (hasMondayReferenceTask) {
      return { added: 0, changed: true };
    }

    const monday = toDateKey(getWeekStart(now));
    let added = 0;
    referenceTasks.forEach(function (definition) {
      const result = createTask(
        {
          title: definition[1],
          type: definition[0],
          date: monday,
          startTime: definition[3],
          durationMinutes: null,
          priority: definition[2],
          description: "",
          documentUrl: "",
        },
        parseDateKey(monday)
      );
      if (result.task) {
        data.tasks.push(result.task);
        added += 1;
      }
    });
    return { added, changed: true };
  }

  function createRecurringTasks(input, recurrenceInput, now) {
    const taskValidation = validateTaskInput(input);
    const recurrenceValidation = validateRecurrenceInput(recurrenceInput);
    if (!taskValidation.valid || !recurrenceValidation.valid) {
      return {
        tasks: [],
        errors: Object.assign({}, taskValidation.errors, recurrenceValidation.errors),
      };
    }

    const seriesId = createTaskId();
    const recurrence = {
      seriesId,
      weekdays: recurrenceValidation.value.weekdays,
      startDate: recurrenceValidation.value.startDate,
      endDate: recurrenceValidation.value.endDate,
    };
    const dates = [];
    let cursor = parseDateKey(recurrence.startDate);
    const end = parseDateKey(recurrence.endDate);

    while (cursor.getTime() <= end.getTime()) {
      if (recurrence.weekdays.includes(cursor.getDay())) {
        dates.push(toDateKey(cursor));
      }
      cursor = addCalendarDays(cursor, 1);
    }

    return {
      tasks: dates.map(function (dateKey) {
        const result = createTask(
          Object.assign({}, taskValidation.value, { date: dateKey }),
          now
        );
        result.task.recurrence = {
          seriesId: recurrence.seriesId,
          weekdays: recurrence.weekdays.slice(),
          startDate: recurrence.startDate,
          endDate: recurrence.endDate,
        };
        return result.task;
      }),
      errors: {},
    };
  }

  function rollOverOverdueTasks(tasks, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = toDateKey(getNextWorkday(today));
    let moved = 0;

    tasks.forEach(function (task) {
      const taskDate = parseDateKey(task.date);
      if (
        task.state === "pending" &&
        taskDate &&
        taskDate.getTime() < today.getTime()
      ) {
        task.overdueFromDate = task.overdueFromDate || task.date;
        task.date = targetDate;
        task.isOverdue = true;
        task.updatedAt = now.toISOString();
        moved += 1;
      }
    });

    return moved;
  }

  function removeFutureRecurringTasks(tasks, sourceTask) {
    if (!sourceTask.recurrence) {
      return tasks.filter(function (task) {
        return task.id !== sourceTask.id;
      });
    }

    const seriesId = sourceTask.recurrence.seriesId;
    const sourceDate = parseDateKey(sourceTask.date);
    return tasks.filter(function (task) {
      const isFutureIncompleteInstance =
        task.recurrence &&
        task.recurrence.seriesId === seriesId &&
        task.state !== "completed" &&
        parseDateKey(task.date).getTime() >= sourceDate.getTime();
      return !isFutureIncompleteInstance;
    });
  }

  function sortTasks(tasks) {
    return tasks.slice().sort(function (first, second) {
      const timeResult = first.startTime.localeCompare(second.startTime);
      if (timeResult !== 0) {
        return timeResult;
      }
      const priorityResult =
        PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority];
      if (priorityResult !== 0) {
        return priorityResult;
      }
      return first.createdAt.localeCompare(second.createdAt);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  const TaskPlannerCore = {
    STORAGE_KEY,
    STORAGE_VERSION,
    createEmptyPlannerData,
    parseDateKey,
    toDateKey,
    isWorkday,
    getWeekStart,
    getNextWorkday,
    isValidTime,
    isValidDocumentUrl,
    validateTaskInput,
    validateRecurrenceInput,
    validateStoredTask,
    normalizeStoredData,
    serializePlannerData,
    parseImportedPlannerData,
    loadPlannerData,
    savePlannerData,
    createTask,
    createReferencePlannerData,
    restoreMissingMondayReferenceTasks,
    createRecurringTasks,
    rollOverOverdueTasks,
    removeFutureRecurringTasks,
    sortTasks,
    escapeHtml,
  };

  globalThis.TaskPlannerCore = TaskPlannerCore;

  if (typeof document === "undefined") {
    return;
  }

  const appRoot = document.getElementById("app-root");
  const importFileInput = document.getElementById("import-file-input");
  const taskDialog = document.getElementById("task-dialog");
  const taskForm = document.getElementById("task-form");
  const taskDialogTitle = document.getElementById("task-dialog-title");
  const taskFormError = document.getElementById("task-form-error");
  const taskTitleInput = document.getElementById("task-title");
  const taskTypeInput = document.getElementById("task-type");
  const taskPriorityInput = document.getElementById("task-priority");
  const taskDateInput = document.getElementById("task-date");
  const taskTimeInput = document.getElementById("task-start-time");
  const taskDurationInput = document.getElementById("task-duration");
  const taskDescriptionInput = document.getElementById("task-description");
  const taskDocumentInput = document.getElementById("task-document-url");
  const taskRepeatInput = document.getElementById("task-repeat");
  const recurrenceOptions = document.getElementById("recurrence-options");
  const recurrenceEndDateInput = document.getElementById("task-repeat-end-date");
  const recurrenceEditNote = document.getElementById("recurrence-edit-note");
  const recurrenceWeekdayInputs = Array.from(
    document.querySelectorAll("input[name='repeatWeekday']")
  );
  const transferDialog = document.getElementById("transfer-dialog");
  const transferForm = document.getElementById("transfer-form");
  const transferTaskName = document.getElementById("transfer-task-name");
  const transferDateInput = document.getElementById("transfer-date");
  const transferFormError = document.getElementById("transfer-form-error");
  const confirmDialog = document.getElementById("confirm-dialog");
  const confirmTitle = document.getElementById("confirm-dialog-title");
  const confirmText = document.getElementById("confirm-dialog-text");
  const toast = document.getElementById("toast");

  let plannerData = null;
  let selectedWeekStart = null;
  let editingTaskId = null;
  let transferTaskId = null;
  let formDirty = false;
  let confirmAction = null;
  let toastTimer = null;
  let filters = { type: "all", priority: "all", state: "all" };
  let importedPlannerData = null;
  let observedTodayKey = null;

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function createButton(text, className, action) {
    const button = createElement("button", className, text);
    button.type = "button";
    if (action) {
      button.dataset.action = action;
    }
    return button;
  }

  function dateForToday() {
    return new Date();
  }

  function getTodayKey() {
    return toDateKey(dateForToday());
  }

  function getDefaultTaskDate() {
    return toDateKey(getNextWorkday(dateForToday()));
  }

  function getTaskById(taskId) {
    return plannerData.tasks.find(function (task) {
      return task.id === taskId;
    });
  }

  function persist() {
    try {
      savePlannerData(window.localStorage, plannerData);
      return true;
    } catch {
      showToast("Не удалось сохранить изменения в браузере.");
      return false;
    }
  }

  function refreshForNewCalendarDay() {
    const todayKey = getTodayKey();
    if (!plannerData || todayKey === observedTodayKey) {
      return;
    }
    observedTodayKey = todayKey;
    const movedOverdueTasks = rollOverOverdueTasks(plannerData.tasks, dateForToday());
    selectedWeekStart = getWeekStart(dateForToday());
    if (movedOverdueTasks > 0 && !persist()) {
      return;
    }
    renderPlanner();
    if (movedOverdueTasks > 0) {
      showToast("Перенесено просроченных задач: " + movedOverdueTasks + ".");
    }
  }

  function saveWeeklyNote(weekStart, value) {
    if (!parseDateKey(weekStart) || typeof value !== "string") {
      return;
    }
    plannerData.settings.weeklyNotes[weekStart] = value.slice(0, 2000);
    persist();
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 3600);
  }

  function formatTimestampForFilename(date) {
    return (
      toDateKey(date) +
      "-" +
      String(date.getHours()).padStart(2, "0") +
      String(date.getMinutes()).padStart(2, "0") +
      String(date.getSeconds()).padStart(2, "0")
    );
  }

  function downloadPlannerData(data, filename) {
    try {
      const blob = new Blob([serializePlannerData(data)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function handleImportFile(file) {
    if (!file) {
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      showToast("Не удалось прочитать выбранный файл.");
      return;
    }

    const parsed = parseImportedPlannerData(text);
    if (!parsed.data) {
      showToast(parsed.error);
      return;
    }

    importedPlannerData = parsed.data;
    showConfirmation(
      "Импортировать резервную копию?",
      "Текущие задачи и настройки будут полностью заменены. Перед заменой автоматически скачается резервная копия текущих данных.",
      function () {
        const backupName =
          "planner-before-import-" + formatTimestampForFilename(new Date()) + ".json";
        if (!downloadPlannerData(plannerData, backupName)) {
          closeDialog(confirmDialog);
          showToast("Не удалось подготовить резервную копию. Импорт отменён.");
          importedPlannerData = null;
          return;
        }

        const previousData = plannerData;
        plannerData = importedPlannerData;
        const movedOverdueTasks = rollOverOverdueTasks(plannerData.tasks, dateForToday());
        if (!persist()) {
          plannerData = previousData;
          importedPlannerData = null;
          closeDialog(confirmDialog);
          return;
        }

        importedPlannerData = null;
        filters = { type: "all", priority: "all", state: "all" };
        selectedWeekStart = getWeekStart(dateForToday());
        applyTheme();
        closeDialog(confirmDialog);
        renderPlanner();
        showToast(
          movedOverdueTasks > 0
            ? "Импорт завершён. Перенесено просроченных задач: " + movedOverdueTasks + "."
            : "Импорт завершён."
        );
      },
      "Импортировать"
    );
  }

  function applyTheme() {
    document.documentElement.dataset.theme = plannerData.settings.theme;
    const themeColor = document.querySelector("meta[name='theme-color']");
    if (themeColor) {
      themeColor.content = plannerData.settings.theme === "dark" ? "#101b2c" : "#f4f6fb";
    }
  }

  function taskMatchesFilters(task) {
    if (filters.type !== "all" && task.type !== filters.type) {
      return false;
    }
    if (filters.priority !== "all" && task.priority !== filters.priority) {
      return false;
    }
    if (filters.state === "pending" && task.state !== "pending") {
      return false;
    }
    if (filters.state === "completed" && task.state !== "completed") {
      return false;
    }
    if (
      filters.state === "overdue" &&
      !(task.state === "pending" && task.isOverdue)
    ) {
      return false;
    }
    return true;
  }

  function formatDate(dateKey, options) {
    const date = parseDateKey(dateKey);
    return new Intl.DateTimeFormat("ru-RU", options).format(date);
  }

  function formatFullDate(dateKey) {
    return formatDate(dateKey, { weekday: "long", day: "numeric", month: "long" });
  }

  function formatShortDate(dateKey) {
    return formatDate(dateKey, { day: "numeric", month: "short" });
  }

  function formatWeekRange(weekStart) {
    const start = toDateKey(weekStart);
    const end = toDateKey(addCalendarDays(weekStart, 5));
    const startDate = parseDateKey(start);
    const endDate = parseDateKey(end);
    const sameMonth = startDate.getMonth() === endDate.getMonth();
    const sameYear = startDate.getFullYear() === endDate.getFullYear();
    const startText = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: sameMonth ? undefined : "long",
      year: sameYear ? undefined : "numeric",
    }).format(startDate);
    const endText = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(endDate);
    return startText + " — " + endText;
  }

  function formatDuration(minutes) {
    if (minutes === null || minutes === undefined) {
      return "";
    }
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours === 0) {
      return minutes + " мин";
    }
    if (restMinutes === 0) {
      return hours + " ч";
    }
    return hours + " ч " + restMinutes + " мин";
  }

  function getDayLoad(dateKey) {
    const total = plannerData.tasks
      .filter(function (task) {
        return task.date === dateKey && task.durationMinutes !== null;
      })
      .reduce(function (sum, task) {
        return sum + task.durationMinutes;
      }, 0);
    return total > 0 ? "Занято: " + formatDuration(total) : "Занято: не указано";
  }

  function getTasksForBlock(dateKey, type, completed) {
    return sortTasks(
      plannerData.tasks.filter(function (task) {
        return (
          task.date === dateKey &&
          task.type === type &&
          (task.state === "completed") === completed &&
          taskMatchesFilters(task)
        );
      })
    );
  }

  function createTaskCard(task) {
    const card = createElement("article", "task-card");
    card.dataset.priority = task.priority;
    card.dataset.taskId = task.id;
    if (task.state === "completed") {
      card.classList.add("is-completed");
    }

    const header = createElement("div", "task-card-header");
    const checkbox = createElement("input", "task-check");
    checkbox.type = "checkbox";
    checkbox.checked = task.state === "completed";
    checkbox.dataset.action = "toggle-completed";
    checkbox.dataset.taskId = task.id;
    checkbox.setAttribute("aria-label", "Отметить задачу «" + task.title + "» выполненной");

    const content = createElement("div", "task-content");
    const title = createElement("h4", "task-title", task.title);
    const meta = createElement("div", "task-meta");
    const time = createElement(
      "span",
      "task-time",
      task.startTime + (task.durationMinutes !== null ? " · " + formatDuration(task.durationMinutes) : "")
    );
    const priority = createElement("span", "priority-tag", PRIORITY_LABELS[task.priority]);
    priority.dataset.priority = task.priority;
    meta.append(time, priority);
    if (task.isOverdue && task.state !== "completed") {
      meta.append(createElement("span", "overdue-tag", "Просрочена"));
    }
    content.append(title, meta);

    const actions = createElement("details", "task-actions");
    const summary = createElement("summary", "", "⋯");
    summary.setAttribute("aria-label", "Действия с задачей");
    const menu = createElement("div", "task-actions-menu");
    [
      ["Редактировать", "edit-task"],
      ["Копировать", "copy-task"],
      ["Перенести", "transfer-task"],
      ["Изменить блок", "switch-type"],
      ["Удалить", "delete-task"],
    ].forEach(function (item) {
      const actionButton = createButton(
        item[0],
        "action-button" + (item[1] === "delete-task" ? " action-delete" : ""),
        item[1]
      );
      actionButton.dataset.taskId = task.id;
      menu.append(actionButton);
    });
    actions.append(summary, menu);

    header.append(checkbox, content, actions);
    card.append(header);

    if (task.description || task.documentUrl) {
      const details = createElement("details", "task-details");
      details.append(createElement("summary", "", "Подробнее"));
      if (task.description) {
        details.append(createElement("p", "task-description", task.description));
      }
      if (task.documentUrl) {
        const link = createElement("a", "task-link", "Открыть документ");
        link.href = task.documentUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        details.append(link);
      }
      card.append(details);
    }
    return card;
  }

  function createTaskBlock(dateKey, type, compact) {
    const block = createElement("section", "task-block" + (compact ? " matrix-task-block" : ""));
    if (!compact) {
      const heading = createElement("div", "block-heading");
      const title = createElement("h3", "", TYPE_LABELS[type]);
      const addButton = createButton("+", "mini-button", "new-task");
      addButton.dataset.date = dateKey;
      addButton.dataset.type = type;
      addButton.setAttribute("aria-label", "Добавить: " + TYPE_LABELS[type]);
      heading.append(title, addButton);
      block.append(heading);
    }

    const pending = getTasksForBlock(dateKey, type, false);
    const completed = getTasksForBlock(dateKey, type, true);
    const pendingList = createElement("div", "task-list");
    if (pending.length === 0) {
      pendingList.append(createElement("p", "empty-state", "Нет невыполненных задач."));
    } else {
      pending.forEach(function (task) {
        pendingList.append(createTaskCard(task));
      });
    }
    block.append(pendingList);

    if (completed.length > 0) {
      const completedArea = createElement("div", "completed-area");
      const completedVisible =
        !plannerData.settings.completedCollapsed || filters.state === "completed";
      const toggle = createButton(
        completedVisible
          ? "Скрыть выполненные (" + completed.length + ")"
          : "Показать выполненные (" + completed.length + ")",
        "completed-toggle",
        "toggle-completed-area"
      );
      toggle.dataset.date = dateKey;
      toggle.dataset.type = type;
      toggle.setAttribute("aria-expanded", String(completedVisible));
      completedArea.append(toggle);
      if (completedVisible) {
        const completedList = createElement("div", "task-list");
        completed.forEach(function (task) {
          completedList.append(createTaskCard(task));
        });
        completedArea.append(completedList);
      }
      block.append(completedArea);
    }
    return block;
  }

  function createIcon(name, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("svg-icon");
    if (className) {
      svg.classList.add(className);
    }
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.9");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const addPath = function (d) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    };
    if (name === "calendar") {
      addPath("M5 4v3M19 4v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01");
    } else if (name === "target") {
      addPath("M12 20a8 8 0 1 0-8-8M12 16a4 4 0 1 0-4-4M12 12l8-8M16 4h4v4M12 12l4-4");
    } else if (name === "checklist") {
      addPath("M8 4h8a2 2 0 0 1 2 2v14H6V6a2 2 0 0 1 2-2ZM9 4a3 3 0 0 1 6 0v2H9V4ZM9 11l1.2 1.2L12.5 10M9 16l1.2 1.2 2.3-2.3M14 11h2M14 16h2");
    } else if (name === "star") {
      addPath("m12 3 2.75 5.57L21 9.48l-4.5 4.38 1.06 6.19L12 17.16l-5.56 2.89 1.06-6.19L3 9.48l6.25-.91L12 3Z");
    } else if (name === "check") {
      addPath("m5 12 4.2 4.2L19 6.4");
    } else if (name === "note") {
      addPath("M5 3h14v18H5zM8 8h8M8 12h8M8 16h5");
    }
    return svg;
  }

  function createMatrixRowLabel(type) {
    const isStrategic = type === "strategic";
    const label = createElement("aside", "matrix-row-label matrix-row-label-" + type);
    label.append(createIcon(isStrategic ? "target" : "checklist", "row-label-icon"));
    label.append(createElement("h2", "", TYPE_LABELS[type]));
    label.append(
      createElement(
        "p",
        "",
        isStrategic ? "Фокус на развитии, планировании и росте" : "Оперативные задачи и рабочие процессы"
      )
    );
    label.append(createIcon(isStrategic ? "star" : "check", "row-label-mark"));
    return label;
  }

  function createMatrixDayHeader(dateKey) {
    const today = dateKey === getTodayKey();
    const header = createElement("div", "matrix-day-heading" + (today ? " is-today" : ""));
    header.append(
      createElement("p", "matrix-day-name", formatDate(dateKey, { weekday: "long" }).toUpperCase()),
      createElement("p", "matrix-day-date", formatDate(dateKey, { day: "2-digit", month: "2-digit" })),
      createElement("p", "matrix-day-load", getDayLoad(dateKey))
    );
    if (today) {
      header.append(createElement("span", "today-chip", "Сегодня"));
    }
    return header;
  }

  function createMatrixCell(dateKey, type) {
    const cell = createElement("section", "matrix-cell matrix-cell-" + type);
    if (dateKey === getTodayKey()) {
      cell.classList.add("is-today");
    }
    const cellTools = createElement("div", "matrix-cell-tools");
    const addButton = createButton("+", "matrix-add-button", "new-task");
    addButton.dataset.date = dateKey;
    addButton.dataset.type = type;
    addButton.setAttribute("aria-label", "Добавить: " + TYPE_LABELS[type] + ", " + formatFullDate(dateKey));
    cellTools.append(addButton);
    cell.append(cellTools, createTaskBlock(dateKey, type, true));
    return cell;
  }

  function createFilterField(label, key, options) {
    const field = createElement("label", "filter-field");
    field.append(createElement("span", "", label));
    const select = createElement("select");
    select.dataset.filter = key;
    options.forEach(function (option) {
      const element = createElement("option", "", option.label);
      element.value = option.value;
      element.selected = filters[key] === option.value;
      select.append(element);
    });
    field.append(select);
    return field;
  }

  function createPlanningToolbar() {
    const toolbar = createElement("section", "planning-toolbar");
    toolbar.setAttribute("aria-label", "Фильтры и настройки отображения");
    toolbar.append(
      createFilterField("Блок", "type", [
        { value: "all", label: "Все блоки" },
        { value: "current", label: "Текущие" },
        { value: "strategic", label: "Стратегические" },
      ]),
      createFilterField("Приоритет", "priority", [
        { value: "all", label: "Все приоритеты" },
        { value: "high", label: "Высокий" },
        { value: "medium", label: "Средний" },
        { value: "low", label: "Низкий" },
      ]),
      createFilterField("Состояние", "state", [
        { value: "all", label: "Все задачи" },
        { value: "pending", label: "Невыполненные" },
        { value: "completed", label: "Выполненные" },
        { value: "overdue", label: "Просроченные" },
      ])
    );
    const actions = createElement("div", "toolbar-actions");
    actions.append(
      createButton("Сбросить", "text-button", "reset-filters"),
      createButton(
        plannerData.settings.theme === "dark" ? "Светлая тема" : "Тёмная тема",
        "text-button",
        "toggle-theme"
      ),
      createButton("Экспорт", "text-button", "export-data"),
      createButton("Импорт", "text-button", "import-data")
    );
    toolbar.append(actions);
    return toolbar;
  }

  function getWeeklyHighPriorities() {
    const start = toDateKey(selectedWeekStart);
    const end = toDateKey(addCalendarDays(selectedWeekStart, 5));
    return plannerData.tasks
      .filter(function (task) {
        return task.state === "pending" && task.priority === "high" && task.date >= start && task.date <= end;
      })
      .sort(function (first, second) {
        return (first.date + first.startTime).localeCompare(second.date + second.startTime);
      })
      .slice(0, 3);
  }

  function createFooterCards() {
    const footer = createElement("section", "footer-cards");
    footer.setAttribute("aria-label", "Сводная информация недели");

    const legend = createElement("section", "footer-card legend-card");
    legend.append(createElement("h2", "", "Условные обозначения"));
    const strategicLegend = createElement("p", "legend-line");
    strategicLegend.append(createIcon("star"), createElement("span", "", "Стратегические задачи"));
    const currentLegend = createElement("p", "legend-line");
    currentLegend.append(createIcon("check"), createElement("span", "", "Текущие задачи"));
    const priorityLegend = createElement("p", "legend-note", "Цветная метка показывает высокий, средний или низкий приоритет. Просроченные задачи помечаются отдельно.");
    legend.append(strategicLegend, currentLegend, priorityLegend);

    const priorities = createElement("section", "footer-card priorities-card");
    priorities.append(createElement("h2", "", "Приоритеты недели"));
    const priorityList = createElement("ol", "weekly-priority-list");
    const highPriorityTasks = getWeeklyHighPriorities();
    if (highPriorityTasks.length === 0) {
      priorityList.append(createElement("li", "priority-empty", "Добавьте задачу с высоким приоритетом."));
    } else {
      highPriorityTasks.forEach(function (task) {
        const item = createElement("li");
        const taskButton = createButton(task.title, "weekly-priority-button", "focus-task");
        taskButton.dataset.taskId = task.id;
        item.append(taskButton);
        priorityList.append(item);
      });
    }
    priorities.append(priorityList);

    const notes = createElement("section", "footer-card notes-card");
    notes.append(createElement("h2", "", "Заметки"));
    const notesInput = createElement("textarea", "weekly-notes-input");
    notesInput.maxLength = 2000;
    notesInput.dataset.weekNote = toDateKey(selectedWeekStart);
    notesInput.placeholder = "Добавьте заметку по этой неделе…";
    notesInput.value = plannerData.settings.weeklyNotes[toDateKey(selectedWeekStart)] || "";
    notesInput.setAttribute("aria-label", "Заметки недели " + formatWeekRange(selectedWeekStart));
    notes.append(notesInput);

    footer.append(legend, priorities, notes);
    return footer;
  }

  function renderPlanner() {
    appRoot.replaceChildren();
    const header = createElement("header", "planner-header");
    const brand = createElement("div", "planner-brand");
    const calendarBadge = createElement("div", "calendar-badge");
    calendarBadge.append(createIcon("calendar"));
    const brandCopy = createElement("div", "planner-brand-copy");
    brandCopy.append(
      createElement("h1", "", "Планировщик задач на неделю"),
      createElement("p", "", "Начальник финансово-экономического отдела")
    );
    const typeLegend = createElement("div", "type-legend");
    [
      ["strategic", "Стратегические задачи"],
      ["current", "Текущие задачи"],
    ].forEach(function (entry) {
      const row = createElement("p", "type-legend-item");
      row.append(createElement("span", "legend-dot legend-dot-" + entry[0]), createElement("span", "", entry[1]));
      typeLegend.append(row);
    });
    brand.append(calendarBadge, brandCopy, typeLegend);
    const weekCard = createElement("div", "week-range-card");
    weekCard.append(createElement("span", "", "Неделя:"), createElement("strong", "", formatWeekRange(selectedWeekStart)));
    header.append(brand, weekCard);

    const controls = createElement("section", "planner-controls");
    const navigation = createElement("nav", "compact-navigation");
    navigation.setAttribute("aria-label", "Навигация по неделям");
    navigation.append(
      createButton("←", "navigation-button", "previous-week"),
      createButton("Сегодня", "navigation-today", "current-week"),
      createButton("→", "navigation-button", "next-week"),
      createButton("+ Новая задача", "button button-primary", "new-task")
    );
    controls.append(navigation, createPlanningToolbar());

    const dates = [0, 1, 2, 3, 4, 5].map(function (offset) {
      return toDateKey(addCalendarDays(selectedWeekStart, offset));
    });
    const scroller = createElement("section", "week-matrix-scroller");
    scroller.setAttribute("aria-label", "Рабочая неделя " + formatWeekRange(selectedWeekStart));
    const matrix = createElement("div", "week-matrix");
    matrix.append(createElement("div", "matrix-corner", "Тип задач"));
    dates.forEach(function (dateKey) {
      matrix.append(createMatrixDayHeader(dateKey));
    });
    ["strategic", "current"].forEach(function (type) {
      matrix.append(createMatrixRowLabel(type));
      dates.forEach(function (dateKey) {
        matrix.append(createMatrixCell(dateKey, type));
      });
    });
    scroller.append(matrix);
    appRoot.append(header, controls, scroller, createFooterCards());
  }

  function showDialog(dialog) {
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function taskFormValues() {
    return {
      title: taskTitleInput.value,
      type: taskTypeInput.value,
      priority: taskPriorityInput.value,
      date: taskDateInput.value,
      startTime: taskTimeInput.value,
      durationMinutes: taskDurationInput.value,
      description: taskDescriptionInput.value,
      documentUrl: taskDocumentInput.value,
    };
  }

  function getSelectedRepeatWeekdays() {
    return recurrenceWeekdayInputs
      .filter(function (input) {
        return input.checked;
      })
      .map(function (input) {
        return Number(input.value);
      });
  }

  function updateRecurrenceVisibility() {
    recurrenceOptions.hidden = !taskRepeatInput.checked || taskRepeatInput.disabled;
  }

  function setRecurrenceFormState(task, isCopy) {
    const isEditing = Boolean(task) && !isCopy;
    const recurrence = isEditing ? task.recurrence : null;
    taskRepeatInput.checked = Boolean(recurrence);
    taskRepeatInput.disabled = isEditing;
    recurrenceWeekdayInputs.forEach(function (input) {
      input.checked = Boolean(recurrence) && recurrence.weekdays.includes(Number(input.value));
      input.disabled = isEditing;
    });
    recurrenceEndDateInput.value = recurrence ? recurrence.endDate : "";
    recurrenceEndDateInput.disabled = isEditing;
    recurrenceEditNote.hidden = !isEditing;
    if (isEditing && !recurrence) {
      recurrenceEditNote.textContent =
        "Повторение настраивается при создании новой задачи. Чтобы создать серию, воспользуйтесь копированием.";
    } else if (isEditing) {
      recurrenceEditNote.textContent =
        "Это экземпляр повторяющейся задачи. Его поля можно изменить независимо; для другого расписания создайте новую серию.";
    }
    updateRecurrenceVisibility();
  }

  function clearTaskFormError() {
    taskFormError.textContent = "";
  }

  function openTaskDialog(options) {
    const settings = options || {};
    const task = settings.task || null;
    const defaults = settings.defaults || {};
    const isCopy = Boolean(settings.copy);
    editingTaskId = task && !isCopy ? task.id : null;
    taskForm.reset();
    clearTaskFormError();
    taskDialogTitle.textContent = isCopy
      ? "Копия задачи"
      : task
        ? "Редактировать задачу"
        : "Новая задача";

    const defaultDate = getDefaultTaskDate();
    const source = task || defaults;
    taskTitleInput.value = source.title || "";
    taskTypeInput.value = source.type || "current";
    taskPriorityInput.value = source.priority || "medium";
    taskDateInput.value = source.date || defaultDate;
    taskTimeInput.value = source.startTime || "09:00";
    taskDurationInput.value =
      source.durationMinutes === null || source.durationMinutes === undefined
        ? ""
        : String(source.durationMinutes);
    taskDescriptionInput.value = source.description || "";
    taskDocumentInput.value = source.documentUrl || "";
    taskDateInput.min = task && !isCopy ? "" : getTodayKey();
    recurrenceEndDateInput.min = taskDateInput.value || getTodayKey();
    setRecurrenceFormState(task, isCopy);
    formDirty = false;
    showDialog(taskDialog);
    window.setTimeout(function () {
      taskTitleInput.focus();
    }, 0);
  }

  function closeTaskForm() {
    formDirty = false;
    editingTaskId = null;
    closeDialog(taskDialog);
  }

  function showConfirmation(title, text, onAccept, dangerLabel) {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
    confirmAction = onAccept;
    const acceptButton = confirmDialog.querySelector("[data-confirm-accept]");
    acceptButton.textContent = dangerLabel || "Подтвердить";
    showDialog(confirmDialog);
  }

  function requestCloseTaskForm() {
    if (!formDirty) {
      closeTaskForm();
      return;
    }
    showConfirmation(
      "Закрыть без сохранения?",
      "У вас есть несохранённые изменения. Закрыть форму без сохранения?",
      function () {
        closeDialog(confirmDialog);
        closeTaskForm();
      },
      "Закрыть"
    );
  }

  function openTransferDialog(task) {
    transferTaskId = task.id;
    transferTaskName.textContent = task.title;
    transferFormError.textContent = "";
    transferDateInput.value = task.date;
    transferDateInput.min = getTodayKey();
    showDialog(transferDialog);
    window.setTimeout(function () {
      transferDateInput.focus();
    }, 0);
  }

  function closeTransferDialog() {
    transferTaskId = null;
    closeDialog(transferDialog);
  }

  function submitTaskForm(event) {
    event.preventDefault();
    const existingTask = editingTaskId ? getTaskById(editingTaskId) : null;
    const validation = validateTaskInput(taskFormValues(), {
      allowPastDate: Boolean(existingTask),
    });
    if (!validation.valid) {
      taskFormError.textContent = Object.values(validation.errors)[0];
      return;
    }

    if (existingTask) {
      Object.assign(existingTask, validation.value, { updatedAt: new Date().toISOString() });
      persist();
      closeTaskForm();
      renderPlanner();
      showToast("Изменения сохранены.");
      return;
    }

    if (taskRepeatInput.checked) {
      const recurrenceValidation = validateRecurrenceInput({
        weekdays: getSelectedRepeatWeekdays(),
        startDate: validation.value.date,
        endDate: recurrenceEndDateInput.value,
      });
      if (!recurrenceValidation.valid) {
        taskFormError.textContent = Object.values(recurrenceValidation.errors)[0];
        return;
      }
      const series = createRecurringTasks(
        validation.value,
        recurrenceValidation.value
      );
      if (series.tasks.length === 0) {
        taskFormError.textContent = Object.values(series.errors)[0] || "Не удалось создать серию задач.";
        return;
      }
      plannerData.tasks.push.apply(plannerData.tasks, series.tasks);
      persist();
      closeTaskForm();
      renderPlanner();
      showToast("Создана серия задач: " + series.tasks.length + ".");
      return;
    }

    const result = createTask(validation.value);
    if (!result.task) {
      taskFormError.textContent = Object.values(result.errors)[0] || "Не удалось создать задачу.";
      return;
    }
    plannerData.tasks.push(result.task);
    persist();
    closeTaskForm();
    renderPlanner();
    showToast("Задача добавлена.");
  }

  function submitTransferForm(event) {
    event.preventDefault();
    const targetDate = transferDateInput.value;
    const todayKey = getTodayKey();
    if (!isWorkday(targetDate)) {
      transferFormError.textContent = "Можно выбрать только рабочий день с понедельника по субботу.";
      return;
    }
    if (isPastDate(targetDate, todayKey)) {
      transferFormError.textContent = "Выберите сегодняшний или будущий рабочий день.";
      return;
    }
    const task = getTaskById(transferTaskId);
    if (!task) {
      closeTransferDialog();
      return;
    }
    task.date = targetDate;
    task.updatedAt = new Date().toISOString();
    selectedWeekStart = getWeekStart(targetDate);
    persist();
    closeTransferDialog();
    renderPlanner();
    showToast("Задача перенесена на " + formatShortDate(targetDate) + ".");
  }

  function toggleTaskCompletion(taskId, checked) {
    const task = getTaskById(taskId);
    if (!task) {
      return;
    }
    task.state = checked ? "completed" : "pending";
    task.completedAt = checked ? new Date().toISOString() : null;
    task.updatedAt = new Date().toISOString();
    persist();
    renderPlanner();
    showToast(checked ? "Задача отмечена выполненной." : "Задача возвращена в список.");
  }

  function switchTaskType(taskId) {
    const task = getTaskById(taskId);
    if (!task) {
      return;
    }
    task.type = task.type === "current" ? "strategic" : "current";
    task.updatedAt = new Date().toISOString();
    persist();
    renderPlanner();
    showToast("Задача перемещена в другой блок.");
  }

  function deleteTask(taskId) {
    const task = getTaskById(taskId);
    if (!task) {
      return;
    }
    const isRecurring = Boolean(task.recurrence);
    showConfirmation(
      isRecurring ? "Удалить будущие задачи серии?" : "Удалить задачу?",
      isRecurring
        ? "Будут удалены все будущие невыполненные экземпляры серии, начиная с этой задачи. Выполненная история останется."
        : "Задача «" + task.title + "» будет удалена без возможности восстановления.",
      function () {
        plannerData.tasks = removeFutureRecurringTasks(plannerData.tasks, task);
        persist();
        closeDialog(confirmDialog);
        renderPlanner();
        showToast(isRecurring ? "Будущие задачи серии удалены." : "Задача удалена.");
      },
      isRecurring ? "Удалить серию" : "Удалить"
    );
  }

  function handleRootClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    const taskId = button.dataset.taskId;

    if (action === "focus-task") {
      const task = getTaskById(taskId);
      if (!task) {
        return;
      }
      selectedWeekStart = getWeekStart(task.date);
      filters = { type: "all", priority: "all", state: "all" };
      renderPlanner();
      window.requestAnimationFrame(function () {
        const card = Array.from(document.querySelectorAll(".task-card")).find(function (item) {
          return item.dataset.taskId === taskId;
        });
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
          const checkbox = card.querySelector("input");
          if (checkbox) {
            checkbox.focus({ preventScroll: true });
          }
        }
      });
      return;
    }

    if (action === "previous-week") {
      selectedWeekStart = addCalendarDays(selectedWeekStart, -7);
      renderPlanner();
      return;
    }
    if (action === "next-week") {
      selectedWeekStart = addCalendarDays(selectedWeekStart, 7);
      renderPlanner();
      return;
    }
    if (action === "current-week") {
      selectedWeekStart = getWeekStart(dateForToday());
      renderPlanner();
      return;
    }
    if (action === "reset-filters") {
      filters = { type: "all", priority: "all", state: "all" };
      renderPlanner();
      return;
    }
    if (action === "toggle-theme") {
      plannerData.settings.theme =
        plannerData.settings.theme === "dark" ? "light" : "dark";
      persist();
      applyTheme();
      renderPlanner();
      return;
    }
    if (action === "export-data") {
      const exportName = "planner-backup-" + toDateKey(new Date()) + ".json";
      showToast(
        downloadPlannerData(plannerData, exportName)
          ? "Резервная копия подготовлена к скачиванию."
          : "Не удалось подготовить резервную копию."
      );
      return;
    }
    if (action === "import-data") {
      importFileInput.click();
      return;
    }
    if (action === "new-task") {
      openTaskDialog({
        defaults: {
          date: button.dataset.date || getDefaultTaskDate(),
          type: button.dataset.type || "current",
        },
      });
      return;
    }
    if (action === "edit-task") {
      const task = getTaskById(taskId);
      if (task) {
        openTaskDialog({ task: task });
      }
      return;
    }
    if (action === "copy-task") {
      const task = getTaskById(taskId);
      if (task) {
        openTaskDialog({ task: task, copy: true });
      }
      return;
    }
    if (action === "transfer-task") {
      const task = getTaskById(taskId);
      if (task) {
        openTransferDialog(task);
      }
      return;
    }
    if (action === "switch-type") {
      switchTaskType(taskId);
      return;
    }
    if (action === "delete-task") {
      deleteTask(taskId);
      return;
    }
    if (action === "toggle-completed-area") {
      plannerData.settings.completedCollapsed = !plannerData.settings.completedCollapsed;
      persist();
      renderPlanner();
    }
  }

  function initializeEventHandlers() {
    appRoot.addEventListener("click", handleRootClick);
    appRoot.addEventListener("input", function (event) {
      const control = event.target;
      if (control.matches("[data-week-note]")) {
        saveWeeklyNote(control.dataset.weekNote, control.value);
      }
    });
    appRoot.addEventListener("change", function (event) {
      const control = event.target;
      if (control.matches("[data-action='toggle-completed']")) {
        toggleTaskCompletion(control.dataset.taskId, control.checked);
        return;
      }
      if (control.matches("[data-filter]")) {
        filters[control.dataset.filter] = control.value;
        renderPlanner();
      }
    });

    taskForm.addEventListener("submit", submitTaskForm);
    taskForm.addEventListener("input", function () {
      formDirty = true;
      clearTaskFormError();
    });
    taskForm.addEventListener("change", function (event) {
      formDirty = true;
      clearTaskFormError();
      if (event.target === taskRepeatInput) {
        updateRecurrenceVisibility();
      }
      if (event.target === taskDateInput) {
        recurrenceEndDateInput.min = taskDateInput.value || getTodayKey();
      }
    });
    taskDialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      requestCloseTaskForm();
    });
    taskDialog.addEventListener("click", function (event) {
      if (event.target === taskDialog) {
        requestCloseTaskForm();
      }
    });
    document.querySelectorAll("[data-close-task]").forEach(function (button) {
      button.addEventListener("click", requestCloseTaskForm);
    });

    transferForm.addEventListener("submit", submitTransferForm);
    transferDialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeTransferDialog();
    });
    document.querySelectorAll("[data-close-transfer]").forEach(function (button) {
      button.addEventListener("click", closeTransferDialog);
    });

    confirmDialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      confirmAction = null;
      closeDialog(confirmDialog);
    });
    document.querySelector("[data-confirm-cancel]").addEventListener("click", function () {
      confirmAction = null;
      closeDialog(confirmDialog);
    });
    document.querySelector("[data-confirm-accept]").addEventListener("click", function () {
      const action = confirmAction;
      confirmAction = null;
      if (typeof action === "function") {
        action();
      }
    });

    importFileInput.addEventListener("change", function () {
      const file = importFileInput.files && importFileInput.files[0];
      handleImportFile(file);
      importFileInput.value = "";
    });

    document.addEventListener("keydown", function (event) {
      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select, button") || target.isContentEditable);
      const dialogOpen = taskDialog.open || transferDialog.open || confirmDialog.open;
      if (event.key === "Escape") {
        if (confirmDialog.open) {
          event.preventDefault();
          confirmAction = null;
          closeDialog(confirmDialog);
          return;
        }
        if (transferDialog.open) {
          event.preventDefault();
          closeTransferDialog();
          return;
        }
        if (taskDialog.open) {
          event.preventDefault();
          requestCloseTaskForm();
          return;
        }
      }
      if (
        event.key.toLowerCase() === "n" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isTypingTarget &&
        !dialogOpen
      ) {
        event.preventDefault();
        openTaskDialog({ defaults: { date: getDefaultTaskDate(), type: "current" } });
      }
    });

    window.addEventListener("beforeunload", function (event) {
      if (taskDialog.open && formDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    window.addEventListener("focus", refreshForNewCalendarDay);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        refreshForNewCalendarDay();
      }
    });
    window.setInterval(refreshForNewCalendarDay, 60 * 1000);
  }

  function initializePage() {
    const result = loadPlannerData(window.localStorage);
    if (result.status === "empty") {
      plannerData = result.data;
      if (!persist()) {
        return;
      }
    } else if (result.status === "loaded") {
      plannerData = result.data;
    } else {
      appRoot.replaceChildren();
      const card = createElement("section", "weekend-panel");
      card.append(createElement("h1", "", "Не удалось открыть планировщик"));
      card.append(
        createElement(
          "p",
          "",
          result.status === "invalid"
            ? "Локальные данные повреждены. Они не были изменены; на следующем этапе можно будет восстановить их из резервной копии."
            : "Браузер не предоставляет доступ к localStorage. Проверьте настройки хранения данных."
        )
      );
      appRoot.append(card);
      return;
    }
    const referenceRecovery = restoreMissingMondayReferenceTasks(plannerData, dateForToday());
    const movedOverdueTasks = rollOverOverdueTasks(plannerData.tasks, dateForToday());
    if (referenceRecovery.changed || movedOverdueTasks > 0) {
      persist();
    }
    observedTodayKey = getTodayKey();
    selectedWeekStart = getWeekStart(dateForToday());
    applyTheme();
    initializeEventHandlers();
    renderPlanner();
    if (movedOverdueTasks > 0) {
      showToast(
        "Перенесено просроченных задач: " + movedOverdueTasks + "."
      );
    }
  }

  document.addEventListener("DOMContentLoaded", initializePage);
})();
