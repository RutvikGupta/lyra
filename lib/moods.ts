// Static taxonomy mapping Last.fm tags to mood buckets. Curated from the
// most common tags surfaced on getTopTags responses across pop/rock/rap/
// electronic — the buckets are deliberately broad so a small selection
// covers a meaningful chunk of any user's library.
//
// Match is case-insensitive exact OR substring (the latter so "summer
// vibes" matches the "summer" mood). To add a new bucket, append below;
// the UI auto-renders chips for whatever's in MOODS.

export type Mood = {
  id: string;
  label: string;
  emoji: string;
  // Lowercase keywords that flag a tag as matching this mood. Substring
  // match — pick keywords that won't false-positive on unrelated tags.
  keywords: string[];
};

export const MOODS: Mood[] = [
  {
    id: "energetic",
    label: "Energetic",
    emoji: "⚡",
    keywords: [
      "energetic",
      "energy",
      "party",
      "dance",
      "club",
      "anthem",
      "banger",
      "hype",
      "workout",
      "upbeat",
    ],
  },
  {
    id: "chill",
    label: "Chill",
    emoji: "☁",
    keywords: [
      "chill",
      "chillout",
      "relax",
      "mellow",
      "easy listening",
      "ambient",
      "downtempo",
      "lo-fi",
      "lofi",
      "lounge",
    ],
  },
  {
    id: "sad",
    label: "Sad",
    emoji: "💧",
    keywords: [
      "sad",
      "melancholy",
      "melancholic",
      "heartbreak",
      "depressing",
      "emotional",
      "somber",
      "tearjerker",
    ],
  },
  {
    id: "aggressive",
    label: "Aggressive",
    emoji: "🔥",
    keywords: [
      "aggressive",
      "hardcore",
      "brutal",
      "intense",
      "angry",
      "heavy",
      "metal",
      "screamo",
    ],
  },
  {
    id: "nostalgic",
    label: "Nostalgic",
    emoji: "📼",
    keywords: [
      "nostalgic",
      "nostalgia",
      "retro",
      "throwback",
      "vintage",
      "oldschool",
      "old school",
      "classic",
    ],
  },
  {
    id: "romantic",
    label: "Romantic",
    emoji: "❤",
    keywords: [
      "love",
      "romantic",
      "romance",
      "sensual",
      "love songs",
      "love song",
      "sexy",
    ],
  },
  {
    id: "uplifting",
    label: "Uplifting",
    emoji: "☀",
    keywords: [
      "happy",
      "uplifting",
      "joyful",
      "feel good",
      "feel-good",
      "positive",
      "sunshine",
      "cheerful",
      "fun",
    ],
  },
  {
    id: "dark",
    label: "Dark",
    emoji: "🌑",
    keywords: [
      "dark",
      "brooding",
      "atmospheric",
      "gothic",
      "goth",
      "sinister",
      "ominous",
      "moody",
    ],
  },
  {
    id: "summer",
    label: "Summer",
    emoji: "🏖",
    keywords: ["summer", "beach", "tropical", "sunny", "summery"],
  },
  {
    id: "latenight",
    label: "Late night",
    emoji: "🌃",
    keywords: [
      "late night",
      "late-night",
      "midnight",
      "nocturnal",
      "after hours",
      "smoky",
      "sultry",
    ],
  },
];

// Build an inverted index once — for each lowercase keyword, the moods
// it's part of. Used by `tagMatchesMoods` to filter graph nodes quickly.
const KEYWORD_TO_MOODS: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const mood of MOODS) {
    for (const k of mood.keywords) {
      const key = k.toLowerCase();
      const set = m.get(key) ?? new Set();
      set.add(mood.id);
      m.set(key, set);
    }
  }
  return m;
})();

// Return the set of mood IDs that any of these tags imply. A tag matches
// a mood if the tag string contains the mood's keyword (case-insensitive).
export function moodsForTags(tags: string[]): Set<string> {
  const result = new Set<string>();
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    for (const [keyword, moods] of KEYWORD_TO_MOODS) {
      if (lower.includes(keyword)) {
        for (const m of moods) result.add(m);
      }
    }
  }
  return result;
}

export function nodeMatchesMoodFilter(
  tags: string[],
  selectedMoodIds: string[],
): boolean {
  if (selectedMoodIds.length === 0) return true;
  const matched = moodsForTags(tags);
  for (const sel of selectedMoodIds) {
    if (matched.has(sel)) return true;
  }
  return false;
}
