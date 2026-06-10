import fs from 'fs';

const content = fs.readFileSync('frontend/src/pages/location-management/LocationManagement.jsx', 'utf8');
const lines = content.split('\n');

// Find the return statement of LocationManagementPage
let startIndex = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('export default function LocationManagementPage()')) {
    startIndex = i;
    break;
  }
}

if (startIndex !== -1) {
  console.log(lines.slice(startIndex, startIndex + 300).join('\n'));
} else {
  console.log('LocationManagementPage not found');
}
