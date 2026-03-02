const express = require("express");
const multer = require("multer");
const path = require("path");
const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");
const archiver = require("archiver");
const sharp = require("sharp");
const { PDFDocument, degrees } = require("pdf-lib");
const { v4: uuidv4 } = require("uuid");
const { spawnSync } = require("child_process");
const { createCanvas, DOMMatrix, ImageData, Path2D } = require("@napi-rs/canvas");

const app = express();
const PORT = process.env.PORT || 3000;

const TEMP_ROOT = path.join(os.tmpdir(), "pdf-toolkit-web");
const UPLOAD_DIR = path.join(TEMP_ROOT, "uploads");
const OUTPUT_DIR = path.join(TEMP_ROOT, "outputs");

const MAX_FILE_SIZE = 110 * 1024 * 1024;
const MAX_FILES = 40;
let fileTypeModulePromise;

if (!globalThis.DOMMatrix) {
  globalThis.DOMMatrix = DOMMatrix;
}
if (!globalThis.ImageData) {
  globalThis.ImageData = ImageData;
}
if (!globalThis.Path2D) {
  globalThis.Path2D = Path2D;
}

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});

async function ensureRuntimeDirs() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
}

const runtimeReady = ensureRuntimeDirs();

app.use(async (req, res, next) => {
  try {
    await runtimeReady;
    next();
  } catch (err) {
    next(err);
  }
});

function parsePageSelection(selection, totalPages) {
  if (!selection || typeof selection !== "string") {
    throw new Error("Page selection is required.");
  }

  const tokens = selection
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) {
    throw new Error("No pages were selected.");
  }

  const result = new Set();

  for (const token of tokens) {
    if (token.includes("-")) {
      const [startRaw, endRaw] = token.split("-").map((v) => v.trim());
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > end) {
        throw new Error(`Invalid page range: ${token}`);
      }
      if (end > totalPages) {
        throw new Error(`Range ${token} exceeds page count (${totalPages}).`);
      }
      for (let page = start; page <= end; page += 1) {
        result.add(page - 1);
      }
      continue;
    }

    const page = Number.parseInt(token, 10);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      throw new Error(`Invalid page number: ${token}`);
    }
    result.add(page - 1);
  }

  return [...result].sort((a, b) => a - b);
}

function parseSplitRanges(ranges, totalPages) {
  if (!ranges || typeof ranges !== "string") {
    throw new Error("Split ranges are required (example: 1-3,4-6).");
  }

  const tokens = ranges
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) {
    throw new Error("At least one split range is required.");
  }

  const parsed = [];
  for (const token of tokens) {
    if (!token.includes("-")) {
      const p = Number.parseInt(token, 10);
      if (!Number.isInteger(p) || p < 1 || p > totalPages) {
        throw new Error(`Invalid split entry: ${token}`);
      }
      parsed.push({ start: p, end: p });
      continue;
    }

    const [startRaw, endRaw] = token.split("-").map((v) => v.trim());
    const start = Number.parseInt(startRaw, 10);
    const end = Number.parseInt(endRaw, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > end) {
      throw new Error(`Invalid split range: ${token}`);
    }
    if (end > totalPages) {
      throw new Error(`Split range ${token} exceeds page count (${totalPages}).`);
    }
    parsed.push({ start, end });
  }

  return parsed;
}

async function cleanupFiles(filePaths) {
  await Promise.all(
    filePaths
      .filter(Boolean)
      .map(async (filePath) => {
        try {
          await fsp.unlink(filePath);
        } catch (err) {
          if (err.code !== "ENOENT") {
            // Cleanup failure should not fail the request flow.
            // eslint-disable-next-line no-console
            console.error(`Cleanup error for ${filePath}:`, err.message);
          }
        }
      })
  );
}

async function detectMime(filePath) {
  if (!fileTypeModulePromise) {
    fileTypeModulePromise = import("file-type");
  }
  const fileType = await fileTypeModulePromise;
  const detected = await fileType.fileTypeFromFile(filePath);
  if (detected?.mime) {
    return detected.mime;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    return "application/pdf";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  return "";
}

async function assertPdf(filePath) {
  const mime = await detectMime(filePath);
  if (mime !== "application/pdf") {
    throw new Error("Only valid PDF files are allowed for this operation.");
  }
}

async function assertImage(filePath) {
  const mime = await detectMime(filePath);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    throw new Error("Only JPG, PNG, and WEBP image files are supported.");
  }
}

async function writeOutput(bytes, extension) {
  const outputPath = path.join(OUTPUT_DIR, `${Date.now()}-${uuidv4()}.${extension}`);
  await fsp.writeFile(outputPath, bytes);
  return outputPath;
}

function sendDownload(res, filePath, downloadName, filesToCleanup = []) {
  res.download(filePath, downloadName, async () => {
    await cleanupFiles([filePath, ...filesToCleanup]);
  });
}

async function zipBuffers(entries, outputPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    entries.forEach((entry) => {
      archive.append(entry.data, { name: entry.name });
    });
    archive.finalize();
  });
}

function qpdfAvailable() {
  const probe = spawnSync("qpdf", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function runQpdf(args) {
  const result = spawnSync("qpdf", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "qpdf processing failed.");
  }
}

async function imageToSinglePagePdf(imagePath) {
  await assertImage(imagePath);
  const inputBuffer = await fsp.readFile(imagePath);
  const meta = await sharp(inputBuffer, { limitInputPixels: false }).metadata();

  if (!meta.width || !meta.height) {
    throw new Error("Invalid image dimensions.");
  }

  const density = meta.density && meta.density > 0 ? meta.density : 72;
  const pageWidth = (meta.width * 72) / density;
  const pageHeight = (meta.height * 72) / density;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  let imageBuffer = inputBuffer;
  let format = meta.format;

  if (format === "jpeg" || format === "jpg") {
    const embedded = await pdfDoc.embedJpg(imageBuffer);
    page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  } else if (format === "png") {
    const embedded = await pdfDoc.embedPng(imageBuffer);
    page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  } else {
    imageBuffer = await sharp(inputBuffer, { limitInputPixels: false }).png({ compressionLevel: 0 }).toBuffer();
    format = "png";
    const embedded = await pdfDoc.embedPng(imageBuffer);
    page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }

  return pdfDoc.save({ useObjectStreams: false, addDefaultPage: false });
}

async function loadPdfJs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

function makeImageName(original, pageNumber, format) {
  const base = path.basename(original, path.extname(original));
  const ext = format === "jpeg" ? "jpg" : format;
  return `${base}-page-${pageNumber}.${ext}`;
}

function toJpegQuality(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) {
    return 90;
  }
  return Math.min(100, Math.max(1, value));
}

app.post("/api/pdf/merge", upload.array("files", 30), async (req, res) => {
  const files = req.files || [];
  try {
    if (files.length < 2) {
      throw new Error("Please upload at least two PDF files to merge.");
    }

    for (const file of files) {
      await assertPdf(file.path);
    }

    const merged = await PDFDocument.create();

    for (const file of files) {
      const data = await fsp.readFile(file.path);
      const source = await PDFDocument.load(data, {
        updateMetadata: false
      });
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }

    const outBytes = await merged.save({ useObjectStreams: false, addDefaultPage: false });
    const outputPath = await writeOutput(outBytes, "pdf");
    sendDownload(res, outputPath, "merged.pdf", files.map((f) => f.path));
  } catch (err) {
    await cleanupFiles(files.map((f) => f.path));
    res.status(400).json({ error: err.message || "Failed to merge PDFs." });
  }
});

app.post("/api/pdf/split", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      throw new Error("Please upload one PDF file.");
    }
    await assertPdf(filePath);

    const data = await fsp.readFile(filePath);
    const source = await PDFDocument.load(data, { updateMetadata: false });
    const total = source.getPageCount();
    const ranges = parseSplitRanges(req.body.ranges, total);

    if (ranges.length === 1) {
      const { start, end } = ranges[0];
      const out = await PDFDocument.create();
      const indices = [];
      for (let p = start - 1; p <= end - 1; p += 1) {
        indices.push(p);
      }
      const pages = await out.copyPages(source, indices);
      pages.forEach((page) => out.addPage(page));
      const outBytes = await out.save({ useObjectStreams: false, addDefaultPage: false });
      const outPath = await writeOutput(outBytes, "pdf");
      sendDownload(res, outPath, `split-${start}-${end}.pdf`, [filePath]);
      return;
    }

    const entries = [];
    for (const range of ranges) {
      const out = await PDFDocument.create();
      const indices = [];
      for (let p = range.start - 1; p <= range.end - 1; p += 1) {
        indices.push(p);
      }
      const pages = await out.copyPages(source, indices);
      pages.forEach((page) => out.addPage(page));
      const outBytes = await out.save({ useObjectStreams: false, addDefaultPage: false });
      entries.push({
        name: `split-${range.start}-${range.end}.pdf`,
        data: Buffer.from(outBytes)
      });
    }

    const zipPath = await writeOutput(Buffer.from([]), "zip");
    await zipBuffers(entries, zipPath);
    sendDownload(res, zipPath, "split-parts.zip", [filePath]);
  } catch (err) {
    await cleanupFiles([filePath]);
    res.status(400).json({ error: err.message || "Failed to split PDF." });
  }
});

app.post("/api/pdf/extract", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      throw new Error("Please upload one PDF file.");
    }
    await assertPdf(filePath);

    const data = await fsp.readFile(filePath);
    const source = await PDFDocument.load(data, { updateMetadata: false });
    const selected = parsePageSelection(req.body.pages, source.getPageCount());

    const out = await PDFDocument.create();
    const pages = await out.copyPages(source, selected);
    pages.forEach((page) => out.addPage(page));

    const outBytes = await out.save({ useObjectStreams: false, addDefaultPage: false });
    const outPath = await writeOutput(outBytes, "pdf");
    sendDownload(res, outPath, "extracted-pages.pdf", [filePath]);
  } catch (err) {
    await cleanupFiles([filePath]);
    res.status(400).json({ error: err.message || "Failed to extract pages." });
  }
});

app.post("/api/pdf/rotate", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      throw new Error("Please upload one PDF file.");
    }
    await assertPdf(filePath);

    const angle = Number.parseInt(req.body.angle, 10);
    if (![90, 180, 270].includes(angle)) {
      throw new Error("Rotation angle must be 90, 180, or 270.");
    }

    const data = await fsp.readFile(filePath);
    const pdfDoc = await PDFDocument.load(data, { updateMetadata: false });
    const pages = parsePageSelection(req.body.pages, pdfDoc.getPageCount());
    pages.forEach((index) => {
      pdfDoc.getPage(index).setRotation(degrees(angle));
    });

    const outBytes = await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false });
    const outPath = await writeOutput(outBytes, "pdf");
    sendDownload(res, outPath, "rotated.pdf", [filePath]);
  } catch (err) {
    await cleanupFiles([filePath]);
    res.status(400).json({ error: err.message || "Failed to rotate pages." });
  }
});

app.post("/api/pdf/compress", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      throw new Error("Please upload one PDF file.");
    }
    await assertPdf(filePath);
    if (!qpdfAvailable()) {
      res.status(501).json({
        error: "Compression requires qpdf installed and available in PATH."
      });
      return;
    }

    const level = (req.body.level || "medium").toLowerCase();
    const outPath = path.join(OUTPUT_DIR, `${Date.now()}-${uuidv4()}.pdf`);

    const args = [];
    if (level === "low") {
      args.push("--stream-data=compress");
    } else if (level === "high") {
      args.push("--stream-data=compress", "--object-streams=generate", "--recompress-flate", "--compression-level=9");
    } else {
      args.push("--stream-data=compress", "--object-streams=generate");
    }
    args.push(filePath, outPath);

    runQpdf(args);
    sendDownload(res, outPath, "compressed.pdf", [filePath]);
  } catch (err) {
    await cleanupFiles([filePath]);
    res.status(400).json({ error: err.message || "Failed to compress PDF." });
  }
});

app.post("/api/pdf/protect", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      throw new Error("Please upload one PDF file.");
    }
    await assertPdf(filePath);
    if (!qpdfAvailable()) {
      res.status(501).json({
        error: "Password protect requires qpdf installed and available in PATH."
      });
      return;
    }

    const password = String(req.body.password || "");
    if (!password) {
      throw new Error("Password is required.");
    }
    const outPath = path.join(OUTPUT_DIR, `${Date.now()}-${uuidv4()}.pdf`);
    runQpdf(["--encrypt", password, password, "256", "--", filePath, outPath]);
    sendDownload(res, outPath, "protected.pdf", [filePath]);
  } catch (err) {
    await cleanupFiles([filePath]);
    res.status(400).json({ error: err.message || "Failed to protect PDF." });
  }
});

app.post("/api/pdf/unlock", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      throw new Error("Please upload one PDF file.");
    }
    await assertPdf(filePath);
    if (!qpdfAvailable()) {
      res.status(501).json({
        error: "Unlock requires qpdf installed and available in PATH."
      });
      return;
    }

    const password = String(req.body.password || "");
    if (!password) {
      throw new Error("Password is required.");
    }
    const outPath = path.join(OUTPUT_DIR, `${Date.now()}-${uuidv4()}.pdf`);
    runQpdf(["--password=" + password, "--decrypt", filePath, outPath]);
    sendDownload(res, outPath, "unlocked.pdf", [filePath]);
  } catch (err) {
    await cleanupFiles([filePath]);
    res.status(400).json({ error: err.message || "Failed to unlock PDF." });
  }
});

app.post("/api/image/to-pdf", upload.array("files", 30), async (req, res) => {
  const files = req.files || [];
  try {
    if (!files.length) {
      throw new Error("Please upload at least one image.");
    }
    for (const file of files) {
      await assertImage(file.path);
    }

    const merge = String(req.body.merge || "true").toLowerCase() !== "false";

    if (merge) {
      const out = await PDFDocument.create();
      for (const file of files) {
        const singlePagePdfBytes = await imageToSinglePagePdf(file.path);
        const tmpPdf = await PDFDocument.load(singlePagePdfBytes, { updateMetadata: false });
        const copied = await out.copyPages(tmpPdf, [0]);
        out.addPage(copied[0]);
      }
      const outBytes = await out.save({ useObjectStreams: false, addDefaultPage: false });
      const outPath = await writeOutput(outBytes, "pdf");
      sendDownload(res, outPath, "images-merged.pdf", files.map((f) => f.path));
      return;
    }

    const entries = [];
    for (const file of files) {
      const singlePagePdfBytes = await imageToSinglePagePdf(file.path);
      entries.push({
        name: `${path.basename(file.originalname, path.extname(file.originalname))}.pdf`,
        data: Buffer.from(singlePagePdfBytes)
      });
    }
    const zipPath = await writeOutput(Buffer.from([]), "zip");
    await zipBuffers(entries, zipPath);
    sendDownload(res, zipPath, "images-to-pdf.zip", files.map((f) => f.path));
  } catch (err) {
    await cleanupFiles(files.map((f) => f.path));
    res.status(400).json({ error: err.message || "Failed to convert images to PDF." });
  }
});

app.post("/api/image/convert", upload.array("files", 30), async (req, res) => {
  const files = req.files || [];
  try {
    if (!files.length) {
      throw new Error("Please upload at least one image.");
    }
    for (const file of files) {
      await assertImage(file.path);
    }

    const format = String(req.body.format || "png").toLowerCase();
    if (!["jpeg", "jpg", "png", "webp"].includes(format)) {
      throw new Error("Output format must be JPG, PNG, or WEBP.");
    }
    const normalizedFormat = format === "jpg" ? "jpeg" : format;
    const quality = toJpegQuality(req.body.quality);

    const entries = [];
    for (const file of files) {
      const pipeline = sharp(file.path, { limitInputPixels: false }).rotate();
      if (normalizedFormat === "png") {
        pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      } else if (normalizedFormat === "webp") {
        pipeline.webp({ quality, effort: 6 });
      } else {
        pipeline.jpeg({ quality, mozjpeg: true });
      }
      const output = await pipeline.withMetadata().toBuffer();
      const ext = normalizedFormat === "jpeg" ? "jpg" : normalizedFormat;
      entries.push({
        name: `${path.basename(file.originalname, path.extname(file.originalname))}.${ext}`,
        data: output
      });
    }

    if (entries.length === 1) {
      const ext = normalizedFormat === "jpeg" ? "jpg" : normalizedFormat;
      const outPath = await writeOutput(entries[0].data, ext);
      sendDownload(res, outPath, entries[0].name, files.map((f) => f.path));
      return;
    }

    const zipPath = await writeOutput(Buffer.from([]), "zip");
    await zipBuffers(entries, zipPath);
    sendDownload(res, zipPath, "converted-images.zip", files.map((f) => f.path));
  } catch (err) {
    await cleanupFiles(files.map((f) => f.path));
    res.status(400).json({ error: err.message || "Failed image conversion." });
  }
});

app.post("/api/pdf/to-images", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      throw new Error("Please upload one PDF file.");
    }
    await assertPdf(filePath);

    const format = String(req.body.format || "png").toLowerCase();
    if (!["png", "jpg", "jpeg"].includes(format)) {
      throw new Error("Image format must be PNG or JPG.");
    }
    const normalizedFormat = format === "jpg" ? "jpeg" : format;
    const dpiRaw = Number.parseInt(req.body.dpi, 10);
    const dpi = Number.isInteger(dpiRaw) ? Math.max(36, Math.min(600, dpiRaw)) : 150;
    const quality = toJpegQuality(req.body.quality);

    const pdfjsLib = await loadPdfJs();
    const pdfData = new Uint8Array(await fsp.readFile(filePath));
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdfDoc = await loadingTask.promise;

    const selectedIndices = req.body.pages
      ? parsePageSelection(req.body.pages, pdfDoc.numPages)
      : Array.from({ length: pdfDoc.numPages }, (_, idx) => idx);

    const entries = [];
    for (const pageIndex of selectedIndices) {
      const pageNumber = pageIndex + 1;
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      await page.render({ canvasContext: context, viewport }).promise;
      const pngBuffer = canvas.toBuffer("image/png");
      let finalBuffer = pngBuffer;
      if (normalizedFormat === "jpeg") {
        finalBuffer = await sharp(pngBuffer).jpeg({ quality, mozjpeg: true }).toBuffer();
      }
      entries.push({
        name: makeImageName(req.file.originalname, pageNumber, normalizedFormat),
        data: finalBuffer
      });
    }

    if (entries.length === 1) {
      const ext = normalizedFormat === "jpeg" ? "jpg" : "png";
      const outPath = await writeOutput(entries[0].data, ext);
      sendDownload(res, outPath, entries[0].name, [filePath]);
      return;
    }

    const zipPath = await writeOutput(Buffer.from([]), "zip");
    await zipBuffers(entries, zipPath);
    sendDownload(res, zipPath, "pdf-pages-images.zip", [filePath]);
  } catch (err) {
    await cleanupFiles([filePath]);
    res.status(400).json({ error: err.message || "Failed to convert PDF to images." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const codeToMessage = {
      LIMIT_FILE_SIZE: `File exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit.`,
      LIMIT_FILE_COUNT: `Too many files uploaded (max ${MAX_FILES}).`
    };
    res.status(400).json({ error: codeToMessage[err.code] || err.message });
    return;
  }
  res.status(500).json({ error: err.message || "Unexpected server error." });
});

if (require.main === module) {
  runtimeReady
    .then(() => {
      app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`PDF Toolkit running at http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Failed to start server:", err);
      process.exit(1);
    });
}

module.exports = app;
