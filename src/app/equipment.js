// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
function getEquipmentDescription(eCode) {
  const code = eCode?.trim().toUpperCase();
  switch (code) {
    case 'VE': return 'VAN:VAN';
    case 'VZ': return 'VAN:VAN, VAN:53VN, REFR:REFR';
    case 'VAN':
    case 'V': return 'VAN:VAN, VAN:53VN';
    case 'VM':
    case 'VT': return 'VAN:VAN, VAN:53VN';
    case 'VR': return 'VAN:VAN, REFR:REFR';
    case 'V,R': return 'VAN:VAN, REFR:REFR';
    case 'R': return 'REFR:REFR';
    case 'RZ': return 'REFR:REFR';
    case 'F': return '48FL, 53FL, FLAT';
    case 'F,SD': return '48FL, 53FL, FLAT, STEP:SD';
    case 'FH': return '48FL, 53FL, FLAT, STEP:SD';
    case 'FV': return '48FL, 53FL, FLAT, STEP:SD';
    case 'FLCS': return 'FLCS';
    case 'SD': return 'STEP:SD';
    case 'D-LG': return 'Straight truck - liftgate required';
    case 'D-ST': return 'Straight truck';
    case 'D-RF': return 'Straight truck - reefer';
    case 'D-LG,D-ST': return 'D-LG, D-ST';
    default: return eCode || 'VAN:VAN';
  }
}

function isTeamEquipment(value) {
  return ['VM', 'VT'].includes(String(value || '').trim().toUpperCase());
}

// Team comes from the Team switch when set; otherwise team equipment (VM/VT) means team.
function isTeamLoad(load) {
  const team = String(load?.team || '').trim().toLowerCase();
  if (team === 'true') return true;
  if (team === 'false') return false;
  return isTeamEquipment(load?.eCode);
}

function normalizeEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return '';
  if (/^D-(LG|ST|RF)/.test(code)) return code.replace(/\s/g, '');
  if (/STRAIGHT\s*TRUCK|SPRINTER|BOX\s*TRUCK|HOT\s*SHOT/.test(code)) {
    if (/REEFER|REFRIGERATED/.test(code)) return 'D-RF';
    return /LIFT\s*GATE/.test(code) && !/NO\s*LIFT\s*GATE|WITHOUT\s*(?:A\s*)?LIFT\s*GATE/.test(code) ? 'D-LG' : 'D-ST';
  }
  if (/CONESTOGA/.test(code)) return 'FLCS';
  // Step Deck before flatbed so "Flatbed or Step Deck" imports as SD.
  if (/STEP\s*DECK|STEPDECK|\bSTEP\b/.test(code)) return 'SD';
  if (/FLAT\s*BED|\bFLAT\b/.test(code)) return 'F';
  if (/\bVAN\b\s+OR\s+(REEFER|REFR)\b/.test(code)) return 'V,R';
  if (/REEFER|\bREFR/.test(code)) return 'R';
  if (/\bVAN\b/.test(code)) return 'V';
  return code;
}

// Liftgate-required freight cannot accept a straight truck without a liftgate.
function getLandstarEquipment2(ord) {
  if (ord?.equipment2 !== undefined) return ord.equipment2;
  if (isTeamLoad(ord)) return '53VN';
  if (isFlatbedEquipment(ord?.eCode)) return 'STEP';
  const code = String(ord?.eCode || '').trim().toUpperCase();
  if (['D-ST', 'D-ST,D-LG', 'D-LG,D-ST'].includes(code.replace(/\s/g, ''))) return 'D-LG';
  if (code === 'V,R') return 'REFR';
  return '';
}

function getLandstarEquipmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  const equipmentCodes = {
    VZ: 'VAN',
    VAN: 'VAN',
    V: 'VAN',
    VT: 'VAN',
    VM: 'VAN',
    VE: 'VAN',
    VR: 'VAN',
    'V,R': 'VAN',
    R: 'REFR',
    RZ: 'REFR',
    F: 'FLAT',
    'F,SD': 'FLAT',
    FH: 'FH',
    FV: 'FLAT',
    FLCS: 'FLCS',
    SD: 'STEP'
  };
  if (equipmentCodes[code]) return equipmentCodes[code];
  if (['D-ST', 'D-ST,D-LG', 'D-LG,D-ST'].includes(code.replace(/\s/g, ''))) return 'D-ST';
  if (code === 'D-LG' || code === 'D-RF') return code;
  if (code.includes('53 FEET') || code.includes('53FT') || code.includes('53 FT')) return '53VN';
  if (code.startsWith('VAN')) return 'VAN';
  if (code.startsWith('REFR') || code.startsWith('REEFER')) return 'REFR';
  if (code.startsWith('FLAT')) return 'FLAT';
  if (code.startsWith('STEP')) return 'STEP';
  return code.match(/\b(24VN|28VN|48VN|53VN|VAN|REFR|FLAT|48FL|53FL|STEP|53SD|SD)\b/)?.[0] || '';
}

function isFlatbedEquipment(value) {
  return ['F', 'F,SD', 'FH', 'FV'].includes(String(value || '').replace(/\s/g, '').toUpperCase());
}

export {
  getEquipmentDescription,
  isTeamEquipment,
  isTeamLoad,
  normalizeEquipmentCode,
  getLandstarEquipment2,
  getLandstarEquipmentCode,
  isFlatbedEquipment
};
