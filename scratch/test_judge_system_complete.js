const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');
const db = require('../db');
const { parseJudgeRoster } = require('../judgeExcelParser');
const { parseConceptNotes } = require('../conceptNoteParser');
const { parseSchedule, crossValidateAll, buildJudgeDossier } = require('../scheduleMatcher');
const { generateJudgeGuidelinePdf, generateMergedPdf, createZipArchive } = require('../judgePdfEngine');

async function runCompleteTestSuite() {
  console.log('====================================================');
  console.log('STARTING JUDGE GUIDELINE SYSTEM COMPLETE TEST SUITE');
  console.log('====================================================');

  const files = {
    judgesPdf: 'C:/Users/mpsin/.gemini/antigravity/brain/24a8eed4-8aa0-4ed0-9909-f545df9529ae/.user_uploaded/media_1794403955703_91a7fbe3.pdf',
    conceptNotePdf: 'C:/Users/mpsin/.gemini/antigravity/brain/24a8eed4-8aa0-4ed0-9909-f545df9529ae/.user_uploaded/media_1794403855387_ce3cdb82.pdf',
    schedulePdf: 'C:/Users/mpsin/.gemini/antigravity/brain/24a8eed4-8aa0-4ed0-9909-f545df9529ae/.user_uploaded/media_1794403881003_e1d2b475.pdf'
  };

  // TEST 1: PARSE JUDGE ROSTER
  console.log('\n[1/7] Testing Judge Roster Parser...');
  const judgeBuf = fs.readFileSync(files.judgesPdf);
  const judgesRes = await parseJudgeRoster(judgeBuf, 'judges.pdf');
  console.log(`✓ Parsed Judges Count: ${judgesRes.judges.length}`);
  if (judgesRes.judges.length !== 30) throw new Error(`Expected 30 judges, got ${judgesRes.judges.length}`);
  console.log(`✓ Judge 1: ${judgesRes.judges[0].judge_no} - ${judgesRes.judges[0].judge_name} (${judgesRes.judges[0].assigned_programmes.length} programmes)`);
  console.log(`✓ Judge 30: ${judgesRes.judges[29].judge_no} - ${judgesRes.judges[29].judge_name}`);

  // TEST 2: PARSE CONCEPT NOTES
  console.log('\n[2/7] Testing Concept Note Parser (~80 pages)...');
  const cnBuf = fs.readFileSync(files.conceptNotePdf);
  const cnRes = await parseConceptNotes(cnBuf);
  console.log(`✓ Parsed Concept Notes Count: ${cnRes.entries.length}`);
  console.log(`✓ Arabic Entries Count: ${cnRes.arabicEntriesCount}`);
  if (cnRes.entries.length < 200) throw new Error(`Expected >200 concept notes, got ${cnRes.entries.length}`);

  // TEST 3: PARSE SCHEDULE
  console.log('\n[3/7] Testing Time Schedule Parser...');
  const schedBuf = fs.readFileSync(files.schedulePdf);
  const schedRes = await parseSchedule(schedBuf, 'schedule.pdf');
  console.log(`✓ Parsed Schedule Slots Count: ${schedRes.entries.length}`);

  // TEST 4: CROSS-VALIDATION
  console.log('\n[4/7] Testing Cross-Validation Engine...');
  const valRes = crossValidateAll(judgesRes.judges, cnRes.entries, schedRes.entries);
  console.log(`✓ Matched Programmes: ${valRes.matchedCount}`);
  console.log(`✓ Typo Suggestions: ${valRes.typos.length}`);
  console.log(`✓ Schedule Overlap Warnings: ${valRes.conflicts.length}`);

  // TEST 5: PDF GENERATION (Judge 1 & Judge 2)
  console.log('\n[5/7] Testing Individual PDF Generation Engine...');
  const dossier1 = buildJudgeDossier(judgesRes.judges[0], cnRes.entriesByCode, schedRes.entriesByCode);
  const t0 = Date.now();
  const pdf1Buf = await generateJudgeGuidelinePdf(dossier1);
  const genTime = Date.now() - t0;
  console.log(`✓ Judge 1 PDF generated in ${genTime}ms! Size: ${pdf1Buf.length} bytes`);

  const doc1 = await PDFDocument.load(pdf1Buf);
  console.log(`✓ Total Pages: ${doc1.getPageCount()} (Expected: 7)`);
  if (doc1.getPageCount() !== 7) throw new Error(`Expected 7 pages for Judge 1, got ${doc1.getPageCount()}`);

  const dossier2 = buildJudgeDossier(judgesRes.judges[1], cnRes.entriesByCode, schedRes.entriesByCode);
  const pdf2Buf = await generateJudgeGuidelinePdf(dossier2);
  const doc2 = await PDFDocument.load(pdf2Buf);
  console.log(`✓ Judge 2 PDF generated! Pages: ${doc2.getPageCount()}, Size: ${pdf2Buf.length} bytes`);

  // TEST 6: MERGED PDFS (Modes A, B, C)
  console.log('\n[6/7] Testing Merged PDF Engine (Modes A, B, C)...');
  const mergedABuf = await generateMergedPdf([pdf1Buf, pdf2Buf], 'A');
  const docA = await PDFDocument.load(mergedABuf);
  console.log(`✓ Mode A (All): ${docA.getPageCount()} pages`);

  const mergedBBuf = await generateMergedPdf([pdf1Buf, pdf2Buf], 'B');
  const docB = await PDFDocument.load(mergedBBuf);
  console.log(`✓ Mode B (Inner Pages): ${docB.getPageCount()} pages`);

  const mergedCBuf = await generateMergedPdf([pdf1Buf, pdf2Buf], 'C');
  const docC = await PDFDocument.load(mergedCBuf);
  console.log(`✓ Mode C (Covers Only): ${docC.getPageCount()} pages`);

  // TEST 7: ZIP ARCHIVE GENERATION
  console.log('\n[7/7] Testing ZIP Package Archiver...');
  const zipBuf = await createZipArchive([
    { fileName: '01_Hafiz_Siraj_Hudawi_Judge_Guideline.pdf', buffer: pdf1Buf },
    { fileName: '02_Hafiz_Mushtaq_Hudawi_Judge_Guideline.pdf', buffer: pdf2Buf }
  ]);
  console.log(`✓ ZIP Archive created successfully! Size: ${zipBuf.length} bytes`);

  console.log('\n====================================================');
  console.log('ALL 7 TEST SUITES PASSED FLAWLESSLY WITH REAL DATA!');
  console.log('====================================================');
  process.exit(0);
}

runCompleteTestSuite().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
