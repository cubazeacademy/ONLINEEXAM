const XLSX = require('xlsx');

/**
 * Normalizes string keys for flexible header matching
 */
function normalizeHeader(str) {
  if (!str) return '';
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Standardizes time strings into 'hh:mm AM/PM'
 */
function normalizeTime(val) {
  if (val === undefined || val === null) return '';
  let str = String(val).trim();
  if (!str) return '';

  // Handle Excel numeric time fraction (e.g. 0.375 = 09:00:00)
  if (typeof val === 'number' || (!isNaN(str) && !str.includes(':'))) {
    const totalMinutes = Math.round(Number(str) * 24 * 60);
    const hours24 = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const ampm = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
  }

  // Handle formats like "09:00 AM", "9:00am", "09.00 AM", "09:00:00"
  str = str.replace(/\./g, ':');
  const match = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = match[2];
    let ampm = match[3] ? match[3].toUpperCase() : null;

    if (!ampm) {
      ampm = h >= 12 ? 'PM' : 'AM';
      if (h > 12) h -= 12;
      if (h === 0) h = 12;
    } else {
      if (h > 12) h = h % 12 || 12;
    }
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  }

  return str;
}

/**
 * Converts a time string 'hh:mm AM/PM' into comparable minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 9999;
  const match = String(timeStr).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 9999;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

/**
 * Standardizes date strings into 'YYYY-MM-DD' or readable 'DD-MM-YYYY'
 */
function normalizeDate(val) {
  if (!val) return '';
  let str = String(val).trim();

  // Excel serial date number
  if (typeof val === 'number') {
    const dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(dateObj.getTime())) {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  // Check DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (dmyMatch) {
    const d = String(dmyMatch[1]).padStart(2, '0');
    const m = String(dmyMatch[2]).padStart(2, '0');
    const y = dmyMatch[3];
    return `${y}-${m}-${d}`;
  }

  // Check YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = String(ymdMatch[2]).padStart(2, '0');
    const d = String(ymdMatch[3]).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return str;
}

/**
 * Formats a date string into SIBAQ official heading format:
 * e.g. "14-11-2026  SATURDAY" or "21 NOVEMBER 2026"
 */
function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const weekday = days[d.getDay()];
    return `${day}-${month}-${year}  ${weekday}`;
  }
  return dateStr;
}

/**
 * Main Excel / CSV Schedule Parser
 * @param {Buffer|ArrayBuffer} fileBuffer 
 * @param {Object} options Options including chosen duplicate column mapping
 */
function parseScheduleWorkbook(fileBuffer, options = {}) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true, raw: false });
  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error('The uploaded Excel file contains no worksheets.');
  }

  const allProgrammes = [];
  const detectedDatesSet = new Set();
  const detectedPoolsSet = new Set();
  const detectedVenuesSet = new Set();
  const duplicateHeaderConflicts = [];
  const validationWarnings = [];

  let globalSerial = 1;

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;

    // Convert sheet to array of rows (2D array)
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
    if (!rawRows || rawRows.length === 0) continue;

    // 1. Identify header row and embedded section dates
    let headerRowIdx = -1;
    let columnMap = {};
    let activeSectionDate = '';
    let duplicateFromColumns = [];

    // Header aliases
    const aliases = {
      sl: ['sl', 'slno', 'sno', 'serial', 'serialno', '#'],
      from: ['from', 'start', 'starttime', 'startingtime'],
      to: ['to', 'end', 'endtime', 'endingtime'],
      code: ['code', 'progcode', 'programmecode', 'itemcode', 'code#'],
      pool: ['pool', 'poolname', 'section', 'division'],
      name: ['name', 'programme', 'programmename', 'item', 'itemname', 'title'],
      category: ['category', 'cat', 'academiccategory', 'level'],
      venue: ['venue', 'stage', 'hall', 'room', 'location'],
      date: ['date', 'scheduledate', 'day', 'eventdate']
    };

    // Scan top 15 rows for the table header row
    for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
      const row = rawRows[r];
      if (!Array.isArray(row)) continue;

      // Check if this row looks like a title row with a date embedded:
      // e.g. "SIBAQ'26 Programmes: 2026-11-21 Day 1" or "14-11-2026 SATURDAY"
      const rowText = row.join(' ');
      const embeddedDateMatch = rowText.match(/(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})/i);
      if (embeddedDateMatch) {
        activeSectionDate = normalizeDate(embeddedDateMatch[1]);
        if (activeSectionDate) detectedDatesSet.add(activeSectionDate);
      }

      // Check for presence of key headers: Code, Name, From, Venue
      let matchedCount = 0;
      const tempMap = {};
      const fromCols = [];

      row.forEach((cellVal, colIdx) => {
        const norm = normalizeHeader(cellVal);
        if (!norm) return;

        for (const [canonical, aliasList] of Object.entries(aliases)) {
          if (aliasList.includes(norm)) {
            if (canonical === 'from') {
              fromCols.push({ colIdx, headerText: String(cellVal).trim() });
            }
            if (tempMap[canonical] === undefined) {
              tempMap[canonical] = colIdx;
              matchedCount++;
            }
            break;
          }
        }
      });

      // If at least 3 critical columns matched (e.g. from, code, name or venue)
      if (matchedCount >= 3 || (tempMap.name !== undefined && (tempMap.from !== undefined || tempMap.code !== undefined))) {
        headerRowIdx = r;
        columnMap = tempMap;
        duplicateFromColumns = fromCols;
        break;
      }
    }

    if (headerRowIdx === -1) {
      // Fallback: search anywhere in sheet
      headerRowIdx = 0;
    }

    // 2. Handle Duplicate "From" Columns (Mandatory requirement from Prompt Section 3)
    let selectedFromCol = columnMap.from !== undefined ? columnMap.from : 1;
    if (duplicateFromColumns.length > 1) {
      // Compare values across rows to see if they are identical duplicates
      let areIdentical = true;
      for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;
        const val1 = normalizeTime(row[duplicateFromColumns[0].colIdx]);
        const val2 = normalizeTime(row[duplicateFromColumns[1].colIdx]);
        if (val1 && val2 && val1 !== val2) {
          areIdentical = false;
          break;
        }
      }

      if (areIdentical) {
        selectedFromCol = duplicateFromColumns[0].colIdx;
        columnMap.from = selectedFromCol;
      } else {
        // Values differ: Record conflict
        duplicateHeaderConflicts.push({
          sheet: sheetName,
          header: 'From',
          columns: duplicateFromColumns.map(c => ({ colIdx: c.colIdx, header: c.headerText })),
          chosenCol: options.chosenFromCol !== undefined ? options.chosenFromCol : duplicateFromColumns[0].colIdx
        });
        if (options.chosenFromCol !== undefined) {
          selectedFromCol = options.chosenFromCol;
          columnMap.from = selectedFromCol;
        }
      }
    }

    // 3. Process Data Rows
    let currentDaySection = activeSectionDate || '';

    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || !Array.isArray(row)) continue;

      // Check if entire row is empty
      const hasContent = row.some(c => c !== undefined && c !== null && String(c).trim() !== '');
      if (!hasContent) continue;

      const rowText = row.join(' ').trim();

      // Check if this row is a sectional date header (e.g. "DAY 1 - 21 NOVEMBER 2026")
      const sectionDateMatch = rowText.match(/(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})/i);
      if (sectionDateMatch && row.filter(c => String(c).trim() !== '').length <= 2) {
        currentDaySection = normalizeDate(sectionDateMatch[1]);
        if (currentDaySection) detectedDatesSet.add(currentDaySection);
        continue;
      }

      // Extract fields according to columnMap
      const rawSl = columnMap.sl !== undefined ? row[columnMap.sl] : '';
      const rawFrom = columnMap.from !== undefined ? row[columnMap.from] : '';
      const rawTo = columnMap.to !== undefined ? row[columnMap.to] : '';
      const rawCode = columnMap.code !== undefined ? row[columnMap.code] : '';
      const rawPool = columnMap.pool !== undefined ? row[columnMap.pool] : '';
      const rawName = columnMap.name !== undefined ? row[columnMap.name] : '';
      const rawCat = columnMap.category !== undefined ? row[columnMap.category] : '';
      const rawVenue = columnMap.venue !== undefined ? row[columnMap.venue] : '';
      const rawDate = columnMap.date !== undefined ? row[columnMap.date] : '';

      const progName = String(rawName || '').trim();
      const progCode = String(rawCode || '').trim();

      // Skip row if both name and code are missing (e.g. decorative divider row)
      if (!progName && !progCode) continue;

      const startTime = normalizeTime(rawFrom);
      const endTime = normalizeTime(rawTo);

      // Date resolution: dedicated date col > sectional day heading > sheet default
      let progDate = normalizeDate(rawDate) || currentDaySection;
      if (!progDate && detectedDatesSet.size > 0) {
        // Fallback to first detected date if singular
        progDate = Array.from(detectedDatesSet)[0];
      }

      // Pool resolution: default to 'POOL B' if not provided (like sample), or detect POOL A/B/C/D
      let pool = String(rawPool || '').trim();
      if (!pool) {
        // Look in sheet title or row text for "POOL A", "POOL B", etc.
        const poolMatch = (sheetName + ' ' + rowText).match(/POOL\s*([A-Za-z0-9]+)/i);
        pool = poolMatch ? `POOL ${poolMatch[1].toUpperCase()}` : 'POOL B';
      } else {
        if (!pool.toUpperCase().startsWith('POOL') && pool.length <= 3) {
          pool = `POOL ${pool.toUpperCase()}`;
        } else {
          pool = pool.toUpperCase();
        }
      }

      // Venue resolution
      let venue = String(rawVenue || '').trim();
      if (!venue) {
        venue = 'Venue 1';
      }

      // Category resolution
      const category = String(rawCat || '').trim();

      // Serial Number
      const sl = String(rawSl || '').trim() || String(globalSerial);
      globalSerial++;

      if (progDate) detectedDatesSet.add(progDate);
      if (pool) detectedPoolsSet.add(pool);
      if (venue) detectedVenuesSet.add(venue);

      // Validation Checks
      const rowNum = r + 1;
      if (!progName) {
        validationWarnings.push({ row: rowNum, type: 'missing_name', message: `Row ${rowNum}: Programme name is missing.` });
      }
      if (!progCode) {
        validationWarnings.push({ row: rowNum, type: 'missing_code', message: `Row ${rowNum} (${progName || 'Unknown'}): Programme code is missing.` });
      }
      if (!progDate) {
        validationWarnings.push({ row: rowNum, type: 'missing_date', message: `Row ${rowNum} (${progName}): Date could not be identified.` });
      }
      if (!startTime) {
        validationWarnings.push({ row: rowNum, type: 'missing_time', message: `Row ${rowNum} (${progName}): Starting time is missing.` });
      }
      if (startTime && endTime) {
        const startMin = timeToMinutes(startTime);
        const endMin = timeToMinutes(endTime);
        if (startMin > endMin && endMin > 0) {
          validationWarnings.push({
            row: rowNum,
            type: 'invalid_time_range',
            message: `Row ${rowNum} (${progName}): Starting time (${startTime}) is later than ending time (${endTime}).`
          });
        }
      }

      allProgrammes.push({
        id: allProgrammes.length + 1,
        serial_number: sl,
        starting_time: startTime,
        ending_time: endTime,
        programme_code: progCode,
        pool: pool,
        programme_name: progName,
        category: category,
        venue: venue,
        programme_date: progDate,
        sort_order: allProgrammes.length
      });
    }
  }

  // Sort detected dates chronologically
  const sortedDates = Array.from(detectedDatesSet).sort((a, b) => {
    return new Date(a).getTime() - new Date(b).getTime();
  });

  const sortedPools = Array.from(detectedPoolsSet).sort();
  const sortedVenues = Array.from(detectedVenuesSet).sort((a, b) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Check for duplicate programme codes/names
  const codeTracker = {};
  for (const p of allProgrammes) {
    if (p.programme_code) {
      if (codeTracker[p.programme_code]) {
        validationWarnings.push({
          type: 'duplicate_code',
          message: `Duplicate programme code detected: "${p.programme_code}" (${p.programme_name})`
        });
      } else {
        codeTracker[p.programme_code] = true;
      }
    }
  }

  return {
    success: true,
    totalProgrammes: allProgrammes.length,
    programmes: allProgrammes,
    detectedDates: sortedDates,
    detectedPools: sortedPools,
    detectedVenues: sortedVenues,
    duplicateHeaderConflicts,
    validationWarnings,
    summary: {
      totalProgrammes: allProgrammes.length,
      totalDates: sortedDates.length,
      totalPools: sortedPools.length,
      totalVenues: sortedVenues.length,
      totalWarnings: validationWarnings.length
    }
  };
}

module.exports = {
  parseScheduleWorkbook,
  normalizeTime,
  timeToMinutes,
  normalizeDate,
  formatDisplayDate
};

