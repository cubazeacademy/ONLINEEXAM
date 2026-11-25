require('../polyfillDom');
const fs = require('fs');
const path = require('path');
const { parseJudgeRoster } = require('../judgeExcelParser');
const { buildJudgeDossier } = require('../scheduleMatcher');
const { generateJudgeGuidelinePdf } = require('../judgePdfEngine');

async function run() {
  console.log('--- 1. Testing Excel Parser with new format ---');
  const xlsxPath = path.join(__dirname, '..', 'public', 'samples', 'judge_roster_sample.xlsx');
  const xlsxBuf = fs.readFileSync(xlsxPath);
  const result = await parseJudgeRoster(xlsxBuf, 'judge_roster_sample.xlsx');

  console.log(`Parsed ${result.totalJudges} judges successfully.`);
  if (result.totalJudges !== 3) {
    throw new Error(`Expected 3 judges, got ${result.totalJudges}`);
  }

  const j1 = result.judges[0];
  console.log(`\nJudge 1: ${j1.judge_no} - ${j1.judge_name}`);
  console.log(`Total Hours: ${j1.total_hours}`);
  console.log(`Teams/Blocks: ${j1.teams_blocks}`);
  console.log(`Assigned programmes count: ${j1.assigned_programmes.length}`);

  // Check Abdurrahman Kunnath programmes
  const expectedCodes = ['BNS25', 'TWS12', 'UNS30', 'TWS12', 'TWS12', 'TNS22', 'KS1B'];
  const actualCodes = j1.assigned_programmes.map(p => p.code);
  console.log('Codes:', actualCodes.join(', '));
  if (JSON.stringify(actualCodes) !== JSON.stringify(expectedCodes)) {
    throw new Error(`Programme codes mismatch for Judge 1: ${actualCodes}`);
  }

  // Check concepts and pools
  const poolAProg = j1.assigned_programmes.find(p => p.pool === 'POOL A');
  if (!poolAProg || poolAProg.concept_type !== 'GENERAL') {
    throw new Error(`Expected POOL A to be GENERAL, got ${poolAProg?.concept_type}`);
  }

  const niicsProg = j1.assigned_programmes.find(p => p.pool === 'NIICS');
  if (!niicsProg || niicsProg.concept_type !== 'NIICS') {
    throw new Error(`Expected NIICS to be NIICS, got ${niicsProg?.concept_type}`);
  }

  // Check Banath on Judge 2
  const j2 = result.judges[1];
  console.log(`\nJudge 2: ${j2.judge_no} - ${j2.judge_name}`);
  const banathProg = j2.assigned_programmes.find(p => p.pool === 'BANATH');
  if (!banathProg || banathProg.concept_type !== 'BANATH') {
    throw new Error(`Expected BANATH to be BANATH, got ${banathProg?.concept_type}`);
  }
  console.log('BANATH concept verified on Judge 2.');

  console.log('\n--- 2. Testing Dossier Building ---');
  const dummyCnMap = {
    'BNS25': { code: 'BNS25', name: 'NASHID ARB', paragraphs: ['Arabic Nashid guidelines.'] },
    'TWS12': { code: 'TWS12', name: 'NASHID ARB', paragraphs: ['Thanawiyyah Nashid guidelines.'] },
    'KS1B': { code: 'KS1B', name: 'HADHRA', paragraphs: ['Hadhra group guidelines.'] }
  };
  const dummySchedMap = {};

  const dossier = buildJudgeDossier(j1, dummyCnMap, dummySchedMap);
  console.log(`Dossier built with ${dossier.items.length} items.`);
  console.log('First dossier item:', {
    code: dossier.items[0].code,
    name: dossier.items[0].name,
    category: dossier.items[0].category,
    pool: dossier.items[0].pool,
    concept_type: dossier.items[0].concept_type,
    time: dossier.items[0].time,
    venue: dossier.items[0].venue
  });

  console.log('\n--- 3. Testing PDF Generation ---');
  const pdfBuffer = await generateJudgeGuidelinePdf(dossier);
  console.log(`Generated PDF buffer size: ${pdfBuffer.length} bytes.`);
  if (pdfBuffer.length < 5000) {
    throw new Error('PDF output seems suspiciously small!');
  }

  const testPdfOut = path.join(__dirname, 'test_output_judge.pdf');
  fs.writeFileSync(testPdfOut, pdfBuffer);
  console.log(`Saved test PDF to: ${testPdfOut}`);

  console.log('\n--- 4. Testing CSV Parsing ---');
  const csvPath = path.join(__dirname, '..', 'public', 'samples', 'judge_roster_sample.csv');
  const csvBuf = fs.readFileSync(csvPath);
  const csvResult = await parseJudgeRoster(csvBuf, 'judge_roster_sample.csv');
  console.log(`CSV parsed ${csvResult.totalJudges} judges successfully.`);
  if (csvResult.totalJudges !== 3) {
    throw new Error(`Expected 3 judges from CSV, got ${csvResult.totalJudges}`);
  }

  console.log('\nALL TESTS PASSED SUCCESSFULLY! Everything is working cleanly.');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
