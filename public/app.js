const state = {
  mergeFiles: [],
  splitFile: null,
  extractFile: null,
  rotateFile: null,
  imageToPdfFiles: [],
  pdfToImagesFile: null,
  imageConvertFiles: [],
  history: []
};

const HISTORY_MAX = 8;

const statusText = document.getElementById("status-text");
const progressBar = document.getElementById("progress-bar");
const downloadLink = document.getElementById("download-link");
const floatingDownload = document.getElementById("floating-download");
const statusOperation = document.getElementById("status-operation");
const clearResultBtn = document.getElementById("clear-result-btn");
const statusPanel = document.getElementById("status-panel");
const selectedFileCount = document.getElementById("selected-file-count");
const selectedTotalSize = document.getElementById("selected-total-size");
const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const toolSearchInput = document.getElementById("tool-search");
const floatingTop = document.getElementById("floating-top");
const toastRoot = document.getElementById("toast-root");

let activeDownloadUrl = "";

const ZONE_CONFIG = {
  merge: { multiple: true, accept: ".pdf", filter: isPdfFile },
  split: { multiple: false, accept: ".pdf", filter: isPdfFile },
  extract: { multiple: false, accept: ".pdf", filter: isPdfFile },
  rotate: { multiple: false, accept: ".pdf", filter: isPdfFile },
  imageToPdf: { multiple: true, accept: ".jpg,.jpeg,.png,.webp", filter: isImageFile },
  pdfToImages: { multiple: false, accept: ".pdf", filter: isPdfFile },
  imageConvert: { multiple: true, accept: ".jpg,.jpeg,.png,.webp", filter: isImageFile }
};

function isPdfFile(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isImageFile(file) {
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return true;
  }
  return /\.(jpg|jpeg|png|webp)$/i.test(file.name);
}

function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function mergeUniqueFiles(existing, incoming) {
  const keys = new Set(existing.map((file) => fileKey(file)));
  const uniqueIncoming = [];
  let skipped = 0;

  incoming.forEach((file) => {
    const key = fileKey(file);
    if (keys.has(key)) {
      skipped += 1;
      return;
    }
    keys.add(key);
    uniqueIncoming.push(file);
  });

  return { files: [...existing, ...uniqueIncoming], skipped };
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) {
    return "0 MB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseFilenameFromHeader(disposition) {
  if (!disposition) {
    return null;
  }
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match ? match[1] : null;
}

function setOperation(label) {
  statusOperation.textContent = label || "No active task";
}

function setStatus(message, progress = 0) {
  statusText.textContent = message;
  progressBar.style.width = `${progress}%`;
}

function setBusy(isBusy) {
  document.querySelectorAll("form button[type='submit']").forEach((button) => {
    button.disabled = isBusy;
  });
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastRoot.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 2800);
}

function cleanupPreviewContainer(container) {
  container.querySelectorAll("[data-preview-url]").forEach((el) => {
    const url = el.dataset.previewUrl;
    if (url) {
      URL.revokeObjectURL(url);
    }
  });
  container.innerHTML = "";
}

function clearDownload() {
  if (activeDownloadUrl) {
    URL.revokeObjectURL(activeDownloadUrl);
    activeDownloadUrl = "";
  }
  downloadLink.classList.add("hidden");
  floatingDownload.classList.add("hidden");
  clearResultBtn.classList.add("hidden");
  downloadLink.removeAttribute("href");
  floatingDownload.removeAttribute("href");
  downloadLink.removeAttribute("download");
  floatingDownload.removeAttribute("download");
}

function clearHistory() {
  state.history.forEach((entry) => URL.revokeObjectURL(entry.url));
  state.history = [];
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = "";
  if (!state.history.length) {
    const li = document.createElement("li");
    li.className = "history-empty";
    li.textContent = "No outputs yet.";
    historyList.appendChild(li);
    return;
  }

  state.history.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "history-item";

    const file = document.createElement("p");
    file.className = "history-file";
    file.textContent = entry.filename;

    const time = document.createElement("p");
    time.className = "history-time";
    time.textContent = entry.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const download = document.createElement("a");
    download.href = entry.url;
    download.download = entry.filename;
    download.textContent = "Download";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(entry.url);
      state.history = state.history.filter((item) => item.id !== entry.id);
      renderHistory();
    });

    actions.appendChild(download);
    actions.appendChild(remove);
    li.appendChild(file);
    li.appendChild(time);
    li.appendChild(actions);
    historyList.appendChild(li);
  });
}

function addToHistory(blob, filename) {
  const historyUrl = URL.createObjectURL(blob);
  state.history.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    filename: filename || "result.bin",
    createdAt: new Date(),
    url: historyUrl
  });

  while (state.history.length > HISTORY_MAX) {
    const removed = state.history.pop();
    URL.revokeObjectURL(removed.url);
  }
  renderHistory();
}

function showDownload(blob, filename) {
  if (activeDownloadUrl) {
    URL.revokeObjectURL(activeDownloadUrl);
  }
  const blobUrl = URL.createObjectURL(blob);
  activeDownloadUrl = blobUrl;
  downloadLink.href = blobUrl;
  floatingDownload.href = blobUrl;
  downloadLink.download = filename || "result.bin";
  floatingDownload.download = filename || "result.bin";
  downloadLink.classList.remove("hidden");
  floatingDownload.classList.remove("hidden");
  clearResultBtn.classList.remove("hidden");
  addToHistory(blob, filename);
}

function getSelectedFiles() {
  const singles = [
    state.splitFile,
    state.extractFile,
    state.rotateFile,
    state.pdfToImagesFile
  ].filter(Boolean);

  return [...state.mergeFiles, ...state.imageToPdfFiles, ...state.imageConvertFiles, ...singles];
}

function updateSummaryStats() {
  const selected = getSelectedFiles();
  const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
  selectedFileCount.textContent = String(selected.length);
  selectedTotalSize.textContent = formatBytes(totalBytes);
}

function setListMeta(id, message) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = message;
  }
}

function fileBadge(file) {
  const text = document.createElement("span");
  text.className = "file-name";
  text.textContent = `${file.name} (${formatBytes(file.size)})`;
  return text;
}

function imagePreview(file, removeHandler) {
  const wrap = document.createElement("div");
  wrap.className = "preview-item";

  const main = document.createElement("div");
  main.className = "preview-main";

  const img = document.createElement("img");
  img.className = "preview-thumb";
  img.alt = file.name;
  const previewUrl = URL.createObjectURL(file);
  img.src = previewUrl;
  img.dataset.previewUrl = previewUrl;

  const text = document.createElement("span");
  text.className = "file-name";
  text.textContent = file.name;
  main.appendChild(img);
  main.appendChild(text);
  wrap.appendChild(main);

  if (removeHandler) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "mini-btn";
    removeButton.textContent = "x";
    removeButton.addEventListener("click", removeHandler);
    wrap.appendChild(removeButton);
  }
  return wrap;
}

function pdfPreview(file) {
  const wrap = document.createElement("div");
  wrap.className = "preview-item preview-pdf";

  const main = document.createElement("div");
  main.className = "preview-main";
  main.appendChild(fileBadge(file));
  wrap.appendChild(main);

  const embed = document.createElement("embed");
  embed.className = "preview-embed";
  embed.type = "application/pdf";
  const previewUrl = URL.createObjectURL(file);
  embed.src = previewUrl;
  embed.dataset.previewUrl = previewUrl;
  wrap.appendChild(embed);

  return wrap;
}

function renderSinglePreview(containerId, file) {
  const container = document.getElementById(containerId);
  cleanupPreviewContainer(container);
  if (!file) {
    updateSummaryStats();
    return;
  }
  if (isImageFile(file)) {
    container.appendChild(imagePreview(file));
  } else {
    container.appendChild(pdfPreview(file));
  }
  updateSummaryStats();
}

function renderImageGrid(containerId, files, stateKey, metaId) {
  const container = document.getElementById(containerId);
  cleanupPreviewContainer(container);

  files.forEach((file, index) => {
    const remove = () => {
      state[stateKey].splice(index, 1);
      renderImageGrid(containerId, state[stateKey], stateKey, metaId);
      clearDownload();
      setStatus("Selection updated.", 0);
      setOperation("No active task");
    };
    container.appendChild(imagePreview(file, remove));
  });

  const count = files.length;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (!count) {
    setListMeta(metaId, "No images selected.");
  } else {
    setListMeta(metaId, `${count} image${count > 1 ? "s" : ""} selected - ${formatBytes(total)}`);
  }

  updateSummaryStats();
}

function renderMergeList() {
  const list = document.getElementById("merge-list");
  list.innerHTML = "";

  state.mergeFiles.forEach((file, index) => {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.index = String(index);

    const fileName = document.createElement("span");
    fileName.className = "file-name";
    fileName.textContent = `${index + 1}. ${file.name}`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "mini-btn";
    removeButton.textContent = "x";
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      state.mergeFiles.splice(index, 1);
      renderMergeList();
      clearDownload();
      setStatus("Merge list updated.", 0);
      setOperation("No active task");
    });

    li.appendChild(fileName);
    li.appendChild(removeButton);
    list.appendChild(li);
  });

  const count = state.mergeFiles.length;
  const total = state.mergeFiles.reduce((sum, file) => sum + file.size, 0);
  if (!count) {
    setListMeta("merge-stats", "No files selected.");
  } else {
    setListMeta("merge-stats", `${count} PDF${count > 1 ? "s" : ""} selected - ${formatBytes(total)}`);
  }

  let sourceIndex = -1;
  list.querySelectorAll("li").forEach((li) => {
    li.addEventListener("dragstart", (event) => {
      sourceIndex = Number(event.currentTarget.dataset.index);
    });
    li.addEventListener("dragover", (event) => event.preventDefault());
    li.addEventListener("drop", (event) => {
      event.preventDefault();
      const targetIndex = Number(event.currentTarget.dataset.index);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return;
      }
      const [moved] = state.mergeFiles.splice(sourceIndex, 1);
      state.mergeFiles.splice(targetIndex, 0, moved);
      renderMergeList();
    });
  });

  updateSummaryStats();
}

function normalizeSelectedFiles(files, zoneName) {
  const config = ZONE_CONFIG[zoneName];
  const valid = files.filter(config.filter);
  const invalid = files.length - valid.length;
  if (invalid > 0) {
    showToast(`${invalid} unsupported file${invalid > 1 ? "s were" : " was"} ignored.`, "error");
  }
  return valid;
}

function initializeDropZone(zoneName, onFiles) {
  const config = ZONE_CONFIG[zoneName];
  const zone = document.querySelector(`[data-zone="${zoneName}"]`);
  if (!config || !zone) {
    return;
  }

  zone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = config.multiple;
    input.accept = config.accept;
    input.addEventListener("change", (event) => {
      const files = normalizeSelectedFiles([...(event.target.files || [])], zoneName);
      onFiles(files);
    });
    input.click();
  });

  ["dragenter", "dragover"].forEach((evt) => {
    zone.addEventListener(evt, (event) => {
      event.preventDefault();
      zone.classList.add("active");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    zone.addEventListener(evt, (event) => {
      event.preventDefault();
      zone.classList.remove("active");
    });
  });

  zone.addEventListener("drop", (event) => {
    const files = normalizeSelectedFiles([...(event.dataTransfer?.files || [])], zoneName);
    onFiles(files);
  });
}

function submitWithProgress(url, formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "blob";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setStatus(`Uploading... ${percent}%`, percent);
      } else {
        setStatus("Uploading...", 35);
      }
    };

    xhr.onerror = () => reject(new Error("Network request failed."));

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const filename = parseFilenameFromHeader(xhr.getResponseHeader("Content-Disposition")) || "result.bin";
        resolve({ blob: xhr.response, filename });
        return;
      }

      let message = `Request failed (${xhr.status})`;
      try {
        const text = await xhr.response.text();
        const parsed = JSON.parse(text);
        if (parsed.error) {
          message = parsed.error;
        }
      } catch (err) {
        // Keep default message.
      }
      reject(new Error(message));
    };

    xhr.send(formData);
  });
}

async function runOperation(url, formData) {
  const operationLabel = formData.get("__operationLabel") || "Running task";
  formData.delete("__operationLabel");
  clearDownload();
  setBusy(true);
  setOperation(operationLabel);
  setStatus("Starting...", 4);
  showToast(`${operationLabel} started.`, "info");

  try {
    const result = await submitWithProgress(url, formData);
    showDownload(result.blob, result.filename);
    setOperation(`${operationLabel} completed`);
    setStatus(`Done. ${result.filename} is ready to download.`, 100);
    showToast(`${operationLabel} completed.`, "success");
    statusPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(`Error: ${err.message}`, 0);
    setOperation(`${operationLabel} failed`);
    showToast(err.message, "error");
  } finally {
    setBusy(false);
  }
}

function bindToolSearch() {
  const cards = [...document.querySelectorAll(".tool-card")];
  toolSearchInput.addEventListener("input", () => {
    const query = toolSearchInput.value.trim().toLowerCase();
    cards.forEach((card) => {
      const haystack = (card.dataset.toolName || "").toLowerCase();
      const visible = !query || haystack.includes(query);
      card.classList.toggle("filtered-out", !visible);
    });
  });
}

function bindToolJumpNav() {
  const buttons = [...document.querySelectorAll(".tool-jump")];
  const cards = [...document.querySelectorAll(".tool-card")];

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.target);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        buttons.forEach((button) => {
          button.classList.toggle("active", button.dataset.target === entry.target.id);
        });
      });
    },
    { root: null, rootMargin: "-38% 0px -52% 0px", threshold: 0.1 }
  );

  cards.forEach((card) => observer.observe(card));
}

function bindFloatingTop() {
  window.addEventListener("scroll", () => {
    floatingTop.classList.toggle("hidden", window.scrollY < 320);
  });
  floatingTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function bindShortcutSubmit() {
  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        const submitButton = form.querySelector("button[type='submit']");
        if (submitButton && !submitButton.disabled) {
          submitButton.click();
        }
      }
    });
  });
}

initializeDropZone("merge", (files) => {
  if (!files.length) {
    return;
  }
  const { files: merged, skipped } = mergeUniqueFiles(state.mergeFiles, files);
  state.mergeFiles = merged;
  renderMergeList();
  clearDownload();
  setStatus("Merge list updated.", 0);
  setOperation("No active task");
  if (skipped > 0) {
    showToast(`${skipped} duplicate file${skipped > 1 ? "s" : ""} skipped.`, "info");
  }
});

initializeDropZone("split", (files) => {
  state.splitFile = files[0] || null;
  renderSinglePreview("split-preview", state.splitFile);
  clearDownload();
  setStatus("Split source updated.", 0);
  setOperation("No active task");
});

initializeDropZone("extract", (files) => {
  state.extractFile = files[0] || null;
  renderSinglePreview("extract-preview", state.extractFile);
  clearDownload();
  setStatus("Extract source updated.", 0);
  setOperation("No active task");
});

initializeDropZone("rotate", (files) => {
  state.rotateFile = files[0] || null;
  renderSinglePreview("rotate-preview", state.rotateFile);
  clearDownload();
  setStatus("Rotate source updated.", 0);
  setOperation("No active task");
});

initializeDropZone("imageToPdf", (files) => {
  if (!files.length) {
    return;
  }
  const { files: merged, skipped } = mergeUniqueFiles(state.imageToPdfFiles, files);
  state.imageToPdfFiles = merged;
  renderImageGrid("image-to-pdf-preview", state.imageToPdfFiles, "imageToPdfFiles", "image-to-pdf-stats");
  clearDownload();
  setStatus("Images added for PDF conversion.", 0);
  setOperation("No active task");
  if (skipped > 0) {
    showToast(`${skipped} duplicate image${skipped > 1 ? "s" : ""} skipped.`, "info");
  }
});

initializeDropZone("pdfToImages", (files) => {
  state.pdfToImagesFile = files[0] || null;
  renderSinglePreview("pdf-to-images-preview", state.pdfToImagesFile);
  clearDownload();
  setStatus("PDF source updated.", 0);
  setOperation("No active task");
});

initializeDropZone("imageConvert", (files) => {
  if (!files.length) {
    return;
  }
  const { files: merged, skipped } = mergeUniqueFiles(state.imageConvertFiles, files);
  state.imageConvertFiles = merged;
  renderImageGrid("image-convert-preview", state.imageConvertFiles, "imageConvertFiles", "image-convert-stats");
  clearDownload();
  setStatus("Images added for format conversion.", 0);
  setOperation("No active task");
  if (skipped > 0) {
    showToast(`${skipped} duplicate image${skipped > 1 ? "s" : ""} skipped.`, "info");
  }
});

document.getElementById("merge-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.mergeFiles.length < 2) {
    setStatus("Select at least two PDFs for merge.", 0);
    showToast("At least two PDF files are required.", "error");
    return;
  }
  const formData = new FormData();
  formData.append("__operationLabel", "Merge PDFs");
  state.mergeFiles.forEach((file) => formData.append("files", file));
  await runOperation("/api/pdf/merge", formData);
});

document.getElementById("split-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.splitFile) {
    setStatus("Select one PDF for split.", 0);
    showToast("A source PDF is required.", "error");
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Split PDF");
  formData.append("file", state.splitFile);
  await runOperation("/api/pdf/split", formData);
});

document.getElementById("extract-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.extractFile) {
    setStatus("Select one PDF for extraction.", 0);
    showToast("A source PDF is required.", "error");
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Extract Pages");
  formData.append("file", state.extractFile);
  await runOperation("/api/pdf/extract", formData);
});

document.getElementById("rotate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.rotateFile) {
    setStatus("Select one PDF for rotation.", 0);
    showToast("A source PDF is required.", "error");
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Rotate Pages");
  formData.append("file", state.rotateFile);
  await runOperation("/api/pdf/rotate", formData);
});

document.getElementById("image-to-pdf-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.imageToPdfFiles.length) {
    setStatus("Select one or more images.", 0);
    showToast("Add at least one image first.", "error");
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Images to PDF");
  state.imageToPdfFiles.forEach((file) => formData.append("files", file));
  await runOperation("/api/image/to-pdf", formData);
});

document.getElementById("pdf-to-images-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.pdfToImagesFile) {
    setStatus("Select one PDF for image conversion.", 0);
    showToast("A source PDF is required.", "error");
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "PDF to Images");
  if (!formData.get("pages")) {
    formData.delete("pages");
  }
  formData.append("file", state.pdfToImagesFile);
  await runOperation("/api/pdf/to-images", formData);
});

document.getElementById("image-convert-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.imageConvertFiles.length) {
    setStatus("Select one or more images for conversion.", 0);
    showToast("Add at least one image first.", "error");
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Image Format Conversion");
  state.imageConvertFiles.forEach((file) => formData.append("files", file));
  await runOperation("/api/image/convert", formData);
});

document.getElementById("merge-clear").addEventListener("click", () => {
  state.mergeFiles = [];
  renderMergeList();
  clearDownload();
  setStatus("Merge list cleared.", 0);
  setOperation("No active task");
});

document.getElementById("image-to-pdf-clear").addEventListener("click", () => {
  state.imageToPdfFiles = [];
  renderImageGrid("image-to-pdf-preview", state.imageToPdfFiles, "imageToPdfFiles", "image-to-pdf-stats");
  clearDownload();
  setStatus("Image selection cleared.", 0);
  setOperation("No active task");
});

document.getElementById("image-convert-clear").addEventListener("click", () => {
  state.imageConvertFiles = [];
  renderImageGrid("image-convert-preview", state.imageConvertFiles, "imageConvertFiles", "image-convert-stats");
  clearDownload();
  setStatus("Image selection cleared.", 0);
  setOperation("No active task");
});

clearResultBtn.addEventListener("click", () => {
  clearDownload();
  setStatus("Result cleared.", 0);
  setOperation("No active task");
});

clearHistoryBtn.addEventListener("click", () => {
  clearHistory();
  showToast("History cleared.", "info");
});

bindToolSearch();
bindToolJumpNav();
bindFloatingTop();
bindShortcutSubmit();
renderMergeList();
renderImageGrid("image-to-pdf-preview", state.imageToPdfFiles, "imageToPdfFiles", "image-to-pdf-stats");
renderImageGrid("image-convert-preview", state.imageConvertFiles, "imageConvertFiles", "image-convert-stats");
renderHistory();
updateSummaryStats();
