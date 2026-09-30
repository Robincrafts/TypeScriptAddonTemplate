// Minimal reader for Valve VPK (v1/v2) directory files: lists entries matching a text, or extracts one entry.
// Used to copy the Dota map's minimap texture (materials/overviews/...) for our pick-mode maps.
// Usage: node scripts/vpk_extract.js <pak01_dir.vpk> list <text>
//        node scripts/vpk_extract.js <pak01_dir.vpk> get <path inside vpk> <output file>
const fs = require("fs");
const path = require("path");

function readDirectory(dirFile) {
    const buffer = fs.readFileSync(dirFile);
    const signature = buffer.readUInt32LE(0);
    if (signature !== 0x55aa1234) throw new Error("Not a VPK directory file");
    const version = buffer.readUInt32LE(4);
    const treeSize = buffer.readUInt32LE(8);
    const headerSize = version === 2 ? 28 : 12;
    let offset = headerSize;
    const end = headerSize + treeSize;
    const readString = () => {
        const start = offset;
        while (buffer[offset] !== 0) offset++;
        const text = buffer.toString("utf8", start, offset);
        offset++;
        return text;
    };
    const entries = [];
    while (offset < end) {
        const extension = readString();
        if (extension === "") break;
        while (true) {
            const folder = readString();
            if (folder === "") break;
            while (true) {
                const name = readString();
                if (name === "") break;
                const crc = buffer.readUInt32LE(offset);
                const preloadBytes = buffer.readUInt16LE(offset + 4);
                const archiveIndex = buffer.readUInt16LE(offset + 6);
                const entryOffset = buffer.readUInt32LE(offset + 8);
                const entryLength = buffer.readUInt32LE(offset + 12);
                offset += 18; // 16 bytes + 0xFFFF terminator
                const preload = buffer.subarray(offset, offset + preloadBytes);
                offset += preloadBytes;
                const full = `${folder === " " ? "" : `${folder}/`}${name}.${extension}`;
                entries.push({ path: full, crc, archiveIndex, entryOffset, entryLength, preload });
            }
        }
    }
    return { entries, dataStart: end, version };
}

const [dirFile, command, arg, output] = process.argv.slice(2);
const { entries, dataStart } = readDirectory(dirFile);
if (command === "list") {
    for (const entry of entries) if (entry.path.includes(arg)) console.log(entry.path, entry.entryLength + entry.preload.length);
} else if (command === "get") {
    const entry = entries.find(item => item.path === arg);
    if (!entry) throw new Error(`Not found: ${arg}`);
    let data = entry.preload;
    if (entry.entryLength > 0) {
        const archive =
            entry.archiveIndex === 0x7fff
                ? dirFile
                : dirFile.replace(/_dir\.vpk$/, `_${String(entry.archiveIndex).padStart(3, "0")}.vpk`);
        const fd = fs.openSync(archive, "r");
        const chunk = Buffer.alloc(entry.entryLength);
        const base = entry.archiveIndex === 0x7fff ? dataStart : 0;
        fs.readSync(fd, chunk, 0, entry.entryLength, base + entry.entryOffset);
        fs.closeSync(fd);
        data = Buffer.concat([data, chunk]);
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, data);
    console.log(`Wrote ${output} (${data.length} bytes)`);
}
