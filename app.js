const DB_NAME = "photoDiaryDB";
const STORE_NAME = "entries";
const MAX_DIM = 900;
const JPEG_QUALITY = 0.72;

let db;
let selectedPhotos = []; // array of dataURL strings for the entry being composed
let viewMode = "list"; // "list" | "calendar"
let calendarCursor = new Date();

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
  "📷 오늘은 어땠어?",
  "📷 오늘 하루, 잘 보냈어?",
  "📷 지금 기분이 어때?",
  "📷 오늘의 감정을 기록해볼까요?",
  "📷 오늘 하루는 어땠나요?",
  "📷 오늘도 수고 많았어",
  "📷 오늘 있었던 일, 들려줄래?",
  "📷 요즘 마음은 좀 어때?",
  "📷 오늘 하루를 색으로 표현한다면?",
  "📷 오늘 웃었던 순간이 있었어?",
  "📷 지금 이 순간의 느낌을 남겨봐",
  "📷 오늘은 어떤 하루였나요?",
  "📷 마음 한 켠에 남은 오늘",
  "📷 오늘의 나에게 하고 싶은 말",
  "📷 오늘 하루도 애썼어",
  "📷 지금 떠오르는 감정은?",
  "📷 오늘 기억하고 싶은 순간은?",
  "📷 오늘 컨디션은 어땠어?",
  "📷 하루를 사진 한 장으로 담는다면?",
  "📷 오늘의 일기, 시작해볼까요?",
];

function dailyTitle() {
  const seed = todayStr();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return DAILY_TITLES[hash % DAILY_TITLES.length];
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
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
let recognition = null;
let isRecording = false;
let voiceDataUrl = null;
let voiceTranscriptDraft = "";

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

function updateVoiceTranscriptPreview() {
  const p = document.getElementById("voiceTranscriptPreview");
  if (voiceTranscriptDraft) {
    p.textContent = `🎙️ ${voiceTranscriptDraft}`;
    p.classList.remove("hidden");
  } else {
    p.textContent = "";
    p.classList.add("hidden");
  }
}

function showVoicePreview(dataUrl) {
  const wrap = document.getElementById("voicePreviewWrap");
  const audio = document.getElementById("voicePreviewAudio");
  audio.src = dataUrl;
  wrap.classList.remove("hidden");
  updateVoiceTranscriptPreview();
}

function hideVoicePreview() {
  const wrap = document.getElementById("voicePreviewWrap");
  const audio = document.getElementById("voicePreviewAudio");
  audio.removeAttribute("src");
  audio.load();
  wrap.classList.add("hidden");
  voiceTranscriptDraft = "";
  updateVoiceTranscriptPreview();
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
  updateVoiceTranscriptPreview();
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
  });
  mediaRecorder.start();

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognitionCtor) {
    recognition = new SpeechRecognitionCtor();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.addEventListener("result", (e) => {
      let chunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        chunk += e.results[i][0].transcript;
      }
      chunk = chunk.trim();
      if (chunk) {
        voiceTranscriptDraft = voiceTranscriptDraft ? `${voiceTranscriptDraft} ${chunk}` : chunk;
        updateVoiceTranscriptPreview();
      }
    });
    recognition.addEventListener("error", () => {});
    recognition.start();
  }

  isRecording = true;
  updateVoiceButton();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  isRecording = false;
  updateVoiceButton();
}

// ---- List / calendar views ----

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
  document.getElementById("listTabBtn").classList.toggle("active", mode === "list");
  document.getElementById("calendarTabBtn").classList.toggle("active", mode === "calendar");
  if (mode === "calendar") {
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

  entries.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "entry-card";

    let thumbHtml;
    if (entry.photos && entry.photos.length > 0) {
      thumbHtml = `<img class="thumb" src="${entry.photos[0]}" />`;
    } else {
      thumbHtml = `<div class="thumb placeholder">📝</div>`;
    }

    card.innerHTML = `
      ${thumbHtml}
      <div class="info">
        <div class="date">${formatDate(entry.date)}</div>
        <div class="snippet">${escapeHtml(entry.text || "(내용 없음)")}</div>
      </div>
    `;
    card.addEventListener("click", () => openDetail(entry));
    list.appendChild(card);
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
  document.getElementById("calendarTitle").textContent = `${year}년 ${month + 1}월`;

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
    if (withPhoto) {
      cell.innerHTML = `<span class="cal-day-num">${day}</span><img class="cal-thumb" src="${withPhoto.photos[0]}" />`;
    } else {
      cell.innerHTML = `<span class="cal-day-num">${day}</span>${dayEntries.length ? '<span class="cal-dot"></span>' : ""}`;
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
    <div class="modal-body-date">${formatDate(entry.date)}</div>
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

  db = await openDB();
  document.getElementById("entryDate").value = todayStr();
  updateDateDisplay();
  refreshViews();

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

  document.getElementById("removeVoiceBtn").addEventListener("click", () => {
    voiceDataUrl = null;
    hideVoicePreview();
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

    await addEntry({
      id: Date.now(),
      date,
      text,
      photos: selectedPhotos,
      voiceNote: voiceDataUrl,
      voiceTranscript: voiceTranscriptDraft || null,
    });

    selectedPhotos = [];
    voiceDataUrl = null;
    document.getElementById("entryText").value = "";
    document.getElementById("photoInput").value = "";
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

  document.getElementById("listTabBtn").addEventListener("click", () => switchView("list"));
  document.getElementById("calendarTabBtn").addEventListener("click", () => switchView("calendar"));
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
}

init();
