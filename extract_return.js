import fs from 'fs';

const content = fs.readFileSync('frontend/src/pages/location-management/LocationManagement.jsx', 'utf8');
const lines = content.split('\n');

// Find the last "return (" inside LocationManagementPage
let lastReturnIndex = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('return (') && i > 1500) {
    lastReturnIndex = i;
    break;
  }
}

if (lastReturnIndex !== -1) {
  console.log(lines.slice(lastReturnIndex, lastReturnIndex + 200).join('\n'));
} else {
  console.log('Return statement not found');
}
