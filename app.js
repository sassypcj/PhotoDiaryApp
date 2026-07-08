const DB_NAME = "photoDiaryDB";
const STORE_NAME = "entries";
const MAX_DIM = 900;
const JPEG_QUALITY = 0.72;

let db;
let selectedPhotos = []; // array of dataURL strings for the entry being composed

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
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      transcript = transcript.trim();
      if (transcript) {
        const textarea = document.getElementById("entryText");
        textarea.value = textarea.value ? `${textarea.value} ${transcript}` : transcript;
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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

  body.innerHTML = `
    <div class="modal-body-date">${formatDate(entry.date)}</div>
    <div class="modal-body-photos">${photosHtml}</div>
    ${voiceHtml}
    <div class="modal-body-text">${escapeHtml(entry.text || "")}</div>
  `;

  modal.classList.remove("hidden");

  const deleteBtn = document.getElementById("deleteBtn");
  deleteBtn.onclick = async () => {
    if (confirm("이 기록을 삭제할까요?")) {
      await deleteEntry(entry.id);
      modal.classList.add("hidden");
      renderEntryList();
    }
  };
}

async function init() {
  document.getElementById("appTitle").textContent = dailyTitle();

  db = await openDB();
  document.getElementById("entryDate").value = todayStr();
  updateDateDisplay();
  renderEntryList();

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
    });

    selectedPhotos = [];
    voiceDataUrl = null;
    document.getElementById("entryText").value = "";
    document.getElementById("photoInput").value = "";
    hideVoicePreview();
    renderPreview();
    renderEntryList();
  });

  document.getElementById("closeModal").addEventListener("click", () => {
    document.getElementById("detailModal").classList.add("hidden");
  });

  document.getElementById("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") {
      e.currentTarget.classList.add("hidden");
    }
  });
}

init();
