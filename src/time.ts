import type { Hemisphere, Phase, Season } from "./types";

export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
export const PHASES: Phase[] = ["dawn", "day", "dusk", "night"];

const OPPOSITE: Record<Season, Season> = {
  spring: "autumn",
  summer: "winter",
  autumn: "spring",
  winter: "summer",
};

/** Meteorological seasons: March to May is spring in the north, and autumn in
 *  the south, where everything is six months out. */
export function seasonOf(date: Date, hemisphere: Hemisphere = "north"): Season {
  const m = date.getMonth(); // 0 = Jan
  const north: Season =
    m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
  return hemisphere === "south" ? OPPOSITE[north] : north;
}

/** Time of day from the local clock. Coarse on purpose: when a weather feed
 *  supplies real sunrise and sunset, `phaseFromSun` is used instead. */
export function phaseOf(date: Date): Phase {
  const h = date.getHours();
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

const MIN = 60_000;
const DAY = 86_400_000;

/**
 * Time of day from the actual sun. Dawn runs from 40 minutes before sunrise to
 * an hour after it; dusk from an hour before sunset to 40 minutes after.
 *
 * Sunrise and sunset come from "today", but a tab can stay open past midnight,
 * so both are slid by whole days to the one that contains `now`.
 */
export function phaseFromSun(now: number, sunrise: number, sunset: number): Phase {
  const shift = Math.round((now - sunrise) / DAY) * DAY;
  const rise = sunrise + shift;
  const set = sunset + shift;
  if (now >= rise - 40 * MIN && now < rise + 60 * MIN) return "dawn";
  if (now >= rise + 60 * MIN && now < set - 60 * MIN) return "day";
  if (now >= set - 60 * MIN && now < set + 40 * MIN) return "dusk";
  return "night";
}

export function hemisphereFromLatitude(lat: number): Hemisphere {
  return lat < 0 ? "south" : "north";
}

/** Zones below the equator (or mostly so). A guess, used only until a real
 *  latitude is known. */
const SOUTHERN = [
  "Australia/",
  "Antarctica/",
  "America/Sao_Paulo",
  "America/Argentina/",
  "America/Buenos_Aires",
  "America/Santiago",
  "America/Lima",
  "America/La_Paz",
  "America/Asuncion",
  "America/Montevideo",
  "America/Bahia",
  "America/Recife",
  "America/Fortaleza",
  "America/Manaus",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Belem",
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Pacific/Fiji",
  "Pacific/Tahiti",
  "Pacific/Tongatapu",
  "Pacific/Noumea",
  "Atlantic/Stanley",
  "Africa/Johannesburg",
  "Africa/Maputo",
  "Africa/Harare",
  "Africa/Lusaka",
  "Africa/Windhoek",
  "Africa/Luanda",
  "Africa/Gaborone",
  "Africa/Maseru",
  "Africa/Mbabane",
  "Africa/Blantyre",
  "Africa/Lubumbashi",
  "Indian/Antananarivo",
  "Indian/Mauritius",
  "Indian/Reunion",
];

export function hemisphereFromTimeZone(tz: string | null): Hemisphere {
  if (!tz) return "north";
  return SOUTHERN.some((p) => tz.startsWith(p)) ? "south" : "north";
}

/** The visitor's IANA timezone, e.g. "America/New_York"; null if unknown. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
