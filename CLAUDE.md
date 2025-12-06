# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FontOrigin Analyzer** is a web-based forensic tool that analyzes document fonts and layout patterns to infer their origin. It's a client-side only application (no server) that runs entirely in the browser using HTML, CSS, and JavaScript with external libraries loaded via CDN.

This tool is part of the "生成AIで作るセキュリティツール100" (100 Security Tools with Generative AI) project - Day 090.

## Architecture

### Core Technology Stack
- **Pure client-side**: HTML + vanilla JavaScript + CSS
- **No build process**: Direct browser execution
- **External libraries (CDN)**:
  - Tailwind CSS v3.4.16 (standalone build)
  - Tesseract.js v5.1.0 (OCR)
  - PDF.js v4.7.76 (PDF rendering)
  - JSZip v3.10.1 (DOCX parsing)

### File Structure
- `index.html` - Main UI with 4-tab layout (解析/比較/コーパス/ガイド)
- `script.js` - All application logic (theme, tabs, file analysis, comparison, corpus management)
- `style.css` - Theme system (light/dark) and component styles
- `assets/` - Icons and screenshots

### Key Features
1. **File Analysis** (解析 tab): Analyzes PDF/PNG/JPG/DOCX/TXT files to extract font and layout metrics
2. **Comparison** (比較 tab): Side-by-side comparison of two documents
3. **Corpus Management** (コーパス tab): Save and manage FontPrint fingerprints in localStorage
4. **Guide** (ガイド tab): Usage instructions and ethical guidelines

## Data Flow & Analysis Pipeline

### File Processing by Type
- **PDF/Images**: OCR with Tesseract → extract word bounding boxes → compute metrics
- **DOCX**: Parse XML (`word/document.xml`, `word/styles.xml`) → extract style info → render placeholder preview
- **TXT**: Virtual rendering on canvas → compute layout based on assumed font settings

### Feature Extraction (script.js:805-831 `buildFeatures`)
The `buildFeatures` function creates a FontPrint JSON with:
- `font_candidates`: Guessed fonts based on glyph aspect ratio
- `avg_font_size_px`: Median character height
- `line_gap_px`: Median line spacing
- `margin_mm`: Page margins (converted px→mm)
- `glyph_signatures`: Sample glyph bounding boxes
- `fingerprint_hash`: SHA-256 hash of normalized features
- `vector`: Numeric feature vector for similarity comparison

### Analysis Modes (script.js:703)
- **バランス** (balanced): Default OCR settings
- **高速** (fast): Tesseract page segmentation mode 3
- **高精度** (accurate): Tesseract page segmentation mode 6

## UI Design System

### Theme System (style.css:21-61)
- **CSS custom properties** for light/dark themes
- Automatic OS preference detection (`prefers-color-scheme`)
- Persistent storage in `localStorage('theme')`
- Toggle button shows NEXT mode icon (🌙 in light mode, ☀ in dark mode)

### Dark Theme Palette
- Background layers: `#0f1220` → `#171e2f`
- Accent colors: Cyan `#22d3ee`, Violet `#a78bfa`, Lime `#a3e635`
- "Not too dark cyberpunk" aesthetic

### Component Patterns
- **Cards**: `.card`, `.card--pattern` (with gradient overlay)
- **Tooltips**: Portal-style positioning (z-index:9999), flip on viewport edges
- **Segmented controls**: `.seg`, `.seg-btn`, `.seg-on`
- **Help buttons**: `.qmark` with `aria-describedby` linking to `.tooltip`

## Development Workflow

### Running the Application
```bash
# No build required - just open in browser
start index.html
# Or use a local server
python -m http.server 8000
# then navigate to http://localhost:8000
```

### Testing
- Test with various file formats: PDF, PNG, JPG, DOCX, TXT
- Verify OCR accuracy across different document layouts
- Check theme toggle persistence
- Validate FontPrint JSON export/import

### Modifying Analysis Logic
- OCR processing: `script.js:702-711`
- Metrics computation: `script.js:723-737`
- Font guessing heuristic: `script.js:300-309`
- Feature normalization: `script.js:805-831`

## Key Implementation Notes

### File Format Certainty Levels (script.js:836-845 `renderPills`)
- **PDF/IMG**: 高 (high) - Most accurate, fixed layout
- **DOCX**: 中 (medium) - XML-based but rendering may differ
- **TXT**: 低 (low) - Virtual render, condition-dependent

### localStorage Usage
- `theme`: Current theme (`'light'` or `'dark'`)
- `foa_corpus`: Array of saved FontPrint JSON objects

### Tooltip System (script.js:154-206)
- Portal rendering to document.body
- Smart positioning with viewport flip
- Hover and click triggers
- ESC key to dismiss

### Comparison Algorithm (script.js:1182-1187)
Cosine similarity between feature vectors:
```
similarity = dot(v1,v2) / (||v1|| * ||v2||)
```

## Privacy & Security Considerations

- **100% client-side processing** - no data sent to servers
- Files analyzed in browser memory only
- Corpus stored in localStorage (device-only)
- Demo page warning: do not upload sensitive documents

## Forensic Use Cases (from README)

1. **Document tampering detection**: Compare revisions to detect font/margin changes
2. **Origin identification**: Match against known organizational templates
3. **OSINT**: Verify authenticity of leaked/public documents
4. **Disinformation detection**: Identify AI-generated documents by layout anomalies
