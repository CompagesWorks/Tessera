use crate::util::{Error, Result};

fn bad(message: &str) -> Error {
    Error::new(format!("invalid texture: bntx {message}"))
}

fn u16_at(bytes: &[u8], at: usize) -> Result<u16> {
    bytes.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]])).ok_or_else(|| bad("truncated"))
}

fn u32_at(bytes: &[u8], at: usize) -> Result<u32> {
    bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).ok_or_else(|| bad("truncated"))
}

fn ptr_at(bytes: &[u8], at: usize) -> Result<usize> {
    let value = bytes.get(at..at + 8).map(|b| u64::from_le_bytes(b.try_into().unwrap())).ok_or_else(|| bad("truncated"))?;
    usize::try_from(value).ok().filter(|v| *v <= bytes.len()).ok_or_else(|| bad("offset out of range"))
}

fn string_at(bytes: &[u8], at: usize) -> Result<String> {
    let length = u16_at(bytes, at)? as usize;
    let raw = bytes.get(at + 2..at + 2 + length).ok_or_else(|| bad("truncated string"))?;
    Ok(String::from_utf8_lossy(raw).into_owned())
}

const INFO_SIZE: usize = 0xa0;
const RUNTIME_SIZE: usize = 0x200;

#[derive(Clone)]
pub struct Texture {
    pub name: String,
    pub info: Vec<u8>,
    pub data: Vec<u8>,
    pub mips: Vec<usize>,
}

impl Texture {
    pub fn alignment(&self) -> usize {
        (u32::from_le_bytes(self.info[0x54..0x58].try_into().unwrap()) as usize).max(1)
    }
}

pub struct BntxFile {
    header: Vec<u8>,
    nx: Vec<u8>,
    pool: Vec<u8>,
    file_name: String,
    strings: Vec<String>,
    null_pointers: bool,
    pub textures: Vec<Texture>,
}

impl BntxFile {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.get(0..4) != Some(b"BNTX") || bytes.get(0x20..0x24) != Some(b"NX  ") || u16_at(bytes, 0x0c)? != 0xfeff {
            return Err(bad("header not recognized"));
        }
        let count = u32_at(bytes, 0x24)? as usize;
        let table = ptr_at(bytes, 0x28)?;
        let pool_start = ptr_at(bytes, 0x40)?;
        if count > 4096 || pool_start < 0x58 || table < pool_start {
            return Err(bad("invalid layout"));
        }
        let strings_at = u16_at(bytes, 0x16)? as usize;
        if bytes.get(strings_at..strings_at + 4) != Some(b"_STR") {
            return Err(bad("string table not found"));
        }
        let string_count = u32_at(bytes, strings_at + 0x10)? as usize;
        let mut strings = Vec::with_capacity(string_count);
        let mut cursor = strings_at + 0x18;
        for _ in 0..string_count.min(8192) {
            let value = string_at(bytes, cursor)?;
            cursor += 2 + value.len() + 1;
            cursor += cursor % 2;
            strings.push(value);
        }
        let file_name = string_at(bytes, u32_at(bytes, 0x10)? as usize - 2)?;
        let mut textures = Vec::with_capacity(count);
        for index in 0..count {
            let info = ptr_at(bytes, table + index * 8)?;
            if bytes.get(info..info + 4) != Some(b"BRTI") {
                return Err(bad("texture info not found"));
            }
            let mip_count = u16_at(bytes, info + 0x16)? as usize;
            let size = u32_at(bytes, info + 0x50)? as usize;
            let mip_table = ptr_at(bytes, info + 0x70)?;
            let mips: Vec<usize> = (0..mip_count).map(|m| ptr_at(bytes, mip_table + m * 8)).collect::<Result<_>>()?;
            let start = *mips.first().ok_or_else(|| bad("texture without mips"))?;
            let data = bytes.get(start..start + size).ok_or_else(|| bad("truncated image data"))?.to_vec();
            textures.push(Texture {
                name: string_at(bytes, ptr_at(bytes, info + 0x60)?)?,
                info: bytes[info..info + INFO_SIZE].to_vec(),
                data,
                mips: mips.iter().map(|m| m - start).collect(),
            });
        }
        let first = if count > 0 { ptr_at(bytes, table)? } else { 0 };
        let null_pointers = count > 0 && decode_relocations(bytes).map(|sections| sections.first().is_some_and(|s| s.contains(&(first + 0x78)))).unwrap_or(false);
        Ok(BntxFile { header: bytes[0..0x20].to_vec(), nx: bytes[0x20..0x58].to_vec(), pool: bytes[pool_start..table].to_vec(), file_name, strings, null_pointers, textures })
    }

    pub fn add(&mut self, texture: Texture) -> Result<()> {
        if self.textures.iter().any(|t| t.name == texture.name) {
            return Err(Error::new("a texture with this name already exists"));
        }
        if !self.strings.contains(&texture.name) {
            self.strings.push(texture.name.clone());
        }
        self.textures.push(texture);
        Ok(())
    }

    pub fn write(&self) -> Vec<u8> {
        let align = |value: usize, to: usize| value.div_ceil(to) * to;
        let mut out = vec![0u8; 0x58];
        out[0..0x20].copy_from_slice(&self.header);
        out[0x20..0x58].copy_from_slice(&self.nx);
        let mut section0 = vec![0x28usize, 0x38, 0x40];
        let mut section1 = vec![0x30usize];
        let put_u16 = |out: &mut Vec<u8>, at: usize, value: u16| out[at..at + 2].copy_from_slice(&value.to_le_bytes());
        let put_u32 = |out: &mut Vec<u8>, at: usize, value: u32| out[at..at + 4].copy_from_slice(&value.to_le_bytes());
        let put_u64 = |out: &mut Vec<u8>, at: usize, value: usize| out[at..at + 8].copy_from_slice(&(value as u64).to_le_bytes());

        let pool = out.len();
        put_u64(&mut out, 0x40, pool);
        out.extend_from_slice(&self.pool);
        let table = out.len();
        put_u32(&mut out, 0x24, self.textures.len() as u32);
        put_u64(&mut out, 0x28, table);
        out.resize(table + self.textures.len() * 8, 0);
        section0.extend((0..self.textures.len()).map(|i| table + i * 8));

        let strings_at = align(out.len(), 8);
        out.resize(strings_at + 0x18, 0);
        out[strings_at..strings_at + 4].copy_from_slice(b"_STR");
        put_u32(&mut out, strings_at + 0x10, self.strings.len() as u32);
        let empty = strings_at + 0x14;
        let mut positions = std::collections::HashMap::new();
        for value in &self.strings {
            positions.entry(value.clone()).or_insert(out.len());
            out.extend_from_slice(&(value.len() as u16).to_le_bytes());
            out.extend_from_slice(value.as_bytes());
            out.push(0);
            if out.len() % 2 == 1 {
                out.push(0);
            }
        }
        put_u16(&mut out, 0x16, strings_at as u16);
        put_u32(&mut out, 0x10, (positions[&self.file_name] + 2) as u32);

        let dictionary = align(out.len(), 8);
        out.resize(dictionary + 8, 0);
        out[dictionary..dictionary + 4].copy_from_slice(b"_DIC");
        put_u32(&mut out, dictionary + 4, self.textures.len() as u32);
        put_u64(&mut out, 0x38, dictionary);
        let names: Vec<&str> = self.textures.iter().map(|t| t.name.as_str()).collect();
        for (i, node) in build_dictionary(&names).iter().enumerate() {
            let at = out.len();
            out.resize(at + 16, 0);
            put_u32(&mut out, at, node.reference as u32);
            put_u16(&mut out, at + 4, node.left);
            put_u16(&mut out, at + 6, node.right);
            put_u64(&mut out, at + 8, if i == 0 { empty } else { positions[&self.textures[i - 1].name] });
            section0.push(at + 8);
        }

        let mut infos = Vec::new();
        let first_info = align(out.len(), 8);
        out.resize(first_info, 0);
        let block = strings_at;
        put_u32(&mut out, block + 4, (first_info - block) as u32);
        put_u64(&mut out, block + 8, first_info - block);
        for (index, texture) in self.textures.iter().enumerate() {
            let at = out.len();
            infos.push(at);
            put_u64(&mut out, table + index * 8, at);
            let size = INFO_SIZE + RUNTIME_SIZE + texture.mips.len() * 8;
            out.extend_from_slice(&texture.info);
            out.resize(at + size, 0);
            out[at..at + 4].copy_from_slice(b"BRTI");
            put_u32(&mut out, at + 4, size as u32);
            put_u64(&mut out, at + 8, size);
            put_u16(&mut out, at + 0x16, texture.mips.len() as u16);
            put_u32(&mut out, at + 0x50, texture.data.len() as u32);
            put_u64(&mut out, at + 0x60, positions[&texture.name]);
            put_u64(&mut out, at + 0x68, 0x20);
            put_u64(&mut out, at + 0x70, at + INFO_SIZE + RUNTIME_SIZE);
            put_u64(&mut out, at + 0x80, at + INFO_SIZE);
            put_u64(&mut out, at + 0x88, at + INFO_SIZE + 0x100);
            section0.extend([at + 0x60, at + 0x68, at + 0x70, at + 0x80, at + 0x88]);
            if self.null_pointers {
                section0.extend([at + 0x78, at + 0x98]);
            }
        }
        let section0_size = out.len();

        let data_alignment = 1usize << self.header[0x0e].min(16);
        let brtd = align(out.len() + 0x10, data_alignment) - 0x10;
        if let Some(last) = infos.last() {
            put_u32(&mut out, last + 4, (brtd - last) as u32);
            put_u64(&mut out, last + 8, brtd - last);
        }
        out.resize(brtd + 0x10, 0);
        out[brtd..brtd + 4].copy_from_slice(b"BRTD");
        put_u64(&mut out, 0x30, brtd);
        for (texture, info) in self.textures.iter().zip(&infos) {
            let start = align(out.len(), texture.alignment());
            out.resize(start, 0);
            out.extend_from_slice(&texture.data);
            for (m, offset) in texture.mips.iter().enumerate() {
                let slot = info + INFO_SIZE + RUNTIME_SIZE + m * 8;
                put_u64(&mut out, slot, start + offset);
                section1.push(slot);
            }
        }
        let relocations = align(out.len(), data_alignment);
        out.resize(relocations, 0);
        put_u64(&mut out, brtd + 8, relocations - brtd);

        let entries0 = encode_relocations(&mut section0);
        let entries1 = encode_relocations(&mut section1);
        out.extend_from_slice(b"_RLT");
        out.extend_from_slice(&(relocations as u32).to_le_bytes());
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        for (start, size, first, count) in [(0usize, section0_size, 0usize, entries0.len()), (brtd, relocations - brtd, entries0.len(), entries1.len())] {
            out.extend_from_slice(&0u64.to_le_bytes());
            for value in [start, size, first, count] {
                out.extend_from_slice(&(value as u32).to_le_bytes());
            }
        }
        for (position, structs, offsets, padding) in entries0.iter().chain(&entries1) {
            out.extend_from_slice(&(*position as u32).to_le_bytes());
            out.extend_from_slice(&(*structs as u16).to_le_bytes());
            out.push(*offsets as u8);
            out.push(*padding as u8);
        }
        put_u32(&mut out, 0x18, relocations as u32);
        let total = out.len();
        put_u32(&mut out, 0x1c, total as u32);
        out
    }
}

pub struct DictionaryNode {
    pub reference: i32,
    pub left: u16,
    pub right: u16,
}

fn bit(key: &[u8], n: i32) -> bool {
    let index = (n >> 3) as usize;
    index < key.len() && (key[key.len() - 1 - index] >> (n & 7)) & 1 == 1
}

pub fn build_dictionary(names: &[&str]) -> Vec<DictionaryNode> {
    let mut nodes = vec![(DictionaryNode { reference: -1, left: 0, right: 0 }, Vec::<u8>::new())];
    for name in names {
        let key = name.as_bytes().to_vec();
        let walk = |nodes: &Vec<(DictionaryNode, Vec<u8>)>, limit: Option<i32>| {
            let (mut parent, mut current) = (0usize, nodes[0].0.left as usize);
            while nodes[parent].0.reference < nodes[current].0.reference && limit.is_none_or(|l| nodes[current].0.reference < l) {
                parent = current;
                current = if bit(&key, nodes[current].0.reference) { nodes[current].0.right } else { nodes[current].0.left } as usize;
            }
            (parent, current)
        };
        let (_, closest) = walk(&nodes, None);
        let other = nodes[closest].1.clone();
        let longest = key.len().max(other.len()) as i32 * 8;
        let reference = (0..longest).find(|n| bit(&key, *n) != bit(&other, *n)).unwrap_or(-1);
        let (parent, current) = walk(&nodes, Some(reference));
        let index = nodes.len() as u16;
        let node = if bit(&key, reference) {
            DictionaryNode { reference, left: current as u16, right: index }
        } else {
            DictionaryNode { reference, left: index, right: current as u16 }
        };
        nodes.push((node, key.clone()));
        if parent == 0 || !bit(&key, nodes[parent].0.reference) {
            nodes[parent].0.left = index;
        } else {
            nodes[parent].0.right = index;
        }
    }
    nodes.into_iter().map(|(node, _)| node).collect()
}

fn encode_relocations(positions: &mut [usize]) -> Vec<(usize, usize, usize, usize)> {
    positions.sort_unstable();
    let mut entries = Vec::new();
    let mut i = 0;
    while i < positions.len() {
        let start = positions[i];
        let mut offsets = 1;
        while i + offsets < positions.len() && offsets < 255 && positions[i + offsets] == start + offsets * 8 {
            offsets += 1;
        }
        let mut structs = 1;
        let mut padding = 0;
        if let Some(&next) = positions.get(i + offsets) {
            let gap = next - (start + offsets * 8);
            if gap % 8 == 0 && gap / 8 <= 255 {
                let stride = offsets * 8 + gap;
                let repeats = |k: usize| (0..offsets).all(|o| positions.get(i + k * offsets + o) == Some(&(start + k * stride + o * 8)));
                let mut count = 1;
                while count < 0xffff && repeats(count) {
                    count += 1;
                }
                if count > 1 {
                    structs = count;
                    padding = gap / 8;
                }
            }
        }
        entries.push((start, structs, offsets, padding));
        i += structs * offsets;
    }
    entries
}

pub fn decode_relocations(bytes: &[u8]) -> Result<Vec<Vec<usize>>> {
    let at = u32_at(bytes, 0x18)? as usize;
    if bytes.get(at..at + 4) != Some(b"_RLT") {
        return Err(bad("relocation table not found"));
    }
    let sections = u32_at(bytes, at + 8)? as usize;
    let entries_at = at + 0x10 + sections * 0x18;
    let mut result = Vec::new();
    for s in 0..sections {
        let base = at + 0x10 + s * 0x18;
        let (first, count) = (u32_at(bytes, base + 0x10)? as usize, u32_at(bytes, base + 0x14)? as usize);
        let mut positions = Vec::new();
        for e in first..first + count {
            let entry = entries_at + e * 8;
            let position = u32_at(bytes, entry)? as usize;
            let structs = u16_at(bytes, entry + 4)? as usize;
            let (offsets, padding) = (bytes[entry + 6] as usize, bytes[entry + 7] as usize);
            for k in 0..structs {
                for o in 0..offsets {
                    positions.push(position + k * (offsets + padding) * 8 + o * 8);
                }
            }
        }
        positions.sort_unstable();
        result.push(positions);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relocations_round_trip() {
        let mut positions = vec![0x28, 0x38, 0x40, 0x600, 0x610, 0x620, 0x630, 0x868, 0x870, 0xb10, 0xb18];
        let encoded = encode_relocations(&mut positions.clone());
        let mut decoded = Vec::new();
        for (position, structs, offsets, padding) in encoded {
            for k in 0..structs {
                for o in 0..offsets {
                    decoded.push(position + k * (offsets + padding) * 8 + o * 8);
                }
            }
        }
        positions.sort_unstable();
        assert_eq!(decoded, positions);
    }

    #[test]
    fn dictionary_finds_every_name() {
        let names = ["com_black16^t", "com_white32^u", "a", "b", "option_button_top_cnr2_00_l^u"];
        let nodes = build_dictionary(&names);
        for (index, name) in names.iter().enumerate() {
            let key = name.as_bytes();
            let (mut parent, mut current) = (0usize, nodes[0].left as usize);
            while nodes[parent].reference < nodes[current].reference {
                parent = current;
                current = if bit(key, nodes[current].reference) { nodes[current].right } else { nodes[current].left } as usize;
            }
            assert_eq!(current, index + 1, "{name}");
        }
    }
}
