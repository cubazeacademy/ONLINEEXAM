/**
 * Judge Guideline PDF Generation Engine
 * Replicates the reference design from SIBAQ 2026 Judge Guideline
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const archiver = require('archiver');

// Standard A4 dimensions in points
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

// Content margins
const MARGIN_LEFT = 78;
const MARGIN_RIGHT = 78;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 439.28 pt
const MARGIN_TOP = 748;
const MARGIN_BOTTOM = 70;

// Asset directories
const PRIMARY_ASSET_DIR = path.join(__dirname, 'public', 'assets', 'judge_templates');
const BACKUP_ASSET_DIR = path.join(__dirname, 'assets', 'judge_templates');

function getAssetPath(filename) {
  const p1 = path.join(PRIMARY_ASSET_DIR, filename);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(BACKUP_ASSET_DIR, filename);
  if (fs.existsSync(p2)) return p2;
  return p1;
}

/**
 * Splits text into lines that fit within a maximum width
 */
function wrapText(text, maxWidth, font, fontSize) {
  if (!text) return [];
  const words = String(text).replace(/\r\n/g, '\n').split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Draws the rounded pill header box (e.g. GENERAL RULES, CONCEPT NOTE, SCHEDULE)
 */
function drawHeaderPill(page, text, y, font) {
  const boxWidth = 206;
  const boxHeight = 34;
  const boxX = (PAGE_WIDTH - boxWidth) / 2;
  const boxY = y - boxHeight;
  const radius = 6;

  // Background and border
  // Outer rectangle
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    color: rgb(0.043, 0.043, 0.043), // near black #0B0B0B
    borderColor: rgb(0.12, 0.23, 0.37), // dark slate blue #1F3A5F
    borderWidth: 1.4
  });

  // Center text
  const fontSize = 13.5;
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const textX = (PAGE_WIDTH - textWidth) / 2;
  const textY = boxY + (boxHeight - fontSize) / 2 + 2;

  page.drawText(text, {
    x: textX,
    y: textY,
    size: fontSize,
    font: font,
    color: rgb(1, 1, 1)
  });

  return boxY - 18; // Next usable Y coordinate
}

/**
 * Default 7 General Rules
 */
const DEFAULT_RULES = [
  'All doubts related to the judgment of the contests should be clarified only by discussing with the concerned controllers.',
  'To ensure fair judgment, jury members are not allowed to discuss the results with each other. Accordingly, each evaluation is required separately.',
  'In order to prevent further disputes, jury members are strictly advised to refrain from post-contest commentaries.',
  'All contestants are evaluated out of 100 marks.',
  'Prior to judging any contest, jury members are expected to carefully read the Concept Note and make evaluation accordingly.',
  'Outfits are not to be considered for giving special marks.',
  'Jury members are advised to keep the confidentiality of the results, and never disclose or declare it at the venue.'
];

/**
 * Loads and embeds fonts and artwork into a PDFDocument
 */
async function loadAssets(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);

  // Fonts
  const cambriaPath = getAssetPath('fonts/Cambria-Bold.ttf');
  const tahomaPath = getAssetPath('fonts/Tahoma-Regular.ttf');
  const tahomaBoldPath = getAssetPath('fonts/Tahoma-Bold.ttf');
  const arialBoldPath = getAssetPath('fonts/Arial-Bold.ttf');

  let fontHeading = null;
  let fontBody = null;
  let fontBodyBold = null;

  try {
    if (fs.existsSync(cambriaPath)) {
      fontHeading = await pdfDoc.embedFont(fs.readFileSync(cambriaPath));
    }
    if (fs.existsSync(tahomaPath)) {
      fontBody = await pdfDoc.embedFont(fs.readFileSync(tahomaPath));
    }
    if (fs.existsSync(tahomaBoldPath)) {
      fontBodyBold = await pdfDoc.embedFont(fs.readFileSync(tahomaBoldPath));
    } else if (fs.existsSync(arialBoldPath)) {
      fontBodyBold = await pdfDoc.embedFont(fs.readFileSync(arialBoldPath));
    }
  } catch (err) {
    console.warn('Custom font load error, falling back:', err.message);
  }

  // Fallback to standard fonts if any failed
  if (!fontHeading) fontHeading = await pdfDoc.embedFont('Helvetica-Bold');
  if (!fontBody) fontBody = await pdfDoc.embedFont('Helvetica');
  if (!fontBodyBold) fontBodyBold = await pdfDoc.embedFont('Helvetica-Bold');

  // Artwork
  let cleanCoverImg = null;
  let borderImg = null;
  let backCoverImg = null;

  try {
    const cleanCoverPath = getAssetPath('clean_cover_artwork.jpg');
    const origCoverPath = getAssetPath('cover_artwork.jpg');
    const chosenCover = fs.existsSync(cleanCoverPath) ? cleanCoverPath : origCoverPath;

    if (fs.existsSync(chosenCover)) {
      cleanCoverImg = await pdfDoc.embedJpg(fs.readFileSync(chosenCover));
    }

    const borderPath = getAssetPath('diamond_border.png');
    if (fs.existsSync(borderPath)) {
      borderImg = await pdfDoc.embedPng(fs.readFileSync(borderPath));
    }

    const backCoverPath = getAssetPath('back_cover_artwork.jpg');
    if (fs.existsSync(backCoverPath)) {
      backCoverImg = await pdfDoc.embedJpg(fs.readFileSync(backCoverPath));
    }
  } catch (err) {
    console.warn('Artwork embedding error:', err.message);
  }

  return {
    fontHeading,
    fontBody,
    fontBodyBold,
    cleanCoverImg,
    borderImg,
    backCoverImg
  };
}

/**
 * Generates an individual Judge Guideline PDF booklet
 * @param {Object} dossier - Judge dossier created by scheduleMatcher.buildJudgeDossier
 * @param {Object} options - Custom template configuration or overrides
 * @returns {Promise<Buffer>} - Generated PDF Buffer
 */
async function generateJudgeGuidelinePdf(dossier, options = {}) {
  const judge = dossier.judge || {};
  const items = dossier.items || [];
  const rules = options.general_rules || DEFAULT_RULES;

  const pdfDoc = await PDFDocument.create();
  const assets = await loadAssets(pdfDoc);

  // Helper to add an inner page with diamond border
  function addInnerPage() {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    if (assets.borderImg) {
      page.drawImage(assets.borderImg, {
        x: 0,
        y: 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT
      });
    }
    return page;
  }

  // ==========================================
  // PAGE 1: COVER PAGE
  // ==========================================
  const coverPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  if (assets.cleanCoverImg) {
    coverPage.drawImage(assets.cleanCoverImg, {
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT
    });
  }

  // Dynamic Judge Name on Cover
  const judgeNo = String(judge.judge_no || '01').padStart(2, '0');
  const judgeName = (judge.judge_name || 'JUDGE').trim();
  const displayTitle = `${judgeNo} ${judgeName}`;

  // Font sizing auto-shrink to fit within 440 pt
  let nameFontSize = 21;
  const maxTitleWidth = 440;
  while (assets.fontHeading.widthOfTextAtSize(displayTitle, nameFontSize) > maxTitleWidth && nameFontSize > 12) {
    nameFontSize -= 1;
  }

  const titleWidth = assets.fontHeading.widthOfTextAtSize(displayTitle, nameFontSize);
  const titleX = (PAGE_WIDTH - titleWidth) / 2;
  const titleY = 345; // Exactly aligned with reference cover badge area

  coverPage.drawText(displayTitle, {
    x: titleX,
    y: titleY,
    size: nameFontSize,
    font: assets.fontHeading,
    color: rgb(0.05, 0.05, 0.05)
  });

  // ==========================================
  // PAGE 2: GENERAL RULES & START OF CONCEPT NOTES
  // ==========================================
  let currentPage = addInnerPage();
  let currentY = MARGIN_TOP;

  // Header: GENERAL RULES
  currentY = drawHeaderPill(currentPage, 'GENERAL RULES', currentY, assets.fontBodyBold);
  currentY -= 6;

  // Draw 7 rules
  const bulletSymbol = '❖';
  const bulletX = MARGIN_LEFT;
  const textX = MARGIN_LEFT + 22;
  const ruleTextWidth = CONTENT_WIDTH - 22;

  for (const rule of rules) {
    const wrappedLines = wrapText(rule, ruleTextWidth, assets.fontBody, 11);
    const ruleHeight = wrappedLines.length * 17.5 + 8;

    // Bullet icon
    currentPage.drawText(bulletSymbol, {
      x: bulletX,
      y: currentY - 11,
      size: 10,
      font: assets.fontBody,
      color: rgb(0.1, 0.1, 0.1)
    });

    // Rule lines
    let lineY = currentY - 11;
    for (const line of wrappedLines) {
      currentPage.drawText(line, {
        x: textX,
        y: lineY,
        size: 11,
        font: assets.fontBody,
        color: rgb(0.08, 0.08, 0.08)
      });
      lineY -= 17.5;
    }

    currentY -= ruleHeight;
  }

  currentY -= 14;

  // ==========================================
  // CONCEPT NOTE SECTION
  // ==========================================
  // If remaining space on Page 2 is >= 200pt, start CONCEPT NOTE here; otherwise new page
  if (currentY < 230) {
    currentPage = addInnerPage();
    currentY = MARGIN_TOP;
  }

  currentY = drawHeaderPill(currentPage, 'CONCEPT NOTE', currentY, assets.fontBodyBold);
  currentY -= 8;

  // Render Concept Note entries
  for (const item of items) {
    const cn = item.concept_note || item.conceptNote || {};
    const code = item.code || '';
    const progName = (cn.name || item.name || '').trim();
    const headingText = `${code}. ${progName}`;

    // Extract paragraphs cleanly from array or string
    let paragraphs = [];
    if (Array.isArray(cn.paragraphs) && cn.paragraphs.length > 0) {
      paragraphs = cn.paragraphs;
    } else if (cn.description) {
      paragraphs = String(cn.description).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    }

    // Extract extra lines (e.g. Portion:, Ḥifẓ portion:)
    let extraLines = [];
    if (Array.isArray(cn.extraLines) && cn.extraLines.length > 0) {
      extraLines = cn.extraLines;
    } else if (Array.isArray(cn.extra_lines) && cn.extra_lines.length > 0) {
      extraLines = cn.extra_lines;
    }
    if (cn.portion_text && !extraLines.some(l => l.includes(cn.portion_text))) {
      extraLines.push(cn.portion_text);
    }

    const meta = cn.meta || {};

    // Build detail lines
    const detailLines = [];
    const categoryVal = cn.category || meta.category || item.category || '';
    if (categoryVal) detailLines.push({ label: 'Category:', value: categoryVal });

    const timeVal = cn.time_allowed || meta.time || cn.time || item.time_allowed || '';
    if (timeVal) detailLines.push({ label: 'Time:', value: timeVal });

    const skillVal = cn.skill || meta.skill || '';
    if (skillVal) detailLines.push({ label: 'Skill:', value: skillVal });

    const candVal = cn.candidates || meta.candidates || '';
    if (candVal) detailLines.push({ label: 'No. of Candidates:', value: candVal });

    // Measure total entry height for keep-together pagination
    let estimatedHeight = 22; // Heading + spacing
    const wrappedParagraphs = [];
    for (const p of paragraphs) {
      const lines = wrapText(p, CONTENT_WIDTH, assets.fontBody, 10.5);
      wrappedParagraphs.push(lines);
      estimatedHeight += lines.length * 16 + 6;
    }

    const wrappedExtras = [];
    for (const ex of extraLines) {
      const lines = wrapText(ex, CONTENT_WIDTH, assets.fontBody, 10);
      wrappedExtras.push(lines);
      estimatedHeight += lines.length * 15 + 4;
    }

    estimatedHeight += detailLines.length * 14 + 18; // Details + bottom gap

    // Check if entry fits on current page
    if (currentY - estimatedHeight < MARGIN_BOTTOM) {
      currentPage = addInnerPage();
      currentY = MARGIN_TOP - 10;
    }

    // Draw Red Bold Serif Heading (e.g. BS4. WAʿẒ)
    currentPage.drawText(headingText, {
      x: MARGIN_LEFT,
      y: currentY - 11,
      size: 10.5,
      font: assets.fontHeading,
      color: rgb(0.753, 0, 0) // Exact #C00000 dark red from reference
    });
    currentY -= 20;

    // Draw Paragraphs
    for (const lines of wrappedParagraphs) {
      for (const line of lines) {
        currentPage.drawText(line, {
          x: MARGIN_LEFT,
          y: currentY - 10.5,
          size: 10.5,
          font: assets.fontBody,
          color: rgb(0.08, 0.08, 0.08)
        });
        currentY -= 16;
      }
      currentY -= 4;
    }

    // Draw Extra Lines (e.g. Portion:, Ḥifẓ portion:)
    for (const lines of wrappedExtras) {
      for (const line of lines) {
        currentPage.drawText(line, {
          x: MARGIN_LEFT,
          y: currentY - 10,
          size: 10,
          font: assets.fontBodyBold,
          color: rgb(0.15, 0.15, 0.15)
        });
        currentY -= 15;
      }
      currentY -= 3;
    }

    // Draw Indented Detail Lines (Category, Time, Skill, Candidates)
    const detailIndent = MARGIN_LEFT + 30;
    for (const d of detailLines) {
      const labelText = d.label + ' ';
      currentPage.drawText(labelText, {
        x: detailIndent,
        y: currentY - 9,
        size: 9,
        font: assets.fontBodyBold,
        color: rgb(0.1, 0.1, 0.1)
      });

      const labelWidth = assets.fontBodyBold.widthOfTextAtSize(labelText, 9);
      currentPage.drawText(String(d.value), {
        x: detailIndent + labelWidth,
        y: currentY - 9,
        size: 9,
        font: assets.fontBody,
        color: rgb(0.15, 0.15, 0.15)
      });

      currentY -= 14;
    }

    currentY -= 12; // Gap between programmes
  }

  // ==========================================
  // SCHEDULE SECTION
  // ==========================================
  const schedPage = addInnerPage();
  let schedY = MARGIN_TOP;

  schedY = drawHeaderPill(schedPage, 'SCHEDULE', schedY, assets.fontBodyBold);
  schedY -= 12;

  // Table Configuration
  const colWidths = {
    sl: 26,
    prog: 116,
    cat: 74,
    date: 68,
    time: 95,
    venue: 60
  };

  const tableHeaderHeight = 24;
  const tableX = MARGIN_LEFT;

  // Black Header Bar
  schedPage.drawRectangle({
    x: tableX,
    y: schedY - tableHeaderHeight,
    width: CONTENT_WIDTH,
    height: tableHeaderHeight,
    color: rgb(0.043, 0.043, 0.043)
  });

  // Table Header Labels
  const headerY = schedY - tableHeaderHeight + 7;
  schedPage.drawText('SL', { x: tableX + 7, y: headerY, size: 9, font: assets.fontBodyBold, color: rgb(1, 1, 1) });
  schedPage.drawText('PROGRAM', { x: tableX + 32, y: headerY, size: 9, font: assets.fontBodyBold, color: rgb(1, 1, 1) });
  schedPage.drawText('CATEGORY', { x: tableX + 148, y: headerY, size: 9, font: assets.fontBodyBold, color: rgb(1, 1, 1) });
  schedPage.drawText('DATE', { x: tableX + 225, y: headerY, size: 9, font: assets.fontBodyBold, color: rgb(1, 1, 1) });
  schedPage.drawText('TIME', { x: tableX + 293, y: headerY, size: 9, font: assets.fontBodyBold, color: rgb(1, 1, 1) });
  schedPage.drawText('VENUE', { x: tableX + 388, y: headerY, size: 9, font: assets.fontBodyBold, color: rgb(1, 1, 1) });

  schedY -= tableHeaderHeight;

  // Table Rows
  const rowHeight = 23;
  items.forEach((item, idx) => {
    const rowY = schedY - rowHeight;

    // Row divider line
    schedPage.drawLine({
      start: { x: tableX, y: rowY },
      end: { x: tableX + CONTENT_WIDTH, y: rowY },
      thickness: 0.7,
      color: rgb(0.78, 0.78, 0.78)
    });

    const textY = rowY + 7;
    const slStr = String(idx + 1);
    const progStr = `${item.code} ${item.name}`.slice(0, 22);
    const catStr = (item.category || '').slice(0, 14);
    const dateStr = item.date || '';
    const timeStr = (item.time || `${item.from || ''} - ${item.to || ''}`).trim();
    const venueStr = (item.venue || '').slice(0, 12);

    schedPage.drawText(slStr, { x: tableX + 9, y: textY, size: 8.5, font: assets.fontBody, color: rgb(0.1, 0.1, 0.1) });
    schedPage.drawText(progStr, { x: tableX + 32, y: textY, size: 8.5, font: assets.fontBodyBold, color: rgb(0.1, 0.1, 0.1) });
    schedPage.drawText(catStr, { x: tableX + 148, y: textY, size: 8.5, font: assets.fontBody, color: rgb(0.1, 0.1, 0.1) });
    schedPage.drawText(dateStr, { x: tableX + 222, y: textY, size: 8.5, font: assets.fontBody, color: rgb(0.1, 0.1, 0.1) });
    schedPage.drawText(timeStr, { x: tableX + 290, y: textY, size: 8.5, font: assets.fontBody, color: rgb(0.1, 0.1, 0.1) });
    schedPage.drawText(venueStr, { x: tableX + 388, y: textY, size: 8.5, font: assets.fontBody, color: rgb(0.1, 0.1, 0.1) });

    schedY = rowY;
  });

  // Total Judging Hours Note
  if (judge.total_hours) {
    schedY -= 18;
    schedPage.drawText(`Total Judging Hours: ${judge.total_hours}`, {
      x: tableX + 4,
      y: schedY,
      size: 9.5,
      font: assets.fontBodyBold,
      color: rgb(0.15, 0.15, 0.15)
    });
  }

  // ==========================================
  // FEEDBACK SECTION
  // ==========================================
  const feedbackPage = addInnerPage();

  // Title: FEEDBACK
  const feedbackTitle = 'FEEDBACK';
  const fbTitleWidth = assets.fontHeading.widthOfTextAtSize(feedbackTitle, 22);
  const fbTitleX = (PAGE_WIDTH - fbTitleWidth) / 2;
  const fbTitleY = 724;

  feedbackPage.drawText(feedbackTitle, {
    x: fbTitleX,
    y: fbTitleY,
    size: 22,
    font: assets.fontHeading,
    color: rgb(0.05, 0.05, 0.05)
  });

  // 24 Ruled Horizontal Lines
  const lineSpacing = 26.5;
  let lineY = 684;
  for (let i = 0; i < 24; i++) {
    feedbackPage.drawLine({
      start: { x: MARGIN_LEFT, y: lineY },
      end: { x: MARGIN_LEFT + CONTENT_WIDTH, y: lineY },
      thickness: 0.7,
      color: rgb(0.784, 0.784, 0.784)
    });
    lineY -= lineSpacing;
  }

  // ==========================================
  // BACK COVER PAGE
  // ==========================================
  const backCoverPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  if (assets.backCoverImg) {
    backCoverPage.drawImage(assets.backCoverImg, {
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Merges multiple judge PDF buffers according to specified mode:
 * - 'A' / 'all': Complete booklets of all judges
 * - 'B' / 'inner': Inner pages only (no cover, no back cover)
 * - 'C' / 'covers': Cover and back cover only of all judges
 */
async function generateMergedPdf(judgeBuffers, mode = 'A') {
  const mergedDoc = await PDFDocument.create();

  for (const buf of judgeBuffers) {
    if (!buf || buf.length === 0) continue;
    const doc = await PDFDocument.load(buf);
    const count = doc.getPageCount();

    let pageIndices = [];
    if (mode === 'A' || mode === 'all') {
      pageIndices = Array.from({ length: count }, (_, i) => i);
    } else if (mode === 'B' || mode === 'inner') {
      // Inner pages: skip 0 (cover) and count - 1 (back cover)
      if (count > 2) {
        pageIndices = Array.from({ length: count - 2 }, (_, i) => i + 1);
      }
    } else if (mode === 'C' || mode === 'covers') {
      // Covers only: 0 and count - 1
      pageIndices = [0];
      if (count > 1) pageIndices.push(count - 1);
    }

    const copiedPages = await mergedDoc.copyPages(doc, pageIndices);
    copiedPages.forEach(p => mergedDoc.addPage(p));
  }

  const finalBytes = await mergedDoc.save();
  return Buffer.from(finalBytes);
}

/**
 * Creates a ZIP archive of individual judge PDFs
 * @param {Array<{fileName: string, buffer: Buffer}>} fileList
 * @returns {Promise<Buffer>}
 */
function createZipArchive(fileList) {
  return new Promise((resolve, reject) => {
    let archive;
    const archiverModule = require('archiver');
    if (typeof archiverModule === 'function') {
      archive = archiverModule('zip', { zlib: { level: 9 } });
    } else if (archiverModule.ZipArchive) {
      archive = new archiverModule.ZipArchive({ zlib: { level: 9 } });
    } else if (archiverModule.default && typeof archiverModule.default === 'function') {
      archive = archiverModule.default('zip', { zlib: { level: 9 } });
    }

    const chunks = [];

    archive.on('data', chunk => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', err => reject(err));

    for (const item of fileList) {
      archive.append(item.buffer, { name: item.fileName });
    }

    archive.finalize();
  });
}

module.exports = {
  generateJudgeGuidelinePdf,
  generateMergedPdf,
  createZipArchive,
  DEFAULT_RULES,
  PAGE_WIDTH,
  PAGE_HEIGHT
};
