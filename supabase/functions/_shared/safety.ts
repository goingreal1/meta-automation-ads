// Medical red-flag detection shared by the voice agent webhook (and any other
// channel that wants it). The ElevenLabs agent is instructed to transfer live
// to a human on these topics; this is the server-side backstop that flags the
// call for a human callback even if the agent didn't.
//
// Covers Nigerian English and common Pidgin phrasings. Deliberately excludes
// "drug"/"medicine" alone: customers routinely call the product itself that.

const RED_FLAG_PATTERNS: [string, RegExp][] = [
  ["sick", /\b(sick|ill|unwell|i no well|i never well)\b/i],
  ["hospital", /\b(hospital|admitted|emergency|clinic)\b/i],
  ["bleeding", /\b(bleed|bleeding|blood (?:dey )?(?:come|comot))\b/i],
  ["allergy", /\b(allerg(?:y|ic|ies)|rash|itch(?:ing)?|swell(?:ing|ed)?|body dey scratch)\b/i],
  ["breathing", /\b(can'?t breathe|cannot breathe|breathing (?:problem|difficult)|short(?:ness)? of breath)\b/i],
  ["chest_pain", /\b(chest pain|heart (?:pain|attack)|palpitation)\b/i],
  ["faint_seizure", /\b(faint(?:ed|ing)?|collapse(?:d)?|seizure|convuls(?:ion|ing))\b/i],
  ["vomiting", /\b(vomit(?:ing|ed)?|throw(?:ing)? up|purg(?:e|ing)|diarrh(?:o)?ea|belle (?:dey )?(?:pain|run))\b/i],
  ["pregnancy", /\b(pregnan(?:t|cy)|breast ?feed(?:ing)?|nursing mother|trying to conceive)\b/i],
  ["overdose", /\b(overdose|took too much|poison(?:ed|ing)?)\b/i],
  ["chronic_condition", /\b(diabet(?:es|ic)|hypertension|high blood pressure|\bBP\b|kidney|liver|cancer|ulcer|sickle cell|HIV)\b/i],
  ["prescription_meds", /\b(prescri(?:bed|ption)|doctor (?:gave|give|placed)|on (?:my )?medication)\b/i],
];

export function detectRedFlags(texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const [label, re] of RED_FLAG_PATTERNS) if (re.test(t)) found.add(label);
  }
  return [...found];
}

// Nigerian numbers to E.164: 08012345678 / 2348012345678 / +234 801 234 5678.
export function toE164NG(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 11) d = "234" + d.slice(1);
  if (d.length === 10 && /^[789]/.test(d)) d = "234" + d;
  if (!/^234[789]\d{9}$/.test(d)) return null;
  return "+" + d;
}
