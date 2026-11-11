const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');
const { normalizeCode } = require('./conceptNoteParser');

/**
 * Converts a time string '09:00 AM' or '09:00' to minutes from midnight
 */
function timeToMinutes(str) {
  if (!str) return -1;
  const match = String(str).trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return -1;

  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = match[3] ? match[3].toUpperCase() : null;

  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;

  return h * 60 + m;
}

/**
 * Parses a Day-based schedule from Excel or PDF
 */
async function parseSchedule(buffer, fileName = '') {
  const isPdf = (fileName || '').toLowerCase().endsWith('.pdf') || (buffer[0] === 0x25 && buffer[1] === 0x50);

  if (isPdf) {
    return await parseScheduleFromPdf(buffer);
  } else {
    return parseScheduleFromExcel(buffer);
  }
}

/**
 * Parses schedule from Excel workbook
 */
function parseScheduleFromExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  const programmes = [];
  let currentDate = '';

  for (let r = 0; r < rawData.length; r++) {
    const row = rawData[r];
    const rowStr = row.join(' ');

    // Check if row contains a date
    const dateMatch = rowStr.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
    if (dateMatch && row.filter(c => String(c).trim()).length <= 3) {
      currentDate = dateMatch[1];
      continue;
    }

    // Try finding code, from, to, venue
    let code = '';
    let fromTime = '';
    let toTime = '';
    let progName = '';
    let category = '';
    let venue = '';

    for (let c = 0; c < row.length; c++) {
      const val = String(row[c]).trim();
      if (!code && /^[A-Z]{2,4}\d{1,3}[A-Z]?$/i.test(val)) {
        code = normalizeCode(val);
      } else if (!fromTime && /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(val)) {
        fromTime = val;
      } else if (fromTime && !toTime && /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(val)) {
        toTime = val;
      } else if (!venue && /Venue\s*\d+/i.test(val)) {
        venue = val;
      } else if (val && !code && !fromTime && !venue) {
        if (!progName) progName = val;
        else if (!category) category = val;
      }
    }

    if (code) {
      programmes.push({
        code: code,
        name: progName,
        category: category,
        programme_date: currentDate || 'General',
        from_time: fromTime,
        to_time: toTime,
        venue: venue || 'Venue 1'
      });
    }
  }

  const entriesByCode = {};
  programmes.forEach(p => {
    if (p.code) entriesByCode[p.code] = p;
  });

  return {
    success: true,
    programmes: programmes,
    entries: programmes,
    totalProgrammes: programmes.length,
    totalEntries: programmes.length,
    entriesByCode: entriesByCode
  };
}

/**
 * Parses schedule from PDF
 */
async function parseScheduleFromPdf(buffer) {
  const parser = new PDFParse(new Uint8Array(buffer));
  await parser.load();
  const pdfRes = await parser.getText();

  const programmes = [];

  for (let p = 0; p < pdfRes.pages.length; p++) {
    const pageText = pdfRes.pages[p].text;
    const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);

    let pageDate = '';
    const dateMatch = pageText.match(/(?:Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday)?,?\s*(\d{1,2})?,?\s*(November|December|January|February|March|April|May|June|July|August|September|October)\s*(\d{1,2})?,?\s*(\d{4})/i);
    if (dateMatch) {
      const day = dateMatch[1] || dateMatch[3] || '14';
      const month = dateMatch[2];
      const year = dateMatch[4];
      pageDate = `${day} ${month} ${year}`;
    }

    // RegEx for programme lines e.g.:
    // "09:00 AM 10:30 AM TS13 TALENT HUNT THANIYAH Venue 1"
    // "10:05 AM 10:49 AM BS3 ADHAN BIDAYAH Venue 4"
    const rowRegex = /^(\d{1,2}:\d{2}\s*(?:AM|PM))(?:\s+(\d{1,2}:\d{2}\s*(?:AM|PM)))?\s+([A-Z]{2,4}\d{1,3}[A-Z]?)\s+(.+?)\s+([A-Za-z\s]+?)\s+(Venue\s*\d+(?:\s*Non)?)$/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(rowRegex);
      if (match) {
        programmes.push({
          code: normalizeCode(match[3]),
          name: match[4].trim(),
          category: match[5].trim(),
          programme_date: pageDate || '14 November 2026',
          from_time: match[1],
          to_time: match[2] || '',
          venue: match[6].trim()
        });
      }
    }
  }

  const entriesByCode = {};
  programmes.forEach(p => {
    if (p.code) entriesByCode[p.code] = p;
  });

  return {
    success: true,
    programmes: programmes,
    entries: programmes,
    totalProgrammes: programmes.length,
    totalEntries: programmes.length,
    entriesByCode: entriesByCode
  };
}

/**
 * Calculates Levenshtein similarity distance between two codes
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[m][n];
}

/**
 * Cross-validates Judges, Concept Notes, and Schedule
 */
function crossValidateAll(judges = [], conceptNotes = [], scheduleList = []) {
  const cnByCode = new Map();
  conceptNotes.forEach(cn => {
    cnByCode.set(normalizeCode(cn.code), cn);
  });

  const schedByCode = new Map();
  scheduleList.forEach(s => {
    schedByCode.set(normalizeCode(s.code), s);
  });

  const allCnCodes = Array.from(cnByCode.keys());
  const allSchedCodes = Array.from(schedByCode.keys());

  const missingFromCn = new Set();
  const missingFromSched = new Set();
  const typoSuggestions = [];
  const warnings = [];

  let matchedCount = 0;

  // Check judge codes
  judges.forEach(j => {
    const assigned = j.assigned_codes || (Array.isArray(j.assigned_programmes) ? j.assigned_programmes.map(p => p.code) : []);
    if (assigned.length === 0) {
      warnings.push({
        type: 'NO_PROGRAMMES',
        judge_no: j.judge_no,
        judge_name: j.judge_name,
        message: `Judge #${j.judge_no} (${j.judge_name}) has no assigned programme codes.`
      });
    }

    assigned.forEach(c => {
      const code = normalizeCode(c);

      // Check Concept Notes
      if (!cnByCode.has(code)) {
        missingFromCn.add(code);
        // Look for typo fix suggestion
        for (const validCode of allCnCodes) {
          const dist = levenshtein(code, validCode);
          if (dist === 1 || (dist === 2 && code.length >= 4)) {
            typoSuggestions.push({
              source: 'judge',
              judge_no: j.judge_no,
              originalCode: code,
              suggestedCode: validCode,
              reason: `Found in Concept Notes as "${validCode}"`
            });
            break;
          }
        }
      } else {
        matchedCount++;
      }

      // Check Schedule
      if (!schedByCode.has(code) && scheduleList.length > 0) {
        missingFromSched.add(code);
        for (const validCode of allSchedCodes) {
          const dist = levenshtein(code, validCode);
          if (dist === 1) {
            typoSuggestions.push({
              source: 'schedule',
              judge_no: j.judge_no,
              originalCode: code,
              suggestedCode: validCode,
              reason: `Found in Schedule as "${validCode}"`
            });
            break;
          }
        }
      }
    });
  });

  // Time overlap conflict detection
  judges.forEach(j => {
    const progs = j.assigned_programmes || [];
    // Compare each pair
    for (let i = 0; i < progs.length; i++) {
      for (let k = i + 1; k < progs.length; k++) {
        const p1 = progs[i];
        const p2 = progs[k];
        if (p1.date && p2.date && p1.date === p2.date) {
          const m1From = timeToMinutes(p1.from_time);
          const m1To = timeToMinutes(p1.to_time);
          const m2From = timeToMinutes(p2.from_time);
          const m2To = timeToMinutes(p2.to_time);

          if (m1From !== -1 && m1To !== -1 && m2From !== -1 && m2To !== -1) {
            // Overlap condition
            if (m1From < m2To && m2From < m1To) {
              warnings.push({
                type: 'JUDGE_TIME_OVERLAP',
                judge_no: j.judge_no,
                judge_name: j.judge_name,
                message: `Schedule conflict on ${p1.date}: [${p1.code}] (${p1.from_time}-${p1.to_time}) overlaps with [${p2.code}] (${p2.from_time}-${p2.to_time}).`
              });
            }
          }
        }
      }
    }
  });

  return {
    matchedCount: matchedCount,
    missingFromConceptNotes: Array.from(missingFromCn),
    missingFromSchedule: Array.from(missingFromSched),
    typoSuggestions: typoSuggestions,
    typos: typoSuggestions,
    warnings: warnings,
    conflicts: warnings,
    hasBlockingErrors: missingFromCn.size > 0
  };
}

/**
 * Helper to get an item from either a Map or a plain Object
 */
function getItem(mapOrObj, key) {
  if (!mapOrObj || !key) return null;
  if (typeof mapOrObj.get === 'function') {
    return mapOrObj.get(key) || null;
  }
  return mapOrObj[key] || null;
}

/**
 * Builds the complete schedule and concept note dossier for a single judge
 * Chronologically sorted by Date -> Starting Time
 */
function buildJudgeDossier(judge, conceptNotesInput, scheduleInput) {
  const assigned = judge.assigned_programmes || [];
  const dossierItems = [];

  for (const prog of assigned) {
    const code = normalizeCode(prog.code);
    const cn = getItem(conceptNotesInput, code) || {
      code: code,
      name: prog.name || 'Programme ' + code,
      paragraphs: ['Programme guidelines will be clarified by the controllers.'],
      extraLines: [],
      meta: {
        category: 'S (Stage programmes held at pool level)',
        time: '5 minutes',
        skill: 'Presentation',
        candidates: '1'
      }
    };

    const sched = getItem(scheduleInput, code) || {};

    const rawTime = prog.time || (prog.from_time && prog.to_time ? `${prog.from_time} - ${prog.to_time}` : (sched.from_time && sched.to_time ? `${sched.from_time} - ${sched.to_time}` : ''));

    dossierItems.push({
      code: code,
      name: prog.name || cn.name || '',
      concept_note: cn,
      conceptNote: cn,
      date: prog.date || sched.programme_date || sched.date || '14/11/2026',
      time: rawTime,
      from: prog.from_time || sched.from_time || '',
      to: prog.to_time || sched.to_time || '',
      venue: prog.venue || sched.venue || 'Venue 1',
      category: prog.category || sched.category || (cn.meta && cn.meta.category) || 'General',
      startMinutes: timeToMinutes(prog.from_time || sched.from_time || rawTime.split('-')[0])
    });
  }

  // Sort chronologically: Date ascending, then startMinutes ascending
  dossierItems.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    return a.startMinutes - b.startMinutes;
  });

  return {
    judge: judge,
    items: dossierItems,
    totalItems: dossierItems.length
  };
}

module.exports = {
  parseSchedule,
  parseScheduleFromExcel,
  parseScheduleFromPdf,
  crossValidateAll,
  buildJudgeDossier,
  timeToMinutes
};
