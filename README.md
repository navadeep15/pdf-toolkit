# PDF Toolkit Web Application

Quality-focused PDF and image processing web app inspired by iLovePDF workflows.

## Features

- PDF: merge, split by ranges, extract pages, rotate pages
- PDF optional: compress, password protect, unlock (requires `qpdf` in `PATH`)
- Images: JPG/PNG/WEBP -> merged PDF or per-image PDF (ZIP)
- PDF -> images (PNG/JPG) with DPI control and page selection
- Image format conversion: JPG/PNG/WEBP batch conversion with quality controls
- Drag-and-drop uploads, reorder list for PDF merge, preview, progress bar, direct download

## Quality and Integrity Defaults

- No implicit compression; compression runs only on explicit user action
- PDF merge/split/extract/rotate preserve vector content (no rasterization)
- Images are embedded using original dimensions and DPI metadata (when present)
- No database storage; temp files are removed after download

## Stack

- Backend: `Node.js`, `Express`, `multer`, `pdf-lib`, `sharp`, `pdfjs-dist`, `@napi-rs/canvas`
- Frontend: Vanilla HTML/CSS/JS

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Optional Dependency (`qpdf`)

The following endpoints require `qpdf`:

- `POST /api/pdf/compress`
- `POST /api/pdf/protect`
- `POST /api/pdf/unlock`

If `qpdf` is not installed, these endpoints return `501` with a clear message.

## Limits

- Max file size per upload: `110MB`
- Max files per request: `40`

Adjust in [`server.js`](/c:/Users/navad/OneDrive/Desktop/vs%20code/Pdf-merger/server.js).
