'use strict';
const { app } = require('electron');
app.disableHardwareAcceleration();
app.setName('School Management System');
app.whenReady().then(() => {
  app.setPath('userData', 'C:\\Users\\Amin Bazai\\AppData\\Roaming\\School Management System');
  const svc = require('../electron/services/students.service');
  console.log('service loaded, keys:', Object.keys(svc).length);
  const db = require('../electron/db/connection').getDb();
  const s = svc.get(7);
  console.log('student 7 history:', JSON.stringify(s.classHistory));
  app.quit();
});