const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DIR = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  if (reqPath === '/dashboard') reqPath = '/dashboard_rio.html';
  if (reqPath === '/admin') reqPath = '/admin.html';
  if (reqPath === '/landing') reqPath = '/landing.html';
  
  const filePath = path.join(DIR, reqPath);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Archivo no encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log('  SERVIDOR WEB LOCAL DEL MONITOREO DE RIO LORA 32  ');
  console.log('==================================================');
  console.log(' Acceso en esta PC     : http://localhost:' + PORT);
  console.log(' Acceso desde tu Celular: http://192.168.1.88:' + PORT);
  console.log(' (Asegúrate de que tu celular esté conectado al mismo Wi-Fi)');
  console.log(' Presiona Ctrl + C para detener el servidor.');
  console.log('==================================================');
});
