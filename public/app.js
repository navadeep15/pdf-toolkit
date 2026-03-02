const state = {
  mergeFiles: [],
  splitFile: null,
  extractFile: null,
  rotateFile: null,
  compressFile: null,
  protectFile: null,
  unlockFile: null,
  imageToPdfFiles: [],
  pdfToImagesFile: null,
  imageConvertFiles: []
};

const statusText = document.getElementById("status-text");
const progressBar = document.getElementById("progress-bar");
const downloadLink = document.getElementById("download-link");
const floatingDownload = document.getElementById("floating-download");
const statusOperation = document.getElementById("status-operation");
const clearResultBtn = document.getElementById("clear-result-btn");
const statusPanel = document.getElementById("status-panel");
let activeDownloadUrl = "";

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
}

function parseFilenameFromHeader(disposition) {
  if (!disposition) {
    return null;
  }
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match ? match[1] : null;
}

function fileBadge(file) {
  const text = document.createElement("span");
  text.className = "file-name";
  text.textContent = `${file.name} (${Math.ceil(file.size / 1024)} KB)`;
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
  img.src = URL.createObjectURL(file);
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
  embed.src = URL.createObjectURL(file);
  wrap.appendChild(embed);
  return wrap;
}

function renderSinglePreview(containerId, file) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!file) {
    return;
  }
  if (file.type.startsWith("image/")) {
    container.appendChild(imagePreview(file));
  } else {
    container.appendChild(pdfPreview(file));
  }
}

function renderImageGrid(containerId, files) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  files.forEach((file, index) => {
    const remove = () => {
      if (containerId === "image-to-pdf-preview") {
        state.imageToPdfFiles.splice(index, 1);
        renderImageGrid(containerId, state.imageToPdfFiles);
      } else if (containerId === "image-convert-preview") {
        state.imageConvertFiles.splice(index, 1);
        renderImageGrid(containerId, state.imageConvertFiles);
      }
      clearDownload();
      setStatus("Selection updated.", 0);
      setOperation("No active task");
    };
    container.appendChild(imagePreview(file, remove));
  });
}

function initializeDropZone(zoneName, onFiles) {
  const zone = document.querySelector(`[data-zone="${zoneName}"]`);
  zone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = zoneName === "merge" || zoneName === "imageToPdf" || zoneName === "imageConvert";
    input.accept = zoneName.includes("image") ? "image/jpeg,image/png,image/webp,application/pdf" : "application/pdf,image/jpeg,image/png,image/webp";
    input.addEventListener("change", (event) => {
      const files = [...(event.target.files || [])];
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
    const files = [...(event.dataTransfer?.files || [])];
    onFiles(files);
  });
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
        setStatus("Processing completed.", 100);
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
        // Fall through to default message.
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
  try {
    const result = await submitWithProgress(url, formData);
    showDownload(result.blob, result.filename);
    setStatus(`Done. ${result.filename} is ready to download.`, 100);
    statusPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(`Error: ${err.message}`, 0);
    setOperation(`${operationLabel} failed`);
  } finally {
    setBusy(false);
  }
}

initializeDropZone("merge", (files) => {
  const newPdfFiles = files.filter((file) => file.type === "application/pdf");
  state.mergeFiles = [...state.mergeFiles, ...newPdfFiles];
  renderMergeList();
  clearDownload();
});

initializeDropZone("split", (files) => {
  state.splitFile = files.find((f) => f.type === "application/pdf") || null;
  renderSinglePreview("split-preview", state.splitFile);
  clearDownload();
});

initializeDropZone("extract", (files) => {
  state.extractFile = files.find((f) => f.type === "application/pdf") || null;
  renderSinglePreview("extract-preview", state.extractFile);
  clearDownload();
});

initializeDropZone("rotate", (files) => {
  state.rotateFile = files.find((f) => f.type === "application/pdf") || null;
  renderSinglePreview("rotate-preview", state.rotateFile);
  clearDownload();
});

initializeDropZone("compress", (files) => {
  state.compressFile = files.find((f) => f.type === "application/pdf") || null;
  renderSinglePreview("compress-preview", state.compressFile);
  clearDownload();
});

initializeDropZone("protect", (files) => {
  state.protectFile = files.find((f) => f.type === "application/pdf") || null;
  renderSinglePreview("protect-preview", state.protectFile);
  clearDownload();
});

initializeDropZone("unlock", (files) => {
  state.unlockFile = files.find((f) => f.type === "application/pdf") || null;
  renderSinglePreview("unlock-preview", state.unlockFile);
  clearDownload();
});

initializeDropZone("imageToPdf", (files) => {
  const newImageFiles = files.filter((f) => f.type.startsWith("image/"));
  state.imageToPdfFiles = [...state.imageToPdfFiles, ...newImageFiles];
  renderImageGrid("image-to-pdf-preview", state.imageToPdfFiles);
  clearDownload();
});

initializeDropZone("pdfToImages", (files) => {
  state.pdfToImagesFile = files.find((f) => f.type === "application/pdf") || null;
  renderSinglePreview("pdf-to-images-preview", state.pdfToImagesFile);
  clearDownload();
});

initializeDropZone("imageConvert", (files) => {
  const newImageFiles = files.filter((f) => f.type.startsWith("image/"));
  state.imageConvertFiles = [...state.imageConvertFiles, ...newImageFiles];
  renderImageGrid("image-convert-preview", state.imageConvertFiles);
  clearDownload();
});

document.getElementById("merge-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.mergeFiles.length < 2) {
    setStatus("Select at least two PDFs for merge.", 0);
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
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Rotate Pages");
  formData.append("file", state.rotateFile);
  await runOperation("/api/pdf/rotate", formData);
});

document.getElementById("compress-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.compressFile) {
    setStatus("Select one PDF for compression.", 0);
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Compress PDF");
  formData.append("file", state.compressFile);
  await runOperation("/api/pdf/compress", formData);
});

document.getElementById("protect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.protectFile) {
    setStatus("Select one PDF to protect.", 0);
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Protect PDF");
  formData.append("file", state.protectFile);
  await runOperation("/api/pdf/protect", formData);
});

document.getElementById("unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.unlockFile) {
    setStatus("Select one PDF to unlock.", 0);
    return;
  }
  const formData = new FormData(event.currentTarget);
  formData.append("__operationLabel", "Unlock PDF");
  formData.append("file", state.unlockFile);
  await runOperation("/api/pdf/unlock", formData);
});

document.getElementById("image-to-pdf-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.imageToPdfFiles.length) {
    setStatus("Select one or more images.", 0);
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
  renderImageGrid("image-to-pdf-preview", state.imageToPdfFiles);
  clearDownload();
  setStatus("Image selection cleared.", 0);
  setOperation("No active task");
});

document.getElementById("image-convert-clear").addEventListener("click", () => {
  state.imageConvertFiles = [];
  renderImageGrid("image-convert-preview", state.imageConvertFiles);
  clearDownload();
  setStatus("Image selection cleared.", 0);
  setOperation("No active task");
});

clearResultBtn.addEventListener("click", () => {
  clearDownload();
  setStatus("Result cleared.", 0);
  setOperation("No active task");
});
