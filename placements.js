// Placement data — the twelve-of-each that define a cast, shared by the dice
// faces, the reading panel caption, the journal, and the share text.

export const PLANET_GLYPHS = ['☉','☽','☿','♀','♂','♃','♄','♅','♆','♇','☊','☋'];
export const ZODIAC_GLYPHS = ['♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'];
export const NUMBER_GLYPHS = ['1','2','3','4','5','6','7','8','9','10','11','12'];

export const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter',
  'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Rahu', 'Ketu'];
export const SIGN_NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
export const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th',
  '9th', '10th', '11th', '12th'];

// "Venus in Scorpio · 5th House" — plain words for people who don't read glyphs.
export function placementLabel(d) {
  return `${PLANET_NAMES[d.planet]} in ${SIGN_NAMES[d.sign]} · ${ORDINALS[d.house - 1]} House`;
}

// "♀  ♏  5" — the glyph row for a cast addressed by raw indices.
export function castGlyphs(p, s, h) {
  return `${PLANET_GLYPHS[p]}  ${ZODIAC_GLYPHS[s]}  ${NUMBER_GLYPHS[h - 1]}`;
}
