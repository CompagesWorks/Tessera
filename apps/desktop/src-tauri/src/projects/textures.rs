use std::io::Cursor;
use std::path::Path;
use std::str::FromStr;

use base64::Engine;
use image::{ImageFormat as FileFormat, RgbaImage};
use serde::Serialize;
use image_dds::ddsfile::Dds;
use image_dds::{dds_image_format, image_from_dds, ImageFormat, Mipmaps, Quality, SurfaceRgba8};
use nutexb::NutexbFile;

use crate::util::{Error, Result};

const PREVIEW_SIZE: u32 = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Image(FileFormat),
    Dds,
    Nutexb,
}

enum Source {
    Image(RgbaImage),
    Dds(Dds),
}

#[derive(Debug, Serialize)]
pub struct Preview {
    pub data: String,
    pub width: u32,
    pub height: u32,
    pub format: Option<String>,
    pub mipmaps: u32,
}

pub struct Options {
    pub format: Option<ImageFormat>,
    pub mipmaps: Mipmaps,
    pub quality: Quality,
    pub gamma_fix: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options { format: None, mipmaps: Mipmaps::GeneratedAutomatic, quality: Quality::Normal, gamma_fix: false }
    }
}

const SMASH_GAMMA: f32 = 2.2;

fn fix_gamma(rgba: &mut [u8]) {
    let table: Vec<u8> = (0..=255u8).map(|v| ((v as f32 / 255.0).powf(SMASH_GAMMA) * 255.0).round() as u8).collect();
    for pixel in rgba.chunks_exact_mut(4) {
        for channel in &mut pixel[..3] {
            *channel = table[*channel as usize];
        }
    }
}

impl Options {
    pub fn parse(format: Option<&str>, mipmaps: Option<&str>, quality: Option<&str>) -> Result<Self> {
        let format = format.map(|f| ImageFormat::from_str(f).map_err(|_| Error::new(format!("unknown format {f}")))).transpose()?;
        let mipmaps = match mipmaps.unwrap_or("GeneratedAutomatic") {
            "GeneratedAutomatic" => Mipmaps::GeneratedAutomatic,
            "FromSurface" => Mipmaps::FromSurface,
            "Disabled" => Mipmaps::Disabled,
            other => return Err(Error::new(format!("unknown mipmaps {other}"))),
        };
        let quality = match quality.unwrap_or("Normal") {
            "Fast" => Quality::Fast,
            "Normal" => Quality::Normal,
            "Slow" => Quality::Slow,
            other => return Err(Error::new(format!("unknown quality {other}"))),
        };
        Ok(Options { format, mipmaps, quality, gamma_fix: false })
    }
}

fn bad(error: impl std::fmt::Display) -> Error {
    Error::new(format!("invalid texture: {error}"))
}

fn kind(path: &str) -> Result<Kind> {
    let extension = Path::new(path).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    match extension.as_str() {
        "dds" => Ok(Kind::Dds),
        "nutexb" => Ok(Kind::Nutexb),
        _ => FileFormat::from_extension(&extension).filter(|f| f.reading_enabled()).map(Kind::Image).ok_or_else(|| Error::new(format!("unsupported image type .{extension}"))),
    }
}

fn read(bytes: &[u8], kind: Kind) -> Result<Source> {
    Ok(match kind {
        Kind::Image(format) => Source::Image(image::load_from_memory_with_format(bytes, format).map_err(bad)?.to_rgba8()),
        Kind::Dds => Source::Dds(Dds::read(Cursor::new(bytes)).map_err(bad)?),
        Kind::Nutexb => Source::Dds(NutexbFile::read(&mut Cursor::new(bytes)).map_err(bad)?.to_dds().map_err(bad)?),
    })
}

fn format_of(bytes: &[u8], kind: Kind) -> Option<ImageFormat> {
    match read(bytes, kind).ok()? {
        Source::Dds(dds) => dds_image_format(&dds).ok(),
        Source::Image(_) => None,
    }
}

pub fn preview_texture(bytes: &[u8], path: &str) -> Result<Preview> {
    let (image, format, mipmaps) = match read(bytes, kind(path)?)? {
        Source::Image(image) => (image, None, 1),
        Source::Dds(dds) => (image_from_dds(&dds, 0).map_err(bad)?, dds_image_format(&dds).ok().map(|f| f.to_string()), dds.get_num_mipmap_levels()),
    };
    let (width, height) = image.dimensions();
    let mut thumbnail = image::DynamicImage::ImageRgba8(image);
    if width.max(height) > PREVIEW_SIZE {
        thumbnail = thumbnail.thumbnail(PREVIEW_SIZE, PREVIEW_SIZE);
    }
    let mut png = Cursor::new(Vec::new());
    thumbnail.write_to(&mut png, FileFormat::Png).map_err(bad)?;
    Ok(Preview { data: base64::engine::general_purpose::STANDARD.encode(png.into_inner()), width, height, format, mipmaps })
}

pub fn convert_texture(source: &[u8], from: &str, to: &str, existing: Option<&[u8]>, options: &Options) -> Result<Vec<u8>> {
    let output = kind(to)?;
    let input = read(source, kind(from)?)?;
    let mut out = Cursor::new(Vec::new());
    if let Kind::Image(other) = output {
        if other != FileFormat::Png {
            return Err(Error::new("can only convert to .png, .dds or .nutexb"));
        }
        let image = match input {
            Source::Image(image) => image,
            Source::Dds(dds) => image_from_dds(&dds, 0).map_err(bad)?,
        };
        image.write_to(&mut out, FileFormat::Png).map_err(bad)?;
        return Ok(out.into_inner());
    }
    let format = options
        .format
        .or_else(|| existing.and_then(|bytes| format_of(bytes, output)))
        .or_else(|| match &input {
            Source::Dds(dds) => dds_image_format(dds).ok(),
            Source::Image(_) => None,
        })
        .unwrap_or(ImageFormat::BC7RgbaUnormSrgb);
    let mut rgba = match input {
        Source::Image(image) => SurfaceRgba8 { width: image.width(), height: image.height(), depth: 1, layers: 1, mipmaps: 1, data: image.into_raw() },
        Source::Dds(dds) => SurfaceRgba8::decode_dds(&dds).map_err(bad)?,
    };
    if options.gamma_fix {
        fix_gamma(&mut rgba.data);
    }
    let dds = rgba.encode(format, options.quality, options.mipmaps).map_err(bad)?.to_dds().map_err(bad)?;
    match output {
        Kind::Dds => dds.write(&mut out).map_err(bad)?,
        _ => {
            let name = Path::new(to).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            NutexbFile::from_dds(&dds, name).map_err(bad)?.write(&mut out).map_err(bad)?
        }
    }
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_fn(width, height, |x, y| image::Rgba([(x * 16) as u8, (y * 16) as u8, 128, 255]));
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, FileFormat::Png).unwrap();
        out.into_inner()
    }

    fn convert(source: &[u8], from: &str, to: &str, existing: Option<&[u8]>) -> Vec<u8> {
        convert_texture(source, from, to, existing, &Options::default()).unwrap()
    }

    #[test]
    fn round_trips_png_through_nutexb() {
        let nutexb = convert(&png(16, 8), "a.png", "fighter/mario/def_mario_001_col.nutexb", None);
        assert_eq!(format_of(&nutexb, Kind::Nutexb), Some(ImageFormat::BC7RgbaUnormSrgb));
        let back = image::load_from_memory(&convert(&nutexb, "a.nutexb", "def_mario_001_col.png", None)).unwrap().to_rgba8();
        assert_eq!(back.dimensions(), (16, 8));
        let [r, g, b, a] = back.get_pixel(8, 4).0;
        assert!(r.abs_diff(128) <= 16 && g.abs_diff(64) <= 16 && b.abs_diff(128) <= 16 && a >= 240);
    }

    #[test]
    fn keeps_the_format_of_the_replaced_file_then_of_the_source() {
        let options = Options::parse(Some("BC7RgbaUnorm"), Some("Disabled"), Some("Fast")).unwrap();
        let previous = convert_texture(&png(8, 8), "a.png", "nor.nutexb", None, &options).unwrap();
        assert_eq!(format_of(&previous, Kind::Nutexb), Some(ImageFormat::BC7RgbaUnorm));
        let replaced = convert(&png(8, 8), "a.png", "nor.nutexb", Some(&previous));
        assert_eq!(format_of(&replaced, Kind::Nutexb), Some(ImageFormat::BC7RgbaUnorm));
        let dds = convert(&previous, "nor.nutexb", "nor.dds", None);
        assert_eq!(format_of(&dds, Kind::Dds), Some(ImageFormat::BC7RgbaUnorm));
        let nutexb = convert(&dds, "nor.dds", "nor.nutexb", None);
        assert_eq!(format_of(&nutexb, Kind::Nutexb), Some(ImageFormat::BC7RgbaUnorm));
    }

    #[test]
    fn applies_the_chosen_format() {
        let options = Options::parse(Some("BC1RgbaUnormSrgb"), None, None).unwrap();
        let nutexb = convert_texture(&png(8, 8), "a.png", "a.nutexb", None, &options).unwrap();
        assert_eq!(format_of(&nutexb, Kind::Nutexb), Some(ImageFormat::BC1RgbaUnormSrgb));
    }

    #[test]
    fn previews_a_small_copy_with_texture_info() {
        let nutexb = convert(&png(1024, 256), "a.png", "a.nutexb", None);
        let preview = preview_texture(&nutexb, "a.nutexb").unwrap();
        assert_eq!((preview.width, preview.height, preview.format.as_deref(), preview.mipmaps), (1024, 256, Some("BC7RgbaUnormSrgb"), 11));
        let data = base64::engine::general_purpose::STANDARD.decode(preview.data).unwrap();
        assert_eq!(image::load_from_memory(&data).unwrap().dimensions(), (512, 128));
    }

    #[test]
    fn reads_other_image_types() {
        let image = image::load_from_memory(&png(8, 8)).unwrap();
        for format in [FileFormat::WebP, FileFormat::Jpeg, FileFormat::Bmp, FileFormat::Tga, FileFormat::Tiff, FileFormat::Gif] {
            let mut bytes = Cursor::new(Vec::new());
            let source = if format == FileFormat::Jpeg { image::DynamicImage::ImageRgb8(image.to_rgb8()) } else { image.clone() };
            source.write_to(&mut bytes, format).unwrap();
            let path = format!("a.{}", format.extensions_str()[0]);
            assert_eq!(preview_texture(bytes.get_ref(), &path).unwrap().width, 8, "{path}");
            convert(bytes.get_ref(), &path, "a.nutexb", None);
        }
        assert!(convert_texture(&png(4, 4), "a.png", "a.webp", None, &Options::default()).is_err());
    }

    #[test]
    fn gamma_fix_darkens_midtones_like_switch_toolbox() {
        let mut pixels = vec![0, 128, 200, 128, 255, 64, 10, 77];
        fix_gamma(&mut pixels);
        assert_eq!(pixels, vec![0, 56, 149, 128, 255, 12, 0, 77]);
        let image = image::RgbaImage::from_pixel(8, 8, image::Rgba([128, 128, 128, 200]));
        let mut source = Cursor::new(Vec::new());
        image.write_to(&mut source, FileFormat::Png).unwrap();
        let options = Options { format: Some(ImageFormat::Rgba8Unorm), mipmaps: Mipmaps::Disabled, gamma_fix: true, ..Options::default() };
        let dds = convert_texture(source.get_ref(), "a.png", "a.dds", None, &options).unwrap();
        let back = image::load_from_memory(&convert(&dds, "a.dds", "a.png", None)).unwrap().to_rgba8();
        assert_eq!(back.get_pixel(0, 0).0, [56, 56, 56, 200]);
    }

    #[test]
    fn refuses_wrong_inputs() {
        assert!(convert_texture(b"not a texture", "a.nutexb", "a.png", None, &Options::default()).is_err());
        assert!(convert_texture(b"not a png", "a.png", "a.nutexb", None, &Options::default()).is_err());
        assert!(convert_texture(&png(4, 4), "a.png", "a.tga", None, &Options::default()).is_err());
        assert!(Options::parse(Some("Nope"), None, None).is_err());
        assert!(Options::parse(None, Some("GeneratedExact"), None).is_err());
    }
}
