'use strict';
const { app } = require('electron');
app.disableHardwareAcceleration();
app.setName('School Management System');
app.whenReady().then(() => {
  app.setPath('userData', 'C:\\Users\\Amin Bazai\\AppData\\Roaming\\School Management System');
  const { initDatabase } = require('../electron/db/connection');
  const db = initDatabase({ seed: false });
  const classes = db.prepare(`SELECT name, level_order FROM classes WHERE is_deleted=0 ORDER BY level_order`).all();
  console.log('classes:', classes.length);
  classes.forEach(c => console.log(' -', c.name));
  const sections = db.prepare(`SELECT COUNT(*) AS n FROM sections WHERE is_deleted=0`).get();
  console.log('sections:', sections.n);
  app.quit();
});