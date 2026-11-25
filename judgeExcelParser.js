require('./polyfillDom');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');

/**
 * Normalizes header strings for flexible matching
 */
function normalizeHeader(str) {
  if (!str) return '';
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Formats Excel date values (Date objects, serial numbers, strings) to YYYY-MM-DD
 */
function formatCellDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof val === 'number' && val > 30000 && val < 60000) {
    const dateObj = XLSX.SSF.parse_date_code(val);
    if (dateObj) {
      const yyyy = dateObj.y;
      const mm = String(dateObj.m).padStart(2, '0');
      const dd = String(dateObj.d).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return String(val).trim();
}

/**
 * Helper to parse time string like "09:10 AM" into minutes from midnight
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const meridiem = (match[3] || '').toUpperCase();
  if (meridiem === 'PM' && h < 12) h += 12;
  if (meridiem === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

/**
 * Calculates duration in minutes from time range like "09:10 AM - 09:55 AM"
 */
function calculateSlotDurationMinutes(timeStr) {
  if (!timeStr || !timeStr.includes('-')) return 0;
  const [startPart, endPart] = timeStr.split('-').map(t => t.trim());
  const startM = parseTimeToMinutes(startPart);
  const endM = parseTimeToMinutes(endPart);
  if (startM !== null && endM !== null) {
    let diff = endM - startM;
    if (diff < 0) diff += 24 * 60;
    return diff;
  }
  return 0;
}

/**
 * Classifies programme into one of the 3 concept types: GENERAL, NIICS, BANATH
 * Concept rules:
 * - POOL A, POOL B, POOL C are from GENERAL
 * - NIICS is from NIICS
 * - BANATH is from BANATH
 */
function classifyPoolAndConcept(poolVal = '', categoryVal = '', codeVal = '') {
  const p = String(poolVal || '').trim();
  const c = String(categoryVal || '').trim();
  const code = String(codeVal || '').trim().toUpperCase();

  const pUpper = p.toUpperCase();
  const cUpper = c.toUpperCase();

  let conceptType = 'GENERAL';
  let poolName = p;

  if (pUpper.includes('NIICS') || cUpper.includes('NIICS') || pUpper.startsWith('NIIC')) {
    conceptType = 'NIICS';
    poolName = p || 'NIICS';
  } else if (pUpper.includes('BANATH') || cUpper.includes('BANATH') || pUpper.startsWith('BAN')) {
    conceptType = 'BANATH';
    poolName = p || 'BANATH';
  } else if (/POOL\s*[A-Z0-9]/i.test(pUpper) || pUpper.startsWith('POOL') || pUpper.includes('GENERAL')) {
    conceptType = 'GENERAL';
    poolName = p || 'GENERAL';
  } else if (p) {
    if (/^[A-C]$/i.test(p)) {
      conceptType = 'GENERAL';
      poolName = `POOL ${pUpper}`;
    } else {
      conceptType = 'GENERAL';
      poolName = p;
    }
  } else {
    // If pool column is blank, infer from code or category
    if (code.includes('NIICS') || /^[A-Z]{1,2}N\d+/i.test(code)) {
      conceptType = 'NIICS';
      poolName = 'NIICS';
    } else if (code.includes('BANATH') || /BANATH/i.test(cUpper)) {
      conceptType = 'BANATH';
      poolName = 'BANATH';
    } else {
      conceptType = 'GENERAL';
      poolName = 'POOL A';
    }
  }

  return {
    concept_type: conceptType,
    pool: poolName
  };
}

/**
 * Parses judge roster from Excel, CSV or PDF buffer
 */
async function parseJudgeRoster(buffer, fileName = '', options = {}) {
  const isPdf = (fileName || '').toLowerCase().endsWith('.pdf') || (buffer[0] === 0x25 && buffer[1] === 0x50);

  if (isPdf) {
    return await parseJudgeRosterFromPdf(buffer);
  } else {
    return parseJudgeRosterFromExcel(buffer, options);
  }
}

/**
 * Parses Judge Roster from Excel / CSV workbook
 * Supports:
 * 1. Exact new format: Judge's Name | Program Code | Program Name | Category / Pool | POOL | Date | Time | Venue
 * 2. Merged/blank cells under Judge's Name (carries judge forward to subsequent rows)
 * 3. Composite / multi-table sheets (Summary table on top, detailed schedule below)
 * 4. Multi-sheet workbooks
 */
function parseJudgeRosterFromExcel(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('The uploaded workbook has no sheets.');
  }

  const judgesMap = new Map(); // cleanNo -> Judge Record
  const nameToNoMap = new Map(); // normalizedName -> cleanNo
  let detectedHeaders = null;
  let firstSampleRows = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rawData || rawData.length === 0) continue;

    let activeColMap = null;
    let lastActiveJudgeNo = null;

    for (let r = 0; r < rawData.length; r++) {
      const row = rawData[r];
      if (!row || row.every(cell => String(cell || '').trim() === '')) continue;

      const normCells = row.map(c => normalizeHeader(c));

      // Check if this row is a header row
      const hasJudgeName = normCells.some(c => c.includes('judgename') || c.includes('judgesname') || c === 'name' || (c.includes('judge') && !c.includes('no') && !c.includes('time')));
      const hasCode = normCells.some(c => c === 'code' || c.includes('progcode') || c.includes('programcode') || c.includes('code'));
      const hasCategory = normCells.some(c => c.includes('category') || c.includes('pool'));
      const hasBlock = normCells.some(c => c.includes('block') || c.includes('team'));
      const hasVenue = normCells.some(c => c.includes('venue'));
      const hasTime = normCells.some(c => c.includes('time') || c.includes('hours') || c.includes('duration'));
      const hasNo = normCells.some(c => c === 'no' || c === 'sl' || c === 'slno' || c === 'srno' || c.includes('judgeno') || c.includes('jno'));

      if ((hasJudgeName || hasNo) && (hasCode || hasBlock || hasVenue || hasTime || hasCategory)) {
        // Build column map for this table section
        const colMap = {
          no: -1,
          name: -1,
          team: -1,
          date: -1,
          code: -1,
          progName: -1,
          category: -1,
          pool: -1,
          venue: -1,
          time: -1,
          hours: -1
        };

        normCells.forEach((cell, cIdx) => {
          if (cell === 'no' || cell === 'sl' || cell === 'slno' || cell === 'srno' || cell.includes('judgeno') || cell.includes('jno')) {
            colMap.no = cIdx;
          } else if (cell.includes('judgename') || cell.includes('judgesname') || cell === 'name' || (cell.includes('judge') && !cell.includes('no') && !cell.includes('time'))) {
            colMap.name = cIdx;
          } else if (cell.includes('block') || cell.includes('team')) {
            colMap.team = cIdx;
          } else if (cell === 'date' || cell.includes('date')) {
            colMap.date = cIdx;
          } else if (cell === 'code' || cell.includes('progcode') || cell.includes('programcode')) {
            colMap.code = cIdx;
          } else if (cell.includes('progname') || cell.includes('programname') || cell.includes('event') || (cell.includes('program') && !cell.includes('code')) || (cell.includes('prog') && !cell.includes('code'))) {
            colMap.progName = cIdx;
          } else if (cell === 'categorypool' || cell.includes('category') || cell === 'cat') {
            colMap.category = cIdx;
          } else if (cell === 'pool' || (cell.includes('pool') && !cell.includes('category'))) {
            colMap.pool = cIdx;
          } else if (cell.includes('venue') || cell.includes('stage')) {
            colMap.venue = cIdx;
          } else if (cell.includes('totalhours') || cell.includes('hours') || cell.includes('duration')) {
            colMap.hours = cIdx;
          } else if (cell.includes('time') || cell.includes('judgingtime')) {
            colMap.time = cIdx;
          }
        });

        activeColMap = colMap;
        if (!detectedHeaders) detectedHeaders = colMap;
        if (firstSampleRows.length === 0) firstSampleRows = rawData.slice(r, r + 8);
        continue;
      }

      // If no active header was found in this sheet yet, attempt fallback defaults for row 0
      if (!activeColMap && r === 0) {
        activeColMap = {
          no: -1,
          name: 0,
          code: 1,
          progName: 2,
          category: 3,
          pool: 4,
          date: 5,
          time: 6,
          venue: 7,
          team: -1,
          hours: -1
        };
        detectedHeaders = activeColMap;
      }

      if (!activeColMap) continue;

      // Extract values for this data row
      const getVal = (colIdx) => (colIdx !== -1 && row[colIdx] !== undefined) ? String(row[colIdx]).trim() : '';

      const noVal = getVal(activeColMap.no);
      const nameVal = getVal(activeColMap.name);
      const teamVal = getVal(activeColMap.team);
      const dateVal = formatCellDate(activeColMap.date !== -1 ? row[activeColMap.date] : '');
      const codeVal = getVal(activeColMap.code).toUpperCase();
      const progVal = getVal(activeColMap.progName);
      const categoryVal = getVal(activeColMap.category);
      const poolVal = getVal(activeColMap.pool);
      const venueVal = getVal(activeColMap.venue);
      const timeVal = getVal(activeColMap.time);
      const hoursVal = getVal(activeColMap.hours);

      // Skip row if neither judge identifier nor programme code is present
      if (!noVal && !nameVal && !codeVal) continue;
      // Skip repeated header text in data rows
      if (normalizeHeader(noVal) === 'no' || normalizeHeader(nameVal) === 'judgename' || normalizeHeader(nameVal) === 'judgesname') continue;

      // Resolve clean judge number (2-digit padded e.g. "01")
      let cleanNo = '';
      if (noVal && /\d+/.test(noVal)) {
        cleanNo = String(parseInt(noVal.replace(/[^0-9]/g, ''), 10)).padStart(2, '0');
        lastActiveJudgeNo = cleanNo;
      } else if (nameVal) {
        const normName = normalizeHeader(nameVal);
        if (nameToNoMap.has(normName)) {
          cleanNo = nameToNoMap.get(normName);
        } else {
          cleanNo = String(judgesMap.size + 1).padStart(2, '0');
          nameToNoMap.set(normName, cleanNo);
        }
        lastActiveJudgeNo = cleanNo;
      } else if (lastActiveJudgeNo && codeVal) {
        // Cells under Judge's Name are blank/merged: associate with the last active judge
        cleanNo = lastActiveJudgeNo;
      } else {
        cleanNo = String(judgesMap.size + 1).padStart(2, '0');
        lastActiveJudgeNo = cleanNo;
      }

      // Retrieve or instantiate Judge record
      let judge = judgesMap.get(cleanNo);
      if (!judge) {
        judge = {
          judge_no: cleanNo,
          judge_name: nameVal || `Judge ${cleanNo}`,
          teams: teamVal || '',
          teams_blocks: teamVal || '',
          total_hours: hoursVal || '',
          assigned_programmes: [],
          assigned_codes: []
        };
        judgesMap.set(cleanNo, judge);
        if (nameVal) nameToNoMap.set(normalizeHeader(nameVal), cleanNo);
      } else {
        if (nameVal && (!judge.judge_name || judge.judge_name.startsWith('Judge '))) {
          judge.judge_name = nameVal;
          nameToNoMap.set(normalizeHeader(nameVal), cleanNo);
        }
        if (teamVal) {
          if (!judge.teams_blocks) judge.teams_blocks = teamVal;
          if (!judge.teams) judge.teams = teamVal;
        }
        if (hoursVal && !judge.total_hours) judge.total_hours = hoursVal;
      }

      // If this row contains a programme assignment, attach it
      if (codeVal && codeVal !== 'CODE') {
        let fromTime = '';
        let toTime = '';
        if (timeVal.includes('-')) {
          const parts = timeVal.split('-').map(t => t.trim());
          fromTime = parts[0] || '';
          toTime = parts[1] || '';
        } else {
          fromTime = timeVal;
        }

        const poolClassification = classifyPoolAndConcept(poolVal, categoryVal, codeVal);

        judge.assigned_programmes.push({
          date: dateVal,
          code: codeVal,
          name: progVal,
          category: categoryVal,
          pool: poolClassification.pool,
          concept_type: poolClassification.concept_type,
          venue: venueVal,
          from_time: fromTime,
          to_time: toTime,
          raw_time: timeVal
        });

        if (!judge.assigned_codes.includes(codeVal)) {
          judge.assigned_codes.push(codeVal);
        }
      }
    }
  }

  if (judgesMap.size === 0) {
    throw new Error('No judges could be parsed from the uploaded spreadsheet. Please check the column headers.');
  }

  // Post-process judges: calculate total hours and pool/team badges if not provided
  for (const judge of judgesMap.values()) {
    // 1. Calculate total judging hours from slot durations if missing
    let totalMinutes = 0;
    judge.assigned_programmes.forEach(p => {
      const dur = calculateSlotDurationMinutes(p.raw_time || `${p.from_time} - ${p.to_time}`);
      totalMinutes += dur;
    });

    if (!judge.total_hours && totalMinutes > 0) {
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      judge.total_hours = `${h}h ${m}m (${totalMinutes}m)`;
    }

    // 2. Derive teams / blocks from pools if missing
    if (!judge.teams || !judge.teams_blocks) {
      const poolsSet = new Set();
      judge.assigned_programmes.forEach(p => {
        if (p.pool) poolsSet.add(p.pool);
      });
      const poolsArr = Array.from(poolsSet);
      if (poolsArr.length > 0) {
        const poolSummary = poolsArr.join(', ');
        judge.teams = poolSummary;
        judge.teams_blocks = poolSummary;
      } else {
        judge.teams = 'Team 1';
        judge.teams_blocks = 'Team 1';
      }
    }
  }

  const judgesList = Array.from(judgesMap.values()).sort((a, b) =>
    parseInt(a.judge_no, 10) - parseInt(b.judge_no, 10)
  );

  return {
    success: true,
    file_type: 'excel',
    totalJudges: judgesList.length,
    judges: judgesList,
    detectedHeaders: detectedHeaders || {},
    sampleRows: firstSampleRows
  };
}

/**
 * Parses Judge Master Schedule directly from PDF (like the 30 judges schedule PDF)
 */
async function parseJudgeRosterFromPdf(buffer) {
  const parser = new PDFParse(new Uint8Array(buffer));
  await parser.load();
  const pdfTextResult = await parser.getText();
  const fullText = pdfTextResult.pages.map(p => p.text).join('\n');

  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  const judgesMap = new Map();
  let currentJudge = null;

  // Regex patterns
  const judgeStartRegex = /^(\d{1,3})\s+([A-Za-z\s\.\(\)\']+?)\s+(Team\s*\d+(?:\s*,\s*Team\s*\d+)?|\bBlock\s*[A-Z0-9]+)/i;
  const progLineRegex = /^(\d{2}[-/]\d{2}[-/]\d{4})\s+([A-Z]{2,4}\d{1,3}[A-Z]?)\s+(.+?)\s+(Venue\s*\d+(?:\s*Non)?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM))/i;
  const hoursRegex = /(\d+h\s*\d+m(?:\s*\(\d+m\))?)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for new judge
    const judgeMatch = line.match(judgeStartRegex);
    if (judgeMatch) {
      const cleanNo = String(parseInt(judgeMatch[1], 10)).padStart(2, '0');
      currentJudge = {
        judge_no: cleanNo,
        judge_name: judgeMatch[2].trim(),
        teams: judgeMatch[3].trim(),
        teams_blocks: judgeMatch[3].trim(),
        total_hours: '',
        assigned_programmes: [],
        assigned_codes: []
      };
      judgesMap.set(cleanNo, currentJudge);
      continue;
    }

    // Check for programme line
    const progMatch = line.match(progLineRegex);
    if (progMatch && currentJudge) {
      const pDate = progMatch[1];
      const pCode = progMatch[2].toUpperCase();
      const pName = progMatch[3].trim();
      const pVenue = progMatch[4].trim();
      const pTimeSlot = progMatch[5].trim();

      const timeParts = pTimeSlot.split('-').map(t => t.trim());
      const fromTime = timeParts[0] || '';
      const toTime = timeParts[1] || '';

      const poolClassification = classifyPoolAndConcept('', '', pCode);

      currentJudge.assigned_programmes.push({
        date: pDate,
        code: pCode,
        name: pName,
        category: '',
        pool: poolClassification.pool,
        concept_type: poolClassification.concept_type,
        venue: pVenue,
        from_time: fromTime,
        to_time: toTime,
        raw_time: pTimeSlot
      });

      if (!currentJudge.assigned_codes.includes(pCode)) {
        currentJudge.assigned_codes.push(pCode);
      }
      continue;
    }

    // Check for total hours
    const hoursMatch = line.match(hoursRegex);
    if (hoursMatch && currentJudge && !currentJudge.total_hours) {
      currentJudge.total_hours = hoursMatch[1].trim();
    }
  }

  const judgesList = Array.from(judgesMap.values()).sort((a, b) =>
    parseInt(a.judge_no, 10) - parseInt(b.judge_no, 10)
  );

  return {
    success: true,
    file_type: 'pdf',
    totalJudges: judgesList.length,
    judges: judgesList
  };
}

module.exports = {
  parseJudgeRoster,
  parseJudgeRosterFromExcel,
  parseJudgeRosterFromPdf,
  classifyPoolAndConcept,
  calculateSlotDurationMinutes
};
