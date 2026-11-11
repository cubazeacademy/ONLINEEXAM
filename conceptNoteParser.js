require('./polyfillDom');
const { PDFParse } = require('pdf-parse');

/**
 * Standardizes Arabic/English programme codes for reliable matching
 * e.g. "BS04" -> "BS4", "U045" -> "UO45", uppercase, trim
 */
function normalizeCode(rawCode) {
  if (!rawCode) return '';
  let clean = String(rawCode).trim().toUpperCase().replace(/\./g, '');
  // Normalize leading zeros in number portion: BS04 -> BS4
  clean = clean.replace(/^([A-Z]+)0+(\d+)$/, '$1$2');
  return clean;
}

/**
 * Checks if a string contains Arabic/Urdu script Unicode characters
 */
function containsArabic(str) {
  if (!str) return false;
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(str);
}

/**
 * Parses Concept Note from a PDF buffer or raw text
 * @param {Buffer|string} input - PDF buffer or raw text string
 */
async function parseConceptNotes(input) {
  let fullText = '';

  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const parser = new PDFParse(new Uint8Array(input));
    await parser.load();
    const pdfRes = await parser.getText();
    // Join page texts with a page separator marker
    fullText = pdfRes.pages.map(p => p.text).join('\n---PAGE_BREAK---\n');
  } else {
    fullText = String(input);
  }

  const rawLines = fullText.split('\n');
  const cleanedLines = [];

  // Filter out running page headers, TOC dots, and division banner lines
  const divisionHeaders = [
    'BIDĀYAH', 'ʾŪLĀ', 'BIDAYAH', 'ULA', 'THĀNIYAH', 'THANIYAH',
    'THĀNAWIYYAH', 'THANAWIYYAH', 'ʿĀLIYAH', 'ALIYAH', '’ĀLIYAH',
    'KULLIYYAH (SENIOR)', 'KULLIYYAH (JUNIOR)', 'KULLIYYAH SENIOR', 'KULLIYYAH JUNIOR'
  ];

  let inToc = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    // Check for TOC start/end
    if (line.includes('TABLE OF CONTENTS')) {
      inToc = true;
      continue;
    }

    // Skip TOC lines with dotted page references
    if (inToc) {
      if (line.includes('....') || line.includes('...')) continue;
      // When we hit the first body division heading on page 1, TOC has ended
      if (divisionHeaders.includes(line.toUpperCase()) || line.match(/^[A-Z]{2,4}\d{1,3}\b/)) {
        inToc = false;
      } else {
        continue;
      }
    }

    // Filter running header
    if (line.includes('DARUL HUDA SIBĀQ') || line.includes('CONCEPT NOTE')) {
      continue;
    }

    // Filter standalone Roman numerals or page numbers
    if (/^(I|II|III|IV|V|VI|VII|VIII|IX|X|\d{1,3})$/i.test(line)) {
      continue;
    }

    // Filter division banners
    if (divisionHeaders.includes(line.toUpperCase())) {
      continue;
    }

    if (line === '---PAGE_BREAK---') {
      cleanedLines.push('---PAGE_BREAK---');
      continue;
    }

    cleanedLines.push(line);
  }

  // Regex pattern for programme entry heading: e.g. "BS1 QIRĀʾAH", "US2 ḤIFẒ", "TS13 TALENT HUNT", "UO45 MEMORY TEST"
  const entryHeaderRegex = /^([A-Z]{2,4}\d{1,3}[A-Z]?)\.?\s+(.+)$/;

  const entries = [];
  let currentEntry = null;
  let currentBuffer = [];

  function finalizeEntry(entry, lines) {
    if (!entry) return;

    let descriptionParagraphs = [];
    let currentPara = '';
    let portionText = '';
    let category = '';
    let timeAllowed = '';
    let skill = '';
    let candidates = '';
    let extraLines = [];

    for (let j = 0; j < lines.length; j++) {
      let l = lines[j];
      if (l === '---PAGE_BREAK---') continue;

      // Extract metadata lines
      if (/^Category\s*:\s*(.+)$/i.test(l)) {
        category = l.replace(/^Category\s*:\s*/i, '').trim();
      } else if (/^Time\s*:\s*(.+)$/i.test(l)) {
        timeAllowed = l.replace(/^Time\s*:\s*/i, '').trim();
      } else if (/^Skill\s*:\s*(.+)$/i.test(l)) {
        skill = l.replace(/^Skill\s*:\s*/i, '').trim();
      } else if (/^No\.\s*of\s*Candidates?\s*:\s*(.+)$/i.test(l)) {
        candidates = l.replace(/^No\.\s*of\s*Candidates?\s*:\s*/i, '').trim();
      } else if (/^(Portion|Ḥifẓ portion|Hifz portion)\s*:\s*(.+)$/i.test(l)) {
        portionText = l.replace(/^(Portion|Ḥifẓ portion|Hifz portion)\s*:\s*/i, '').trim();
      } else if (/^(Tools?|Personalities|Expected areas?)\s*:\s*(.+)$/i.test(l)) {
        extraLines.push(l);
      } else {
        // Description paragraph text
        // Handle page splits: join with space
        if (currentPara) {
          if (currentPara.endsWith('-')) {
            currentPara = currentPara.slice(0, -1) + l;
          } else {
            currentPara += ' ' + l;
          }
        } else {
          currentPara = l;
        }

        // If next line is a metadata line or end of lines, flush paragraph
        const nextLine = lines[j + 1] || '';
        if (
          !nextLine ||
          /^Category\s*:/i.test(nextLine) ||
          /^Time\s*:/i.test(nextLine) ||
          /^Skill\s*:/i.test(nextLine) ||
          /^No\.\s*of\s*Candidates?/i.test(nextLine) ||
          /^(Portion|Ḥifẓ portion|Hifz portion)\s*:/i.test(nextLine) ||
          /^(Tools?|Personalities|Expected areas?)\s*:/i.test(nextLine)
        ) {
          if (currentPara.trim()) {
            descriptionParagraphs.push(currentPara.trim());
            currentPara = '';
          }
        }
      }
    }

    if (currentPara.trim()) {
      descriptionParagraphs.push(currentPara.trim());
    }

    const fullDescription = descriptionParagraphs.join('\n\n');
    const hasArabicText = containsArabic(entry.name) || containsArabic(fullDescription) || containsArabic(portionText);

    entries.push({
      code: normalizeCode(entry.code),
      name: entry.name.trim(),
      description: fullDescription,
      portion_text: portionText,
      category: category,
      time_allowed: timeAllowed,
      skill: skill,
      candidates: candidates,
      extra_lines: extraLines,
      has_arabic: hasArabicText,
      arabic_verified: false,
      raw_text: lines.filter(x => x !== '---PAGE_BREAK---').join('\n')
    });
  }

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i];
    if (line === '---PAGE_BREAK---') {
      if (currentEntry) currentBuffer.push(line);
      continue;
    }

    const match = line.match(entryHeaderRegex);
    // Ensure that match[1] looks like a valid programme code (e.g. BS1, US12, TS3, TN17, KJS1, etc.)
    const isCodeHeading = match && /^[A-Z]{2,4}\d{1,3}[A-Z]?$/.test(match[1]);

    if (isCodeHeading) {
      if (currentEntry) {
        finalizeEntry(currentEntry, currentBuffer);
      }
      currentEntry = {
        code: match[1],
        name: match[2]
      };
      currentBuffer = [];
    } else {
      if (currentEntry) {
        currentBuffer.push(line);
      }
    }
  }

  if (currentEntry) {
    finalizeEntry(currentEntry, currentBuffer);
  }

  // Deduplicate and index by code
  const entriesByCode = {};
  entries.forEach(e => {
    entriesByCode[e.code] = e;
  });

  return {
    success: true,
    totalEntries: entries.length,
    entries: entries,
    entriesByCode: entriesByCode,
    arabicEntriesCount: entries.filter(e => e.has_arabic).length
  };
}

module.exports = {
  parseConceptNotes,
  normalizeCode,
  containsArabic
};

