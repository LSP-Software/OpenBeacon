const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const ownedDeviceName = ({
  deviceName,
  ownerNames,
  isYou,
}: {
  deviceName: string;
  ownerNames: readonly string[];
  isYou: boolean;
}) => {
  const name = deviceName.normalize("NFC").trim();
  const names = ownerNames.map((owner) => owner.normalize("NFC").trim()).filter(Boolean);
  const prefix = isYou ? "Your" : `${names[0] ?? "Someone"}’s`;
  const candidates = [...new Set(names.flatMap((owner) => [owner, owner.split(/\s+/)[0] ?? owner]))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  if (candidates) {
    const possessive = new RegExp(`^(?:${candidates})(?:['’]s?)\\s+(\\S.*)$`, "iu").exec(name);
    if (possessive?.[1]) return `${prefix} ${possessive[1]}`;
    if (new RegExp(`^(?:${candidates})(?![\\p{L}\\p{N}])`, "iu").test(name)) return name;
  }
  const mine = /^my\s+(\S.*)$/iu.exec(name);
  if (mine?.[1]) return `${prefix} ${mine[1]}`;
  if (/^[\p{L}\p{N}-]+['’]s?\s/u.test(name)) return name;
  return `${prefix} ${name}`;
};
