const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');
const { timeToMinutes, formatDisplayDate } = require('./scheduleExcelParser');

// Colors
const COLOR_HEADER_RED = rgb(192 / 255, 0, 0); // #C00000 Official SIBAQ Crimson Header
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_TEXT_BLACK = rgb(15 / 255, 23 / 255, 42 / 255);
const COLOR_MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const COLOR_BORDER = rgb(226 / 255, 232 / 255, 240 / 255);
const COLOR_ALT_ROW = rgb(253 / 255, 248 / 255, 248 / 255);
const COLOR_SECTION_BG = rgb(248 / 255, 250 / 255, 252 / 255);

// A4 Page dimensions in points (72 points/inch)
const PAGE_WIDTH = 595.32;
const PAGE_HEIGHT = 841.92;

/**
 * Loads and caches Azurio font files and letterhead background images
 */
let cachedAssets = null;

function loadAssets() {
  if (cachedAssets) return cachedAssets;

  const fontDir = path.join(__dirname, 'public', 'assets', 'schedule_templates', 'fonts');
  const bgDir = path.join(__dirname, 'public', 'assets', 'schedule_templates', 'backgrounds');

  const lightBytes = fs.readFileSync(path.join(fontDir, 'AzurioTrial-Light.otf'));
  const regularBytes = fs.readFileSync(path.join(fontDir, 'AzurioTrial-Regular.otf'));
  const mediumBytes = fs.readFileSync(path.join(fontDir, 'AzurioTrial-Medium.otf'));
  const semiboldBytes = fs.readFileSync(path.join(fontDir, 'AzurioTrial-Semibold.otf'));

  const frontBgBytes = fs.readFileSync(path.join(bgDir, 'SHEDULE LETTERPAD front.jpg'));
  const secondBgBytes = fs.readFileSync(path.join(bgDir, 'Sibaq-letter-pad-second.jpg'));

  cachedAssets = {
    fonts: {
      light: lightBytes,
      regular: regularBytes,
      medium: mediumBytes,
      semibold: semiboldBytes
    },
    backgrounds: {
      front: frontBgBytes,
      second: secondBgBytes
    }
  };

  return cachedAssets;
}

/**
 * Splits text into lines that fit within a maximum width
 */
function wrapText(text, font, fontSize, maxWidth) {
  if (!text) return [''];
  const words = String(text).split(' ');
  const lines = [];
  let currentLine = words[0] || '';

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine + ' ' + word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
 * Formats hex color '#RRGGBB' to pdf-lib rgb()
 */
function hexToRgb(hex, defaultColor = COLOR_HEADER_RED) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return defaultColor;
  const clean = hex.replace('#', '');
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return rgb(r, g, b);
  }
  return defaultColor;
}

/**
 * Draws background image on a page (front for page 1, second for page 2+)
 */
function drawPageBackground(page, isFirstPage, frontImg, secondImg) {
  const img = isFirstPage ? frontImg : secondImg;
  page.drawImage(img, {
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT
  });
}

/**
 * =========================================================================
 * 1. DAY-BASED SCHEDULE PDF GENERATOR
 * =========================================================================
 * Generates an exact replica of "POOL B SECTION A SCHEDULE - DAY BASED.pdf"
 */
async function generateDayBasedSchedulePdf(programmes, options = {}) {
  const assets = loadAssets();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // Embed Azurio Fonts
  const fontLight = await doc.embedFont(assets.fonts.light);
  const fontRegular = await doc.embedFont(assets.fonts.regular);
  const fontMedium = await doc.embedFont(assets.fonts.medium);
  const fontSemibold = await doc.embedFont(assets.fonts.semibold);

  // Embed Letterhead Images
  const frontImg = await doc.embedJpg(assets.backgrounds.front);
  const secondImg = await doc.embedJpg(assets.backgrounds.second);

  // Template / Styling settings
  const tmpl = options.templateSettings || {};
  const headerBgColor = hexToRgb(tmpl.headerColor, COLOR_HEADER_RED);
  const selectedPool = options.pool || 'POOL B';
  const eventName = tmpl.eventName || 'SIBAQ\'26';

  // Filter programmes for the selected pool
  const poolProgrammes = programmes.filter(p => !selectedPool || p.pool === selectedPool);

  // Group by Date
  const dateGroups = {};
  for (const p of poolProgrammes) {
    const dateKey = p.programme_date || 'General Schedule';
    if (!dateGroups[dateKey]) dateGroups[dateKey] = [];
    dateGroups[dateKey].push(p);
  }

  // Sort dates chronologically
  const sortedDates = Object.keys(dateGroups).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  // Table Column Specifications (Total Width = 473.1 pt, Left Margin = 72.0 pt)
  const leftMargin = 72.0;
  const colWidths = [
    { key: 'from', title: 'From', width: 58.56, align: 'left' },
    { key: 'to', title: 'To', width: 63.98, align: 'left' },
    { key: 'code', title: 'Code', width: 33.00, align: 'left' },
    { key: 'name', title: 'Name', width: 146.06, align: 'left' },
    { key: 'category', title: 'Category', width: 101.06, align: 'left' },
    { key: 'venue', title: 'Venue', width: 70.44, align: 'left' }
  ];
  const tableWidth = colWidths.reduce((sum, c) => sum + c.width, 0);

  let currentPage = null;
  let pageIndex = 0;
  let currentY = 0;

  function addNewPage() {
    pageIndex++;
    currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isFirst = pageIndex === 1;
    drawPageBackground(currentPage, isFirst, frontImg, secondImg);

    // On page 1, table starts right below the official letterhead header (y = 575)
    // On continuation pages (page 2+), table starts at y = 740
    currentY = isFirst ? 575.0 : 740.0;
    return currentPage;
  }

  function drawTableHeader() {
    const headerHeight = 19.5;
    let colX = leftMargin;

    for (const col of colWidths) {
      // Header cell rectangle
      currentPage.drawRectangle({
        x: colX,
        y: currentY - headerHeight,
        width: col.width,
        height: headerHeight,
        color: headerBgColor,
        borderColor: COLOR_WHITE,
        borderWidth: 0.5
      });

      // Header text (White Bold 9pt)
      const textX = colX + 5;
      const textY = currentY - headerHeight + 5.5;
      currentPage.drawText(col.title, {
        x: textX,
        y: textY,
        size: 9,
        font: fontSemibold,
        color: COLOR_WHITE
      });

      colX += col.width;
    }

    currentY -= headerHeight;
  }

  // Iterate dates
  for (let dIdx = 0; dIdx < sortedDates.length; dIdx++) {
    const dateStr = sortedDates[dIdx];
    const items = dateGroups[dateStr];

    // Sort items by Starting Time
    items.sort((a, b) => timeToMinutes(a.starting_time) - timeToMinutes(b.starting_time));

    // Each date gets a clean start or continuation
    if (!currentPage || (dIdx > 0 && currentY < 200)) {
      addNewPage();
    }

    // If options specify custom date heading or continuation
    if (dIdx > 0 && currentY < 650) {
      currentY -= 15;
    }

    // Always draw table header at start of date section or page
    drawTableHeader();

    // Draw programme rows
    for (let rIdx = 0; rIdx < items.length; rIdx++) {
      const item = items[rIdx];

      // Calculate required row height based on text wrapping
      const nameLines = wrapText(item.programme_name, fontRegular, 9, colWidths[3].width - 8);
      const catLines = wrapText(item.category, fontRegular, 9, colWidths[4].width - 8);
      const maxLines = Math.max(nameLines.length, catLines.length, 1);
      const rowHeight = maxLines > 1 ? 24.0 : 15.6;

      // Check if row exceeds printable bottom boundary (above letterhead orange footer y=75)
      if (currentY - rowHeight < 75.0) {
        // Trigger page break!
        addNewPage();
        drawTableHeader();
      }

      // Alternating row background
      const rowBg = rIdx % 2 === 1 ? COLOR_ALT_ROW : COLOR_WHITE;

      let colX = leftMargin;
      const cellY = currentY - rowHeight;

      // Draw row background & cell borders
      currentPage.drawRectangle({
        x: leftMargin,
        y: cellY,
        width: tableWidth,
        height: rowHeight,
        color: rowBg,
        borderColor: COLOR_BORDER,
        borderWidth: 0.5
      });

      // Draw cell vertical grid borders
      for (const col of colWidths) {
        currentPage.drawLine({
          start: { x: colX, y: currentY },
          end: { x: colX, y: cellY },
          color: COLOR_BORDER,
          thickness: 0.5
        });
        colX += col.width;
      }
      // Rightmost border line
      currentPage.drawLine({
        start: { x: leftMargin + tableWidth, y: currentY },
        end: { x: leftMargin + tableWidth, y: cellY },
        color: COLOR_BORDER,
        thickness: 0.5
      });

      // Draw cell text
      colX = leftMargin;
      const textBaselineY = maxLines > 1 ? currentY - 11.0 : currentY - 11.2;

      // Col 0: From
      currentPage.drawText(item.starting_time || '', {
        x: colX + 4,
        y: textBaselineY,
        size: 9,
        font: fontRegular,
        color: COLOR_TEXT_BLACK
      });
      colX += colWidths[0].width;

      // Col 1: To
      currentPage.drawText(item.ending_time || '', {
        x: colX + 4,
        y: textBaselineY,
        size: 9,
        font: fontRegular,
        color: COLOR_TEXT_BLACK
      });
      colX += colWidths[1].width;

      // Col 2: Code
      currentPage.drawText(item.programme_code || '', {
        x: colX + 4,
        y: textBaselineY,
        size: 9,
        font: fontRegular,
        color: COLOR_TEXT_BLACK
      });
      colX += colWidths[2].width;

      // Col 3: Name (with wrapping)
      let nameY = textBaselineY;
      for (const line of nameLines) {
        currentPage.drawText(line, {
          x: colX + 4,
          y: nameY,
          size: 9,
          font: fontRegular,
          color: COLOR_TEXT_BLACK
        });
        nameY -= 10.5;
      }
      colX += colWidths[3].width;

      // Col 4: Category (with wrapping)
      let catY = textBaselineY;
      for (const line of catLines) {
        currentPage.drawText(line, {
          x: colX + 4,
          y: catY,
          size: 9,
          font: fontRegular,
          color: COLOR_TEXT_BLACK
        });
        catY -= 10.5;
      }
      colX += colWidths[4].width;

      // Col 5: Venue
      currentPage.drawText(item.venue || '', {
        x: colX + 4,
        y: textBaselineY,
        size: 9,
        font: fontRegular,
        color: COLOR_TEXT_BLACK
      });

      currentY -= rowHeight;
    }
  }

  return await doc.save();
}

/**
 * =========================================================================
 * 2. VENUE-BASED SCHEDULE PDF GENERATOR
 * =========================================================================
 * Generates an exact replica of "POOL B SECTION A SCHEDULE - VENUE BASED.pdf"
 */
async function generateVenueBasedSchedulePdf(programmes, options = {}) {
  const assets = loadAssets();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // Embed Azurio Fonts
  const fontLight = await doc.embedFont(assets.fonts.light);
  const fontRegular = await doc.embedFont(assets.fonts.regular);
  const fontMedium = await doc.embedFont(assets.fonts.medium);
  const fontSemibold = await doc.embedFont(assets.fonts.semibold);

  // Embed Letterhead Images
  const frontImg = await doc.embedJpg(assets.backgrounds.front);
  const secondImg = await doc.embedJpg(assets.backgrounds.second);

  // Template settings
  const tmpl = options.templateSettings || {};
  const headerBgColor = hexToRgb(tmpl.headerColor, COLOR_HEADER_RED);
  const selectedPool = options.pool || 'POOL B';

  // Filter programmes for the selected pool
  const poolProgrammes = programmes.filter(p => !selectedPool || p.pool === selectedPool);

  // Group by Venue
  const venueGroups = {};
  for (const p of poolProgrammes) {
    const venueKey = p.venue || 'Venue 1';
    if (!venueGroups[venueKey]) venueGroups[venueKey] = [];
    venueGroups[venueKey].push(p);
  }

  // Natural sort venue names (Venue 1, Venue 2 ... Venue 5)
  const sortedVenues = Object.keys(venueGroups).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  // Table Column Specifications (Width = 455.1 pt, Left Margin = 72.0 pt)
  const leftMargin = 72.0;
  const colWidths = [
    { key: 'from', title: 'From', width: 66.24, align: 'left' },
    { key: 'to', title: 'To', width: 66.74, align: 'left' },
    { key: 'code', title: 'Code', width: 37.56, align: 'left' },
    { key: 'name', title: 'Programme', width: 149.06, align: 'left' },
    { key: 'category', title: 'Category', width: 135.50, align: 'left' }
  ];
  const tableWidth = colWidths.reduce((sum, c) => sum + c.width, 0);

  let currentPage = null;
  let pageIndex = 0;
  let currentY = 0;

  function addNewPage(isFirstVenue = false) {
    pageIndex++;
    currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isFirst = pageIndex === 1;
    drawPageBackground(currentPage, isFirst, frontImg, secondImg);

    // On Page 1, start below top letterhead (y ~ 535)
    // On Page 2+, start at y ~ 720
    currentY = isFirst ? 535.0 : 720.0;
    return currentPage;
  }

  function drawTableHeader() {
    const headerHeight = 23.28;
    let colX = leftMargin;

    for (const col of colWidths) {
      currentPage.drawRectangle({
        x: colX,
        y: currentY - headerHeight,
        width: col.width,
        height: headerHeight,
        color: headerBgColor,
        borderColor: COLOR_WHITE,
        borderWidth: 0.5
      });

      const textX = colX + 6;
      const textY = currentY - headerHeight + 7.5;
      currentPage.drawText(col.title, {
        x: textX,
        y: textY,
        size: 11,
        font: fontSemibold,
        color: COLOR_WHITE
      });

      colX += col.width;
    }

    currentY -= headerHeight;
  }

  // Each Venue gets its own dedicated section (matching the original 5-page PDF)
  for (let vIdx = 0; vIdx < sortedVenues.length; vIdx++) {
    const venueName = sortedVenues[vIdx];
    const venueItems = venueGroups[venueName];

    // Each new venue begins on a clean page (or continues cleanly if space permits)
    addNewPage(vIdx === 0);

    // 1. Draw Large Venue Heading: e.g. "VENUE 1" (21.96pt Bold, Centered)
    const venueHeadingText = venueName.toUpperCase();
    const venueTextWidth = fontSemibold.widthOfTextAtSize(venueHeadingText, 21.96);
    const venueCenterX = leftMargin + (tableWidth - venueTextWidth) / 2;

    currentPage.drawText(venueHeadingText, {
      x: venueCenterX,
      y: currentY,
      size: 21.96,
      font: fontSemibold,
      color: COLOR_TEXT_BLACK
    });

    currentY -= 36.0;

    // Group items within this venue by Date
    const venueDateGroups = {};
    for (const item of venueItems) {
      const dKey = item.programme_date || 'General';
      if (!venueDateGroups[dKey]) venueDateGroups[dKey] = [];
      venueDateGroups[dKey].push(item);
    }

    const sortedVenueDates = Object.keys(venueDateGroups).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    for (let dIdx = 0; dIdx < sortedVenueDates.length; dIdx++) {
      const dateStr = sortedVenueDates[dIdx];
      const items = venueDateGroups[dateStr];

      // Sort items by starting time
      items.sort((a, b) => timeToMinutes(a.starting_time) - timeToMinutes(b.starting_time));

      // Check if space is adequate for date heading + header + at least 1 row
      if (currentY < 160.0) {
        addNewPage(false);
      }

      // 2. Draw Date Subheading: e.g. "14-11-2026  SATURDAY" (11.04pt Bold, Centered)
      const formattedDate = formatDisplayDate(dateStr);
      const dateTextWidth = fontSemibold.widthOfTextAtSize(formattedDate, 11.04);
      const dateCenterX = leftMargin + (tableWidth - dateTextWidth) / 2;

      currentPage.drawText(formattedDate, {
        x: dateCenterX,
        y: currentY,
        size: 11.04,
        font: fontSemibold,
        color: COLOR_TEXT_BLACK
      });

      currentY -= 24.0;

      // 3. Draw Table Header
      drawTableHeader();

      // 4. Draw Rows for this date
      for (let rIdx = 0; rIdx < items.length; rIdx++) {
        const item = items[rIdx];

        const nameLines = wrapText(item.programme_name, fontRegular, 11.04, colWidths[3].width - 10);
        const catLines = wrapText(item.category, fontRegular, 11.04, colWidths[4].width - 10);
        const maxLines = Math.max(nameLines.length, catLines.length, 1);
        const rowHeight = maxLines > 1 ? 26.0 : 23.5;

        // Check page overflow
        if (currentY - rowHeight < 75.0) {
          addNewPage(false);
          drawTableHeader();
        }

        const rowBg = rIdx % 2 === 1 ? COLOR_ALT_ROW : COLOR_WHITE;
        const cellY = currentY - rowHeight;

        currentPage.drawRectangle({
          x: leftMargin,
          y: cellY,
          width: tableWidth,
          height: rowHeight,
          color: rowBg,
          borderColor: COLOR_BORDER,
          borderWidth: 0.5
        });

        // Vertical lines
        let colX = leftMargin;
        for (const col of colWidths) {
          currentPage.drawLine({
            start: { x: colX, y: currentY },
            end: { x: colX, y: cellY },
            color: COLOR_BORDER,
            thickness: 0.5
          });
          colX += col.width;
        }
        currentPage.drawLine({
          start: { x: leftMargin + tableWidth, y: currentY },
          end: { x: leftMargin + tableWidth, y: cellY },
          color: COLOR_BORDER,
          thickness: 0.5
        });

        // Text
        colX = leftMargin;
        const textBaselineY = maxLines > 1 ? currentY - 12.0 : currentY - 15.0;

        // From
        currentPage.drawText(item.starting_time || '', {
          x: colX + 6,
          y: textBaselineY,
          size: 11.04,
          font: fontRegular,
          color: COLOR_TEXT_BLACK
        });
        colX += colWidths[0].width;

        // To
        currentPage.drawText(item.ending_time || '', {
          x: colX + 6,
          y: textBaselineY,
          size: 11.04,
          font: fontRegular,
          color: COLOR_TEXT_BLACK
        });
        colX += colWidths[1].width;

        // Code
        currentPage.drawText(item.programme_code || '', {
          x: colX + 6,
          y: textBaselineY,
          size: 11.04,
          font: fontRegular,
          color: COLOR_TEXT_BLACK
        });
        colX += colWidths[2].width;

        // Programme Name
        let nameY = textBaselineY;
        for (const line of nameLines) {
          currentPage.drawText(line, {
            x: colX + 6,
            y: nameY,
            size: 11.04,
            font: fontRegular,
            color: COLOR_TEXT_BLACK
          });
          nameY -= 12.0;
        }
        colX += colWidths[3].width;

        // Category
        let catY = textBaselineY;
        for (const line of catLines) {
          currentPage.drawText(line, {
            x: colX + 6,
            y: catY,
            size: 11.04,
            font: fontRegular,
            color: COLOR_TEXT_BLACK
          });
          catY -= 12.0;
        }

        currentY -= rowHeight;
      }

      currentY -= 18.0;
    }
  }

  return await doc.save();
}

/**
 * Generates both Day-Based and Venue-Based PDFs for all detected pools
 */
async function generateAllSchedulePdfs(programmes, options = {}) {
  const detectedPools = options.pools || Array.from(new Set(programmes.map(p => p.pool || 'POOL B'))).sort();
  const results = [];

  const outDir = path.join(__dirname, 'public', 'uploads', 'generated_schedules');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const timestamp = Date.now();

  for (const pool of detectedPools) {
    const poolClean = pool.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();

    // 1. Day-Based PDF
    const dayPdfBytes = await generateDayBasedSchedulePdf(programmes, { ...options, pool });
    const dayFileName = `SIBAQ_2026_${poolClean}_DAY_BASED_${timestamp}.pdf`;
    const dayFilePath = path.join(outDir, dayFileName);
    fs.writeFileSync(dayFilePath, dayPdfBytes);

    results.push({
      pool,
      pdfType: 'day_based',
      title: `${pool} – Day-Based Schedule`,
      fileName: dayFileName,
      url: `/uploads/generated_schedules/${dayFileName}`,
      size: dayPdfBytes.length
    });

    // 2. Venue-Based PDF
    const venuePdfBytes = await generateVenueBasedSchedulePdf(programmes, { ...options, pool });
    const venueFileName = `SIBAQ_2026_${poolClean}_VENUE_BASED_${timestamp}.pdf`;
    const venueFilePath = path.join(outDir, venueFileName);
    fs.writeFileSync(venueFilePath, venuePdfBytes);

    results.push({
      pool,
      pdfType: 'venue_based',
      title: `${pool} – Venue-Based Schedule`,
      fileName: venueFileName,
      url: `/uploads/generated_schedules/${venueFileName}`,
      size: venuePdfBytes.length
    });
  }

  return results;
}

module.exports = {
  generateDayBasedSchedulePdf,
  generateVenueBasedSchedulePdf,
  generateAllSchedulePdfs
};

