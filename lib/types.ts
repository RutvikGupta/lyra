export type Play = {
  ts: number;
  msPlayed: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  trackUri?: string;
  reasonStart?: string;
  reasonEnd?: string;
  shuffle?: boolean;
  skipped?: boolean;
};

export type Track = {
  key: string;
  uri?: string;
  name: string;
  artistName: string;
  albumName?: string;
  playCount: number;
  totalMsPlayed: number;
  firstPlayed: number;
  lastPlayed: number;
  hasUri: boolean;
};

export type Artist = {
  key: string;
  name: string;
  trackCount: number;
  playCount: number;
  totalMsPlayed: number;
};

export type HistorySource = "extended" | "account" | "mixed";

export type ParsedHistory = {
  source: HistorySource;
  plays: Play[];
  tracks: Map<string, Track>;
  artists: Map<string, Artist>;
  totalPlays: number;
  totalMsPlayed: number;
  earliest: number;
  latest: number;
  parsedAt: number;
};

export type StoredHistory = Omit<ParsedHistory, "tracks" | "artists"> & {
  tracks: Track[];
  artists: Artist[];
};
