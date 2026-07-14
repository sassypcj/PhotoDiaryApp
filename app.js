const DB_NAME = "photoDiaryDB";
const STORE_NAME = "entries";
const MAX_DIM = 900;
const JPEG_QUALITY = 0.72;

let db;
let selectedPhotos = []; // array of dataURL strings for the entry being composed
let selectedWeather = null;
let viewMode = "list"; // "list" | "calendar"
let calendarCursor = new Date();

// ---- Pattern lock ----

const LOCK_HASH_KEY = "photoDiaryLockHash";
const LOCK_MIN_DOTS = 4;

let lockMode = "unlock"; // "unlock" | "setup-first" | "setup-confirm" | "verify-for-change" | "verify-for-disable"
let pendingPattern = null;
let dotCenters = [];
let currentPattern = [];
let isDrawingPattern = false;

function getLockHash() {
  return localStorage.getItem(LOCK_HASH_KEY);
}

function setLockHash(hash) {
  localStorage.setItem(LOCK_HASH_KEY, hash);
}

function clearLockHash() {
  localStorage.removeItem(LOCK_HASH_KEY);
}

async function hashPattern(patternArr) {
  const data = new TextEncoder().encode(patternArr.join("-"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function updateLockButtonLabel() {
  const btn = document.getElementById("lockManageBtn");
  btn.textContent = getLockHash() ? "🔒 잠금 관리" : "🔒 잠금 설정";
}

function showLockMsg(text, isError) {
  const msg = document.getElementById("lockMsg");
  msg.textContent = text;
  msg.classList.toggle("error", !!isError);
}

function getDotCenters() {
  const dots = document.querySelectorAll("#lockGrid .lock-dot");
  const gridRect = document.getElementById("lockGrid").getBoundingClientRect();
  return Array.from(dots).map((dot) => {
    const r = dot.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - gridRect.left,
      y: r.top + r.height / 2 - gridRect.top,
    };
  });
}

function makeLockLine(a, b) {
  const ns = "http://www.w3.org/2000/svg";
  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", a.x);
  line.setAttribute("y1", a.y);
  line.setAttribute("x2", b.x);
  line.setAttribute("y2", b.y);
  line.setAttribute("class", "lock-line-seg");
  return line;
}

function renderLockLines(pointerPos) {
  const svg = document.getElementById("lockLines");
  svg.innerHTML = "";
  for (let i = 0; i < currentPattern.length - 1; i++) {
    svg.appendChild(makeLockLine(dotCenters[currentPattern[i]], dotCenters[currentPattern[i + 1]]));
  }
  if (pointerPos && currentPattern.length > 0) {
    svg.appendChild(makeLockLine(dotCenters[currentPattern[currentPattern.length - 1]], pointerPos));
  }
}

function clearLockDrawing() {
  currentPattern = [];
  document.querySelectorAll("#lockGrid .lock-dot.active").forEach((dot) => dot.classList.remove("active"));
  document.getElementById("lockLines").innerHTML = "";
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function handleLockPointerMove(e) {
  const gridRect = document.getElementById("lockGrid").getBoundingClientRect();
  const pos = { x: e.clientX - gridRect.left, y: e.clientY - gridRect.top };
  dotCenters.forEach((c, idx) => {
    if (currentPattern.includes(idx)) return;
    const dist = Math.hypot(c.x - pos.x, c.y - pos.y);
    if (dist < 26) {
      currentPattern.push(idx);
      document.querySelector(`#lockGrid .lock-dot[data-idx="${idx}"]`).classList.add("active");
    }
  });
  renderLockLines(pos);
}

async function finalizeLockPattern() {
  const pattern = currentPattern.slice();
  clearLockDrawing();

  if (pattern.length < LOCK_MIN_DOTS) {
    showLockMsg(`${LOCK_MIN_DOTS}개 이상의 점을 연결해주세요`, true);
    return;
  }

  if (lockMode === "unlock") {
    const hash = await hashPattern(pattern);
    if (hash === getLockHash()) {
      hideLockScreen();
      onUnlockSuccess();
    } else {
      showLockMsg("패턴이 일치하지 않아요. 다시 시도해주세요.", true);
    }
  } else if (lockMode === "setup-first") {
    pendingPattern = pattern;
    lockMode = "setup-confirm";
    showLockMsg("확인을 위해 한 번 더 그려주세요");
  } else if (lockMode === "setup-confirm") {
    if (arraysEqual(pattern, pendingPattern)) {
      setLockHash(await hashPattern(pattern));
      pendingPattern = null;
      hideLockScreen();
      updateLockButtonLabel();
      alert("패턴 잠금이 설정됐어요.");
    } else {
      showLockMsg("패턴이 일치하지 않아요. 처음부터 다시 그려주세요.", true);
      lockMode = "setup-first";
      pendingPattern = null;
    }
  } else if (lockMode === "verify-for-change") {
    const hash = await hashPattern(pattern);
    if (hash === getLockHash()) {
      lockMode = "setup-first";
      document.getElementById("lockManageLinks").classList.add("hidden");
      document.getElementById("lockForgotBtn").classList.add("hidden");
      document.getElementById("lockTitle").textContent = "새 패턴을 그려주세요";
      showLockMsg("");
    } else {
      showLockMsg("패턴이 일치하지 않아요.", true);
    }
  } else if (lockMode === "verify-for-disable") {
    const hash = await hashPattern(pattern);
    if (hash === getLockHash()) {
      clearLockHash();
      hideLockScreen();
      updateLockButtonLabel();
      alert("패턴 잠금을 껐어요.");
    } else {
      showLockMsg("패턴이 일치하지 않아요.", true);
    }
  }
}

function openLockScreen(mode) {
  lockMode = mode;
  pendingPattern = null;
  clearLockDrawing();
  showLockMsg("");

  const isUnlock = mode === "unlock";
  const isManageVerify = mode === "verify-for-change" || mode === "verify-for-disable";
  document.getElementById("lockForgotBtn").classList.toggle("hidden", !isUnlock);
  document.getElementById("lockManageLinks").classList.toggle("hidden", !isManageVerify);

  const titles = {
    unlock: "패턴을 그려주세요",
    "setup-first": "새로 사용할 패턴을 그려주세요",
    "setup-confirm": "확인을 위해 한 번 더 그려주세요",
    "verify-for-change": "현재 패턴을 먼저 그려주세요",
    "verify-for-disable": "현재 패턴을 먼저 그려주세요",
  };
  document.getElementById("lockTitle").textContent = titles[mode] || "패턴을 그려주세요";

  const screen = document.getElementById("lockScreen");
  screen.classList.remove("hidden");

  dotCenters = getDotCenters();
}

function hideLockScreen() {
  document.getElementById("lockScreen").classList.add("hidden");
}

function onUnlockSuccess() {
  refreshViews();
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function addEntry(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function putEntry(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteEntry(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getAllEntries() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round(height * (MAX_DIM / width));
            width = MAX_DIM;
          } else {
            width = Math.round(width * (MAX_DIM / height));
            height = MAX_DIM;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAILY_TITLES = [
  "📔 오늘은 어땠어?",
  "🌷 오늘 하루, 잘 보냈어?",
  "🌙 지금 기분이 어때?",
  "📔 오늘의 감정을 기록해볼까?",
  "🌸 오늘 하루는 어땠나요?",
  "🌙 오늘도 수고 많았어",
  "🌷 오늘 있었던 일, 들려줄래?",
  "💌 요즘 마음은 좀 어때?",
  "🌸 오늘 하루를 색으로 표현한다면?",
  "📷 오늘 웃었던 순간은?",
  "🌙 지금 이 순간의 느낌을 남겨봐",
  "☕ 지금 눈을 감으면 뭐가 느껴져?",
  "💌 마음 한 켠에 남은 오늘은?",
  "📔 오늘 나에게 하고 싶은 말은?",
  "🌸 지금 무슨 생각해?",
  "☕ 오늘 하루도 애썼어~",
  "💌 지금 감정은 어때?",
  "🌷 오늘 기억하고 싶은 순간은?",
  "☕ 오늘 컨디션은 어땠어?",
  "📷 하루를 사진 한 장으로 담는다면?",
  "📔 오늘의 일기, 시작해볼까요?",
  "🌸 오늘 하루 수고해썽^^*"
];

function hashSeed(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const NO_PHOTO_FACES = ["( ˙_˙ )", "'_'", "^0^*", "^♡^", "*^^*", "♡"];

function noPhotoFace(entry) {
  return NO_PHOTO_FACES[hashSeed(String(entry.id)) % NO_PHOTO_FACES.length];
}

function dailyTitle() {
  return DAILY_TITLES[hashSeed(todayStr()) % DAILY_TITLES.length];
}

// Pastel palette taken from a sticker-sheet reference image, spanning
// purple -> pink -> red -> orange -> yellow -> green -> teal -> blue.
const DAILY_ACCENT_COLORS = [
  "#9B8AC4", // 보라
  "#B9A6DE", // 라벤더
  "#D68FB0", // 모브 핑크
  "#E06C8E", // 마젠타
  "#E2637A", // 코랄 레드
  "#E8927C", // 살몬
  "#E8A15C", // 오렌지
  "#D9A441", // 머스타드
  "#A8A45C", // 올리브
  "#8FB08A", // 세이지 그린
  "#7CC2AE", // 민트
  "#5FA8A0", // 틸
  "#7FB3D9", // 스카이 블루
  "#8C93C7", // 페리윙클
];

function dailyAccentColor() {
  return DAILY_ACCENT_COLORS[hashSeed(`${todayStr()}-color`) % DAILY_ACCENT_COLORS.length];
}

function darkenHex(hex, factor = 0.82) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (c) => Math.max(0, Math.min(255, Math.round(c)));
  const r = clamp(((n >> 16) & 255) * factor);
  const g = clamp(((n >> 8) & 255) * factor);
  const b = clamp((n & 255) * factor);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function applyDailyAccentColor() {
  const accent = dailyAccentColor();
  const accentDark = darkenHex(accent);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-dark", accentDark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = accent;
}

function formatDate(dateStr) {
  return dateStr;
}

function formatTime(id) {
  const d = new Date(id);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function updateDateDisplay() {
  const input = document.getElementById("entryDate");
  document.getElementById("entryDateText").textContent = formatDate(input.value);
}

function renderPreview() {
  const preview = document.getElementById("photoPreview");
  preview.innerHTML = "";
  selectedPhotos.forEach((src, index) => {
    const thumb = document.createElement("div");
    thumb.className = "photo-thumb";

    const img = document.createElement("img");
    img.src = src;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-photo-btn";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", "사진 삭제");
    removeBtn.addEventListener("click", () => {
      selectedPhotos.splice(index, 1);
      renderPreview();
    });

    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    preview.appendChild(thumb);
  });
  const labelText = document.getElementById("photoLabelText");
  labelText.textContent = selectedPhotos.length
    ? `📎 사진 ${selectedPhotos.length}장 선택됨`
    : "📎 사진 추가";
}

// ---- Voice recording ----

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let isRecording = false;
let voiceDataUrl = null;
let voiceTranscriptDraft = "";
let transcribePromise = null;

// ---- On-device speech-to-text (Whisper, via transformers.js) ----
// Runs fully on the phone after recording stops - no audio ever leaves the
// device. First use downloads the model (~70MB) and caches it for offline use.

const ASR_MODEL = "Xenova/whisper-base";
let asrPipelinePromise = null;

function getAsrPipeline(onProgress) {
  if (!asrPipelinePromise) {
    asrPipelinePromise = import("./vendor/transformers.min.js").then(({ pipeline }) =>
      pipeline("automatic-speech-recognition", ASR_MODEL, {
        quantized: true,
        progress_callback: onProgress,
      })
    );
  }
  return asrPipelinePromise;
}

function setTranscribeStatus(text, isError) {
  const el = document.getElementById("voiceTranscriptPreview");
  el.textContent = text;
  el.classList.toggle("error", !!isError);
  el.classList.toggle("hidden", !text);
}

// Whisper (especially the small quantized models) can fall into a
// "hallucination loop" on unclear/quiet audio, repeating the same short
// phrase dozens of times instead of failing cleanly. Detect that and treat
// it as a failed transcription rather than dumping garbage into the diary.
function collapseRepetition(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length;
  for (let phraseLen = 1; phraseLen <= 4; phraseLen++) {
    for (let start = 0; start + phraseLen * 4 <= n; start++) {
      const phrase = words.slice(start, start + phraseLen).join(" ");
      let pos = start + phraseLen;
      let repeats = 1;
      while (pos + phraseLen <= n && words.slice(pos, pos + phraseLen).join(" ") === phrase) {
        repeats++;
        pos += phraseLen;
      }
      if (repeats >= 4) {
        return words.slice(0, start).join(" ").trim();
      }
    }
  }
  return text;
}

function startTranscription(dataUrl) {
  transcribePromise = (async () => {
    try {
      setTranscribeStatus("🤖 음성을 텍스트로 변환 중...");
      const transcriber = await getAsrPipeline((progress) => {
        if (progress && progress.status === "progress") {
          setTranscribeStatus(`🤖 처음 사용 준비 중... (${Math.round(progress.progress || 0)}%)`);
        }
      });
      const result = await transcriber(dataUrl, { language: "korean", task: "transcribe" });
      const rawText = ((result && result.text) || "").trim();
      voiceTranscriptDraft = collapseRepetition(rawText);

      if (voiceTranscriptDraft) {
        setTranscribeStatus(`🎙️ ${voiceTranscriptDraft}`);
      } else if (rawText) {
        setTranscribeStatus("텍스트 인식이 불안정했어요. 음성은 정상적으로 저장돼요.", true);
      } else {
        setTranscribeStatus("");
      }
    } catch (err) {
      console.error("STT failed:", err);
      voiceTranscriptDraft = "";
      setTranscribeStatus("텍스트 변환에 실패했어요. 음성은 정상적으로 저장돼요.", true);
    }
  })();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function updateVoiceButton() {
  const btn = document.getElementById("voiceBtn");
  if (isRecording) {
    btn.textContent = "⏹";
    btn.classList.add("recording");
    btn.title = "녹음 중지";
    btn.setAttribute("aria-label", "녹음 중지");
  } else {
    btn.textContent = "🎙️";
    btn.classList.remove("recording");
    btn.title = "음성으로 기록하기";
    btn.setAttribute("aria-label", "음성으로 기록하기");
  }
}

function showVoicePreview(dataUrl) {
  const wrap = document.getElementById("voicePreviewWrap");
  const audio = document.getElementById("voicePreviewAudio");
  audio.src = dataUrl;
  wrap.classList.remove("hidden");
}

function hideVoicePreview() {
  const wrap = document.getElementById("voicePreviewWrap");
  const audio = document.getElementById("voicePreviewAudio");
  audio.removeAttribute("src");
  audio.load();
  wrap.classList.add("hidden");
  voiceTranscriptDraft = "";
  transcribePromise = null;
  setTranscribeStatus("");
}

async function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    alert("이 브라우저에서는 음성 녹음을 지원하지 않아요.");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert("마이크 권한이 필요해요.");
    return;
  }

  audioChunks = [];
  voiceTranscriptDraft = "";
  transcribePromise = null;
  setTranscribeStatus("");
  mediaRecorder = new MediaRecorder(mediaStream);
  mediaRecorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  });
  mediaRecorder.addEventListener("stop", async () => {
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
    voiceDataUrl = await blobToDataUrl(blob);
    showVoicePreview(voiceDataUrl);
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    startTranscription(voiceDataUrl);
  });
  mediaRecorder.start();

  isRecording = true;
  updateVoiceButton();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  isRecording = false;
  updateVoiceButton();
}

// ---- List / calendar views ----

const ICON_LIST =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
const ICON_CALENDAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>';

async function refreshViews() {
  await renderEntryList();
  if (viewMode === "calendar") {
    await renderCalendar();
  }
}

function switchView(mode) {
  viewMode = mode;
  document.getElementById("listView").classList.toggle("hidden", mode !== "list");
  document.getElementById("calendarView").classList.toggle("hidden", mode !== "calendar");

  const btn = document.getElementById("viewToggleBtn");
  if (mode === "list") {
    btn.innerHTML = ICON_CALENDAR;
    btn.title = "달력 보기";
    btn.setAttribute("aria-label", "달력 보기");
  } else {
    btn.innerHTML = ICON_LIST;
    btn.title = "목록 보기";
    btn.setAttribute("aria-label", "목록 보기");
    renderCalendar();
  }
}

async function renderEntryList() {
  const entries = await getAllEntries();
  entries.sort((a, b) => b.id - a.id);

  const list = document.getElementById("entryList");
  const emptyMsg = document.getElementById("emptyMsg");
  list.innerHTML = "";

  if (entries.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  const byDate = groupEntriesByDate(entries);

  byDate.forEach((dayEntries, date) => {
    const group = document.createElement("div");
    group.className = "date-group";

    const header = document.createElement("div");
    header.className = "date-group-header";
    header.textContent = formatDate(date);
    group.appendChild(header);

    dayEntries.forEach((entry) => {
      const card = document.createElement("div");
      card.className = "entry-card";

      let thumbHtml;
      if (entry.photos && entry.photos.length > 0) {
        thumbHtml = `<img class="thumb" src="${entry.photos[0]}" />`;
      } else {
        thumbHtml = `<div class="thumb placeholder">${noPhotoFace(entry)}</div>`;
      }

      card.innerHTML = `
        ${thumbHtml}
        <div class="info">
          <div class="time">${formatTime(entry.id)}${entry.weather ? ` ${entry.weather}` : ""}</div>
          <div class="snippet">${escapeHtml(entry.text || "(내용 없음)")}</div>
        </div>
      `;
      card.addEventListener("click", () => openDetail(entry));
      group.appendChild(card);
    });

    list.appendChild(group);
  });
}

function groupEntriesByDate(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    if (!map.has(entry.date)) map.set(entry.date, []);
    map.get(entry.date).push(entry);
  });
  return map;
}

async function renderCalendar() {
  const entries = await getAllEntries();
  const byDate = groupEntriesByDate(entries);

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  document.getElementById("calendarTitle").textContent = `${year}-${String(month + 1).padStart(2, "0")}`;

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const pad = (n) => String(n).padStart(2, "0");
  const todayKey = todayStr();

  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-cell empty";
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${pad(month + 1)}-${pad(day)}`;
    const dayEntries = byDate.get(dateKey) || [];
    const cell = document.createElement("div");
    cell.className =
      "cal-cell" + (dayEntries.length ? " has-entry" : "") + (dateKey === todayKey ? " today" : "");

    const withPhoto = dayEntries.find((entry) => entry.photos && entry.photos.length > 0);
    const countBadge = dayEntries.length ? `<span class="cal-count">${dayEntries.length}</span>` : "";
    if (withPhoto) {
      cell.innerHTML = `<span class="cal-day-num">${day}</span><img class="cal-thumb" src="${withPhoto.photos[0]}" />${countBadge}`;
    } else {
      cell.innerHTML = `<span class="cal-day-num">${day}</span>${countBadge}`;
    }

    if (dayEntries.length > 0) {
      cell.addEventListener("click", () => {
        if (dayEntries.length === 1) {
          openDetail(dayEntries[0]);
        } else {
          openDayList(dateKey, dayEntries);
        }
      });
    }
    grid.appendChild(cell);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function openDayList(dateKey, dayEntries) {
  const modal = document.getElementById("detailModal");
  const body = document.getElementById("modalBody");

  const itemsHtml = dayEntries
    .map((entry, idx) => {
      const thumbHtml =
        entry.photos && entry.photos.length > 0
          ? `<img class="thumb" src="${entry.photos[0]}" />`
          : `<div class="thumb placeholder">📝</div>`;
      return `<div class="day-list-item" data-idx="${idx}">
        ${thumbHtml}
        <div class="snippet">${escapeHtml(entry.text || "(내용 없음)")}</div>
      </div>`;
    })
    .join("");

  body.innerHTML = `
    <div class="modal-body-date">${formatDate(dateKey)}</div>
    <div class="day-list">${itemsHtml}</div>
  `;

  document.getElementById("modalActions").classList.add("hidden");

  body.querySelectorAll(".day-list-item").forEach((el) => {
    el.addEventListener("click", () => openDetail(dayEntries[Number(el.dataset.idx)]));
  });

  modal.classList.remove("hidden");
}

function openDetail(entry) {
  const modal = document.getElementById("detailModal");
  const body = document.getElementById("modalBody");

  const photosHtml = (entry.photos || [])
    .map((src) => `<img src="${src}" />`)
    .join("");

  const voiceHtml = entry.voiceNote
    ? `<div class="modal-body-voice"><audio controls src="${entry.voiceNote}"></audio></div>`
    : "";

  const voiceTranscriptHtml = entry.voiceTranscript
    ? `<div class="modal-body-voice-text">
        <div class="voice-text-label">🎙️ 음성을 텍스트로</div>
        <div class="voice-text-content">${escapeHtml(entry.voiceTranscript)}</div>
      </div>`
    : "";

  body.innerHTML = `
    <div class="modal-body-date">${formatDate(entry.date)}${entry.weather ? ` ${entry.weather}` : ""}</div>
    <div class="modal-body-photos">${photosHtml}</div>
    ${voiceHtml}
    ${voiceTranscriptHtml}
    <div class="modal-body-text">${escapeHtml(entry.text || "")}</div>
  `;

  document.getElementById("modalActions").classList.remove("hidden");
  modal.classList.remove("hidden");

  const shareBtn = document.getElementById("shareBtn");
  shareBtn.onclick = () => shareEntry(entry);

  const deleteBtn = document.getElementById("deleteBtn");
  deleteBtn.onclick = async () => {
    if (confirm("이 기록을 삭제할까요?")) {
      await deleteEntry(entry.id);
      modal.classList.add("hidden");
      refreshViews();
    }
  };
}

// ---- Backup / restore / share ----

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function backupAll() {
  const entries = await getAllEntries();
  if (entries.length === 0) {
    alert("백업할 기록이 아직 없어요.");
    return;
  }
  const payload = {
    app: "photoDiaryDB",
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
  downloadJson(`사진일기_백업_${todayStr()}.json`, payload);
}

async function restoreFromFile(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    alert("파일을 읽을 수 없어요.");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    alert("올바른 백업 파일이 아니에요.");
    return;
  }

  const entries = Array.isArray(payload) ? payload : payload.entries;
  if (!Array.isArray(entries)) {
    alert("올바른 백업 파일이 아니에요.");
    return;
  }

  if (!confirm(`${entries.length}개의 기록을 복원할까요? 같은 날짜/id의 기록은 덮어써질 수 있어요.`)) {
    return;
  }

  let restored = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.id === "undefined" || !entry.date) continue;
    try {
      await putEntry(entry);
      restored++;
    } catch {
      // skip malformed entries
    }
  }

  await refreshViews();
  alert(`${restored}개의 기록을 복원했어요.`);
}

async function dataUrlToFile(dataUrl, filename) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "application/octet-stream" });
}

async function shareEntry(entry) {
  if (!navigator.share) {
    alert("이 브라우저/기기에서는 공유 기능을 지원하지 않아요. 대신 백업 파일로 저장해보세요.");
    return;
  }

  const shareData = {
    title: "오늘의 사진 일기",
    text: `${formatDate(entry.date)}\n\n${entry.text || ""}${
      entry.voiceTranscript ? `\n\n🎙️ ${entry.voiceTranscript}` : ""
    }`,
  };

  try {
    const files = [];
    if (entry.photos) {
      for (let i = 0; i < entry.photos.length; i++) {
        files.push(await dataUrlToFile(entry.photos[i], `photo-${i + 1}.jpg`));
      }
    }
    if (entry.voiceNote) {
      const ext = entry.voiceNote.includes("mp4") ? "m4a" : "webm";
      files.push(await dataUrlToFile(entry.voiceNote, `voice.${ext}`));
    }
    if (files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
      shareData.files = files;
    }
    await navigator.share(shareData);
  } catch (err) {
    if (err && err.name !== "AbortError") {
      alert("공유 중 문제가 발생했어요.");
    }
  }
}

async function init() {
  document.getElementById("appTitle").textContent = dailyTitle();
  applyDailyAccentColor();

  db = await openDB();
  document.getElementById("entryDate").value = todayStr();
  updateDateDisplay();
  updateLockButtonLabel();
  document.getElementById("viewToggleBtn").innerHTML = ICON_CALENDAR;

  if (getLockHash()) {
    openLockScreen("unlock");
  } else {
    refreshViews();
  }

  document.getElementById("entryDate").addEventListener("change", updateDateDisplay);

  document.getElementById("changeDateBtn").addEventListener("click", () => {
    const input = document.getElementById("entryDate");
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  });

  document.getElementById("photoInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const dataUrl = await resizeImage(file);
      selectedPhotos.push(dataUrl);
    }
    renderPreview();
  });

  document.getElementById("voiceBtn").addEventListener("click", () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  document.getElementById("emojiBtn").addEventListener("click", () => {
    const panel = document.getElementById("emojiPanel");
    const btn = document.getElementById("emojiBtn");
    const isOpen = !panel.classList.contains("hidden");
    panel.classList.toggle("hidden", isOpen);
    btn.classList.toggle("active", !isOpen);
  });

  document.querySelectorAll("#emojiPanel .emoji-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const textarea = document.getElementById("entryText");
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const emoji = btn.dataset.emoji;
      textarea.value = textarea.value.slice(0, start) + emoji + textarea.value.slice(end);
      const cursor = start + emoji.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  });

  document.getElementById("removeVoiceBtn").addEventListener("click", () => {
    voiceDataUrl = null;
    hideVoicePreview();
  });

  document.querySelectorAll("#weatherPicker .weather-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const isSelected = btn.classList.contains("selected");
      document.querySelectorAll("#weatherPicker .weather-opt.selected").forEach((el) => el.classList.remove("selected"));
      if (isSelected) {
        selectedWeather = null;
      } else {
        btn.classList.add("selected");
        selectedWeather = btn.dataset.weather;
      }
    });
  });

  document.getElementById("saveBtn").addEventListener("click", async () => {
    const date = document.getElementById("entryDate").value || todayStr();
    const text = document.getElementById("entryText").value.trim();

    if (isRecording) {
      alert("녹음을 먼저 멈춰주세요.");
      return;
    }

    if (!text && selectedPhotos.length === 0 && !voiceDataUrl) {
      alert("사진, 음성, 글 중 하나는 남겨주세요!");
      return;
    }

    const saveBtn = document.getElementById("saveBtn");
    if (transcribePromise) {
      saveBtn.disabled = true;
      saveBtn.textContent = "텍스트 변환 완료 대기 중...";
      await transcribePromise.catch(() => {});
      saveBtn.disabled = false;
      saveBtn.textContent = "저장하기";
    }

    await addEntry({
      id: Date.now(),
      date,
      text,
      photos: selectedPhotos,
      voiceNote: voiceDataUrl,
      voiceTranscript: voiceTranscriptDraft || null,
      weather: selectedWeather,
    });

    selectedPhotos = [];
    voiceDataUrl = null;
    selectedWeather = null;
    document.getElementById("entryText").value = "";
    document.getElementById("photoInput").value = "";
    document.querySelectorAll("#weatherPicker .weather-opt.selected").forEach((btn) => btn.classList.remove("selected"));
    document.getElementById("emojiPanel").classList.add("hidden");
    document.getElementById("emojiBtn").classList.remove("active");
    hideVoicePreview();
    renderPreview();
    refreshViews();
  });

  document.getElementById("closeModal").addEventListener("click", () => {
    document.getElementById("detailModal").classList.add("hidden");
  });

  document.getElementById("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") {
      e.currentTarget.classList.add("hidden");
    }
  });

  document.getElementById("viewToggleBtn").addEventListener("click", () => {
    switchView(viewMode === "list" ? "calendar" : "list");
  });
  document.getElementById("prevMonthBtn").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById("backupBtn").addEventListener("click", backupAll);
  document.getElementById("restoreBtn").addEventListener("click", () => {
    document.getElementById("restoreInput").click();
  });
  document.getElementById("restoreInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) await restoreFromFile(file);
    e.target.value = "";
  });

  document.getElementById("lockManageBtn").addEventListener("click", () => {
    if (getLockHash()) {
      openLockScreen("verify-for-change");
    } else {
      openLockScreen("setup-first");
    }
  });

  document.getElementById("lockChangeLink").addEventListener("click", () => {
    lockMode = "verify-for-change";
    document.getElementById("lockTitle").textContent = "현재 패턴을 그려 확인해주세요 (변경)";
    showLockMsg("");
  });

  document.getElementById("lockDisableLink").addEventListener("click", () => {
    lockMode = "verify-for-disable";
    document.getElementById("lockTitle").textContent = "현재 패턴을 그려 확인해주세요 (끄기)";
    showLockMsg("");
  });

  document.getElementById("lockForgotBtn").addEventListener("click", () => {
    if (confirm("패턴을 초기화할까요? 일기 데이터는 그대로 남아있고, 잠금만 새로 설정하면 돼요.")) {
      clearLockHash();
      hideLockScreen();
      updateLockButtonLabel();
      onUnlockSuccess();
      alert("잠금이 초기화됐어요. 원하시면 다시 설정해주세요.");
    }
  });

  const lockGrid = document.getElementById("lockGrid");
  lockGrid.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dotCenters = getDotCenters();
    currentPattern = [];
    isDrawingPattern = true;
    handleLockPointerMove(e);
  });
  document.addEventListener("pointermove", (e) => {
    if (!isDrawingPattern) return;
    handleLockPointerMove(e);
  });
  document.addEventListener("pointerup", () => {
    if (!isDrawingPattern) return;
    isDrawingPattern = false;
    finalizeLockPattern();
  });
}

init();
