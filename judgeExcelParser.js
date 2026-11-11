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
 */
function parseJudgeRosterFromExcel(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (!rawData || rawData.length === 0) {
    throw new Error('The uploaded roster sheet is empty.');
  }

  // 1. Locate header row
  let headerRowIdx = -1;
  let colMap = {
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

  for (let r = 0; r < Math.min(rawData.length, 15); r++) {
    const row = rawData[r].map(c => normalizeHeader(c));
    let hasName = false;
    let hasCodeOrTeam = false;

    row.forEach((cell, cIdx) => {
      if (cell.includes('judgename') || cell === 'name' || cell.includes('judge')) {
        colMap.name = cIdx;
        hasName = true;
      } else if (cell === 'no' || cell === 'sl' || cell === 'slno' || cell === 'srno') {
        colMap.no = cIdx;
      } else if (cell.includes('block') || cell.includes('team')) {
        colMap.team = cIdx;
        hasCodeOrTeam = true;
      } else if (cell === 'date' || cell.includes('date')) {
        colMap.date = cIdx;
      } else if (cell === 'code' || cell.includes('progcode') || cell.includes('programcode')) {
        colMap.code = cIdx;
        hasCodeOrTeam = true;
      } else if (cell.includes('prog') || cell.includes('programmename')) {
        colMap.progName = cIdx;
      } else if (cell.includes('venue')) {
        colMap.venue = cIdx;
      } else if (cell.includes('judgingtime') || cell.includes('time')) {
        colMap.time = cIdx;
      } else if (cell.includes('totalhours') || cell.includes('hours') || cell.includes('duration')) {
        colMap.hours = cIdx;
      }
    });

    if (hasName && (hasCodeOrTeam || colMap.no !== -1)) {
      headerRowIdx = r;
      break;
    }
  }

  // Fallback defaults if header row not explicitly identified
  if (headerRowIdx === -1) {
    headerRowIdx = 0;
    colMap = {
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
  }

  // Override with manual options if provided
  if (options.manualMapping) {
    colMap = { ...colMap, ...options.manualMapping };
  }

  // 2. Iterate rows and extract judges and programme assignments
  const judgesMap = new Map(); // judge_no -> Judge Record
  let currentJudge = null;

  for (let r = headerRowIdx + 1; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row || row.every(cell => String(cell).trim() === '')) continue;

    const noVal = colMap.no !== -1 ? String(row[colMap.no] || '').trim() : '';
    const nameVal = colMap.name !== -1 ? String(row[colMap.name] || '').trim() : '';
    const teamVal = colMap.team !== -1 ? String(row[colMap.team] || '').trim() : '';
    const dateVal = colMap.date !== -1 ? String(row[colMap.date] || '').trim() : '';
    const codeVal = colMap.code !== -1 ? String(row[colMap.code] || '').trim().toUpperCase() : '';
    const progVal = colMap.progName !== -1 ? String(row[colMap.progName] || '').trim() : '';
    const venueVal = colMap.venue !== -1 ? String(row[colMap.venue] || '').trim() : '';
    const timeVal = colMap.time !== -1 ? String(row[colMap.time] || '').trim() : '';
    const hoursVal = colMap.hours !== -1 ? String(row[colMap.hours] || '').trim() : '';

    // Check if new judge entry starts
    if (noVal || nameVal) {
      const judgeNo = noVal || (currentJudge ? String(judgesMap.size + 1).padStart(2, '0') : '01');
      const cleanNo = judgeNo.replace(/[^0-9]/g, '').padStart(2, '0');

      if (!judgesMap.has(cleanNo)) {
        currentJudge = {
          judge_no: cleanNo,
          judge_name: nameVal || (currentJudge ? currentJudge.judge_name : 'Judge ' + cleanNo),
          teams_blocks: teamVal || (currentJudge ? currentJudge.teams_blocks : ''),
          total_hours: hoursVal || '',
          assigned_programmes: [],
          assigned_codes: []
        };
        judgesMap.set(cleanNo, currentJudge);
      } else {
        currentJudge = judgesMap.get(cleanNo);
        if (nameVal && !currentJudge.judge_name) currentJudge.judge_name = nameVal;
        if (teamVal && !currentJudge.teams_blocks) currentJudge.teams_blocks = teamVal;
        if (hoursVal && !currentJudge.total_hours) currentJudge.total_hours = hoursVal;
      }
    }

    if (currentJudge) {
      if (hoursVal && !currentJudge.total_hours) currentJudge.total_hours = hoursVal;
      if (teamVal && !currentJudge.teams_blocks) currentJudge.teams_blocks = teamVal;

      if (codeVal) {
        // Parse time slot e.g. "09:00 AM - 09:53 AM"
        let fromTime = '';
        let toTime = '';
        if (timeVal.includes('-')) {
          const parts = timeVal.split('-').map(p => p.trim());
          fromTime = parts[0] || '';
          toTime = parts[1] || '';
        } else {
          fromTime = timeVal;
        }

        currentJudge.assigned_programmes.push({
          date: dateVal,
          code: codeVal,
          name: progVal,
          venue: venueVal,
          from_time: fromTime,
          to_time: toTime,
          raw_time: timeVal
        });

        if (!currentJudge.assigned_codes.includes(codeVal)) {
          currentJudge.assigned_codes.push(codeVal);
        }
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
    detectedHeaders: colMap,
    sampleRows: rawData.slice(headerRowIdx, headerRowIdx + 6)
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

