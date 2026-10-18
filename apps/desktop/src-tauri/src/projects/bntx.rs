use image_dds::ddsfile::Dds;
use image::{imageops, RgbaImage};
use image_dds::{ImageFormat, Mipmaps, Quality, Surface, SurfaceRgba8};
use tegra_swizzle::surface::{deswizzle_surface, swizzle_surface, BlockDim};
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

pub const IDENTITY_CHANNELS: [u8; 4] = [2, 3, 4, 5];

pub struct BntxTexture {
    pub dds: Dds,
    pub channels: [u8; 4],
}

fn texture_name(bytes: &[u8], info: usize) -> Result<String> {
    let at = offset_at(bytes, info + 0x60)?;
    let length = u16_at(bytes, at)? as usize;
    let name = bytes.get(at + 2..at + 2 + length).ok_or_else(|| bad("truncated name"))?;
    Ok(String::from_utf8_lossy(name).into_owned())
}

pub fn read_bntx(bytes: &[u8]) -> Result<Dds> {
    Ok(read_bntx_texture(bytes, None)?.dds)
}

struct Info {
    channels: [u8; 4],
    mipmaps: usize,
    width: usize,
    height: usize,
    depth: usize,
    layers: usize,
    block_height: BlockHeight,
    size: usize,
    data: usize,
    format: ImageFormat,
    dim: BlockDim,
    bytes_per_block: usize,
}

fn locate(bytes: &[u8], name: Option<&str>) -> Result<Info> {
    if bytes.get(0..4) != Some(b"BNTX") || bytes.get(0x20..0x24) != Some(b"NX  ") || u16_at(bytes, 0x0c)? != 0xfeff {
        return Err(bad("header not recognized"));
    }
    let count = u32_at(bytes, 0x24)? as usize;
    if count == 0 {
        return Err(bad("contains no texture"));
    }
    let table = offset_at(bytes, 0x28)?;
    let mut found = None;
    for index in 0..count.min(4096) {
        let info = offset_at(bytes, table + index * 8)?;
        if bytes.get(info..info + 4) != Some(b"BRTI") {
            return Err(bad("texture info not found"));
        }
        if name.is_none() || texture_name(bytes, info)? == name.unwrap_or_default() {
            found = Some(info);
            break;
        }
    }
    let info = found.ok_or_else(|| bad("texture not found"))?;
    let channels = match bytes.get(info + 0x58..info + 0x5c) {
        Some(&[r, g, b, a]) if [r, g, b, a].iter().all(|c| *c <= 5) && [r, g, b, a] != [0; 4] => [r, g, b, a],
        _ => IDENTITY_CHANNELS,
    };
    let code = u32_at(bytes, info + 0x1c)?;
    let (format, dim, bytes_per_block) = format_of(code).ok_or_else(|| bad(&format!("format 0x{code:04x} is not supported")))?;
    let found = Info {
        channels,
        mipmaps: u16_at(bytes, info + 0x16)? as usize,
        width: u32_at(bytes, info + 0x24)? as usize,
        height: u32_at(bytes, info + 0x28)? as usize,
        depth: u32_at(bytes, info + 0x2c)?.max(1) as usize,
        layers: u32_at(bytes, info + 0x30)?.max(1) as usize,
        block_height: BlockHeight::new(1 << u32_at(bytes, info + 0x34)?.min(5)).ok_or_else(|| bad("invalid block height"))?,
        size: u32_at(bytes, info + 0x50)? as usize,
        data: offset_at(bytes, offset_at(bytes, info + 0x70)?)?,
        format,
        dim,
        bytes_per_block,
    };
    if found.width == 0 || found.height == 0 || found.width > 16384 || found.height > 16384 || found.mipmaps == 0 || found.mipmaps > 16 || found.layers > 6 {
        return Err(bad("invalid dimensions"));
    }
    if bytes.len() < found.data + found.size {
        return Err(bad("truncated image data"));
    }
    Ok(found)
}

pub fn read_bntx_texture(bytes: &[u8], name: Option<&str>) -> Result<BntxTexture> {
    let info = locate(bytes, name)?;
    let swizzled = &bytes[info.data..info.data + info.size];
    let linear = deswizzle_surface(info.width, info.height, info.depth, swizzled, info.dim, Some(info.block_height), info.bytes_per_block, info.mipmaps, info.layers).map_err(|e| bad(&e.to_string()))?;
    let surface = Surface {
        width: info.width as u32,
        height: info.height as u32,
        depth: info.depth as u32,
        layers: info.layers as u32,
        mipmaps: info.mipmaps as u32,
        image_format: info.format,
        data: linear,
    };
    Ok(BntxTexture { dds: surface.to_dds().map_err(|e| bad(&e.to_string()))?, channels: info.channels })
}

fn stored(image: &RgbaImage, channels: [u8; 4]) -> Vec<u8> {
    let mut stored = vec![0u8; image.as_raw().len()];
    for (pixel, out) in image.pixels().zip(stored.chunks_exact_mut(4)) {
        out[3] = 255;
        let mut written = [false; 4];
        for (shown, selector) in channels.iter().enumerate() {
            if *selector >= 2 && !written[(*selector - 2) as usize] {
                out[(*selector - 2) as usize] = pixel.0[shown];
                written[(*selector - 2) as usize] = true;
            }
        }
    }
    stored
}

const CODES: [u32; 20] = [0x0201, 0x0901, 0x0b01, 0x0b06, 0x0c01, 0x0c06, 0x1a01, 0x1a06, 0x1b01, 0x1b06, 0x1c01, 0x1c06, 0x1d01, 0x1d02, 0x1e01, 0x1e02, 0x1f05, 0x1f0a, 0x2001, 0x2006];

pub fn default_channels(format: ImageFormat) -> [u8; 4] {
    match format {
        ImageFormat::BC4RUnorm | ImageFormat::BC4RSnorm => [1, 1, 1, 2],
        ImageFormat::BC5RgUnorm | ImageFormat::BC5RgSnorm => [2, 2, 2, 3],
        _ => IDENTITY_CHANNELS,
    }
}

pub fn new_bntx_texture(template: &[u8], name: &str, image: &RgbaImage, format: ImageFormat) -> Result<crate::projects::bntx_file::Texture> {
    let code = CODES.iter().copied().find(|code| format_of(*code).map(|f| f.0) == Some(format)).ok_or_else(|| bad("format is not supported"))?;
    let (_, dim, bytes_per_block) = format_of(code).unwrap();
    let (width, height) = (image.width() as usize, image.height() as usize);
    if width == 0 || height == 0 || width > 16384 || height > 16384 {
        return Err(bad("invalid dimensions"));
    }
    let channels = default_channels(format);
    let block_height = tegra_swizzle::block_height_mip0(height.div_ceil(dim.height.get()));
    let surface = SurfaceRgba8 { width: width as u32, height: height as u32, depth: 1, layers: 1, mipmaps: 1, data: stored(image, channels) };
    let encoded = surface.encode(format, Quality::Normal, Mipmaps::Disabled).map_err(|e| bad(&e.to_string()))?;
    let data = swizzle_surface(width, height, 1, &encoded.data, dim, Some(block_height), bytes_per_block, 1, 1).map_err(|e| bad(&e.to_string()))?;
    let mut info = template.to_vec();
    info.resize(0xa0, 0);
    info[0x10] = 1;
    info[0x11] = 2;
    info[0x12..0x16].fill(0);
    info[0x18..0x1c].copy_from_slice(&1u32.to_le_bytes());
    info[0x1c..0x20].copy_from_slice(&code.to_le_bytes());
    info[0x20..0x24].copy_from_slice(&0x20u32.to_le_bytes());
    info[0x24..0x28].copy_from_slice(&(width as u32).to_le_bytes());
    info[0x28..0x2c].copy_from_slice(&(height as u32).to_le_bytes());
    info[0x2c..0x30].copy_from_slice(&1u32.to_le_bytes());
    info[0x30..0x34].copy_from_slice(&1u32.to_le_bytes());
    info[0x34..0x38].copy_from_slice(&(block_height as u32).trailing_zeros().to_le_bytes());
    info[0x40..0x50].fill(0);
    info[0x54..0x58].copy_from_slice(&0x200u32.to_le_bytes());
    info[0x58..0x5c].copy_from_slice(&channels);
    info[0x5c..0x60].copy_from_slice(&1u32.to_le_bytes());
    info[0x60..0xa0].fill(0);
    Ok(crate::projects::bntx_file::Texture { name: name.to_owned(), info, data, mips: vec![0] })
}

pub fn replace_bntx_texture(bytes: &[u8], name: Option<&str>, image: &RgbaImage) -> Result<Vec<u8>> {
    let info = locate(bytes, name)?;
    if info.depth != 1 || info.layers != 1 {
        return Err(bad("only flat textures can be replaced"));
    }
    let resized = if image.dimensions() == (info.width as u32, info.height as u32) {
        image.clone()
    } else {
        imageops::resize(image, info.width as u32, info.height as u32, imageops::FilterType::Lanczos3)
    };
    let surface = SurfaceRgba8 { width: info.width as u32, height: info.height as u32, depth: 1, layers: 1, mipmaps: 1, data: stored(&resized, info.channels) };
    let encoded = surface.encode(info.format, Quality::Normal, Mipmaps::GeneratedExact(info.mipmaps as u32)).map_err(|e| bad(&e.to_string()))?;
    let swizzled = swizzle_surface(info.width, info.height, 1, &encoded.data, info.dim, Some(info.block_height), info.bytes_per_block, info.mipmaps, 1).map_err(|e| bad(&e.to_string()))?;
    if swizzled.len() > info.size {
        return Err(bad("encoded texture does not fit"));
    }
    let mut out = bytes.to_vec();
    out[info.data..info.data + swizzled.len()].copy_from_slice(&swizzled);
    Ok(out)
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
    fn picks_a_texture_by_name_with_its_channels() {
        let swizzled = tegra_swizzle::surface::swizzle_surface(8, 8, 1, &[200u8; 8 * 8 * 4], BlockDim::uncompressed(), Some(BlockHeight::One), 4, 1, 1).unwrap();
        let mut bytes = bntx(0x0b01, 8, 8, &swizzled);
        bytes[0x80 + 0x58..0x80 + 0x5c].copy_from_slice(&[1, 1, 1, 2]);
        bytes[0x80 + 0x60..0x80 + 0x68].copy_from_slice(&0x1c0u64.to_le_bytes());
        bytes[0x1c0..0x1c2].copy_from_slice(&4u16.to_le_bytes());
        bytes[0x1c2..0x1c6].copy_from_slice(b"bg^s");
        assert_eq!(read_bntx_texture(&bytes, Some("bg^s")).unwrap().channels, [1, 1, 1, 2]);
        assert!(read_bntx_texture(&bytes, Some("other")).is_err());
        assert_eq!(read_bntx_texture(&bytes, None).unwrap().channels, [1, 1, 1, 2]);
    }

    #[test]
    fn replaces_a_texture_in_place() {
        let swizzled = tegra_swizzle::surface::swizzle_surface(8, 8, 1, &[200u8; 8 * 8 * 4], BlockDim::uncompressed(), Some(BlockHeight::One), 4, 1, 1).unwrap();
        let mut bytes = bntx(0x0b01, 8, 8, &swizzled);
        bytes[0x80 + 0x58..0x80 + 0x5c].copy_from_slice(&[1, 1, 1, 2]);
        let image = RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 77]));
        let replaced = replace_bntx_texture(&bytes, None, &image).unwrap();
        assert_eq!(replaced.len(), bytes.len());
        let texture = read_bntx_texture(&replaced, None).unwrap();
        let decoded = image_dds::image_from_dds(&texture.dds, 0).unwrap();
        assert_eq!((decoded.width(), decoded.get_pixel(2, 6).0[0]), (8, 77));
    }

    #[test]
    fn new_texture_matches_the_layout_of_a_real_one() {
        let image = RgbaImage::from_pixel(16, 56, image::Rgba([255, 255, 255, 128]));
        let texture = new_bntx_texture(&[0u8; 0xa0], "bg^s", &image, ImageFormat::BC4RUnorm).unwrap();
        assert_eq!(&texture.info[0x1c..0x20], &0x1d01u32.to_le_bytes());
        assert_eq!(&texture.info[0x58..0x5c], &[1, 1, 1, 2]);
        assert_eq!(texture.data.len(), 0x400);
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

