import fs from 'fs';

const content = fs.readFileSync('frontend/src/pages/location-management/LocationManagement.jsx', 'utf8');
const lines = content.split('\n');

console.log('Total lines:', lines.length);
console.log('Searching for "Plan":');
lines.forEach((line, index) => {
  if (line.toLowerCase().includes('plan')) {
    console.log(`  L${index + 1}: ${line.trim()}`);
  }
});
