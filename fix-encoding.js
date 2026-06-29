const fs = require('fs');
const file = require('path').join(__dirname, 'client/src/pages/AdminDashboard.js');
let content = fs.readFileSync(file, 'utf8');

// Replace common mangled characters with their ASCII equivalents
content = content.replace(/…/g, '...');
content = content.replace(/鈥/g, '...');
content = content.replace(/闁ワ拷/g, '...');
content = content.replace(/[^\x00-\x7F]/g, ''); // strip remaining non-ascii

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed encoding in AdminDashboard.js');
