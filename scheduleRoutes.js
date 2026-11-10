const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('./db');
const scheduleParser = require('./scheduleExcelParser');
const schedulePdfEngine = require('./schedulePdfEngine');

// Ensure upload and output directories exist
const generatedDir = path.join(__dirname, 'public', 'uploads', 'generated_schedules');
if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });

/**
 * 1. POST /api/schedule/parse-excel
 * Accepts base64 encoded file data (.xlsx, .xls, .csv)
 * Returns parsed programmes, detected dates/pools/venues, validation warnings, duplicate conflicts
 */
router.post('/parse-excel', async (req, res) => {
  try {
    const { file_data, file_name, chosen_from_col } = req.body;
    if (!file_data) {
      return res.status(400).json({ error: 'No file data received.' });
    }

    // Extract base64 buffer
    let base64Content = file_data;
    if (file_data.includes(',')) {
      base64Content = file_data.split(',')[1];
    }
    const buffer = Buffer.from(base64Content, 'base64');

    const result = scheduleParser.parseScheduleWorkbook(buffer, {
      chosenFromCol: chosen_from_col !== undefined ? parseInt(chosen_from_col, 10) : undefined
    });

    res.json({
      success: true,
      file_name: file_name || 'Uploaded Schedule',
      ...result
    });
  } catch (err) {
    console.error('Error parsing schedule excel:', err);
    res.status(500).json({ error: err.message || 'Failed to parse Excel schedule.' });
  }
});

/**
 * 2. GET /api/schedule/dashboard-stats
 * Returns overall statistics for the Schedule Template Creation Dashboard
 */
router.get('/dashboard-stats', async (req, res) => {
  try {
    const totalProjectsRes = await db.query(`SELECT COUNT(*)::int as count FROM schedule_projects`);
    const totalProgrammesRes = await db.query(`SELECT COUNT(*)::int as count FROM schedule_programmes`);
    const totalPdfsRes = await db.query(`SELECT COUNT(*)::int as count FROM generated_schedule_pdfs`);

    // Get unique pools and venues count from all programmes
    const poolsRes = await db.query(`SELECT COUNT(DISTINCT pool)::int as count FROM schedule_programmes WHERE pool IS NOT NULL AND pool != ''`);
    const venuesRes = await db.query(`SELECT COUNT(DISTINCT venue)::int as count FROM schedule_programmes WHERE venue IS NOT NULL AND venue != ''`);
    const datesRes = await db.query(`SELECT COUNT(DISTINCT programme_date)::int as count FROM schedule_programmes WHERE programme_date IS NOT NULL AND programme_date != ''`);

    // Recent projects
    const recentProjectsRes = await db.query(`
      SELECT p.*,
        (SELECT COUNT(*)::int FROM schedule_programmes WHERE project_id = p.id) as programme_count
      FROM schedule_projects p
      ORDER BY p.updated_at DESC
      LIMIT 5
    `);

    // Recent generated PDFs
    const recentPdfsRes = await db.query(`
      SELECT g.*, p.project_name
      FROM generated_schedule_pdfs g
      JOIN schedule_projects p ON g.project_id = p.id
      ORDER BY g.created_at DESC
      LIMIT 8
    `);

    res.json({
      success: true,
      stats: {
        totalProjects: totalProjectsRes.rows[0]?.count || 0,
        totalProgrammes: totalProgrammesRes.rows[0]?.count || 0,
        totalDates: datesRes.rows[0]?.count || 0,
        totalPools: poolsRes.rows[0]?.count || 0,
        totalVenues: venuesRes.rows[0]?.count || 0,
        totalPdfs: totalPdfsRes.rows[0]?.count || 0
      },
      recentProjects: recentProjectsRes.rows || [],
      recentPdfs: recentPdfsRes.rows || []
    });
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3. GET /api/schedule/projects
 * Lists all saved schedule projects
 */
router.get('/projects', async (req, res) => {
  try {
    const query = `
      SELECT
        p.id,
        p.project_name,
        p.event_name,
        p.uploaded_file_name,
        p.created_at,
        p.updated_at,
        COUNT(prog.id)::int as total_programmes,
        COUNT(DISTINCT prog.programme_date)::int as total_dates,
        COUNT(DISTINCT prog.pool)::int as total_pools,
        COUNT(DISTINCT prog.venue)::int as total_venues,
        (SELECT COUNT(*)::int FROM generated_schedule_pdfs WHERE project_id = p.id) as generated_pdfs_count
      FROM schedule_projects p
      LEFT JOIN schedule_programmes prog ON prog.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC;
    `;
    const result = await db.query(query);
    res.json({ success: true, projects: result.rows });
  } catch (err) {
    console.error('Error listing projects:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4. GET /api/schedule/projects/:id
 * Fetches a single project with its full programme records and template configuration
 */
router.get('/projects/:id', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const projectRes = await db.query(`SELECT * FROM schedule_projects WHERE id = $1`, [projectId]);
    if (!projectRes.rows[0]) {
      return res.status(404).json({ error: 'Schedule project not found.' });
    }

    const project = projectRes.rows[0];

    // Programmes
    const progRes = await db.query(`
      SELECT * FROM schedule_programmes
      WHERE project_id = $1
      ORDER BY sort_order ASC, id ASC
    `, [projectId]);

    // Template settings
    const tmplRes = await db.query(`SELECT * FROM schedule_templates WHERE project_id = $1 LIMIT 1`, [projectId]);

    // Generated PDFs
    const pdfsRes = await db.query(`
      SELECT * FROM generated_schedule_pdfs
      WHERE project_id = $1
      ORDER BY created_at DESC
    `, [projectId]);

    // Extract unique detected dates, pools, venues
    const dates = [...new Set(progRes.rows.map(p => p.programme_date).filter(Boolean))].sort();
    const pools = [...new Set(progRes.rows.map(p => p.pool).filter(Boolean))].sort();
    const venues = [...new Set(progRes.rows.map(p => p.venue).filter(Boolean))].sort();

    res.json({
      success: true,
      project,
      programmes: progRes.rows,
      template: tmplRes.rows[0] || null,
      generatedPdfs: pdfsRes.rows,
      detectedDates: dates,
      detectedPools: pools,
      detectedVenues: venues,
      summary: {
        totalProgrammes: progRes.rows.length,
        totalDates: dates.length,
        totalPools: pools.length,
        totalVenues: venues.length
      }
    });
  } catch (err) {
    console.error('Error getting project:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 5. POST /api/schedule/projects
 * Creates or updates a schedule project along with its programmes and template configuration
 */
router.post('/projects', async (req, res) => {
  try {
    const {
      project_id,
      project_name,
      event_name,
      uploaded_file_name,
      programmes,
      template_settings,
      user_id
    } = req.body;

    if (!project_name || !project_name.trim()) {
      return res.status(400).json({ error: 'Project name is required.' });
    }

    let pId = project_id ? parseInt(project_id, 10) : null;

    if (pId) {
      // Update existing project
      await db.query(`
        UPDATE schedule_projects
        SET project_name = $1, event_name = $2, uploaded_file_name = COALESCE($3, uploaded_file_name), updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [project_name.trim(), event_name || 'SIBAQ\'26', uploaded_file_name || null, pId]);
    } else {
      // Create new project
      const insertProj = await db.query(`
        INSERT INTO schedule_projects (project_name, event_name, uploaded_file_name, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [project_name.trim(), event_name || 'SIBAQ\'26', uploaded_file_name || 'Uploaded Schedule', user_id || null]);
      pId = insertProj.rows[0].id;
    }

    // Save or replace programmes if provided
    if (Array.isArray(programmes)) {
      await db.query(`DELETE FROM schedule_programmes WHERE project_id = $1`, [pId]);

      for (let i = 0; i < programmes.length; i++) {
        const p = programmes[i];
        await db.query(`
          INSERT INTO schedule_programmes (
            project_id, serial_number, programme_date, starting_time, ending_time,
            programme_code, pool, programme_name, category, venue, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          pId,
          String(p.serial_number || i + 1),
          p.programme_date || '',
          p.starting_time || '',
          p.ending_time || '',
          p.programme_code || '',
          p.pool || 'POOL B',
          p.programme_name || '',
          p.category || '',
          p.venue || 'Venue 1',
          i
        ]);
      }
    }

    // Save template settings
    if (template_settings) {
      await db.query(`
        INSERT INTO schedule_templates (
          project_id, template_name, header_settings, table_settings, footer_settings, font_settings, layout_settings
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [
        pId,
        template_settings.template_name || 'SIBAQ Official Template',
        JSON.stringify(template_settings.header_settings || {}),
        JSON.stringify(template_settings.table_settings || {}),
        JSON.stringify(template_settings.footer_settings || {}),
        JSON.stringify(template_settings.font_settings || {}),
        JSON.stringify(template_settings.layout_settings || {})
      ]);
    }

    res.json({
      success: true,
      project_id: pId,
      message: `Project "${project_name}" saved successfully!`
    });
  } catch (err) {
    console.error('Error saving project:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 6. DELETE /api/schedule/projects/:id
 * Deletes a project
 */
router.delete('/projects/:id', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    await db.query(`DELETE FROM schedule_projects WHERE id = $1`, [projectId]);
    res.json({ success: true, message: 'Project deleted successfully.' });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 7. POST /api/schedule/generate-pdfs
 * Generates both Day-Based and Venue-Based PDFs for all or specified pools
 */
router.post('/generate-pdfs', async (req, res) => {
  try {
    const { programmes, template_settings, pools, project_id } = req.body;

    if (!Array.isArray(programmes) || programmes.length === 0) {
      return res.status(400).json({ error: 'No programme records provided for PDF generation.' });
    }

    const generatedResults = await schedulePdfEngine.generateAllSchedulePdfs(programmes, {
      templateSettings: template_settings || {},
      pools: Array.isArray(pools) && pools.length > 0 ? pools : undefined
    });

    // If linked to a saved project, record generated PDFs in DB
    if (project_id) {
      const pId = parseInt(project_id, 10);
      for (const item of generatedResults) {
        await db.query(`
          INSERT INTO generated_schedule_pdfs (project_id, pool, pdf_type, file_name, file_path)
          VALUES ($1, $2, $3, $4, $5)
        `, [pId, item.pool, item.pdfType, item.fileName, item.url]);
      }
    }

    res.json({
      success: true,
      totalGenerated: generatedResults.length,
      files: generatedResults
    });
  } catch (err) {
    console.error('Error generating PDFs:', err);
    res.status(500).json({ error: err.message || 'PDF generation failed.' });
  }
});

/**
 * 8. POST /api/schedule/download-all-zip
 * Creates a ZIP archive containing all generated PDFs and streams it for instant download
 */
router.post('/download-all-zip', async (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files provided for download.' });
    }

    const zipFileName = `SIBAQ_2026_All_Schedules_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    for (const file of files) {
      const filePath = path.join(__dirname, 'public', file.url.replace(/^\//, ''));
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file.fileName });
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Error creating ZIP bundle:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

module.exports = router;

