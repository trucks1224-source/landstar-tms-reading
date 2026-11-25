// Team logo (Daniel's request, 2026-11-25): each teammate picks the football team logo shown in
// the top bar in ⚙ My Settings. '' keeps the original Eagles artwork; an NFL team code shows that
// team's logo; an uploaded picture (any team, college or soccer too) is kept as a small data URL.

export const defaultTeamLogo = '/eagles-sidebar.png';

export const nflTeams = [
  ['ari', 'Arizona Cardinals'], ['atl', 'Atlanta Falcons'], ['bal', 'Baltimore Ravens'], ['buf', 'Buffalo Bills'],
  ['car', 'Carolina Panthers'], ['chi', 'Chicago Bears'], ['cin', 'Cincinnati Bengals'], ['cle', 'Cleveland Browns'],
  ['dal', 'Dallas Cowboys'], ['den', 'Denver Broncos'], ['det', 'Detroit Lions'], ['gb', 'Green Bay Packers'],
  ['hou', 'Houston Texans'], ['ind', 'Indianapolis Colts'], ['jax', 'Jacksonville Jaguars'], ['kc', 'Kansas City Chiefs'],
  ['lv', 'Las Vegas Raiders'], ['lac', 'Los Angeles Chargers'], ['lar', 'Los Angeles Rams'], ['mia', 'Miami Dolphins'],
  ['min', 'Minnesota Vikings'], ['ne', 'New England Patriots'], ['no', 'New Orleans Saints'], ['nyg', 'New York Giants'],
  ['nyj', 'New York Jets'], ['phi', 'Philadelphia Eagles'], ['pit', 'Pittsburgh Steelers'], ['sf', 'San Francisco 49ers'],
  ['sea', 'Seattle Seahawks'], ['tb', 'Tampa Bay Buccaneers'], ['ten', 'Tennessee Titans'], ['wsh', 'Washington Commanders']
].map(([code, name]) => ({ code, name }));

const nflCodes = new Set(nflTeams.map(team => team.code));
// Uploaded logos are shrunk to 160px before saving; anything far bigger is not one of ours.
const MAX_UPLOAD_LENGTH = 300000;

export function isUploadedLogo(value) {
  return /^data:image\/(png|jpeg|webp|gif);base64,/i.test(String(value || '')) && String(value).length <= MAX_UPLOAD_LENGTH;
}

export function normalizeTeamLogo(value) {
  const text = String(value || '');
  if (nflCodes.has(text)) return text;
  return isUploadedLogo(text) ? text : '';
}

export function teamLogoSrc(value) {
  const choice = normalizeTeamLogo(value);
  if (!choice) return defaultTeamLogo;
  if (isUploadedLogo(choice)) return choice;
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${choice}.png&h=160&w=160`;
}

export function teamLogoName(value) {
  const choice = normalizeTeamLogo(value);
  if (!choice) return 'Eagles artwork';
  if (isUploadedLogo(choice)) return 'Team logo';
  return `${nflTeams.find(team => team.code === choice).name} logo`;
}
