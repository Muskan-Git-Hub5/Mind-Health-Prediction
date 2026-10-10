"use strict";

/* ---------- Configuration ---------- */
const API_URL = "https://mind-health-prediction-m3ce.onrender.com";   // change if your API runs elsewhere
const REQUEST_TIMEOUT_MS = 15000;
const SCORE_MAX = 10;                       // assumed scale of the model output; adjust to match your dataset

/* ---------- Field rules (mirror the Pydantic model) ---------- */
const FIELDS = {
  age:                     { type: "int",   min: 1, max: 100, label: "Age" },
  gender:                  { type: "choice", label: "Gender" },
  country:                 { type: "text",  label: "Country" },
  academic_level:          { type: "choice", label: "Academic level" },
  most_used_platform:      { type: "choice", label: "Most used platform" },
  purpose_of_use:          { type: "choice", label: "Main purpose" },
  avg_daily_usage_hours:   { type: "float", min: 0, max: 24, label: "Daily usage" },
  daily_unlocks:           { type: "int",   min: 0, label: "Phone unlocks" },
  study_hours:             { type: "float", min: 0, max: 24, label: "Study hours" },
  physical_activity_hours: { type: "float", min: 0, max: 2,  label: "Physical activity" },
  sleep_hours_per_night:   { type: "float", min: 0, max: 24, label: "Sleep hours" },
  stress_level:            { type: "choice", label: "Stress level" },
};

/* ---------- DOM ---------- */
const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const states = {
  idle: document.getElementById("state-idle"),
  loading: document.getElementById("state-loading"),
  result: document.getElementById("state-result"),
  error: document.getElementById("state-error"),
};
const ringBar = document.getElementById("ring-bar");
const RING_LENGTH = 326.7;

function showState(name) {
  Object.entries(states).forEach(([key, el]) => { el.hidden = key !== name; });
}

/* ---------- Validation ---------- */
function setFieldError(name, message) {
  const input = document.getElementById(name);
  const slot = document.querySelector(`.error[data-for="${name}"]`);
  if (!input || !slot) return;
  input.closest(".field").classList.toggle("invalid", Boolean(message));
  slot.textContent = message || "";
}

function clearErrors() {
  Object.keys(FIELDS).forEach((name) => setFieldError(name, ""));
}

function validate() {
  const payload = {};
  let firstInvalid = null;

  for (const [name, rule] of Object.entries(FIELDS)) {
    const raw = form.elements[name].value.trim();
    let error = "";

    if (raw === "") {
      error = rule.type === "choice" ? "Please select an option." : "This field is required.";
    } else if (rule.type === "int" || rule.type === "float") {
      const num = Number(raw);
      if (Number.isNaN(num)) error = "Enter a valid number.";
      else if (rule.type === "int" && !Number.isInteger(num)) error = "Enter a whole number.";
      else if (rule.min !== undefined && num < rule.min) error = `Must be at least ${rule.min}.`;
      else if (rule.max !== undefined && num > rule.max) error = `Must be at most ${rule.max}.`;
      else payload[name] = num;
    } else {
      payload[name] = raw;
    }

    setFieldError(name, error);
    if (error && !firstInvalid) firstInvalid = name;
  }

  if (firstInvalid) {
    document.getElementById(firstInvalid).focus();
    return null;
  }
  return payload;
}

/* ---------- API ---------- */
async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body = null;
    try { body = await response.json(); } catch (_) { /* non-JSON response */ }

    if (!response.ok) {
      const err = new Error("API error");
      err.status = response.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Result rendering ---------- */
function describeScore(score) {
  const ratio = score / SCORE_MAX;
  if (ratio >= 0.7) return ["Looking healthy", "Your habits point to a strong mental health score. Keep up the routines that work for you."];
  if (ratio >= 0.45) return ["Room to improve", "Your score is in the middle range. Small changes to sleep, activity or screen time can help."];
  return ["Worth some attention", "Your score is on the lower side. Consider reducing screen time and talking to someone you trust."];
}

function animateNumber(el, target, duration = 1200) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (target * eased).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function showResult(score) {
  const [title, note] = describeScore(score);
  document.getElementById("score-title").textContent = title;
  document.getElementById("score-note").textContent = note;
  document.getElementById("score-max").textContent = `out of ${SCORE_MAX}`;

  showState("result");

  const ratio = Math.max(0, Math.min(score / SCORE_MAX, 1));
  ringBar.style.strokeDashoffset = RING_LENGTH;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ringBar.style.strokeDashoffset = RING_LENGTH * (1 - ratio);
  }));
  animateNumber(document.getElementById("score-value"), score);
}

/* ---------- Error rendering ---------- */
function showError(title, message, details = []) {
  document.getElementById("error-title").textContent = title;
  document.getElementById("error-message").textContent = message;

  const list = document.getElementById("error-list");
  list.innerHTML = "";
  details.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
  list.hidden = details.length === 0;

  showState("error");
}

function handleError(err) {
  // Request timed out
  if (err.name === "AbortError") {
    return showError("The request timed out", "The server took too long to respond. Check that the API is running and try again.");
  }

  // Network failure or CORS / server offline
  if (!err.status) {
    return showError("Cannot reach the server", `Make sure the FastAPI backend is running at ${API_URL} and try again.`);
  }

  // Pydantic validation errors (422)
  if (err.status === 422 && Array.isArray(err.body?.detail)) {
    const messages = err.body.detail.map((item) => {
      const field = item.loc?.[item.loc.length - 1];
      if (field && FIELDS[field]) setFieldError(field, item.msg);
      const label = FIELDS[field]?.label || field || "Input";
      return `${label}: ${item.msg}`;
    });
    return showError("Some inputs were rejected", "The server could not accept these values. Please correct them and try again.", messages);
  }

  // Server-side failure (500 etc.)
  if (err.status >= 500) {
    return showError("The model hit an error", "The server failed while making the prediction. Check the backend logs for details.");
  }

  const detail = typeof err.body?.detail === "string" ? err.body.detail : `Request failed with status ${err.status}.`;
  showError("Request failed", detail);
}

/* ---------- Events ---------- */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();

  const payload = validate();
  if (!payload) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Predicting...";
  showState("loading");

  try {
    const data = await requestPrediction(payload);
    if (typeof data?.predicted_mental_health_score !== "number") {
      throw Object.assign(new Error("Unexpected response"), { status: 500 });
    }
    showResult(data.predicted_mental_health_score);
  } catch (err) {
    handleError(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Predict my score";
  }
});

form.addEventListener("reset", () => {
  clearErrors();
  showState("idle");
});

form.addEventListener("input", (event) => {
  if (event.target.name) setFieldError(event.target.name, "");
});

document.getElementById("retry-btn").addEventListener("click", () => showState("idle"));
