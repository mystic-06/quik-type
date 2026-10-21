// Reads a team list (roster) from CSV. Two layouts are understood, the same two the Matiks event roster takes:
//   1. one row per team:   team_name, email_1, email_2, email_3, email_4
//   2. an Unstop export, one row per person:   ... Team Name ... Candidate's Name, Candidate's Email, Candidate Type ...
// The first email of a team (or the person typed "leader") is the captain.

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const RESERVED = new Set(["SYSTEM"]);
const isEmail = (value) => Boolean(value) && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

/** A short code made of the team's name ("Team Alpha!" becomes "TEAMALPH"), or TM01, TM02... when that is too short. */
function slugFor(teamName, fallbackNumber) {
  const slug = teamName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (slug.length >= 3 && !RESERVED.has(slug)) return slug;
  return `TM${String(fallbackNumber).padStart(2, "0")}`;
}

/** @returns {{ teamName: string, teamCode: string, targetSize: number, members: { email: string, name: string, isLeader: boolean }[] }[]} */
function parseRosterCsv(content) {
  const lines = String(content).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const headerKey = header.map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  const consolidated = headerKey.some((h) => h.startsWith("email1") || h.startsWith("email_1"));

  const teams = [];
  if (consolidated) {
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const teamName = cols[0]?.trim();
      if (!teamName) continue;
      const emails = [...new Set(cols.slice(1).map((e) => e.toLowerCase().trim()).filter(isEmail))];
      if (emails.length === 0) continue;
      teams.push({
        teamName,
        teamCode: slugFor(teamName, i),
        targetSize: emails.length,
        members: emails.map((email, idx) => ({ email, name: email.split("@")[0], isLeader: idx === 0 })),
      });
    }
    return teams;
  }

  const find = (predicate, fallback) => {
    const idx = header.findIndex((h) => predicate(h.toLowerCase().trim()));
    return idx === -1 ? fallback : idx;
  };
  const teamCol = find((h) => h.includes("team name"), 1);
  const emailCol = find((h) => h === "candidate's email" || h === "candidate email", 5);
  const nameCol = find((h) => h === "candidate's name" || h === "candidate name", 4);
  const typeCol = find((h) => h === "candidate type", 3);

  const byName = new Map();
  let counter = 1;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const teamName = cols[teamCol]?.trim();
    const email = cols[emailCol]?.toLowerCase().trim();
    if (!teamName || !isEmail(email)) continue;

    if (!byName.has(teamName)) {
      byName.set(teamName, { teamName, teamCode: slugFor(teamName, counter++), targetSize: 0, members: [] });
    }
    const team = byName.get(teamName);
    if (!team.members.some((m) => m.email === email)) {
      team.members.push({
        email,
        name: cols[nameCol]?.trim() || email.split("@")[0],
        isLeader: Boolean(cols[typeCol]?.toLowerCase().includes("leader")),
      });
    }
  }

  for (const team of byName.values()) {
    team.targetSize = team.members.length;
    if (!team.members.some((m) => m.isLeader)) team.members[0].isLeader = true;
    teams.push(team);
  }
  return teams;
}

module.exports = { parseRosterCsv, parseCsvLine };
