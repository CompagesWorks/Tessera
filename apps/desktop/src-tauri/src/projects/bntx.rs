use image_dds::ddsfile::Dds;
use image_dds::{ImageFormat, Surface};
use tegra_swizzle::surface::{deswizzle_surface, BlockDim};
use tegra_swizzle::BlockHeight;

use crate::util::{Error, Result};

fn bad(message: &str) -> Error {
    Error::new(format!("invalid texture: bntx {message}"))
}

fn u16_at(bytes: &[u8], offset: usize) -> Result<u16> {
    bytes.get(offset..offset + 2).map(|b| u16::from_le_bytes([b[0], b[1]])).ok_or_else(|| bad("truncated"))
}

fn u32_at(bytes: &[u8], offset: usize) -> Result<u32> {
    bytes.get(offset..offset + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).ok_or_else(|| bad("truncated"))
}

fn offset_at(bytes: &[u8], offset: usize) -> Result<usize> {
    let value = bytes.get(offset..offset + 8).map(|b| u64::from_le_bytes(b.try_into().unwrap())).ok_or_else(|| bad("truncated"))?;
    usize::try_from(value).ok().filter(|v| *v < bytes.len()).ok_or_else(|| bad("offset out of range"))
}

fn format_of(code: u32) -> Option<(ImageFormat, BlockDim, usize)> {
    let block = BlockDim::block_4x4();
    let plain = BlockDim::uncompressed();
    Some(match code {
        0x0201 => (ImageFormat::R8Unorm, plain, 1),
        0x0901 => (ImageFormat::Rg8Unorm, plain, 2),
        0x0b01 => (ImageFormat::Rgba8Unorm, plain, 4),
        0x0b06 => (ImageFormat::Rgba8UnormSrgb, plain, 4),
        0x0c01 => (ImageFormat::Bgra8Unorm, plain, 4),
        0x0c06 => (ImageFormat::Bgra8UnormSrgb, plain, 4),
        0x1a01 => (ImageFormat::BC1RgbaUnorm, block, 8),
        0x1a06 => (ImageFormat::BC1RgbaUnormSrgb, block, 8),
        0x1b01 => (ImageFormat::BC2RgbaUnorm, block, 16),
        0x1b06 => (ImageFormat::BC2RgbaUnormSrgb, block, 16),
        0x1c01 => (ImageFormat::BC3RgbaUnorm, block, 16),
        0x1c06 => (ImageFormat::BC3RgbaUnormSrgb, block, 16),
        0x1d01 => (ImageFormat::BC4RUnorm, block, 8),
        0x1d02 => (ImageFormat::BC4RSnorm, block, 8),
        0x1e01 => (ImageFormat::BC5RgUnorm, block, 16),
        0x1e02 => (ImageFormat::BC5RgSnorm, block, 16),
        0x1f05 => (ImageFormat::BC6hRgbSfloat, block, 16),
        0x1f0a => (ImageFormat::BC6hRgbUfloat, block, 16),
        0x2001 => (ImageFormat::BC7RgbaUnorm, block, 16),
        0x2006 => (ImageFormat::BC7RgbaUnormSrgb, block, 16),
        _ => return None,
    })
}

pub fn read_bntx(bytes: &[u8]) -> Result<Dds> {
    if bytes.get(0..4) != Some(b"BNTX") || bytes.get(0x20..0x24) != Some(b"NX  ") || u16_at(bytes, 0x0c)? != 0xfeff {
        return Err(bad("header not recognized"));
    }
    if u32_at(bytes, 0x24)? == 0 {
        return Err(bad("contains no texture"));
    }
    let info = offset_at(bytes, offset_at(bytes, 0x28)?)?;
    if bytes.get(info..info + 4) != Some(b"BRTI") {
        return Err(bad("texture info not found"));
    }
    let mipmaps = u16_at(bytes, info + 0x16)? as usize;
    let code = u32_at(bytes, info + 0x1c)?;
    let width = u32_at(bytes, info + 0x24)? as usize;
    let height = u32_at(bytes, info + 0x28)? as usize;
    let depth = u32_at(bytes, info + 0x2c)?.max(1) as usize;
    let layers = u32_at(bytes, info + 0x30)?.max(1) as usize;
    let block_height = BlockHeight::new(1 << u32_at(bytes, info + 0x34)?.min(5)).ok_or_else(|| bad("invalid block height"))?;
    let size = u32_at(bytes, info + 0x50)? as usize;
    let data = offset_at(bytes, offset_at(bytes, info + 0x70)?)?;
    let (format, dim, bytes_per_block) = format_of(code).ok_or_else(|| bad(&format!("format 0x{code:04x} is not supported")))?;
    if width == 0 || height == 0 || width > 16384 || height > 16384 || mipmaps == 0 || mipmaps > 16 || layers > 6 {
        return Err(bad("invalid dimensions"));
    }
    let swizzled = bytes.get(data..data + size).ok_or_else(|| bad("truncated image data"))?;
    let linear = deswizzle_surface(width, height, depth, swizzled, dim, Some(block_height), bytes_per_block, mipmaps, layers).map_err(|e| bad(&e.to_string()))?;
    let surface = Surface {
        width: width as u32,
        height: height as u32,
        depth: depth as u32,
        layers: layers as u32,
        mipmaps: mipmaps as u32,
        image_format: format,
        data: linear,
    };
    surface.to_dds().map_err(|e| bad(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bntx(format: u32, width: u32, height: u32, data: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0u8; 0x200];
        bytes[0..4].copy_from_slice(b"BNTX");
        bytes[0x0c..0x0e].copy_from_slice(&0xfeffu16.to_le_bytes());
        bytes[0x20..0x24].copy_from_slice(b"NX  ");
        bytes[0x24..0x28].copy_from_slice(&1u32.to_le_bytes());
        bytes[0x28..0x30].copy_from_slice(&0x40u64.to_le_bytes());
        bytes[0x40..0x48].copy_from_slice(&0x80u64.to_le_bytes());
        let info = 0x80;
        bytes[info..info + 4].copy_from_slice(b"BRTI");
        bytes[info + 0x16..info + 0x18].copy_from_slice(&1u16.to_le_bytes());
        bytes[info + 0x1c..info + 0x20].copy_from_slice(&format.to_le_bytes());
        bytes[info + 0x24..info + 0x28].copy_from_slice(&width.to_le_bytes());
        bytes[info + 0x28..info + 0x2c].copy_from_slice(&height.to_le_bytes());
        bytes[info + 0x2c..info + 0x30].copy_from_slice(&1u32.to_le_bytes());
        bytes[info + 0x30..info + 0x34].copy_from_slice(&1u32.to_le_bytes());
        bytes[info + 0x50..info + 0x54].copy_from_slice(&(data.len() as u32).to_le_bytes());
        bytes[info + 0x70..info + 0x78].copy_from_slice(&0x180u64.to_le_bytes());
        bytes[0x180..0x188].copy_from_slice(&0x200u64.to_le_bytes());
        bytes.extend_from_slice(data);
        bytes
    }

    #[test]
    fn reads_an_rgba_texture() {
        let swizzled = tegra_swizzle::surface::swizzle_surface(8, 8, 1, &[200u8; 8 * 8 * 4], BlockDim::uncompressed(), Some(BlockHeight::One), 4, 1, 1).unwrap();
        let dds = read_bntx(&bntx(0x0b01, 8, 8, &swizzled)).unwrap();
        let image = image_dds::image_from_dds(&dds, 0).unwrap();
        assert_eq!((image.width(), image.get_pixel(3, 5).0), (8, [200, 200, 200, 200]));
    }

    #[test]
    fn refuses_broken_files() {
        assert!(read_bntx(b"nope").is_err());
        assert!(read_bntx(&bntx(0x9999, 8, 8, &[0; 256])).is_err());
        let mut short = bntx(0x0b01, 8, 8, &[0; 16]);
        short.truncate(0x210);
        assert!(read_bntx(&short).is_err());
    }
}

