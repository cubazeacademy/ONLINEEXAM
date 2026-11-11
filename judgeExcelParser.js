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
 * Parses judge roster from Excel, CSV or PDF buffer
 * @param {Buffer} buffer - File buffer
 * @param {string} fileName - File name to determine type
 * @param {Object} options - Manual column mappings or overrides
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
 * 1. Composite / multi-table sheets (e.g. Summary table on top, Detailed programme schedule below)
 * 2. Multi-sheet workbooks (Sheet 1 = Summary, Sheet 2 = Detailed schedule)
 * 3. Flat single table sheets (every row has judge info + programme info)
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

    for (let r = 0; r < rawData.length; r++) {
      const row = rawData[r];
      if (!row || row.every(cell => String(cell || '').trim() === '')) continue;

      const normCells = row.map(c => normalizeHeader(c));

      // Check if this row is a header row
      const hasJudgeName = normCells.some(c => c.includes('judgename') || c === 'name' || (c.includes('judge') && !c.includes('no') && !c.includes('time')));
      const hasCode = normCells.some(c => c === 'code' || c.includes('progcode') || c.includes('programcode'));
      const hasBlock = normCells.some(c => c.includes('block') || c.includes('team'));
      const hasVenue = normCells.some(c => c.includes('venue'));
      const hasTime = normCells.some(c => c.includes('time') || c.includes('hours') || c.includes('duration'));
      const hasNo = normCells.some(c => c === 'no' || c === 'sl' || c === 'slno' || c === 'srno' || c.includes('judgeno') || c.includes('jno'));

      if ((hasJudgeName || hasNo) && (hasCode || hasBlock || hasVenue || hasTime)) {
        // Build column map for this table section
        const colMap = {
          no: -1,
          name: -1,
          team: -1,
          date: -1,
          code: -1,
          progName: -1,
          venue: -1,
          time: -1,
          hours: -1
        };

        normCells.forEach((cell, cIdx) => {
          if (cell === 'no' || cell === 'sl' || cell === 'slno' || cell === 'srno' || cell.includes('judgeno') || cell.includes('jno')) {
            colMap.no = cIdx;
          } else if (cell.includes('judgename') || cell === 'name' || (cell.includes('judge') && !cell.includes('no') && !cell.includes('time'))) {
            colMap.name = cIdx;
          } else if (cell.includes('block') || cell.includes('team')) {
            colMap.team = cIdx;
          } else if (cell === 'date' || cell.includes('date')) {
            colMap.date = cIdx;
          } else if (cell === 'code' || cell.includes('progcode') || cell.includes('programcode')) {
            colMap.code = cIdx;
          } else if (cell.includes('prog') || cell.includes('programmename') || cell.includes('event')) {
            colMap.progName = cIdx;
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
        if (firstSampleRows.length === 0) firstSampleRows = rawData.slice(r, r + 6);
        continue;
      }

      // If no active header was found in this sheet yet, attempt fallback defaults for row 0
      if (!activeColMap && r === 0) {
        activeColMap = {
          no: 0,
          name: 1,
          team: 2,
          date: 3,
          code: 4,
          progName: 5,
          venue: 6,
          time: 7,
          hours: 8
        };
        detectedHeaders = activeColMap;
      }

      if (!activeColMap) continue;

      // Extract values for this data row
      const getVal = (colIdx) => (colIdx !== -1 && row[colIdx] !== undefined) ? String(row[colIdx]).trim() : '';

      const noVal = getVal(activeColMap.no);
      const nameVal = getVal(activeColMap.name);
      const teamVal = getVal(activeColMap.team);
      const dateVal = getVal(activeColMap.date);
      const codeVal = getVal(activeColMap.code).toUpperCase();
      const progVal = getVal(activeColMap.progName);
      const venueVal = getVal(activeColMap.venue);
      const timeVal = getVal(activeColMap.time);
      const hoursVal = getVal(activeColMap.hours);

      // Skip row if neither judge identifier nor programme code is present
      if (!noVal && !nameVal && !codeVal) continue;
      // Skip repeated header text in data rows
      if (normalizeHeader(noVal) === 'no' || normalizeHeader(nameVal) === 'judgename') continue;

      // Resolve clean judge number (2-digit padded e.g. "01")
      let cleanNo = '';
      if (noVal && /\d+/.test(noVal)) {
        cleanNo = String(parseInt(noVal.replace(/[^0-9]/g, ''), 10)).padStart(2, '0');
      } else if (nameVal && nameToNoMap.has(normalizeHeader(nameVal))) {
        cleanNo = nameToNoMap.get(normalizeHeader(nameVal));
      } else {
        cleanNo = String(judgesMap.size + 1).padStart(2, '0');
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

        judge.assigned_programmes.push({
          date: dateVal,
          code: codeVal,
          name: progVal,
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

      currentJudge.assigned_programmes.push({
        date: pDate,
        code: pCode,
        name: pName,
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
  parseJudgeRosterFromPdf
};

