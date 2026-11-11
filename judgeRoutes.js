/**
 * Judge Guideline PDF Generator - Express API Routes
 * Prefixed tables: jg_projects, jg_judges, jg_concept_notes, jg_schedule, jg_templates, jg_generated_pdfs
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('./db');

// In-memory cache for fast PDF serving (Vercel-friendly, 0ms disk dependency)
const pdfBufferCache = new Map();

// Helper to get parsers and engines cleanly
function getExcelParser() {
  return require('./judgeExcelParser');
}
function getConceptNoteParser() {
  return require('./conceptNoteParser');
}
function getScheduleMatcher() {
  return require('./scheduleMatcher');
}
function getPdfEngine() {
  return require('./judgePdfEngine');
}

/**
 * 1. GET /api/judge-guidelines/projects
 * List all projects with stats
 */
router.get('/projects', async (req, res) => {
  try {
    const projects = await db.all(`
      SELECT p.*,
        (SELECT COUNT(*) FROM jg_judges j WHERE j.project_id = p.id) as judges_count,
        (SELECT COUNT(*) FROM jg_concept_notes cn WHERE cn.project_id = p.id) as concept_notes_count,
        (SELECT COUNT(*) FROM jg_schedule s WHERE s.project_id = p.id) as schedule_count,
        (SELECT COUNT(*) FROM jg_generated_pdfs gp WHERE gp.project_id = p.id) as generated_count
      FROM jg_projects p
      ORDER BY p.id DESC
    `);
    res.json({ success: true, projects });
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: 'Failed to fetch projects: ' + err.message });
  }
});

/**
 * 2. POST /api/judge-guidelines/projects
 * Create a new project
 */
router.post('/projects', async (req, res) => {
  try {
    const { name, description, academic_year } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required.' });
    }

    const newProject = await db.get(`
      INSERT INTO jg_projects (name, description, academic_year, status)
      VALUES ($1, $2, $3, 'draft')
      RETURNING *
    `, [name.trim(), description || '', academic_year || '2026']);

    // Initialize default template for project
    const defaultRules = getPdfEngine().DEFAULT_RULES;
    await db.query(`
      INSERT INTO jg_templates (project_id, name, general_rules, settings)
      VALUES ($1, 'Default SIBAQ Template', $2, $3)
    `, [newProject.id, JSON.stringify(defaultRules), JSON.stringify({ accent_color: '#d97706', event_title: 'SIBAQ 2026' })]);

    res.json({ success: true, project: newProject });
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ error: 'Failed to create project: ' + err.message });
  }
});

/**
 * 3. GET /api/judge-guidelines/projects/:id
 * Get single project with associated data counts
 */
router.get('/projects/:id', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const project = await db.get('SELECT * FROM jg_projects WHERE id = $1', [projectId]);
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    const judges = await db.all('SELECT * FROM jg_judges WHERE project_id = $1 ORDER BY id ASC', [projectId]);
    const conceptNotes = await db.all('SELECT * FROM jg_concept_notes WHERE project_id = $1 ORDER BY code ASC', [projectId]);
    const schedule = await db.all('SELECT * FROM jg_schedule WHERE project_id = $1 ORDER BY id ASC', [projectId]);
    const template = await db.get('SELECT * FROM jg_templates WHERE project_id = $1 LIMIT 1', [projectId]);

    res.json({
      success: true,
      project,
      judges,
      concept_notes_count: conceptNotes.length,
      schedule_count: schedule.length,
      template: template || { general_rules: getPdfEngine().DEFAULT_RULES }
    });
  } catch (err) {
    console.error('Error fetching project details:', err);
    res.status(500).json({ error: 'Failed to fetch project details: ' + err.message });
  }
});

/**
 * 4. POST /api/judge-guidelines/upload-judges
 * Upload Excel/PDF roster of judges
 */
router.post('/upload-judges', async (req, res) => {
  try {
    const { project_id, file_data, file_name, column_mappings } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required.' });
    if (!file_data) return res.status(400).json({ error: 'file_data (base64) is required.' });

    const buffer = Buffer.from(file_data, 'base64');
    const parser = getExcelParser();
    const result = await parser.parseJudgeRoster(buffer, file_name, column_mappings || {});

    if (!result.success || !result.judges || result.judges.length === 0) {
      return res.status(400).json({ error: 'Could not detect any judges in the uploaded file.' });
    }

    // Clear previous judges for this project
    await db.query('DELETE FROM jg_judges WHERE project_id = $1', [project_id]);

    // Insert new judges
    for (const j of result.judges) {
      await db.query(`
        INSERT INTO jg_judges (project_id, judge_no, judge_name, teams, total_hours, assigned_programmes, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        project_id,
        j.judge_no,
        j.judge_name,
        j.teams || '',
        j.total_hours || '',
        JSON.stringify(j.assigned_programmes || []),
        JSON.stringify({ raw: j })
      ]);
    }

    const savedJudges = await db.all('SELECT * FROM jg_judges WHERE project_id = $1 ORDER BY id ASC', [project_id]);

    res.json({
      success: true,
      totalJudges: savedJudges.length,
      judges: savedJudges
    });
  } catch (err) {
    console.error('Error uploading judges:', err);
    res.status(500).json({ error: 'Failed to parse and save judges: ' + err.message });
  }
});

/**
 * 5. POST /api/judge-guidelines/upload-concept-notes
 * Upload Concept Note PDF/DOCX
 */
router.post('/upload-concept-notes', async (req, res) => {
  try {
    const { project_id, file_data, file_name } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required.' });
    if (!file_data) return res.status(400).json({ error: 'file_data (base64) is required.' });

    const buffer = Buffer.from(file_data, 'base64');
    const parser = getConceptNoteParser();
    const result = await parser.parseConceptNotes(buffer);

    if (!result.success || !result.entries || result.entries.length === 0) {
      return res.status(400).json({ error: 'No concept note entries could be parsed from the file.' });
    }

    // Clear previous concept notes for this project
    await db.query('DELETE FROM jg_concept_notes WHERE project_id = $1', [project_id]);

    // Insert parsed concept notes
    for (const e of result.entries) {
      await db.query(`
        INSERT INTO jg_concept_notes (
          project_id, code, name, description, portion_text,
          category, time_allowed, skill, candidates, extra_lines,
          has_arabic, arabic_verified, raw_text
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        project_id,
        e.code,
        e.name,
        e.description || '',
        e.portion_text || '',
        e.category || '',
        e.time_allowed || '',
        e.skill || '',
        e.candidates || '',
        JSON.stringify(e.extra_lines || []),
        Boolean(e.has_arabic),
        false,
        e.raw_text || ''
      ]);
    }

    const savedNotes = await db.all('SELECT * FROM jg_concept_notes WHERE project_id = $1 ORDER BY code ASC', [project_id]);

    res.json({
      success: true,
      totalEntries: savedNotes.length,
      arabicEntriesCount: savedNotes.filter(n => n.has_arabic).length,
      entries: savedNotes
    });
  } catch (err) {
    console.error('Error uploading concept notes:', err);
    res.status(500).json({ error: 'Failed to parse concept notes: ' + err.message });
  }
});

/**
 * 6. POST /api/judge-guidelines/upload-schedule
 * Upload Day Schedule (PDF or Excel)
 */
router.post('/upload-schedule', async (req, res) => {
  try {
    const { project_id, file_data, file_name } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required.' });
    if (!file_data) return res.status(400).json({ error: 'file_data (base64) is required.' });

    const buffer = Buffer.from(file_data, 'base64');
    const matcher = getScheduleMatcher();
    const result = await matcher.parseSchedule(buffer, file_name);

    if (!result.success || !result.entries || result.entries.length === 0) {
      return res.status(400).json({ error: 'No schedule items found in the file.' });
    }

    // Clear previous schedule for this project
    await db.query('DELETE FROM jg_schedule WHERE project_id = $1', [project_id]);

    // Insert schedule rows
    for (const s of result.entries) {
      await db.query(`
        INSERT INTO jg_schedule (
          project_id, code, name, category, programme_date,
          from_time, to_time, venue, pool, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        project_id,
        s.code,
        s.name || '',
        s.category || '',
        s.date || s.programme_date || '',
        s.from || s.from_time || '',
        s.to || s.to_time || '',
        s.venue || '',
        s.pool || '',
        JSON.stringify(s)
      ]);
    }

    const savedSchedule = await db.all('SELECT * FROM jg_schedule WHERE project_id = $1 ORDER BY id ASC', [project_id]);

    res.json({
      success: true,
      totalEntries: savedSchedule.length,
      schedule: savedSchedule
    });
  } catch (err) {
    console.error('Error uploading schedule:', err);
    res.status(500).json({ error: 'Failed to parse schedule: ' + err.message });
  }
});

/**
 * 7. POST /api/judge-guidelines/validate
 * Cross-validate judge programmes against concept notes and schedule
 */
router.post('/validate', async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required.' });

    const judges = await db.all('SELECT * FROM jg_judges WHERE project_id = $1 ORDER BY id ASC', [project_id]);
    const conceptNotes = await db.all('SELECT * FROM jg_concept_notes WHERE project_id = $1 ORDER BY code ASC', [project_id]);
    const schedule = await db.all('SELECT * FROM jg_schedule WHERE project_id = $1 ORDER BY id ASC', [project_id]);

    const matcher = getScheduleMatcher();
    const validation = matcher.crossValidateAll(judges, schedule, conceptNotes);

    res.json({
      success: true,
      validation
    });
  } catch (err) {
    console.error('Error validating data:', err);
    res.status(500).json({ error: 'Validation failed: ' + err.message });
  }
});

/**
 * 8. POST /api/judge-guidelines/update-concept-note
 * Inline review/editor update for Arabic text or description
 */
router.post('/update-concept-note', async (req, res) => {
  try {
    const { id, description, portion_text, category, time_allowed, skill, candidates, arabic_verified } = req.body;
    if (!id) return res.status(400).json({ error: 'Concept note id is required.' });

    const updated = await db.get(`
      UPDATE jg_concept_notes
      SET description = COALESCE($1, description),
          portion_text = COALESCE($2, portion_text),
          category = COALESCE($3, category),
          time_allowed = COALESCE($4, time_allowed),
          skill = COALESCE($5, skill),
          candidates = COALESCE($6, candidates),
          arabic_verified = COALESCE($7, arabic_verified)
      WHERE id = $8
      RETURNING *
    `, [
      description !== undefined ? description : null,
      portion_text !== undefined ? portion_text : null,
      category !== undefined ? category : null,
      time_allowed !== undefined ? time_allowed : null,
      skill !== undefined ? skill : null,
      candidates !== undefined ? candidates : null,
      arabic_verified !== undefined ? Boolean(arabic_verified) : null,
      id
    ]);

    res.json({ success: true, entry: updated });
  } catch (err) {
    console.error('Error updating concept note:', err);
    res.status(500).json({ error: 'Failed to update concept note: ' + err.message });
  }
});

/**
 * 9. POST /api/judge-guidelines/generate-single
 * Generate PDF for a single judge with zero latency
 */
router.post('/generate-single', async (req, res) => {
  try {
    const { project_id, judge_id } = req.body;
    if (!project_id || !judge_id) {
      return res.status(400).json({ error: 'project_id and judge_id are required.' });
    }

    const judge = await db.get('SELECT * FROM jg_judges WHERE id = $1 AND project_id = $2', [judge_id, project_id]);
    if (!judge) return res.status(404).json({ error: 'Judge not found.' });

    const conceptNotes = await db.all('SELECT * FROM jg_concept_notes WHERE project_id = $1', [project_id]);
    const scheduleRows = await db.all('SELECT * FROM jg_schedule WHERE project_id = $1', [project_id]);
    const templateRow = await db.get('SELECT * FROM jg_templates WHERE project_id = $1 LIMIT 1', [project_id]);

    const cnMap = {};
    conceptNotes.forEach(cn => {
      cnMap[cn.code] = cn;
    });

    const schedMap = {};
    scheduleRows.forEach(s => {
      schedMap[s.code] = s;
    });

    const matcher = getScheduleMatcher();
    const pdfEngine = getPdfEngine();

    const dossier = matcher.buildJudgeDossier(judge, cnMap, schedMap);
    const options = {
      general_rules: templateRow && templateRow.general_rules && templateRow.general_rules.length > 0
        ? templateRow.general_rules
        : pdfEngine.DEFAULT_RULES
    };

    const pdfBuffer = await pdfEngine.generateJudgeGuidelinePdf(dossier, options);

    // Cache PDF buffer in memory for instant streaming
    const cacheKey = `judge_${judge_id}_${project_id}`;
    pdfBufferCache.set(cacheKey, pdfBuffer);

    // Save to DB (without blocking on binary data size)
    const judgeNo = String(judge.judge_no || '01').padStart(2, '0');
    const safeName = (judge.judge_name || 'Judge').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${judgeNo}_${safeName}_Judge_Guideline.pdf`;

    await db.query(`
      INSERT INTO jg_generated_pdfs (project_id, judge_id, file_name, file_size, page_count, status)
      VALUES ($1, $2, $3, $4, 7, 'completed')
    `, [project_id, judge_id, fileName, pdfBuffer.length]);

    res.json({
      success: true,
      judge_id: judge.id,
      judge_no: judge.judge_no,
      judge_name: judge.judge_name,
      file_name: fileName,
      file_size: pdfBuffer.length,
      preview_url: `/api/judge-guidelines/preview-pdf/${judge.id}?project_id=${project_id}`
    });
  } catch (err) {
    console.error('Error generating single judge PDF:', err);
    res.status(500).json({ error: 'Failed to generate PDF: ' + err.message });
  }
});

/**
 * 10. GET /api/judge-guidelines/preview-pdf/:judgeId
 * Stream PDF directly to browser/iframe
 */
router.get('/preview-pdf/:judgeId', async (req, res) => {
  try {
    const judgeId = parseInt(req.params.judgeId, 10);
    const projectId = parseInt(req.query.project_id, 10);

    const cacheKey = `judge_${judgeId}_${projectId}`;
    let buffer = pdfBufferCache.get(cacheKey);

    if (!buffer) {
      // Regenerate on demand if not in cache
      const judge = await db.get('SELECT * FROM jg_judges WHERE id = $1', [judgeId]);
      if (!judge) return res.status(404).send('Judge not found.');

      const projId = judge.project_id;
      const conceptNotes = await db.all('SELECT * FROM jg_concept_notes WHERE project_id = $1', [projId]);
      const scheduleRows = await db.all('SELECT * FROM jg_schedule WHERE project_id = $1', [projId]);
      const templateRow = await db.get('SELECT * FROM jg_templates WHERE project_id = $1 LIMIT 1', [projId]);

      const cnMap = {};
      conceptNotes.forEach(cn => { cnMap[cn.code] = cn; });
      const schedMap = {};
      scheduleRows.forEach(s => { schedMap[s.code] = s; });

      const matcher = getScheduleMatcher();
      const pdfEngine = getPdfEngine();
      const dossier = matcher.buildJudgeDossier(judge, cnMap, schedMap);
      const options = {
        general_rules: templateRow && templateRow.general_rules ? templateRow.general_rules : pdfEngine.DEFAULT_RULES
      };

      buffer = await pdfEngine.generateJudgeGuidelinePdf(dossier, options);
      pdfBufferCache.set(cacheKey, buffer);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="judge_guideline_preview.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error('Error streaming preview PDF:', err);
    res.status(500).send('Error previewing PDF: ' + err.message);
  }
});

/**
 * 11. POST /api/judge-guidelines/download-merged
 * Merged PDF modes:
 * Mode A: Complete booklets for all judges
 * Mode B: Inner pages only (no cover, no back cover)
 * Mode C: Covers & Backs only
 */
router.post('/download-merged', async (req, res) => {
  try {
    const { project_id, mode = 'A', judge_ids } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required.' });

    let judges;
    if (Array.isArray(judge_ids) && judge_ids.length > 0) {
      judges = await db.all('SELECT * FROM jg_judges WHERE project_id = $1 AND id = ANY($2) ORDER BY id ASC', [project_id, judge_ids]);
    } else {
      judges = await db.all('SELECT * FROM jg_judges WHERE project_id = $1 ORDER BY id ASC', [project_id]);
    }

    if (!judges || judges.length === 0) {
      return res.status(404).json({ error: 'No judges found for merged PDF.' });
    }

    const conceptNotes = await db.all('SELECT * FROM jg_concept_notes WHERE project_id = $1', [project_id]);
    const scheduleRows = await db.all('SELECT * FROM jg_schedule WHERE project_id = $1', [project_id]);
    const templateRow = await db.get('SELECT * FROM jg_templates WHERE project_id = $1 LIMIT 1', [project_id]);

    const cnMap = {};
    conceptNotes.forEach(cn => { cnMap[cn.code] = cn; });
    const schedMap = {};
    scheduleRows.forEach(s => { schedMap[s.code] = s; });

    const matcher = getScheduleMatcher();
    const pdfEngine = getPdfEngine();
    const options = {
      general_rules: templateRow && templateRow.general_rules ? templateRow.general_rules : pdfEngine.DEFAULT_RULES
    };

    const judgeBuffers = [];
    for (const judge of judges) {
      const cacheKey = `judge_${judge.id}_${project_id}`;
      let buf = pdfBufferCache.get(cacheKey);
      if (!buf) {
        const dossier = matcher.buildJudgeDossier(judge, cnMap, schedMap);
        buf = await pdfEngine.generateJudgeGuidelinePdf(dossier, options);
        pdfBufferCache.set(cacheKey, buf);
      }
      judgeBuffers.push(buf);
    }

    const mergedBuffer = await pdfEngine.generateMergedPdf(judgeBuffers, mode);

    const modeLabels = { A: 'All', B: 'InnerPages', C: 'CoversOnly' };
    const label = modeLabels[mode] || mode;
    const downloadName = `SIBAQ_2026_Judge_Guidelines_Merged_${label}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.send(mergedBuffer);
  } catch (err) {
    console.error('Error generating merged PDF:', err);
    res.status(500).json({ error: 'Failed to generate merged PDF: ' + err.message });
  }
});

/**
 * 12. POST /api/judge-guidelines/download-zip
 * Bundles all judge PDFs into a streaming ZIP archive
 */
router.post('/download-zip', async (req, res) => {
  try {
    const { project_id, judge_ids } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required.' });

    let judges;
    if (Array.isArray(judge_ids) && judge_ids.length > 0) {
      judges = await db.all('SELECT * FROM jg_judges WHERE project_id = $1 AND id = ANY($2) ORDER BY id ASC', [project_id, judge_ids]);
    } else {
      judges = await db.all('SELECT * FROM jg_judges WHERE project_id = $1 ORDER BY id ASC', [project_id]);
    }

    const conceptNotes = await db.all('SELECT * FROM jg_concept_notes WHERE project_id = $1', [project_id]);
    const scheduleRows = await db.all('SELECT * FROM jg_schedule WHERE project_id = $1', [project_id]);
    const templateRow = await db.get('SELECT * FROM jg_templates WHERE project_id = $1 LIMIT 1', [project_id]);

    const cnMap = {};
    conceptNotes.forEach(cn => { cnMap[cn.code] = cn; });
    const schedMap = {};
    scheduleRows.forEach(s => { schedMap[s.code] = s; });

    const matcher = getScheduleMatcher();
    const pdfEngine = getPdfEngine();
    const options = {
      general_rules: templateRow && templateRow.general_rules ? templateRow.general_rules : pdfEngine.DEFAULT_RULES
    };

    const fileList = [];
    for (const judge of judges) {
      const cacheKey = `judge_${judge.id}_${project_id}`;
      let buf = pdfBufferCache.get(cacheKey);
      if (!buf) {
        const dossier = matcher.buildJudgeDossier(judge, cnMap, schedMap);
        buf = await pdfEngine.generateJudgeGuidelinePdf(dossier, options);
        pdfBufferCache.set(cacheKey, buf);
      }

      const judgeNo = String(judge.judge_no || '01').padStart(2, '0');
      const safeName = (judge.judge_name || 'Judge').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${judgeNo}_${safeName}_Judge_Guideline.pdf`;

      fileList.push({ fileName, buffer: buf });
    }

    const zipBuffer = await pdfEngine.createZipArchive(fileList);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="SIBAQ_2026_Individual_Judge_Guidelines.zip"');
    res.send(zipBuffer);
  } catch (err) {
    console.error('Error creating ZIP archive:', err);
    res.status(500).json({ error: 'Failed to create ZIP: ' + err.message });
  }
});

/**
 * 13. GET /api/judge-guidelines/template/:projectId
 * Fetch template settings
 */
router.get('/template/:projectId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    const tmpl = await db.get('SELECT * FROM jg_templates WHERE project_id = $1 LIMIT 1', [projectId]);
    const pdfEngine = getPdfEngine();

    res.json({
      success: true,
      template: tmpl || {
        general_rules: pdfEngine.DEFAULT_RULES,
        settings: { event_title: 'SIBAQ 2026', accent_color: '#d97706' }
      }
    });
  } catch (err) {
    console.error('Error fetching template:', err);
    res.status(500).json({ error: 'Failed to fetch template: ' + err.message });
  }
});

/**
 * 14. POST /api/judge-guidelines/template/:projectId
 * Update template settings (rules, branding)
 */
router.post('/template/:projectId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    const { general_rules, settings } = req.body;

    const existing = await db.get('SELECT id FROM jg_templates WHERE project_id = $1 LIMIT 1', [projectId]);
    if (existing) {
      await db.query(`
        UPDATE jg_templates
        SET general_rules = COALESCE($1, general_rules),
            settings = COALESCE($2, settings),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [general_rules ? JSON.stringify(general_rules) : null, settings ? JSON.stringify(settings) : null, existing.id]);
    } else {
      await db.query(`
        INSERT INTO jg_templates (project_id, general_rules, settings)
        VALUES ($1, $2, $3)
      `, [projectId, JSON.stringify(general_rules || []), JSON.stringify(settings || {})]);
    }

    res.json({ success: true, message: 'Template settings saved.' });
  } catch (err) {
    console.error('Error updating template:', err);
    res.status(500).json({ error: 'Failed to update template: ' + err.message });
  }
});

module.exports = router;
